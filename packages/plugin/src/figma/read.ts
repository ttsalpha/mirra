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

/** Inverse of `buildNode`, down to `depth` levels of children. */
export function readNode(
  node: SceneNode,
  depth: number,
  names: NameIndex = EMPTY_NAMES,
): ReadOutcome {
  const skipped = { count: 0 };
  const tree = toSpec(node, depth, skipped, names);
  return { tree, skipped: skipped.count };
}

function toSpec(
  node: SceneNode,
  depth: number,
  skipped: { count: number },
  names: NameIndex,
): UINode | null {
  const svg = node.getPluginData(SVG_FIELD);
  if (svg) return { type: "svg", ...common(node), src: svg };

  const src = node.getPluginData(SRC_FIELD);
  if (src) return { type: "image", ...common(node), ...painted(node, names), src };

  switch (node.type) {
    case "FRAME":
      return frameSpec(node, depth, skipped, names);
    case "TEXT":
      return textSpec(node, names);
    case "RECTANGLE":
      return { type: "rect", ...common(node), ...painted(node, names) };
    case "ELLIPSE":
      return { type: "ellipse", ...common(node), ...painted(node, names) };
    case "INSTANCE":
      return instanceSpec(node);
    default:
      skipped.count += 1;
      return null;
  }
}

function frameSpec(
  node: FrameNode,
  depth: number,
  skipped: { count: number },
  names: NameIndex,
): UINode {
  const children: UINode[] = [];
  if (depth > 0) {
    for (const child of node.children) {
      const spec = toSpec(child, depth - 1, skipped, names);
      if (spec) children.push(spec);
    }
  } else if (node.children.length) {
    skipped.count += node.children.length;
  }

  return {
    type: "frame",
    ...common(node),
    ...painted(node, names),
    ...(node.clipsContent ? {} : { clip: false }),
    ...(layoutSpec(node) ? { layout: layoutSpec(node) } : {}),
    ...(children.length ? { children } : {}),
  };
}

function layoutSpec(node: FrameNode): Layout | undefined {
  if (node.layoutMode === "NONE") return undefined;

  const pad = fromPadding({
    top: node.paddingTop,
    right: node.paddingRight,
    bottom: node.paddingBottom,
    left: node.paddingLeft,
  });

  return {
    dir: node.layoutMode === "HORIZONTAL" ? "horizontal" : "vertical",
    ...(node.itemSpacing ? { gap: node.itemSpacing } : {}),
    ...(pad === undefined ? {} : { pad }),
    ...(node.primaryAxisAlignItems === "MIN"
      ? {}
      : { justify: fromPrimaryAxisAlign(node.primaryAxisAlignItems) }),
    ...(node.counterAxisAlignItems === "MIN"
      ? {}
      : { align: fromCounterAxisAlign(node.counterAxisAlignItems) }),
    ...(node.layoutWrap === "WRAP" ? { wrap: true } : {}),
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

  return {
    type: "text",
    ...common(node),
    text: node.characters,
    ...(style ? { style } : {}),
    ...(font ? { font: { family: font.family, style: font.style } } : {}),
    ...(node.fontSize === figma.mixed ? {} : { size: node.fontSize }),
    ...(lineHeight && lineHeight.unit !== "PERCENT"
      ? { lineHeight: lineHeight.unit === "AUTO" ? ("auto" as const) : lineHeight.value }
      : {}),
    ...(letterSpacing && letterSpacing.unit === "PIXELS" && letterSpacing.value !== 0
      ? { letterSpacing: letterSpacing.value }
      : {}),
    ...(node.textAlignHorizontal === "LEFT"
      ? {}
      : { align: node.textAlignHorizontal.toLowerCase() as TextSpec["align"] }),
    ...(color ? { color } : {}),
  };
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
  return {
    ...(key ? { key } : {}),
    name: node.name,
    ...sizing(node),
    ...bounds(node),
    ...placement(node),
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
          topLeft: corners.topLeftRadius,
          topRight: corners.topRightRadius,
          bottomRight: corners.bottomRightRadius,
          bottomLeft: corners.bottomLeftRadius,
        })
      : undefined;
  const stroke = strokeSpec(shape);

  return {
    ...(fill ? { fill } : {}),
    ...(stroke ? { stroke } : {}),
    ...(radius === undefined ? {} : { radius }),
    ...(effects ? { effects } : {}),
  };
}

function strokeSpec(node: SceneNode & GeometryMixin) {
  const paint = Array.isArray(node.strokes) ? node.strokes[0] : undefined;
  if (!paint || paint.type !== "SOLID") return undefined;

  const weight = typeof node.strokeWeight === "number" ? node.strokeWeight : 1;
  const color = fromPaints([paint]);
  if (typeof color !== "string") return undefined;

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
