import { beforeEach, expect, test } from "vitest";
import { UINode } from "@mirra/schema";
import type { UINode as UINodeSpec } from "@mirra/schema";
import { buildNode, type Deferred } from "./build";
import { installFakeFigma } from "./fake-figma";
import { readNode } from "./read";

let fake: ReturnType<typeof installFakeFigma>;

beforeEach(() => {
  fake = installFakeFigma();
});

async function roundTrip(spec: UINodeSpec): Promise<UINodeSpec> {
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  const deferred: Deferred = [];
  const node = await buildNode(spec, parent, {}, undefined, deferred);
  // The render op flushes these once the tree has its final size.
  for (const place of deferred) place();
  const outcome = readNode(node, 10);
  expect(outcome.skipped).toBe(0);
  expect(outcome.tree).not.toBeNull();
  return UINode.parse(outcome.tree);
}

/** Every property the DSL supports today, so nothing is lost silently. */
const card: UINodeSpec = {
  type: "frame",
  key: "card",
  name: "Card",
  w: 320,
  h: 180,
  clip: false,
  opacity: 0.9,
  layout: { dir: "vertical", gap: 12, pad: [16, 20], justify: "space-between", align: "center" },
  fill: "#ffffff",
  stroke: { color: "#e6e6e6", width: 2, align: "outside" },
  radius: [12, 12, 4, 4],
  effects: [{ type: "shadow", x: 0, y: 4, blur: 12, spread: 0, color: "#0000001a" }],
  children: [
    {
      type: "text",
      key: "title",
      name: "Title",
      w: "fill",
      h: "hug",
      text: "Welcome back",
      font: { family: "Inter", style: "Semi Bold" },
      size: 24,
      lineHeight: 32,
      letterSpacing: -0.4,
      align: "center",
      color: "#111111",
    },
    {
      type: "rect",
      name: "Divider",
      w: "fill",
      h: 1,
      fill: "#eeeeee",
    },
    {
      type: "ellipse",
      name: "Dot",
      w: 24,
      h: 24,
      visible: false,
      fill: "#14ae5c80",
    },
  ],
};

test("a fully specified tree survives render then read unchanged", async () => {
  expect(await roundTrip(card)).toEqual(card);
});

test("the long and short spellings of a translucent fill converge", async () => {
  const long: UINodeSpec = {
    type: "rect",
    name: "Dot",
    w: 10,
    h: 10,
    fill: { type: "solid", color: "#14ae5c", opacity: 0.5 },
  };
  expect(await roundTrip(long)).toMatchObject({ fill: "#14ae5c80" });
});

test("a frame without a fill stays transparent, like a div with no background", async () => {
  const spec: UINodeSpec = {
    type: "frame",
    name: "Row",
    w: 100,
    h: 40,
    layout: { dir: "horizontal" },
  };
  const result = await roundTrip(spec);

  expect(result).not.toHaveProperty("fill");
  expect(result).toEqual(spec);
});

test("an auto layout frame hugs its content unless told otherwise", async () => {
  const spec: UINodeSpec = {
    type: "frame",
    name: "Stack",
    layout: { dir: "vertical", gap: 8 },
    children: [{ type: "rect", name: "Box", w: 40, h: 40 }],
  };

  const result = await roundTrip(spec);

  expect(result).toMatchObject({ w: "hug", h: "hug" });
});

test("an explicit size still wins over the hug default", async () => {
  const spec: UINodeSpec = {
    type: "frame",
    name: "Bar",
    w: 320,
    h: 48,
    layout: { dir: "horizontal" },
  };

  expect(await roundTrip(spec)).toMatchObject({ w: 320, h: 48 });
});

test("a gradient fill keeps its stops and angle", async () => {
  const spec: UINodeSpec = {
    type: "rect",
    name: "Hero",
    w: 200,
    h: 100,
    fill: {
      type: "gradient",
      kind: "linear",
      angle: 90,
      stops: [
        { at: 0, color: "#ff0000" },
        { at: 1, color: "#0000ff" },
      ],
    },
  };
  expect(await roundTrip(spec)).toEqual(spec);
});

test("reading is idempotent, so a sparse tree normalises once and then stays put", async () => {
  const sparse: UINodeSpec = {
    type: "frame",
    layout: { dir: "horizontal", gap: 8, pad: 16 },
    fill: "#fafafa",
    children: [
      { type: "text", text: "Hello" },
      { type: "ellipse", w: 16, h: 16 },
    ],
  };

  const first = await roundTrip(sparse);
  fake = installFakeFigma();
  const second = await roundTrip(first);

  expect(second).toEqual(first);
});

test("render reports the keys it wrote, and read finds them again", async () => {
  const keys: Record<string, string> = {};
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  const node = await buildNode(card, parent, keys);

  expect(Object.keys(keys)).toEqual(["card", "title"]);
  const tree = readNode(node, 10).tree as Extract<UINodeSpec, { type: "frame" }>;
  expect(tree.key).toBe("card");
  expect(tree.children?.[0]?.key).toBe("title");
});

test("depth stops the walk and says how many nodes it left out", async () => {
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  const node = await buildNode(card, parent, {});

  const shallow = readNode(node, 0);
  expect(shallow.skipped).toBe(3);
  expect((shallow.tree as Extract<UINodeSpec, { type: "frame" }>).children).toBeUndefined();
});

test("bounds, pinning and constraints survive the round trip", async () => {
  const spec: UINodeSpec = {
    type: "frame",
    name: "Overlay host",
    w: 300,
    h: 200,
    layout: { dir: "vertical" },
    children: [
      {
        type: "rect",
        name: "Badge",
        w: 24,
        h: 24,
        at: { x: 268, y: 8 },
        constraints: { h: "max", v: "min" },
      },
      {
        type: "text",
        name: "Body",
        w: "fill",
        h: "hug",
        minW: 120,
        maxW: 480,
        text: "Bounded",
        font: { family: "Inter", style: "Regular" },
        size: 16,
        lineHeight: "auto",
      },
    ],
  };

  const result = await roundTrip(spec);

  expect(result).toEqual(spec);
});

test("a node in the flow reports no placement at all", async () => {
  const result = await roundTrip({
    type: "frame",
    name: "Plain",
    layout: { dir: "vertical" },
    children: [{ type: "rect", name: "Box", w: 10, h: 10 }],
  });

  const child = (result as Extract<UINodeSpec, { type: "frame" }>).children?.[0];
  expect(child).not.toHaveProperty("at");
  expect(child).not.toHaveProperty("constraints");
});
