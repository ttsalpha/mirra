import { expect, test } from "vitest";
import {
  gradientTransform,
  rgba,
  toEffects,
  toPadding,
  toPaints,
  toRadius,
  toStrokeAlign,
} from "./values";

test("expands short hex and reads alpha", () => {
  expect(rgba("#fff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  expect(rgba("#000000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  expect(rgba("#ff000080").a).toBeCloseTo(0.502, 3);
});

test("a bare hex string is an opaque solid fill", () => {
  expect(toPaints("#ff0000")).toEqual([{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 }]);
});

test("hex alpha becomes paint opacity", () => {
  const [paint] = toPaints("#00000080");
  expect(paint).toMatchObject({ type: "SOLID" });
  expect((paint as SolidPaint).opacity).toBeCloseTo(0.502, 3);
});

test("gradient stops keep their order and position", () => {
  const [paint] = toPaints({
    type: "gradient",
    kind: "radial",
    stops: [
      { at: 0, color: "#ffffff" },
      { at: 1, color: "#000000" },
    ],
  });
  expect(paint).toMatchObject({ type: "GRADIENT_RADIAL" });
  expect((paint as GradientPaint).gradientStops.map((stop) => stop.position)).toEqual([0, 1]);
});

test("a 0deg gradient is the identity transform, so it runs left to right", () => {
  const [[a, b, c], [d, e, f]] = gradientTransform(0);
  expect([a, b, c]).toEqual([1, -0, 0]);
  expect([d, e, f]).toEqual([0, 1, 0]);
});

test("padding accepts one, two or four values", () => {
  expect(toPadding(8)).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
  expect(toPadding([4, 12])).toEqual({ top: 4, right: 12, bottom: 4, left: 12 });
  expect(toPadding([1, 2, 3, 4])).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
});

test("one radius rounds every corner", () => {
  expect(toRadius(6)).toEqual([6, 6, 6, 6]);
  expect(toRadius([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
});

test("a shadow fills in the parts the caller left out", () => {
  const [effect] = toEffects([{ type: "shadow", y: 4, blur: 12 }]);
  expect(effect).toMatchObject({
    type: "DROP_SHADOW",
    offset: { x: 0, y: 4 },
    radius: 12,
    spread: 0,
    visible: true,
    blendMode: "NORMAL",
  });
});

test("blur effects carry the blur type Figma requires", () => {
  expect(toEffects([{ type: "layer-blur", radius: 4 }])).toEqual([
    { type: "LAYER_BLUR", blurType: "NORMAL", radius: 4, visible: true },
  ]);
});

test("stroke alignment maps to Figma's spelling, and defaults to inside", () => {
  expect(toStrokeAlign(undefined)).toBe("INSIDE");
  expect(toStrokeAlign("outside")).toBe("OUTSIDE");
  expect(toStrokeAlign("center")).toBe("CENTER");
});
