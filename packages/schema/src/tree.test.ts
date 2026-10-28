import { expect, test } from "vitest";
import { RenderParams } from "./protocol.js";
import { UINode } from "./tree.js";

const card = {
  type: "frame",
  key: "card",
  name: "Card",
  layout: { dir: "vertical", gap: 12, pad: [16, 20], justify: "start", align: "center" },
  fill: "#ffffff",
  radius: 12,
  effects: [{ type: "shadow", y: 4, blur: 12, color: "#0000001a" }],
  children: [
    { type: "text", key: "title", text: "Welcome back", size: 24, color: "#111111" },
    { type: "frame", layout: { dir: "horizontal", gap: 8 }, w: "fill", children: [] },
    { type: "ellipse", w: 24, h: 24, fill: { type: "solid", color: "#14ae5c" } },
  ],
};

test("accepts a nested tree", () => {
  const parsed = UINode.parse(card);
  expect(parsed).toMatchObject({ type: "frame", key: "card" });
});

test("accepts a gradient fill", () => {
  const parsed = UINode.parse({
    type: "rect",
    fill: {
      type: "gradient",
      angle: 90,
      stops: [
        { at: 0, color: "#fff" },
        { at: 1, color: "#000" },
      ],
    },
  });
  expect(parsed.type).toBe("rect");
});

test("rejects a colour that is not hex", () => {
  expect(() => UINode.parse({ type: "rect", fill: "red" })).toThrow();
});

test("rejects a gradient with a single stop", () => {
  const fill = { type: "gradient", stops: [{ at: 0, color: "#fff" }] };
  expect(() => UINode.parse({ type: "rect", fill })).toThrow();
});

test("rejects an unknown node type", () => {
  expect(() => UINode.parse({ type: "polygon" })).toThrow();
});

test("render params default to the current page", () => {
  const params = RenderParams.parse({ tree: card });
  expect(params.parentId).toBeUndefined();
  expect(params.tree).toMatchObject({ type: "frame" });
});

test("accepts a FigJam board", () => {
  const parsed = UINode.parse({
    type: "section",
    name: "Flow",
    layout: { dir: "horizontal", gap: 16, wrap: true },
    w: 800,
    children: [
      { type: "sticky", text: "Idea", fill: "#ffc943", wide: true },
      { type: "shape", shape: "diamond", text: "Ok?", w: 160, h: 120 },
      {
        type: "connector",
        from: "a",
        to: { key: "b", magnet: "left" },
        line: "elbow",
        endCap: "arrow",
      },
      { type: "connector", from: { id: "1:2" }, to: { x: 10, y: 20 } },
      {
        type: "table",
        rows: [
          ["a", "b"],
          ["c", "d"],
        ],
      },
      { type: "code", code: "let a = 1", language: "typescript" },
      { type: "link", url: "https://example.com" },
    ],
  });
  expect(parsed.type).toBe("section");
});

test("rejects a FigJam node that is not well formed", () => {
  expect(() => UINode.parse({ type: "shape", shape: "blob" })).toThrow();
  expect(() => UINode.parse({ type: "connector", from: "a" })).toThrow();
  expect(() => UINode.parse({ type: "table", rows: [] })).toThrow();
  expect(() => UINode.parse({ type: "link", url: "not a url" })).toThrow();
});
