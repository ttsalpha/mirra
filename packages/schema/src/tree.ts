import { z } from "zod";

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

/** A bare hex string is shorthand for an opaque solid fill. */
export const Fill = z.union([Hex, TokenRef, SolidFill, GradientFill]);

export const Stroke = z.object({
  color: Hex,
  width: z.number().positive().optional(),
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
  z.number(),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
]);

export const Layout = z.object({
  dir: z.enum(["horizontal", "vertical"]),
  gap: z.number().optional(),
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
export const Radius = z.union([
  z.number().nonnegative(),
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
]);

export const ConstraintSide = z.enum(["min", "center", "max", "stretch", "scale"]);

const base = {
  /** Caller-chosen, stable across renders: `patch` and `read` address nodes by it. */
  key: z.string().optional(),
  name: z.string().optional(),
  w: Sizing.optional(),
  h: Sizing.optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
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
  size: z.number().positive().optional(),
  /** A number is px; "auto" leaves Figma's automatic line height. */
  lineHeight: z.union([z.number().positive(), z.literal("auto")]).optional(),
  letterSpacing: z.number().optional(),
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

/** Everything `patch` can set on a node that already exists. */
export const NodeProps = z.object({
  ...base,
  ...painted,
  ...container,
  ...typography,
  text: z.string().optional(),
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
export type UINode =
  FrameNode | TextNode | RectNode | EllipseNode | InstanceNode | SvgNode | ImageNode;

export const FrameNode = FrameBase.extend({
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
]);

export type Hex = z.infer<typeof Hex>;
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
