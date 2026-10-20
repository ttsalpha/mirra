import type { Layout, NodeProps, Radius, Sizing, UINode } from "@mirra/schema";
import { TokenIndex, isRef } from "./tokens";
import {
  toCounterAxisAlign,
  toEffects,
  toPadding,
  toPaints,
  toPrimaryAxisAlign,
  toRadius,
  toStrokes,
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

  await applyProps(node, spec, tokens);

  if (spec.type === "frame") {
    for (const child of spec.children ?? []) {
      await buildNode(child, node as FrameNode, keys, tokens, deferred);
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
  applySizing(node, spec.w ?? fallback, "Horizontal");
  applySizing(node, spec.h ?? fallback, "Vertical");
  return node;
}

async function createNode(spec: UINode, parent: Container): Promise<SceneNode> {
  const node = await make(spec);
  parent.appendChild(node);
  if (spec.type === "svg" || spec.type === "image") remember(node, spec);
  // The layer can be renamed, so the component it came from is recorded.
  if (spec.type === "instance") node.setPluginData(COMPONENT_FIELD, spec.component);
  return node;
}

async function make(spec: UINode): Promise<SceneNode> {
  switch (spec.type) {
    case "frame":
      return figma.createFrame();
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

function stripDataUri(src: string): string {
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
async function findComponent(name: string): Promise<ComponentNode> {
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

/** Shared by `render` and `patch`; `w`/`h` are left to `applySizing`. */
export async function applyProps(
  node: SceneNode,
  props: NodeProps,
  tokens = new TokenIndex(),
): Promise<void> {
  if (props.name !== undefined) node.name = props.name;
  if (props.opacity !== undefined) (node as SceneNode & BlendMixin).opacity = props.opacity;
  if (props.visible !== undefined) node.visible = props.visible;

  if (props.layout !== undefined || props.clip !== undefined) {
    if (node.type !== "FRAME") {
      throw new Error(`layout and clip only apply to a frame, not a ${low(node)}`);
    }
    applyLayout(node, props.layout, props.clip);
  }

  await applyPaint(node, props, tokens);

  if (props.properties) {
    if (node.type !== "INSTANCE") {
      throw new Error(`component properties only apply to an instance, not a ${low(node)}`);
    }
    node.setProperties(resolveProperties(node, props.properties));
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

  if (props.size !== undefined) text.fontSize = props.size;
  if (props.lineHeight !== undefined) {
    text.lineHeight =
      props.lineHeight === "auto" ? { unit: "AUTO" } : { unit: "PIXELS", value: props.lineHeight };
  }
  if (props.letterSpacing !== undefined) {
    text.letterSpacing = { unit: "PIXELS", value: props.letterSpacing };
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

function applyLayout(
  frame: FrameNode,
  layout: Layout | undefined,
  clip: boolean | undefined,
): void {
  if (clip !== undefined) frame.clipsContent = clip;
  if (!layout) return;

  const { dir, gap, pad, justify, align, wrap } = layout;
  frame.layoutMode = dir === "horizontal" ? "HORIZONTAL" : "VERTICAL";
  if (gap !== undefined) frame.itemSpacing = gap;
  if (pad !== undefined) {
    const { top, right, bottom, left } = toPadding(pad);
    frame.paddingTop = top;
    frame.paddingRight = right;
    frame.paddingBottom = bottom;
    frame.paddingLeft = left;
  }
  if (wrap !== undefined) frame.layoutWrap = wrap ? "WRAP" : "NO_WRAP";
  if (justify) frame.primaryAxisAlignItems = toPrimaryAxisAlign(justify);
  if (align) frame.counterAxisAlignItems = toCounterAxisAlign(align);
}

async function applyPaint(node: SceneNode, props: NodeProps, tokens: TokenIndex): Promise<void> {
  const shape = node as SceneNode & GeometryMixin & CornerMixin & BlendMixin;

  // Figma gives every new frame a white fill; an unspecified fill should mean
  // transparent, the way a div without a background does.
  if (!props.fill && node.type === "FRAME") shape.fills = [];

  // On a text node `fill` would fight with `color`, which owns its paints.
  if (props.fill && node.type !== "TEXT") {
    shape.fills = isRef(props.fill) ? [await boundPaint(props.fill, tokens)] : toPaints(props.fill);
  }
  if (props.stroke) {
    const { paints, weight, align } = toStrokes(props.stroke);
    shape.strokes = paints;
    shape.strokeWeight = weight;
    shape.strokeAlign = align;
  }
  if (props.radius !== undefined) applyRadius(shape, props.radius);
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
function applyRadius(node: CornerMixin, radius: Radius): void {
  const [topLeft, topRight, bottomRight, bottomLeft] = toRadius(radius);
  if (!("topLeftRadius" in node)) {
    node.cornerRadius = topLeft;
    return;
  }
  const corners = node as CornerMixin & RectangleCornerMixin;
  corners.topLeftRadius = topLeft;
  corners.topRightRadius = topRight;
  corners.bottomRightRadius = bottomRight;
  corners.bottomLeftRadius = bottomLeft;
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
