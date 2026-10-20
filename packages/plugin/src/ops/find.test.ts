import { beforeEach, expect, test } from "vitest";
import type { UINode } from "@mirra/schema";
import { buildNode } from "../figma/build";
import { installFakeFigma } from "../figma/fake-figma";
import { readNode } from "../figma/read";
import { find } from "./find";
import { patch } from "./patch";

let fake: ReturnType<typeof installFakeFigma>;

beforeEach(() => {
  fake = installFakeFigma();
});

async function build(spec: UINode) {
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  return buildNode(spec, parent, {});
}

const row: UINode = {
  type: "frame",
  key: "row",
  name: "Row",
  layout: { dir: "horizontal", gap: 8 },
  children: [
    { type: "text", key: "first", name: "First label", text: "One" },
    { type: "text", key: "second", name: "Second label", text: "Two" },
    { type: "rect", key: "box", name: "Box", w: 10, h: 10 },
  ],
};

test("find matches on name, and reports the key a node carries", async () => {
  await build(row);

  const result = await find({ name: "label" });

  expect(result.nodes.map((node) => node.name)).toEqual(["First label", "Second label"]);
  expect(result.nodes[0]).toMatchObject({ kind: "TEXT", key: "first", page: "Page 1" });
  expect(result.truncated).toBe(false);
});

test("find filters by kind and says when it stopped early", async () => {
  await build(row);

  const texts = await find({ kind: "text" });
  expect(texts.nodes).toHaveLength(2);

  const capped = await find({ limit: 1 });
  expect(capped.nodes).toHaveLength(1);
  expect(capped.truncated).toBe(true);
});

test("move puts a child at a new index", async () => {
  const root = await build(row);

  await patch({ ops: [{ op: "move", target: { key: "box" }, index: 0 }] });

  const tree = readNode(root, 5).tree as Extract<UINode, { type: "frame" }>;
  expect(tree.children?.map((child) => child.name)).toEqual(["Box", "First label", "Second label"]);
});
