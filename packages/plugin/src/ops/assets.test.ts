import { beforeEach, expect, test } from "vitest";
import type { UINode } from "@mirra/schema";
import { buildNode } from "../figma/build";
import { installFakeFigma } from "../figma/fake-figma";
import { readNode } from "../figma/read";
import { define } from "./define";

let fake: ReturnType<typeof installFakeFigma>;

beforeEach(() => {
  fake = installFakeFigma();
});

async function build(spec: UINode) {
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  return buildNode(spec, parent, {});
}

const CIRCLE = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>';

test("an svg node keeps its markup, so read hands the same tree back", async () => {
  const node = await build({ type: "svg", key: "icon", name: "Icon", src: CIRCLE });

  expect(readNode(node, 2).tree).toMatchObject({ type: "svg", key: "icon", src: CIRCLE });
});

test("an image node reads back by the path it was inlined from", async () => {
  const node = await build({
    type: "image",
    key: "hero",
    name: "Hero",
    src: "data:image/png;base64,aGVsbG8=",
    srcRef: "assets/hero.png",
    radius: 8,
  });

  expect(readNode(node, 0).tree).toMatchObject({
    type: "image",
    key: "hero",
    src: "assets/hero.png",
    radius: 8,
  });
});

test("an image starts at its own size", async () => {
  const node = await build({ type: "image", name: "Hero", src: "aGVsbG8=" });

  expect(readNode(node, 0).tree).toMatchObject({ w: 64, h: 64 });
});

test("define creates a collection, its modes and the variables in it", async () => {
  const result = await define({
    collection: "Theme",
    modes: ["Light", "Dark"],
    variables: [
      { name: "color/brand", type: "color", value: { Light: "#ff0000", Dark: "#aa0000" } },
      { name: "color/primary", type: "color", value: "$color/brand" },
      { name: "space/md", type: "number", value: 16 },
    ],
  });

  expect(result).toMatchObject({
    collection: "Theme",
    modes: ["Light", "Dark"],
    created: ["color/brand", "color/primary", "space/md"],
    notes: [],
  });
  expect(fake.collections[0]?.modes.map((mode) => mode.name)).toEqual(["Light", "Dark"]);

  const brand = fake.variables.find((variable) => variable.name === "color/brand");
  expect(brand?.valuesByMode["m1"]).toEqual({ r: 1, g: 0, b: 0, a: 1 });

  const primary = fake.variables.find((variable) => variable.name === "color/primary");
  expect(primary?.valuesByMode["m1"]).toEqual({ type: "VARIABLE_ALIAS", id: brand?.id });
});

test("a mode the file refuses is reported instead of failing the call", async () => {
  fake.collections = [
    {
      id: "c1",
      name: "Theme",
      modes: [{ modeId: "m1", name: "Mode 1" }],
      addMode: () => {
        throw new Error("in addMode: Limited to 1 modes only");
      },
      renameMode(modeId: string, name: string) {
        const mode = this.modes.find((candidate) => candidate.modeId === modeId);
        if (mode) mode.name = name;
      },
    },
  ];

  const result = await define({
    collection: "Theme",
    modes: ["Light", "Dark"],
    variables: [
      { name: "color/brand", type: "color", value: { Light: "#ff0000", Dark: "#000000" } },
    ],
  });

  expect(result.modes).toEqual(["Light"]);
  expect(result.notes[0]).toMatch(/Limited to 1 modes only/);
  expect(result.created).toEqual(["color/brand"]);

  // The Light value still lands rather than the variable being left empty.
  const brand = fake.variables.find((variable) => variable.name === "color/brand");
  expect(brand?.valuesByMode["m1"]).toEqual({ r: 1, g: 0, b: 0, a: 1 });
});

test("defining the same variable twice updates it instead of duplicating", async () => {
  await define({
    collection: "Theme",
    variables: [{ name: "space/md", type: "number", value: 16 }],
  });
  const again = await define({
    collection: "Theme",
    variables: [{ name: "space/md", type: "number", value: 24 }],
  });

  expect(again).toMatchObject({ created: [], updated: ["space/md"] });
  expect(fake.variables).toHaveLength(1);
});
