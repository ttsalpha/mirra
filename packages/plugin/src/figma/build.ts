import type { Layout, NodeProps, Radius, Sizing, UINode } from "@mirra/schema";
import {
  applyJam,
  checkJamProps,
  checkNotJamProps,
  fixedSize,
  isJamNode,
  isJamSpec,
  makeJam,
  settled,
  settleSection,
  type JamContext,
} from "./jam";
import { TokenIndex, isRef } from "./tokens";
import {
  toCounterAxisAlign,
  toEffects,
  toPadding,
  toPaints,
  toPrimaryAxisAlign,
  toRadius,
  toStrokeAlign,
} from "./values";

export const KEY_FIELD = "mirra:key";
export const SVG_FIELD = "mirra:svg";
export const SRC_FIELD = "mirra:src";
export const COMPONENT_FIELD = "mirra:component";

/** pluginData is capped per entry, so long markup is remembered by path only. */
const MAX_REMEMBERED_SOURCE = 50_000;

type Container = BaseNode & ChildrenMixin;

/**
 * Builds the node under `parent`, because Figma only honours fill/hug sizing
 * once a node knows its parent.
 */
/** Work that can only be done once the tree has reached its final size. */
export type Deferred = (() => void)[];

export async function buildNode(
  spec: UINode,
  parent: Container,
  keys: Record<string, string>,
  tokens = new TokenIndex(),
  deferred: Deferred = [],
): Promise<SceneNode> {
  const node = await createNode(spec, parent);

  // The parent's key is recorded before its children's, so `keys` reads top down.
  if (spec.key) {
    node.setPluginData(KEY_FIELD, spec.key);
    keys[spec.key] = node.id;
  }

  await applyProps(node, spec, tokens, { keys, deferred });

  if (spec.type === "frame" || spec.type === "section") {
    const pinned = new Set<SceneNode>();
    for (const child of spec.children ?? []) {
      const built = await buildNode(child, node as FrameNode, keys, tokens, deferred);
      if (child.at) pinned.add(built);
    }
    // Queued after the children's pins, which it reads.
    if (spec.type === "section") {
      deferred.push(() => settleSection(node as SectionNode, spec.layout, pinned, fixedSize(spec)));
    }
  }

  applyBounds(node, spec);
  applyConstraints(node, spec);
  // Pinning waits: a constraint drags the node when its parent is resized, and
  // the parent only reaches its final size once the whole tree is built.
  if (spec.at) deferred.push(() => pin(node, spec.at));

  // Sizing comes last: "hug" means nothing until the children are in. An auto
  // layout frame hugs by default, or Figma keeps the 100x100 it starts every
  // frame with.
  const fallback = spec.type === "frame" && spec.layout ? "hug" : undefined;
  const size = spec as { w?: Sizing; h?: Sizing };
  applySizing(node, size.w ?? fallback, "Horizontal");
  applySizing(node, size.h ?? fallback, "Vertical");
  // After sizing, before the deferred pin: Figma moves x and y when it rotates.
  applyRotation(node, spec);
  return node;
}

async function createNode(spec: UINode, parent: Container): Promise<SceneNode> {
  const node = await make(spec).catch((error: unknown) => {
    // FigJam lacks some of Figma Design's node types.
    if (figma.editorType !== "figjam" || isJamSpec(spec)) throw error;
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${spec.type} cannot be created in FigJam (${cause}). Use sticky, shape, connector, ` +
        `section, table, code or link.`,
    );
  });
  parent.appendChild(node);
  if (spec.type === "link") await settled(node);
  if (spec.type === "svg" || spec.type === "image" || spec.type === "gif") remember(node, spec);
  // The layer can be renamed, so the component it came from is recorded.
  if (spec.type === "instance") node.setPluginData(COMPONENT_FIELD, spec.component);
  return node;
}

async function make(spec: UINode): Promise<SceneNode> {
  if (isJamSpec(spec)) return makeJam(spec);

  switch (spec.type) {
    case "frame": {
      // Figma gives every new frame a white fill; an unspecified fill should mean
      // transparent, the way a div without a background does.
      const frame = figma.createFrame();
      frame.fills = [];
      return frame;
    }
    case "text":
      return figma.createText();
    case "rect":
      return figma.createRectangle();
    case "ellipse":
      return figma.createEllipse();
    case "instance":
      return (await findComponent(spec.component)).createInstance();
    case "svg":
      return figma.createNodeFromSvg(spec.src);
    case "image":
      return imageRect(spec.src, spec.fit);
  }
}

/** An image lives on a rectangle, the way Figma models an image fill. */
async function imageRect(
  src: string,
  fit: "fill" | "fit" | "crop" | "tile" | undefined,
): Promise<RectangleNode> {
  const image = figma.createImage(figma.base64Decode(stripDataUri(src)));
  const rect = figma.createRectangle();
  rect.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: SCALE_MODES[fit ?? "fill"] }];

  // Start at the image's own size; an explicit w/h still overrides it later.
  const { width, height } = await image.getSizeAsync();
  rect.resize(width, height);
  return rect;
}

const SCALE_MODES = {
  fill: "FILL",
  fit: "FIT",
  crop: "CROP",
  tile: "TILE",
} as const;

export function stripDataUri(src: string): string {
  const comma = src.indexOf(",");
  return src.startsWith("data:") && comma !== -1 ? src.slice(comma + 1) : src;
}

/** Keeps enough of the source that `read` can hand the same tree back. */
function remember(node: SceneNode, spec: { src: string; srcRef?: string; type: string }): void {
  const field = spec.type === "svg" ? SVG_FIELD : SRC_FIELD;
  if (spec.srcRef) node.setPluginData(field, spec.srcRef);
  else if (spec.src.length <= MAX_REMEMBERED_SOURCE) node.setPluginData(field, spec.src);
}

/** Components are looked up by name on the current page, variants as "Set/Variant". */
export async function findComponent(name: string): Promise<ComponentNode> {
  const components = figma.currentPage.findAllWithCriteria({ types: ["COMPONENT"] });
  const match = components.find((component) => componentPath(component) === name);
  if (!match) {
    const available = components.map(componentPath).slice(0, 10).join(", ");
    throw new Error(
      `No component named "${name}" on this page${available ? `. Found: ${available}` : ""}`,
    );
  }
  return match;
}

function componentPath(component: ComponentNode): string {
  const parent = component.parent;
  return parent && parent.type === "COMPONENT_SET"
    ? `${parent.name}/${component.name}`
    : component.name;
}

const VECTOR_TYPES = new Set(["VECTOR", "STAR", "POLYGON", "LINE", "BOOLEAN_OPERATION"]);

/**
 * What `set` can change beyond the props `render` and `patch` share: the key, the
 * component an instance follows, and the source of an image or svg. Figma cannot
 * swap an svg's markup in place, so that node is replaced and the new one returned.
 */
export async function applyIdentity(
  node: SceneNode,
  props: NodeProps,
  keys: Record<string, string>,
): Promise<SceneNode> {
  let current = node;

  if (props.src !== undefined) current = await swapSource(current, props, keys);
  else if (props.fit !== undefined) setFit(current, props.fit);

  if (props.component !== undefined) {
    if (current.type !== "INSTANCE") {
      throw new Error(`component only applies to an instance, not a ${low(current)}`);
    }
    current.swapComponent(await findComponent(props.component));
    current.setPluginData(COMPONENT_FIELD, props.component);
  }

  if (props.key !== undefined) {
    const taken = figma.currentPage
      .findAllWithCriteria({ pluginData: { keys: [KEY_FIELD] } })
      .some((other) => other.id !== current.id && other.getPluginData(KEY_FIELD) === props.key);
    if (taken) throw new Error(`Another node already has the key "${props.key}"`);
    current.setPluginData(KEY_FIELD, props.key);
    keys[props.key] = current.id;
  }

  return current;
}

async function swapSource(
  node: SceneNode,
  props: NodeProps,
  keys: Record<string, string>,
): Promise<SceneNode> {
  const src = props.src as string;

  if (node.type === "RECTANGLE") {
    const image = figma.createImage(figma.base64Decode(stripDataUri(src)));
    const fit = props.fit ?? currentFit(node) ?? "fill";
    node.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: SCALE_MODES[fit] }];
    node.setPluginData(SRC_FIELD, "");
    remember(node, { ...props, src, type: "image" });
    return node;
  }

  const isSvg = node.getPluginData(SVG_FIELD) !== "" || VECTOR_TYPES.has(node.type);
  if (!isSvg || !node.parent || !("insertChild" in node.parent)) {
    throw new Error(`src only applies to an image or svg, not a ${low(node)}`);
  }

  const parent = node.parent as BaseNode & ChildrenMixin;
  const replacement = figma.createNodeFromSvg(src);
  parent.insertChild(parent.children.indexOf(node), replacement);
  replacement.name = node.name;
  replacement.opacity = (node as SceneNode & BlendMixin).opacity;
  replacement.visible = node.visible;
  if (!("layoutMode" in parent) || parent.layoutMode === "NONE") {
    replacement.x = node.x;
    replacement.y = node.y;
  }
  remember(replacement, { ...props, src, type: "svg" });

  const key = node.getPluginData(KEY_FIELD);
  if (key) {
    replacement.setPluginData(KEY_FIELD, key);
    keys[key] = replacement.id;
  }
  node.remove();
  return replacement;
}

function setFit(node: SceneNode, fit: keyof typeof SCALE_MODES): void {
  const paints = node.type === "RECTANGLE" && Array.isArray(node.fills) ? node.fills : [];
  if (!paints.some((paint) => paint.type === "IMAGE")) {
    throw new Error(`fit only applies to an image, not a ${low(node)}`);
  }
  (node as RectangleNode).fills = paints.map((paint) =>
    paint.type === "IMAGE" ? { ...paint, scaleMode: SCALE_MODES[fit] } : paint,
  );
}

function currentFit(node: RectangleNode): keyof typeof SCALE_MODES | undefined {
  const paint = Array.isArray(node.fills) ? node.fills.find((p) => p.type === "IMAGE") : undefined;
  const mode = paint && paint.type === "IMAGE" ? paint.scaleMode : undefined;
  return (Object.keys(SCALE_MODES) as (keyof typeof SCALE_MODES)[]).find(
    (fit) => SCALE_MODES[fit] === mode,
  );
}

/** Shared by `render` and `patch`; `w`/`h` are left to `applySizing`. */
export async function applyProps(
  node: SceneNode,
  props: NodeProps,
  tokens = new TokenIndex(),
  jam: JamContext = { keys: {}, deferred: [] },
): Promise<void> {
  const flat = isJamNode(node);
  if (flat) checkJamProps(node, props);
  else checkNotJamProps(node, props);

  if (props.name !== undefined) node.name = props.name;
  if (props.opacity !== undefined) (node as SceneNode & BlendMixin).opacity = props.opacity;
  if (props.visible !== undefined) node.visible = props.visible;

  if (props.layout !== undefined || props.clip !== undefined) {
    // A section is laid out after its children are in, by buildNode and patch.
    if (node.type !== "FRAME" && node.type !== "SECTION") {
      throw new Error(`layout and clip only apply to a frame, not a ${low(node)}`);
    }
    if (node.type === "FRAME") await applyLayout(node, props.layout, props.clip, tokens);
  }

  await applyPaint(node, props, tokens);

  if (props.properties) {
    if (node.type !== "INSTANCE") {
      throw new Error(`component properties only apply to an instance, not a ${low(node)}`);
    }
    node.setProperties(resolveProperties(node, props.properties));
  }

  if (flat) {
    await applyJam(node, props, jam);
    return;
  }

  const typography =
    props.text !== undefined ||
    props.font !== undefined ||
    props.size !== undefined ||
    props.lineHeight !== undefined ||
    props.letterSpacing !== undefined ||
    props.align !== undefined ||
    props.color !== undefined ||
    props.style !== undefined;

  if (typography) {
    if (node.type !== "TEXT") {
      throw new Error(`text properties only apply to a text node, not a ${low(node)}`);
    }
    await applyText(node, props, tokens);
  }
}

async function applyText(text: TextNode, props: NodeProps, tokens: TokenIndex): Promise<void> {
  const style = props.style ? await tokens.textStyle(props.style) : null;
  if (style) {
    await figma.loadFontAsync(style.fontName);
    await text.setTextStyleIdAsync(style.id);
  }

  if (props.font) {
    const fallback = text.fontName === figma.mixed ? "Regular" : text.fontName.style;
    const font: FontName = { family: props.font.family, style: props.font.style ?? fallback };
    await figma.loadFontAsync(font);
    text.fontName = font;
  } else if (!style) {
    // Characters cannot be set until the node's own font is loaded. Assigning
    // fontName here would detach a text style, so nothing is written.
    const current =
      text.fontName === figma.mixed ? { family: "Inter", style: "Regular" } : text.fontName;
    await figma.loadFontAsync(current);
  }

  if (props.text !== undefined) text.characters = props.text;

  if (props.size !== undefined) await setNumbers(text, { fontSize: props.size }, tokens);
  if (props.lineHeight !== undefined) {
    if (props.lineHeight === "auto") text.lineHeight = { unit: "AUTO" };
    else if (isRef(props.lineHeight)) {
      await setNumbers(text, { lineHeight: props.lineHeight }, tokens);
    } else text.lineHeight = { unit: "PIXELS", value: props.lineHeight };
  }
  if (props.letterSpacing !== undefined) {
    if (isRef(props.letterSpacing)) {
      await setNumbers(text, { letterSpacing: props.letterSpacing }, tokens);
    } else {
      text.letterSpacing = { unit: "PIXELS", value: props.letterSpacing };
    }
  }
  if (props.align) {
    text.textAlignHorizontal = props.align.toUpperCase() as TextNode["textAlignHorizontal"];
  }
  if (props.color) {
    text.fills = isRef(props.color)
      ? [await boundPaint(props.color, tokens)]
      : toPaints(props.color);
  }
}

async function applyLayout(
  frame: FrameNode,
  layout: Layout | undefined,
  clip: boolean | undefined,
  tokens: TokenIndex,
): Promise<void> {
  if (clip !== undefined) frame.clipsContent = clip;
  if (!layout) return;

  const { dir, gap, pad, justify, align, wrap } = layout;
  frame.layoutMode = dir === "horizontal" ? "HORIZONTAL" : "VERTICAL";
  if (gap !== undefined) await setNumbers(frame, { itemSpacing: gap }, tokens);
  if (pad !== undefined) {
    const { top, right, bottom, left } = toPadding(pad);
    const sides = {
      paddingTop: top,
      paddingRight: right,
      paddingBottom: bottom,
      paddingLeft: left,
    };
    await setNumbers(frame, sides, tokens);
  }
  if (wrap !== undefined) frame.layoutWrap = wrap ? "WRAP" : "NO_WRAP";
  if (justify) frame.primaryAxisAlignItems = toPrimaryAxisAlign(justify);
  if (align) frame.counterAxisAlignItems = toCounterAxisAlign(align);
}

async function applyPaint(node: SceneNode, props: NodeProps, tokens: TokenIndex): Promise<void> {
  const shape = node as SceneNode & GeometryMixin & CornerMixin & BlendMixin;

  // On a text node `fill` would fight with `color`, which owns its paints.
  if (props.fill && node.type !== "TEXT") {
    shape.fills = isRef(props.fill) ? [await boundPaint(props.fill, tokens)] : toPaints(props.fill);
  }
  if (props.stroke) {
    const { color, width, align } = props.stroke;
    shape.strokes = isRef(color) ? [await boundPaint(color, tokens)] : toPaints(color);
    shape.strokeAlign = toStrokeAlign(align);
    await setNumbers(shape, { strokeWeight: width ?? 1 }, tokens);
  }
  if (props.radius !== undefined) await applyRadius(shape, props.radius, tokens);
  if (props.effects) shape.effects = toEffects(props.effects);
}

/**
 * Figma suffixes component property names with an id ("Label#1:23"), which is
 * noise in a tree, so a plain name is matched against the real ones here.
 * Numbers are a convenience the DSL allows; Figma only takes strings and booleans.
 */
function resolveProperties(
  node: InstanceNode,
  properties: Record<string, string | number | boolean>,
): Record<string, string | boolean> {
  const available = node.componentProperties;
  const resolved: Record<string, string | boolean> = {};

  for (const [name, value] of Object.entries(properties)) {
    const match =
      name in available
        ? name
        : Object.keys(available).find((candidate) => candidate.split("#")[0] === name);

    if (!match) {
      const names = Object.keys(available)
        .map((candidate) => candidate.split("#")[0])
        .join(", ");
      throw new Error(
        `"${node.name}" has no component property "${name}"${names ? `. It has: ${names}` : ""}`,
      );
    }
    resolved[match] = typeof value === "number" ? String(value) : value;
  }

  return resolved;
}

/** A solid paint whose colour follows a variable, so the design system stays in charge. */
async function boundPaint(ref: string, tokens: TokenIndex): Promise<Paint> {
  const variable = await tokens.variable(ref);
  const base: SolidPaint = { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
  return figma.variables.setBoundVariableForPaint(base, "color", variable);
}

function low(node: SceneNode): string {
  return node.type.toLowerCase();
}

/** Only rectangles and frames carry per-corner radii; an ellipse has one. */
async function applyRadius(node: CornerMixin, radius: Radius, tokens: TokenIndex): Promise<void> {
  const [topLeft, topRight, bottomRight, bottomLeft] = toRadius(radius);
  if (!("topLeftRadius" in node)) {
    if (isRef(topLeft)) {
      throw new Error("A radius token needs a node with corners; this one takes a number");
    }
    node.cornerRadius = topLeft;
    return;
  }
  await setNumbers(
    node,
    {
      topLeftRadius: topLeft,
      topRightRadius: topRight,
      bottomRightRadius: bottomRight,
      bottomLeftRadius: bottomLeft,
    },
    tokens,
  );
}

/** A "$name" binds the field to its variable; anything else is written straight in. */
async function setNumbers(
  node: object,
  fields: Record<string, number | string>,
  tokens: TokenIndex,
): Promise<void> {
  for (const [field, value] of Object.entries(fields)) {
    if (!isRef(value)) {
      (node as Record<string, unknown>)[field] = value;
      continue;
    }
    const bindable = node as { setBoundVariable?: (field: string, variable: Variable) => void };
    if (!bindable.setBoundVariable) throw new Error(`"${field}" cannot follow a variable`);
    bindable.setBoundVariable(field, await tokens.variable(value));
  }
}

const CONSTRAINTS = {
  min: "MIN",
  center: "CENTER",
  max: "MAX",
  stretch: "STRETCH",
  scale: "SCALE",
} as const;

/** Bounds only bite on a node that fills or hugs, which is where they matter. */
export function applyBounds(node: SceneNode, props: NodeProps): void {
  const box = node as SceneNode & {
    minWidth?: number | null;
    maxWidth?: number | null;
    minHeight?: number | null;
    maxHeight?: number | null;
  };
  if (props.minW !== undefined) box.minWidth = props.minW;
  if (props.maxW !== undefined) box.maxWidth = props.maxW;
  if (props.minH !== undefined) box.minHeight = props.minH;
  if (props.maxH !== undefined) box.maxHeight = props.maxH;
}

export function applyRotation(node: SceneNode, props: NodeProps): void {
  if (props.rotation === undefined) return;
  (node as SceneNode & { rotation: number }).rotation = props.rotation;
}

export function applyConstraints(node: SceneNode, props: NodeProps): void {
  if (!props.constraints) return;
  const target = node as SceneNode & { constraints?: Constraints };
  target.constraints = {
    horizontal: CONSTRAINTS[props.constraints.h],
    vertical: CONSTRAINTS[props.constraints.v],
  };
}

/** `at` inside an auto layout means "take this out of the flow and pin it". */
export function pin(node: SceneNode, at: { x: number; y: number } | undefined): void {
  if (!at) return;

  const parent = node.parent;
  const inFlow = parent !== null && "layoutMode" in parent && parent.layoutMode !== "NONE";
  if (inFlow)
    (node as SceneNode & { layoutPositioning?: "AUTO" | "ABSOLUTE" }).layoutPositioning =
      "ABSOLUTE";

  const placed = node as SceneNode & { x: number; y: number };
  placed.x = at.x;
  placed.y = at.y;
}

export function applySizing(
  node: SceneNode,
  sizing: Sizing | undefined,
  axis: "Horizontal" | "Vertical",
): void {
  if (sizing === undefined) return;

  if (typeof sizing === "number") {
    const box = node as SceneNode & LayoutMixin;
    if (axis === "Horizontal") box.resize(sizing, box.height);
    else box.resize(box.width, sizing);
    return;
  }

  const layoutNode = node as SceneNode & {
    layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
    layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  };
  const field = axis === "Horizontal" ? "layoutSizingHorizontal" : "layoutSizingVertical";
  if (!(field in layoutNode)) {
    throw new Error(`"${sizing}" sizing is not available on a ${node.type.toLowerCase()} node`);
  }
  layoutNode[field] = sizing === "fill" ? "FILL" : "HUG";
}
