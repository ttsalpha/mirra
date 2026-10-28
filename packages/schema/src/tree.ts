import { z } from "zod";
import {
  CODE_LANGUAGES,
  CONNECTOR_CAPS,
  CONNECTOR_LINES,
  MAGNETS,
  SHAPE_TYPES,
} from "./constants.js";

/** A zod enum over the keys of a name map, so the two cannot drift apart. */
function keysOf<T extends Record<string, string>>(map: T) {
  const keys = Object.keys(map) as [keyof T & string, ...(keyof T & string)[]];
  return z.enum(keys);
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa`. */
export const Hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);

export const SolidFill = z.object({
  type: z.literal("solid"),
  color: Hex,
  opacity: z.number().min(0).max(1).optional(),
});

export const GradientStop = z.object({ at: z.number().min(0).max(1), color: Hex });

export const GradientFill = z.object({
  type: z.literal("gradient"),
  kind: z.enum(["linear", "radial"]).optional(),
  /** Degrees clockwise from left-to-right. 90 points downwards. */
  angle: z.number().optional(),
  stops: z.array(GradientStop).min(2),
});

/** A reference to a variable or style by name, e.g. "$color/primary". */
export const TokenRef = z.string().regex(/^\$[\w][\w .\/-]*$/);

/** A number, or "$space/md" to follow a number variable instead. */
export const NumberValue = z.union([z.number(), TokenRef]);

/** The same, where a negative value would mean nothing. */
export const SizeValue = z.union([z.number().nonnegative(), TokenRef]);

/** A bare hex string is shorthand for an opaque solid fill. */
export const Fill = z.union([Hex, TokenRef, SolidFill, GradientFill]);

export const Stroke = z.object({
  color: z.union([Hex, TokenRef]),
  width: SizeValue.optional(),
  align: z.enum(["inside", "outside", "center"]).optional(),
});

export const ShadowEffect = z.object({
  type: z.enum(["shadow", "inner-shadow"]),
  x: z.number().optional(),
  y: z.number().optional(),
  blur: z.number().optional(),
  spread: z.number().optional(),
  color: Hex.optional(),
});

export const BlurEffect = z.object({
  type: z.enum(["layer-blur", "background-blur"]),
  radius: z.number().nonnegative(),
});

export const Effect = z.union([ShadowEffect, BlurEffect]);

/** A number is a fixed size in px; auto layout also understands fill and hug. */
export const Sizing = z.union([z.number().nonnegative(), z.literal("fill"), z.literal("hug")]);

/** One value for all sides, [vertical, horizontal], or [top, right, bottom, left]. */
export const Padding = z.union([
  NumberValue,
  z.tuple([NumberValue, NumberValue]),
  z.tuple([NumberValue, NumberValue, NumberValue, NumberValue]),
]);

export const Layout = z.object({
  dir: z.enum(["horizontal", "vertical"]),
  gap: SizeValue.optional(),
  pad: Padding.optional(),
  /** Along the layout direction. */
  justify: z
    .enum(["start", "center", "end", "space-between", "space-around", "space-evenly"])
    .optional(),
  /** Across the layout direction. */
  align: z.enum(["start", "center", "end", "baseline"]).optional(),
  wrap: z.boolean().optional(),
});

/** One number rounds every corner; four go clockwise from the top left. */
export const Radius = z.union([SizeValue, z.tuple([SizeValue, SizeValue, SizeValue, SizeValue])]);

export const ConstraintSide = z.enum(["min", "center", "max", "stretch", "scale"]);

const base = {
  /** Caller-chosen, stable across renders: `patch` and `read` address nodes by it. */
  key: z.string().optional(),
  name: z.string().optional(),
  w: Sizing.optional(),
  h: Sizing.optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  /** Degrees, counter-clockwise, the way Figma's own rotation field reads. */
  rotation: z.number().optional(),
  /** Bounds for a node that fills or hugs. */
  minW: z.number().nonnegative().optional(),
  maxW: z.number().nonnegative().optional(),
  minH: z.number().nonnegative().optional(),
  maxH: z.number().nonnegative().optional(),
  /** Position inside the parent. Inside an auto layout it lifts the node out of the flow. */
  at: z.object({ x: z.number(), y: z.number() }).optional(),
  /** How the node reacts when its parent resizes. */
  constraints: z.object({ h: ConstraintSide, v: ConstraintSide }).optional(),
};

const painted = {
  fill: Fill.optional(),
  stroke: Stroke.optional(),
  radius: Radius.optional(),
  effects: z.array(Effect).optional(),
};

const typography = {
  font: z.object({ family: z.string(), style: z.string().optional() }).optional(),
  size: SizeValue.optional(),
  /** A number is px; "auto" leaves Figma's automatic line height. */
  lineHeight: z.union([SizeValue, z.literal("auto")]).optional(),
  letterSpacing: NumberValue.optional(),
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  color: Fill.optional(),
  /** A text style by name, e.g. "$text/heading". Overridden by the fields above. */
  style: TokenRef.optional(),
};

const container = {
  layout: Layout.optional(),
  clip: z.boolean().optional(),
};

export const TextNode = z.object({
  ...base,
  ...typography,
  type: z.literal("text"),
  text: z.string(),
});

export const RectNode = z.object({ ...base, ...painted, type: z.literal("rect") });

const asset = {
  /** Inline content: SVG markup, or a data URI for an image. */
  src: z.string(),
  /** The path the server inlined `src` from, kept so `read` can name it again. */
  srcRef: z.string().optional(),
};

export const SvgNode = z.object({ ...base, ...asset, type: z.literal("svg") });

export const ImageNode = z.object({
  ...base,
  ...asset,
  ...painted,
  type: z.literal("image"),
  fit: z.enum(["fill", "fit", "crop", "tile"]).optional(),
});

const instance = {
  /** Component name, e.g. "Button" or "Button/Primary" for a variant. */
  component: z.string(),
  /** Component properties, by the name Figma shows (without its id suffix). */
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
};

export const InstanceNode = z.object({ ...base, ...instance, type: z.literal("instance") });
export const EllipseNode = z.object({ ...base, ...painted, type: z.literal("ellipse") });

/** FigJam has no auto layout, so a node sits where `at` says. */
const jamBase = {
  key: base.key,
  name: base.name,
  opacity: base.opacity,
  visible: base.visible,
  /** Inside a section, relative to it; at the top level, on the canvas. */
  at: base.at,
};

/** The text on a sticky, a shape or a connector: font, size, letter spacing, colour. */
const jamText = {
  text: z.string().optional(),
  font: typography.font,
  size: typography.size,
  letterSpacing: typography.letterSpacing,
  color: typography.color,
};

export const ShapeKind = keysOf(SHAPE_TYPES);
export const ConnectorLine = keysOf(CONNECTOR_LINES);
export const ConnectorCap = keysOf(CONNECTOR_CAPS);
export const Magnet = keysOf(MAGNETS);
export const CodeLanguage = z.enum(CODE_LANGUAGES);

/**
 * Where a connector starts or ends: the key of a node (in this tree or already in
 * the file), a Figma node id, or a point on the canvas. A magnet picks the side.
 */
export const ConnectorEnd = z.union([
  z.string(),
  z.object({ key: z.string(), magnet: Magnet.optional() }),
  z.object({ id: z.string(), magnet: Magnet.optional() }),
  z.object({ x: z.number(), y: z.number() }),
]);

const jamSize = z.number().positive();

export const StickyNode = z.object({
  ...jamBase,
  ...jamText,
  type: z.literal("sticky"),
  fill: Fill.optional(),
  /** The wide rectangle rather than the square. */
  wide: z.boolean().optional(),
  /** Show the author's name on the sticky. */
  author: z.boolean().optional(),
});

export const ShapeNode = z.object({
  ...jamBase,
  ...jamText,
  type: z.literal("shape"),
  shape: ShapeKind.optional(),
  w: jamSize.optional(),
  h: jamSize.optional(),
  rotation: base.rotation,
  fill: Fill.optional(),
  stroke: Stroke.optional(),
});

export const ConnectorNode = z.object({
  ...jamBase,
  type: z.literal("connector"),
  from: ConnectorEnd,
  to: ConnectorEnd,
  line: ConnectorLine.optional(),
  startCap: ConnectorCap.optional(),
  endCap: ConnectorCap.optional(),
  /** The label on the line. */
  text: z.string().optional(),
  stroke: Stroke.optional(),
});

/** A cell is its text, or an object when it wants a fill or text colour of its own. */
export const TableCell = z.union([
  z.string(),
  z.object({ text: z.string(), fill: Fill.optional(), color: typography.color }),
]);

export const TableNode = z.object({
  ...jamBase,
  type: z.literal("table"),
  /** One array of cells per row. Short rows are padded with empty cells. */
  rows: z.array(z.array(TableCell)).min(1),
  colWidths: z.array(jamSize).optional(),
  rowHeights: z.array(jamSize).optional(),
  fill: Fill.optional(),
  font: typography.font,
  size: typography.size,
  color: typography.color,
});

export const CodeNode = z.object({
  ...jamBase,
  type: z.literal("code"),
  code: z.string(),
  language: CodeLanguage.optional(),
});

/** An animated GIF: `src` is a file path or a data URI. */
export const GifNode = z.object({
  ...jamBase,
  type: z.literal("gif"),
  src: z.string(),
  srcRef: z.string().optional(),
  w: jamSize.optional(),
  h: jamSize.optional(),
});

/** A pasted link: FigJam turns it into an embed or a preview card. */
export const LinkNode = z.object({
  ...jamBase,
  type: z.literal("link"),
  url: z.string().url(),
});

/** Everything `patch` can set on a node that already exists. */
export const NodeProps = z.object({
  ...base,
  ...painted,
  ...container,
  ...typography,
  text: z.string().optional(),
  shape: ShapeKind.optional(),
  wide: z.boolean().optional(),
  author: z.boolean().optional(),
  from: ConnectorEnd.optional(),
  to: ConnectorEnd.optional(),
  line: ConnectorLine.optional(),
  startCap: ConnectorCap.optional(),
  endCap: ConnectorCap.optional(),
  rows: TableNode.shape.rows.optional(),
  colWidths: TableNode.shape.colWidths,
  rowHeights: TableNode.shape.rowHeights,
  code: z.string().optional(),
  language: CodeLanguage.optional(),
  src: z.string().optional(),
  srcRef: z.string().optional(),
  fit: ImageNode.shape.fit,
  component: z.string().optional(),
  properties: instance.properties,
});
export type NodeProps = z.infer<typeof NodeProps>;

const FrameBase = z.object({
  ...base,
  ...painted,
  ...container,
  type: z.literal("frame"),
});

/** Explicit, because `children` makes the type recursive. */
export type FrameNode = z.infer<typeof FrameBase> & { children?: UINode[] };

/** FigJam's container for part of a board. */
const SectionBase = z.object({
  ...jamBase,
  type: z.literal("section"),
  w: jamSize.optional(),
  h: jamSize.optional(),
  fill: Fill.optional(),
  stroke: Stroke.optional(),
  radius: SizeValue.optional(),
  /**
   * Places the children for you, without Figma's own auto layout: dir, gap, pad,
   * align and wrap. A child with `at` stays where it is. Padding defaults to 24.
   */
  layout: Layout.optional(),
});
export type SectionNode = z.infer<typeof SectionBase> & { children?: UINode[] };

export type UINode =
  | FrameNode
  | TextNode
  | RectNode
  | EllipseNode
  | InstanceNode
  | SvgNode
  | ImageNode
  | SectionNode
  | StickyNode
  | ShapeNode
  | ConnectorNode
  | TableNode
  | CodeNode
  | LinkNode
  | GifNode;

export const FrameNode = FrameBase.extend({
  get children(): z.ZodOptional<z.ZodArray<z.ZodType<UINode>>> {
    return z.array(UINode).optional();
  },
});

export const SectionNode = SectionBase.extend({
  get children(): z.ZodOptional<z.ZodArray<z.ZodType<UINode>>> {
    return z.array(UINode).optional();
  },
});

export const UINode: z.ZodType<UINode> = z.discriminatedUnion("type", [
  FrameNode,
  TextNode,
  RectNode,
  EllipseNode,
  InstanceNode,
  SvgNode,
  ImageNode,
  SectionNode,
  StickyNode,
  ShapeNode,
  ConnectorNode,
  TableNode,
  CodeNode,
  LinkNode,
  GifNode,
]);

export type Hex = z.infer<typeof Hex>;
export type NumberValue = z.infer<typeof NumberValue>;
export type SizeValue = z.infer<typeof SizeValue>;
export type Fill = z.infer<typeof Fill>;
export type Stroke = z.infer<typeof Stroke>;
export type Effect = z.infer<typeof Effect>;
export type Sizing = z.infer<typeof Sizing>;
export type Padding = z.infer<typeof Padding>;
export type Layout = z.infer<typeof Layout>;
export type Radius = z.infer<typeof Radius>;
export type TextNode = z.infer<typeof TextNode>;
export type RectNode = z.infer<typeof RectNode>;
export type EllipseNode = z.infer<typeof EllipseNode>;
export type InstanceNode = z.infer<typeof InstanceNode>;
export type SvgNode = z.infer<typeof SvgNode>;
export type ImageNode = z.infer<typeof ImageNode>;
export type TokenRef = z.infer<typeof TokenRef>;
export type StickyNode = z.infer<typeof StickyNode>;
export type ShapeNode = z.infer<typeof ShapeNode>;
export type ConnectorNode = z.infer<typeof ConnectorNode>;
export type ConnectorEnd = z.infer<typeof ConnectorEnd>;
export type TableNode = z.infer<typeof TableNode>;
export type CodeNode = z.infer<typeof CodeNode>;
export type LinkNode = z.infer<typeof LinkNode>;
export type GifNode = z.infer<typeof GifNode>;
export type TableCell = z.infer<typeof TableCell>;
export type ShapeKind = z.infer<typeof ShapeKind>;
export type ConnectorLine = z.infer<typeof ConnectorLine>;
export type ConnectorCap = z.infer<typeof ConnectorCap>;
export type Magnet = z.infer<typeof Magnet>;
export type CodeLanguage = z.infer<typeof CodeLanguage>;
