import { EMPTY_NAMES, type NameIndex } from "./tokens";
import type { Effect as EffectSpec, Fill, Layout, Padding, Radius, Stroke } from "@mirra/schema";

export function rgba(hex: string): RGBA {
  const digits = hex.slice(1);
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  const value = (start: number) => parseInt(full.slice(start, start + 2), 16) / 255;
  return { r: value(0), g: value(2), b: value(4), a: full.length === 8 ? value(6) : 1 };
}

export function toPaints(fill: Fill): Paint[] {
  if (typeof fill === "string") return [solid(fill)];
  if (fill.type === "solid") return [solid(fill.color, fill.opacity)];
  return [
    {
      type: fill.kind === "radial" ? "GRADIENT_RADIAL" : "GRADIENT_LINEAR",
      gradientTransform: gradientTransform(fill.angle ?? 90),
      gradientStops: fill.stops.map((stop) => ({ position: stop.at, color: rgba(stop.color) })),
    },
  ];
}

function solid(hex: string, opacity?: number): SolidPaint {
  const { r, g, b, a } = rgba(hex);
  return { type: "SOLID", color: { r, g, b }, opacity: opacity ?? a };
}

/**
 * Figma reads a gradient along the x axis of this matrix, so the matrix is a
 * rotation about the centre of the node. 0deg runs left to right, 90deg down.
 */
export function gradientTransform(angleDeg: number): Transform {
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    [cos, -sin, 0.5 - 0.5 * cos + 0.5 * sin],
    [sin, cos, 0.5 - 0.5 * sin - 0.5 * cos],
  ];
}

export function toStrokeAlign(align: Stroke["align"]): "CENTER" | "INSIDE" | "OUTSIDE" {
  return (align ?? "inside").toUpperCase() as "CENTER" | "INSIDE" | "OUTSIDE";
}

export function toEffects(effects: EffectSpec[]): Effect[] {
  return effects.map<Effect>((effect) => {
    switch (effect.type) {
      case "layer-blur":
        return { type: "LAYER_BLUR", blurType: "NORMAL", radius: effect.radius, visible: true };
      case "background-blur":
        return {
          type: "BACKGROUND_BLUR",
          blurType: "NORMAL",
          radius: effect.radius,
          visible: true,
        };
      case "shadow":
        return { type: "DROP_SHADOW", ...shadow(effect) };
      case "inner-shadow":
        return { type: "INNER_SHADOW", ...shadow(effect) };
    }
  });
}

function shadow(effect: Extract<EffectSpec, { type: "shadow" | "inner-shadow" }>) {
  return {
    color: rgba(effect.color ?? "#00000040"),
    offset: { x: effect.x ?? 0, y: effect.y ?? 0 },
    radius: effect.blur ?? 0,
    spread: effect.spread ?? 0,
    visible: true,
    blendMode: "NORMAL" as BlendMode,
  };
}

/** Generic in the value, because a side may be a number or a "$name" token. */
export function toPadding<T>(pad: T | [T, T] | [T, T, T, T]): Sides<T> {
  if (!Array.isArray(pad)) return { top: pad, right: pad, bottom: pad, left: pad };
  if (pad.length === 2) {
    const [vertical, horizontal] = pad;
    return { top: vertical, right: horizontal, bottom: vertical, left: horizontal };
  }
  const [top, right, bottom, left] = pad;
  return { top, right, bottom, left };
}

export type Sides<T> = { top: T; right: T; bottom: T; left: T };

export function toRadius<T>(radius: T | [T, T, T, T]): [T, T, T, T] {
  return Array.isArray(radius) ? radius : [radius, radius, radius, radius];
}

const PRIMARY_AXIS = {
  start: "MIN",
  center: "CENTER",
  end: "MAX",
  "space-between": "SPACE_BETWEEN",
  "space-around": "SPACE_AROUND",
  "space-evenly": "SPACE_EVENLY",
} as const;

const COUNTER_AXIS = { start: "MIN", center: "CENTER", end: "MAX", baseline: "BASELINE" } as const;

export function toPrimaryAxisAlign(justify: NonNullable<Layout["justify"]>) {
  return PRIMARY_AXIS[justify];
}

export function toCounterAxisAlign(align: NonNullable<Layout["align"]>) {
  return COUNTER_AXIS[align];
}

// Figma values back into the DSL. A property is emitted only when it differs
// from what `render` would do anyway, so render(read(x)) comes back as x.

export function toHex({ r, g, b }: RGB, alpha = 1): string {
  const channel = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  const rgb = `#${channel(r)}${channel(g)}${channel(b)}`;
  return alpha >= 1 ? rgb : `${rgb}${channel(alpha)}`;
}

export function fromPaints(
  paints: readonly Paint[] | typeof figma.mixed,
  names: NameIndex = EMPTY_NAMES,
): Fill | undefined {
  if (!Array.isArray(paints)) return undefined;
  const paint = paints.find((candidate) => candidate.visible !== false);
  if (!paint) return undefined;

  if (paint.type === "SOLID") {
    // A bound variable is the truer answer than the colour it happens to resolve to.
    const bound = paint.boundVariables?.color;
    const ref = bound ? names.variable(bound.id) : undefined;
    return ref ?? toHex(paint.color, paint.opacity ?? 1);
  }
  if (paint.type !== "GRADIENT_LINEAR" && paint.type !== "GRADIENT_RADIAL") return undefined;

  return {
    type: "gradient",
    kind: paint.type === "GRADIENT_RADIAL" ? "radial" : "linear",
    angle: fromGradientTransform(paint.gradientTransform),
    stops: paint.gradientStops.map((stop: ColorStop) => ({
      at: stop.position,
      color: toHex(stop.color, stop.color.a),
    })),
  };
}

export function fromGradientTransform(transform: Transform): number {
  const cos = transform[0][0];
  const sin = transform[1][0];
  const degrees = (Math.atan2(sin, cos) * 180) / Math.PI;
  return Math.round(degrees * 1000) / 1000;
}

export function fromEffects(effects: readonly Effect[]): EffectSpec[] | undefined {
  const specs = effects.filter((effect) => effect.visible !== false).map(fromEffect);
  return specs.length ? specs : undefined;
}

function fromEffect(effect: Effect): EffectSpec {
  switch (effect.type) {
    case "LAYER_BLUR":
      return { type: "layer-blur", radius: effect.radius };
    case "BACKGROUND_BLUR":
      return { type: "background-blur", radius: effect.radius };
    case "DROP_SHADOW":
    case "INNER_SHADOW":
      return {
        type: effect.type === "DROP_SHADOW" ? "shadow" : "inner-shadow",
        x: effect.offset.x,
        y: effect.offset.y,
        blur: effect.radius,
        spread: effect.spread ?? 0,
        color: toHex(effect.color, effect.color.a),
      };
    default:
      return { type: "layer-blur", radius: 0 };
  }
}

export function fromPadding(sides: Sides<number | string>): Padding | undefined {
  const { top, right, bottom, left } = sides;
  if (top === right && right === bottom && bottom === left) return top === 0 ? undefined : top;
  if (top === bottom && left === right) return [top, right];
  return [top, right, bottom, left];
}

export function fromRadius(corners: {
  topLeft: number | string;
  topRight: number | string;
  bottomRight: number | string;
  bottomLeft: number | string;
}): Radius | undefined {
  const { topLeft, topRight, bottomRight, bottomLeft } = corners;
  if (topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft) {
    return topLeft === 0 ? undefined : topLeft;
  }
  return [topLeft, topRight, bottomRight, bottomLeft];
}

const PRIMARY_AXIS_BACK = {
  MIN: "start",
  CENTER: "center",
  MAX: "end",
  SPACE_BETWEEN: "space-between",
  SPACE_AROUND: "space-around",
  SPACE_EVENLY: "space-evenly",
} as const;

const COUNTER_AXIS_BACK = {
  MIN: "start",
  CENTER: "center",
  MAX: "end",
  BASELINE: "baseline",
} as const;

export function fromPrimaryAxisAlign(value: keyof typeof PRIMARY_AXIS_BACK) {
  return PRIMARY_AXIS_BACK[value];
}

export function fromCounterAxisAlign(value: keyof typeof COUNTER_AXIS_BACK) {
  return COUNTER_AXIS_BACK[value];
}
