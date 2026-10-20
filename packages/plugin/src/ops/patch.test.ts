import { beforeEach, expect, test } from "vitest";
import type { UINode } from "@mirra/schema";
import { buildNode } from "../figma/build";
import { installFakeFigma } from "../figma/fake-figma";
import { readNode } from "../figma/read";
import { patch } from "./patch";
import { screenshot } from "./screenshot";

let fake: ReturnType<typeof installFakeFigma>;

const card: UINode = {
  type: "frame",
  key: "card",
  name: "Card",
  layout: { dir: "vertical", gap: 8, pad: 16 },
  fill: "#ffffff",
  children: [
    { type: "text", key: "title", name: "Title", text: "Welcome back", size: 24 },
    { type: "rect", key: "divider", name: "Divider", w: 100, h: 1, fill: "#eeeeee" },
  ],
};

async function renderCard() {
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  return buildNode(card, parent, {});
}

function treeOf(node: SceneNode) {
  return readNode(node, 10).tree as Extract<UINode, { type: "frame" }>;
}

beforeEach(() => {
  fake = installFakeFigma();
});

test("set changes properties of a node addressed by key", async () => {
  const root = await renderCard();

  const result = await patch({
    ops: [
      { op: "set", target: { key: "title" }, props: { text: "Hello again", color: "#111111" } },
      { op: "set", target: { key: "card" }, props: { fill: "#fafafa", radius: 12 } },
    ],
  });

  expect(result.applied).toBe(2);
  const tree = treeOf(root);
  expect(tree.fill).toBe("#fafafa");
  expect(tree.radius).toBe(12);
  expect(tree.children?.[0]).toMatchObject({ text: "Hello again", color: "#111111" });
});

test("append adds a child, honouring the index it is given", async () => {
  const root = await renderCard();

  const result = await patch({
    ops: [
      {
        op: "append",
        target: { key: "card" },
        index: 0,
        tree: { type: "ellipse", key: "badge", name: "Badge", w: 16, h: 16, fill: "#14ae5c" },
      },
    ],
  });

  expect(result.keys).toEqual({ badge: expect.any(String) });
  expect(treeOf(root).children?.map((child) => child.name)).toEqual(["Badge", "Title", "Divider"]);
});

test("replace swaps a node in place and keeps its position", async () => {
  const root = await renderCard();

  await patch({
    ops: [
      {
        op: "replace",
        target: { key: "divider" },
        tree: {
          type: "rect",
          key: "divider",
          name: "Thick divider",
          w: 100,
          h: 4,
          fill: "#dddddd",
        },
      },
    ],
  });

  const children = treeOf(root).children ?? [];
  expect(children.map((child) => child.name)).toEqual(["Title", "Thick divider"]);
  expect(children[1]).toMatchObject({ h: 4, fill: "#dddddd" });
});

test("remove deletes the node, and the key stops resolving", async () => {
  const root = await renderCard();

  await patch({ ops: [{ op: "remove", target: { key: "divider" } }] });

  expect(treeOf(root).children?.map((child) => child.name)).toEqual(["Title"]);
  await expect(patch({ ops: [{ op: "remove", target: { key: "divider" } }] })).rejects.toThrow(
    /No node with key "divider"/,
  );
});

test("the whole patch is a single undo step", async () => {
  await renderCard();
  const before = fake.undoCommits;

  await patch({
    ops: [
      { op: "set", target: { key: "title" }, props: { text: "One" } },
      { op: "set", target: { key: "title" }, props: { text: "Two" } },
    ],
  });

  expect(fake.undoCommits - before).toBe(1);
});

test("properties that do not apply to the node type are refused by name", async () => {
  await renderCard();

  await expect(
    patch({
      ops: [{ op: "set", target: { key: "divider" }, props: { layout: { dir: "vertical" } } }],
    }),
  ).rejects.toThrow(/only apply to a frame/);

  await expect(
    patch({ ops: [{ op: "set", target: { key: "divider" }, props: { text: "nope" } }] }),
  ).rejects.toThrow(/only apply to a text node/);
});

test("screenshot exports the target and reports its size", async () => {
  const root = await renderCard();

  const shot = await screenshot({ target: { key: "card" }, scale: 2 });

  expect(shot.id).toBe(root.id);
  expect(shot.name).toBe("Card");
  expect(shot.png).toBe(Buffer.from([137, 80, 78, 71]).toString("base64"));
});

test("screenshot without a target falls back to the selection", async () => {
  const root = await renderCard();
  fake.page.selection = [root as unknown as never];

  await expect(screenshot({})).resolves.toMatchObject({ name: "Card" });

  fake.page.selection = [];
  await expect(screenshot({})).rejects.toThrow(/Nothing is selected/);
});
