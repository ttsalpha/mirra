import { beforeEach, expect, test } from "vitest";
import type { UINode } from "@mirra/schema";
import { buildNode } from "../figma/build";
import { installFakeFigma } from "../figma/fake-figma";
import { readNode } from "../figma/read";
import { buildNameIndex } from "../figma/tokens";
import { read } from "./read";
import { tokens } from "./tokens";

let fake: ReturnType<typeof installFakeFigma>;

beforeEach(() => {
  fake = installFakeFigma();
  fake.collections = [
    {
      id: "c1",
      name: "Theme",
      modes: [
        { modeId: "m1", name: "Light" },
        { modeId: "m2", name: "Dark" },
      ],
    },
  ];
  fake.variables = [
    {
      id: "v1",
      name: "color/primary",
      resolvedType: "COLOR",
      variableCollectionId: "c1",
      valuesByMode: { m1: { r: 1, g: 0, b: 0, a: 1 }, m2: { type: "VARIABLE_ALIAS", id: "v2" } },
    },
    {
      id: "v2",
      name: "color/brand",
      resolvedType: "COLOR",
      variableCollectionId: "c1",
      valuesByMode: { m1: { r: 0, g: 0, b: 1, a: 1 }, m2: { r: 0, g: 0, b: 1, a: 1 } },
    },
  ];
  fake.textStyles = [
    { id: "s1", name: "text/heading", fontName: { family: "Inter", style: "Bold" }, fontSize: 24 },
  ];
});

async function build(spec: UINode) {
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  return buildNode(spec, parent, {});
}

test("a $variable fill is bound, and reads back as the same reference", async () => {
  const spec: UINode = { type: "rect", name: "Chip", w: 40, h: 20, fill: "$color/primary" };
  const node = await build(spec);

  const paints = (node as unknown as { fills: { boundVariables?: unknown }[] }).fills;
  expect(paints[0]?.boundVariables).toEqual({ color: { type: "VARIABLE_ALIAS", id: "v1" } });

  const names = await buildNameIndex();
  expect((await readNode(node, 0, names)).tree).toEqual(spec);
});

test("an unknown variable name is refused by name", async () => {
  await expect(build({ type: "rect", fill: "$color/nope" })).rejects.toThrow(
    /No variable named "color\/nope"/,
  );
});

test("a $text style is applied and reads back", async () => {
  const spec: UINode = { type: "text", name: "Title", text: "Hello", style: "$text/heading" };
  const node = await build(spec);

  expect((node as unknown as { textStyleId: string }).textStyleId).toBe("s1");

  const names = await buildNameIndex();
  expect((await readNode(node, 0, names)).tree).toMatchObject({ style: "$text/heading" });
});

test("applying a style does not write fontName, which would detach it", async () => {
  const written: string[] = [];
  const node = await build({ type: "text", name: "Title", text: "Hello", style: "$text/heading" });
  const text = node as unknown as { fontName: unknown };

  // A write would replace the getter-free default with the assigned object.
  Object.defineProperty(text, "fontName", {
    set: () => written.push("fontName"),
    get: () => ({ family: "Inter", style: "Bold" }),
  });
  await build({ type: "text", name: "Title", text: "Hello", style: "$text/heading" });

  expect(written).toEqual([]);
});

test("an instance remembers the component it came from, not its layer name", async () => {
  fake.addComponent("Button");

  const node = await build({
    type: "instance",
    name: "CTA",
    component: "Button",
    properties: { Label: "Save" },
  });

  expect((await readNode(node, 0)).tree).toMatchObject({ name: "CTA", component: "Button" });
});

test("tokens lists collections, modes and alias values", async () => {
  const result = await tokens();

  expect(result.collections[0]).toMatchObject({ name: "Theme", modes: ["Light", "Dark"] });
  expect(result.collections[0]?.variables[0]).toEqual({
    ref: "$color/primary",
    type: "COLOR",
    values: { Light: "#ff0000", Dark: "$color/brand" },
  });
  expect(result.styles.text[0]).toEqual({ ref: "$text/heading", font: "Inter Bold", size: 24 });
});

test("an instance is created from a component by name, with its properties set", async () => {
  fake.addComponent("Button");

  const node = await build({
    type: "instance",
    key: "cta",
    component: "Button",
    properties: { Label: "Save", Disabled: false },
  });

  const tree = (await readNode(node, 0)).tree;
  expect(tree).toMatchObject({
    type: "instance",
    key: "cta",
    component: "Button",
    properties: { Label: "Save", Disabled: false },
  });
});

test("a property the component does not have is refused by name", async () => {
  fake.addComponent("Button");

  await expect(
    build({ type: "instance", component: "Button", properties: { Caption: "nope" } }),
  ).rejects.toThrow(/has no component property "Caption"\. It has: Label, Disabled/);
});

test("a missing component says what is on the page", async () => {
  fake.addComponent("Button");

  await expect(build({ type: "instance", component: "Card" })).rejects.toThrow(
    /No component named "Card" on this page\. Found: Button/,
  );
});

test("a node the DSL cannot express is counted once, not twice", async () => {
  const slice = fake.addSlice("Export") as { id: string };

  const result = await read({ nodeId: slice.id });

  expect(result.nodes).toHaveLength(0);
  expect(result.skipped).toBe(1);
});

test("number tokens bind the fields that take them, and read back as references", async () => {
  fake.addVariable("space/md");
  fake.addVariable("radius/card");
  const spec: UINode = {
    type: "frame",
    name: "Card",
    layout: { dir: "vertical", gap: "$space/md", pad: "$space/md" },
    radius: "$radius/card",
    stroke: { color: "$color/primary", width: "$space/md" },
    children: [{ type: "text", name: "Title", text: "Hello", size: "$space/md" }],
  };
  const node = await build(spec);

  const bound = (node as unknown as { boundVariables: Record<string, { id: string }> })
    .boundVariables;
  expect(bound["itemSpacing"]).toEqual({ type: "VARIABLE_ALIAS", id: "v3" });
  expect(bound["paddingTop"]).toEqual({ type: "VARIABLE_ALIAS", id: "v3" });
  expect(bound["topLeftRadius"]).toEqual({ type: "VARIABLE_ALIAS", id: "v4" });
  expect(bound["strokeWeight"]).toEqual({ type: "VARIABLE_ALIAS", id: "v3" });

  const names = await buildNameIndex();
  // The frame picks up its own hug sizing on the way back, so this is a subset.
  expect((await readNode(node, 2, names)).tree).toMatchObject(spec);
});

test("a radius token needs a node with corners", async () => {
  fake.addVariable("radius/card");

  await expect(build({ type: "ellipse", w: 10, h: 10, radius: "$radius/card" })).rejects.toThrow(
    /needs a node with corners/,
  );
});

test("read stops at the node budget and says how many it left", async () => {
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  const row: UINode = {
    type: "frame",
    name: "Row",
    layout: { dir: "horizontal" },
    children: Array.from({ length: 10 }, (_, index) => ({
      type: "rect" as const,
      name: `Box ${index}`,
      w: 10,
      h: 10,
    })),
  };
  const node = await buildNode(row, parent, {});

  const capped = await readNode(node, 5, undefined, 4);
  const whole = await readNode(node, 5);

  expect((capped.tree as Extract<UINode, { type: "frame" }>).children).toHaveLength(3);
  expect(capped.skipped).toBe(7);
  expect((whole.tree as Extract<UINode, { type: "frame" }>).children).toHaveLength(10);
  expect(whole.skipped).toBe(0);
});
