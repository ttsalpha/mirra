import type { Layout, Sizing, TextNode as TextSpec, UINode } from "@mirra/schema";
import { COMPONENT_FIELD, KEY_FIELD, SRC_FIELD, SVG_FIELD } from "./build";
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

  const svg = node.getPluginData(SVG_FIELD);
  if (svg) return { type: "svg", ...common(node), src: svg };

  const src = node.getPluginData(SRC_FIELD);
  if (src) return { type: "image", ...common(node), ...painted(node, names), src };

  switch (node.type) {
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
    case "SECTION":
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
    ...(node.strokeAlign === "INSIDE"
      ? {}
      : { align: node.strokeAlign.toLowerCase() as "outside" | "center" }),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
