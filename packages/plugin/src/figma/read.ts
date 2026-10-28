import { CONNECTOR_CAPS, CONNECTOR_LINES, MAGNETS, SHAPE_TYPES } from "@mirra/schema/constants";
import type { ConnectorEnd, Layout, Sizing, TextNode as TextSpec, UINode } from "@mirra/schema";
import { COMPONENT_FIELD, KEY_FIELD, SRC_FIELD, SVG_FIELD } from "./build";
import { readFont } from "./jam";
import { EMPTY_NAMES, type NameIndex } from "./tokens";
import {
  fromCounterAxisAlign,
  fromEffects,
  fromPadding,
  fromPaints,
  fromPrimaryAxisAlign,
  fromRadius,
} from "./values";

export type ReadOutcome = { tree: UINode | null; skipped: number };

type Budget = { count: number; left: number };

/** Inverse of `buildNode`, bounded by depth and node count. */
export async function readNode(
  node: SceneNode,
  depth: number,
  names: NameIndex = EMPTY_NAMES,
  limit = Number.MAX_SAFE_INTEGER,
): Promise<ReadOutcome> {
  const budget: Budget = { count: 0, left: limit };
  const tree = await toSpec(node, depth, budget, names);
  return { tree, skipped: budget.count };
}

async function toSpec(
  node: SceneNode,
  depth: number,
  budget: Budget,
  names: NameIndex,
): Promise<UINode | null> {
  if (budget.left <= 0) {
    budget.count += 1;
    return null;
  }
  budget.left -= 1;

  if (node.type === "MEDIA") return mediaSpec(node, budget);

  const svg = node.getPluginData(SVG_FIELD);
  if (svg) return { type: "svg", ...common(node), src: svg };

  const src = node.getPluginData(SRC_FIELD);
  if (src) return { type: "image", ...common(node), ...painted(node, names), src };

  switch (node.type) {
    case "STICKY":
    case "SHAPE_WITH_TEXT":
    case "CONNECTOR":
    case "TABLE":
    case "CODE_BLOCK":
    case "EMBED":
    case "LINK_UNFURL":
      return jamSpec(node, names);
    case "SECTION":
      // FigJam's own container reads back as itself; in Figma Design it stays a frame.
      if (figma.editorType === "figjam") return sectionSpec(node, depth, budget, names);
      return frameSpec(node, depth, budget, names);
    case "TEXT":
      return textSpec(node, names);
    case "RECTANGLE":
      return { type: "rect", ...common(node), ...painted(node, names) };
    case "ELLIPSE":
      return { type: "ellipse", ...common(node), ...painted(node, names) };
    case "INSTANCE":
      return instanceSpec(node);
    // Containers the DSL has no type of its own for.
    case "FRAME":
    case "COMPONENT":
    case "COMPONENT_SET":
    case "GROUP":
      return frameSpec(node, depth, budget, names);
    // Shapes with no type either, but which export as the markup that redraws them.
    case "VECTOR":
    case "STAR":
    case "POLYGON":
    case "LINE":
    case "BOOLEAN_OPERATION": {
      const vector = await vectorSpec(node);
      if (vector) return vector;
      budget.count += 1;
      return null;
    }
    default:
      budget.count += 1;
      return null;
  }
}

/** Rendering the result makes a plain frame, which `patch` can turn back into a component. */
async function frameSpec(
  node: SceneNode & ChildrenMixin,
  depth: number,
  budget: Budget,
  names: NameIndex,
): Promise<UINode> {
  const children: UINode[] = [];
  if (depth > 0) {
    for (const child of node.children) {
      const spec = await toSpec(child, depth - 1, budget, names);
      if (spec) children.push(spec);
    }
  } else if (node.children.length) {
    budget.count += node.children.length;
  }

  const layout = layoutSpec(node, names);
  const clips = (node as Partial<FrameNode>).clipsContent;

  return {
    type: "frame",
    ...common(node),
    ...painted(node, names),
    ...(clips === false ? { clip: false } : {}),
    ...(layout ? { layout } : {}),
    ...(children.length ? { children } : {}),
  };
}

/** Children keep their place, since FigJam has no layout to derive it from. */
async function sectionSpec(
  node: SectionNode,
  depth: number,
  budget: Budget,
  names: NameIndex,
): Promise<UINode> {
  const children: UINode[] = [];
  if (depth > 0) {
    for (const child of node.children) {
      const spec = await toSpec(child, depth - 1, budget, names);
      if (spec) children.push(spec.type === "connector" ? spec : withAt(child, spec));
    }
  } else if (node.children.length) {
    budget.count += node.children.length;
  }

  const fill = fromPaints(node.fills, names);
  const stroke = strokeSpec(node as SectionNode & GeometryMixin, names);
  const radius = node.cornerRadius;

  return {
    type: "section",
    ...jamCommon(node),
    w: round(node.width),
    h: round(node.height),
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
    ...(typeof radius === "number" && radius !== 0 ? { radius } : {}),
    ...(children.length ? { children } : {}),
  };
}

function withAt(node: SceneNode, spec: UINode): UINode {
  return { ...spec, at: { x: round(node.x), y: round(node.y) } } as UINode;
}

const REVERSE = <T extends Record<string, string>>(map: T) =>
  Object.fromEntries(Object.entries(map).map(([name, value]) => [value, name])) as Record<
    string,
    keyof T & string
  >;
const SHAPE_NAMES = REVERSE(SHAPE_TYPES);
const LINE_NAMES = REVERSE(CONNECTOR_LINES);
const CAP_NAMES = REVERSE(CONNECTOR_CAPS);
const MAGNET_NAMES = REVERSE(MAGNETS);

/** Key, name and visibility. */
function jamCommon(node: SceneNode) {
  const key = node.getPluginData(KEY_FIELD);
  const blend = node as SceneNode & { opacity?: number };
  return {
    ...(key ? { key } : {}),
    name: node.name,
    ...(blend.opacity === undefined || blend.opacity === 1 ? {} : { opacity: blend.opacity }),
    ...(node.visible ? {} : { visible: false }),
  };
}

/** FigJam's default text colours: a sticky's, and a table cell's. Not repeated on every node. */
const DEFAULT_TEXT_COLORS = new Set(["#000000", "#000000cc", "#1e1e1e"]);

function sublayerText(layer: TextSublayerNode, names: NameIndex) {
  const font = readFont(layer);
  const size = layer.fontSize === figma.mixed ? undefined : layer.fontSize;
  const color = fromPaints(layer.fills, names);
  const spacing = layer.letterSpacing === figma.mixed ? undefined : layer.letterSpacing;

  return {
    text: layer.characters,
    ...(font ? { font: { family: font.family, style: font.style } } : {}),
    ...(size === undefined ? {} : { size }),
    ...(spacing && spacing.unit === "PIXELS" && spacing.value !== 0
      ? { letterSpacing: spacing.value }
      : {}),
    ...(color && !DEFAULT_TEXT_COLORS.has(color as string) ? { color } : {}),
  };
}

/** A GIF's bytes cannot be read back, so one is only known by the file it came from. */
function mediaSpec(node: MediaNode, budget: Budget): UINode | null {
  const src = node.getPluginData(SRC_FIELD);
  if (!src) {
    budget.count += 1;
    return null;
  }
  return withAt(node, {
    type: "gif",
    ...jamCommon(node),
    src,
    w: round(node.width),
    h: round(node.height),
  });
}

function key(value: unknown): string {
  return JSON.stringify(value) ?? "";
}

function commonest<T>(values: (T | undefined)[]): T | undefined {
  const counts = new Map<string, { value: T; count: number }>();
  for (const value of values) {
    if (value === undefined) continue;
    const entry = counts.get(key(value)) ?? { value, count: 0 };
    entry.count += 1;
    counts.set(key(value), entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.value;
}

async function jamSpec(node: SceneNode, names: NameIndex): Promise<UINode | null> {
  switch (node.type) {
    case "STICKY": {
      const fill = fromPaints(node.fills, names);
      return withAt(node, {
        type: "sticky",
        ...jamCommon(node),
        ...sublayerText(node.text, names),
        ...(fill ? { fill } : {}),
        ...(node.isWideWidth ? { wide: true } : {}),
        ...(node.authorVisible ? { author: true } : {}),
      });
    }
    case "SHAPE_WITH_TEXT": {
      const fill = fromPaints(node.fills, names);
      const stroke = strokeSpec(node as ShapeWithTextNode & GeometryMixin, names);
      const angle = round(node.rotation);
      return withAt(node, {
        type: "shape",
        ...jamCommon(node),
        shape: SHAPE_NAMES[node.shapeType] ?? "square",
        w: round(node.width),
        h: round(node.height),
        ...(angle === 0 ? {} : { rotation: angle }),
        ...sublayerText(node.text, names),
        ...(fill ? { fill } : {}),
        ...(stroke ? { stroke } : {}),
      });
    }
    case "CONNECTOR": {
      const stroke = strokeSpec(node as ConnectorNode & GeometryMixin, names);
      const label = node.text.characters;
      // What a bare key would have meant, so it is not spelled out again.
      const assumed = node.connectorLineType === "STRAIGHT" ? "center" : "auto";
      return {
        type: "connector",
        ...jamCommon(node),
        from: await endSpec(node.connectorStart, assumed),
        to: await endSpec(node.connectorEnd, assumed),
        line: LINE_NAMES[node.connectorLineType] ?? "elbow",
        startCap: CAP_NAMES[node.connectorStartStrokeCap] ?? "none",
        endCap: CAP_NAMES[node.connectorEndStrokeCap] ?? "none",
        ...(label ? { text: label } : {}),
        ...(stroke ? { stroke } : {}),
      };
    }
    case "TABLE": {
      const grid = Array.from({ length: node.numRows }, (_, row) =>
        Array.from({ length: node.numColumns }, (_, column) => {
          const cell = node.cellAt(row, column);
          return {
            text: cell.text.characters,
            fill: fromPaints(cell.fills, names),
            color: fromPaints(cell.text.fills, names),
          };
        }),
      );
      // The table's own fills do not read back in FigJam, so the commonest cell fill stands in.
      const fill = commonest(grid.flat().map((cell) => cell.fill));
      const rows = grid.map((line) =>
        line.map((cell) => {
          const ownFill = cell.fill !== undefined && key(cell.fill) !== key(fill);
          const ownColor =
            cell.color !== undefined && !DEFAULT_TEXT_COLORS.has(cell.color as string);
          if (!ownFill && !ownColor) return cell.text;
          return {
            text: cell.text,
            ...(ownFill ? { fill: cell.fill } : {}),
            ...(ownColor ? { color: cell.color } : {}),
          };
        }),
      );
      return withAt(node, {
        type: "table",
        ...jamCommon(node),
        rows,
        colWidths: Array.from({ length: node.numColumns }, (_, column) =>
          round(node.cellAt(0, column).width),
        ),
        rowHeights: Array.from({ length: node.numRows }, (_, row) =>
          round(node.cellAt(row, 0).height),
        ),
        ...(fill ? { fill } : {}),
      });
    }
    case "CODE_BLOCK":
      return withAt(node, {
        type: "code",
        ...jamCommon(node),
        code: node.code,
        language: node.codeLanguage.toLowerCase() as never,
      });
    case "EMBED": {
      const { canonicalUrl, srcUrl } = node.embedData;
      return withAt(node, { type: "link", ...jamCommon(node), url: canonicalUrl ?? srcUrl });
    }
    case "LINK_UNFURL":
      return withAt(node, { type: "link", ...jamCommon(node), url: node.linkUnfurlData.url });
    default:
      return null;
  }
}

/** A node with a key reads back as that key. */
async function endSpec(end: ConnectorEndpoint, assumed: "auto" | "center"): Promise<ConnectorEnd> {
  if (!("endpointNodeId" in end)) return { x: round(end.position.x), y: round(end.position.y) };

  const target = await figma.getNodeByIdAsync(end.endpointNodeId);
  const key = target && "getPluginData" in target ? target.getPluginData(KEY_FIELD) : "";
  const magnet = "magnet" in end ? (MAGNET_NAMES[end.magnet] ?? assumed) : assumed;

  if (key) return magnet === assumed ? key : { key, magnet };
  return { id: end.endpointNodeId, magnet };
}

async function vectorSpec(node: SceneNode): Promise<UINode | null> {
  try {
    const src = await node.exportAsync({ format: "SVG_STRING" });
    return { type: "svg", ...common(node), src };
  } catch {
    return null;
  }
}

function layoutSpec(node: SceneNode, names: NameIndex): Layout | undefined {
  if (!("layoutMode" in node)) return undefined;
  const frame = node as FrameNode;
  if (frame.layoutMode === "NONE") return undefined;

  const pad = fromPadding({
    top: boundRef(frame, "paddingTop", names) ?? frame.paddingTop,
    right: boundRef(frame, "paddingRight", names) ?? frame.paddingRight,
    bottom: boundRef(frame, "paddingBottom", names) ?? frame.paddingBottom,
    left: boundRef(frame, "paddingLeft", names) ?? frame.paddingLeft,
  });
  const gap = boundRef(frame, "itemSpacing", names) ?? frame.itemSpacing;

  return {
    dir: frame.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical",
    ...(gap ? { gap } : {}),
    ...(pad === undefined ? {} : { pad }),
    ...(frame.primaryAxisAlignItems === "MIN"
      ? {}
      : { justify: fromPrimaryAxisAlign(frame.primaryAxisAlignItems) }),
    ...(frame.counterAxisAlignItems === "MIN"
      ? {}
      : { align: fromCounterAxisAlign(frame.counterAxisAlignItems) }),
    ...(frame.layoutWrap === "WRAP" ? { wrap: true } : {}),
  };
}

function instanceSpec(node: InstanceNode): UINode {
  const properties: Record<string, string | number | boolean> = {};
  for (const [name, property] of Object.entries(node.componentProperties)) {
    if (typeof property.value === "string" || typeof property.value === "boolean") {
      // Figma suffixes property names with an id, which is noise in a tree.
      properties[name.split("#")[0] ?? name] = property.value;
    }
  }

  return {
    type: "instance",
    ...common(node),
    component: node.getPluginData(COMPONENT_FIELD) || node.name,
    ...(Object.keys(properties).length ? { properties } : {}),
  };
}

function textSpec(node: TextNode, names: NameIndex): TextSpec {
  const font = node.fontName === figma.mixed ? undefined : node.fontName;
  const lineHeight = node.lineHeight === figma.mixed ? undefined : node.lineHeight;
  const letterSpacing = node.letterSpacing === figma.mixed ? undefined : node.letterSpacing;
  const color = fromPaints(node.fills, names);
  const style = typeof node.textStyleId === "string" ? names.style(node.textStyleId) : undefined;

  // A bound variable is the truer answer than the number it happens to resolve to.
  const size =
    boundRef(node, "fontSize", names) ??
    (node.fontSize === figma.mixed ? undefined : node.fontSize);
  const height =
    boundRef(node, "lineHeight", names) ??
    (lineHeight && lineHeight.unit !== "PERCENT"
      ? lineHeight.unit === "AUTO"
        ? ("auto" as const)
        : lineHeight.value
      : undefined);
  const spacing =
    boundRef(node, "letterSpacing", names) ??
    (letterSpacing && letterSpacing.unit === "PIXELS" && letterSpacing.value !== 0
      ? letterSpacing.value
      : undefined);

  return {
    type: "text",
    ...common(node),
    text: node.characters,
    ...(style ? { style } : {}),
    ...(font ? { font: { family: font.family, style: font.style } } : {}),
    ...(size === undefined ? {} : { size }),
    ...(height === undefined ? {} : { lineHeight: height }),
    ...(spacing === undefined ? {} : { letterSpacing: spacing }),
    ...(node.textAlignHorizontal === "LEFT"
      ? {}
      : { align: node.textAlignHorizontal.toLowerCase() as TextSpec["align"] }),
    ...(color ? { color } : {}),
  };
}

function boundRef(node: SceneNode, field: string, names: NameIndex): string | undefined {
  const bound = (node as SceneNode & { boundVariables?: Record<string, { id?: string }> })
    .boundVariables?.[field];
  return bound?.id ? names.variable(bound.id) : undefined;
}

const CONSTRAINTS_BACK = {
  MIN: "min",
  CENTER: "center",
  MAX: "max",
  STRETCH: "stretch",
  SCALE: "scale",
} as const;

function bounds(node: SceneNode) {
  const box = node as SceneNode & {
    minWidth?: number | null;
    maxWidth?: number | null;
    minHeight?: number | null;
    maxHeight?: number | null;
  };
  return {
    ...(box.minWidth == null ? {} : { minW: box.minWidth }),
    ...(box.maxWidth == null ? {} : { maxW: box.maxWidth }),
    ...(box.minHeight == null ? {} : { minH: box.minHeight }),
    ...(box.maxHeight == null ? {} : { maxH: box.maxHeight }),
  };
}

/** Only reported when they carry information: pinned, or not the default. */
function placement(node: SceneNode) {
  const placed = node as SceneNode & {
    layoutPositioning?: "AUTO" | "ABSOLUTE";
    constraints?: Constraints;
    x: number;
    y: number;
  };
  const pinned = placed.layoutPositioning === "ABSOLUTE";
  const constraints = placed.constraints;
  const custom =
    constraints && (constraints.horizontal !== "MIN" || constraints.vertical !== "MIN");

  return {
    ...(pinned ? { at: { x: round(placed.x), y: round(placed.y) } } : {}),
    ...(custom && constraints
      ? {
          constraints: {
            h: CONSTRAINTS_BACK[constraints.horizontal],
            v: CONSTRAINTS_BACK[constraints.vertical],
          },
        }
      : {}),
  };
}

function common(node: SceneNode) {
  const key = node.getPluginData(KEY_FIELD);
  const blend = node as SceneNode & BlendMixin;
  const angle = (node as SceneNode & { rotation?: number }).rotation ?? 0;
  return {
    ...(key ? { key } : {}),
    name: node.name,
    ...sizing(node),
    ...bounds(node),
    ...placement(node),
    ...(angle === 0 ? {} : { rotation: round(angle) }),
    ...(blend.opacity === 1 ? {} : { opacity: blend.opacity }),
    ...(node.visible ? {} : { visible: false }),
  };
}

function sizing(node: SceneNode): { w?: Sizing; h?: Sizing } {
  const box = node as SceneNode & LayoutMixin;
  const parent = node.parent;
  const inAutoLayout =
    parent !== null && "layoutMode" in parent && (parent as FrameNode).layoutMode !== "NONE";

  // "fill" needs a parent that lays out; "hug" is the node's own business.
  const ownsLayout = node.type === "FRAME" && node.layoutMode !== "NONE";
  const axis = (fixed: number, mode: "FIXED" | "HUG" | "FILL" | undefined): Sizing => {
    if (mode === "HUG" && (inAutoLayout || ownsLayout)) return "hug";
    if (mode === "FILL" && inAutoLayout) return "fill";
    return round(fixed);
  };

  return {
    w: axis(box.width, box.layoutSizingHorizontal),
    h: axis(box.height, box.layoutSizingVertical),
  };
}

function painted(node: SceneNode, names: NameIndex) {
  const shape = node as SceneNode & GeometryMixin & CornerMixin & BlendMixin;
  const fill = fromPaints(shape.fills, names);
  const effects = fromEffects(shape.effects ?? []);
  const corners = node as unknown as RectangleCornerMixin;
  const radius =
    "topLeftRadius" in corners
      ? fromRadius({
          topLeft: boundRef(node, "topLeftRadius", names) ?? corners.topLeftRadius,
          topRight: boundRef(node, "topRightRadius", names) ?? corners.topRightRadius,
          bottomRight: boundRef(node, "bottomRightRadius", names) ?? corners.bottomRightRadius,
          bottomLeft: boundRef(node, "bottomLeftRadius", names) ?? corners.bottomLeftRadius,
        })
      : undefined;
  const stroke = strokeSpec(shape, names);

  return {
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
    ...(radius === undefined ? {} : { radius }),
    ...(effects ? { effects } : {}),
  };
}

function strokeSpec(node: SceneNode & GeometryMixin, names: NameIndex) {
  const paint = Array.isArray(node.strokes) ? node.strokes[0] : undefined;
  if (!paint || paint.type !== "SOLID") return undefined;

  const color = fromPaints([paint], names);
  if (typeof color !== "string") return undefined;

  const weight =
    boundRef(node, "strokeWeight", names) ??
    (typeof node.strokeWeight === "number" ? node.strokeWeight : 1);

  return {
    color,
    ...(weight === 1 ? {} : { width: weight }),
    // A FigJam shape or connector has no stroke alignment to report.
    ...(!node.strokeAlign || node.strokeAlign === "INSIDE"
      ? {}
      : { align: node.strokeAlign.toLowerCase() as "outside" | "center" }),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
