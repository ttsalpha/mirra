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

async function treeOf(node: SceneNode) {
  return (await readNode(node, 10)).tree as Extract<UINode, { type: "frame" }>;
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
  const tree = await treeOf(root);
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
  expect((await treeOf(root)).children?.map((child) => child.name)).toEqual([
    "Badge",
    "Title",
    "Divider",
  ]);
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

  const children = (await treeOf(root)).children ?? [];
  expect(children.map((child) => child.name)).toEqual(["Title", "Thick divider"]);
  expect(children[1]).toMatchObject({ h: 4, fill: "#dddddd" });
});

test("remove deletes the node, and the key stops resolving", async () => {
  const root = await renderCard();

  await patch({ ops: [{ op: "remove", target: { key: "divider" } }] });

  expect((await treeOf(root)).children?.map((child) => child.name)).toEqual(["Title"]);
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

test("a screenshot of a large frame lowers its scale to fit", async () => {
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  await buildNode({ type: "frame", key: "huge", name: "Huge", w: 4000, h: 1000 }, parent, {});

  const capped = await screenshot({ target: { key: "huge" }, scale: 2 });
  const roomy = await screenshot({ target: { key: "huge" }, scale: 2, maxEdge: 8000 });

  expect(capped.scale).toBeCloseTo(1200 / 4000, 5);
  expect(capped.width).toBe(1200);
  expect(roomy.scale).toBe(2);
  expect(roomy.width).toBe(8000);
});

test("set leaves a frame's fill alone when the props do not mention one", async () => {
  const root = await renderCard();

  await patch({ ops: [{ op: "set", target: { key: "card" }, props: { opacity: 0.5 } }] });

  expect(await treeOf(root)).toMatchObject({ fill: "#ffffff", opacity: 0.5 });
});

test("set src swaps an image's picture and keeps its fit", async () => {
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  const image = await buildNode(
    { type: "image", key: "hero", src: "data:image/png;base64,iVBORw0=", fit: "crop" },
    parent,
    {},
  );

  await patch({
    ops: [{ op: "set", target: { key: "hero" }, props: { src: "data:image/png;base64,AAAA" } }],
  });

  expect(await readNode(image, 1)).toMatchObject({
    tree: { type: "image", src: "data:image/png;base64,AAAA" },
  });
  expect((image as unknown as RectangleNode).fills).toMatchObject([{ scaleMode: "CROP" }]);
});

test("set fit changes how an image fills its box", async () => {
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  const image = await buildNode(
    { type: "image", key: "hero", src: "data:image/png;base64,iVBORw0=" },
    parent,
    {},
  );

  await patch({ ops: [{ op: "set", target: { key: "hero" }, props: { fit: "tile" } }] });

  expect((image as unknown as RectangleNode).fills).toMatchObject([{ scaleMode: "TILE" }]);
});

test("set src on an svg replaces the node but keeps its key, name and place", async () => {
  const card = await renderCard();
  const parent = card as unknown as BaseNode & ChildrenMixin;
  await patch({
    ops: [
      {
        op: "append",
        target: { key: "card" },
        tree: { type: "svg", key: "icon", name: "Logo", src: "<svg><rect/></svg>" },
        index: 0,
      },
    ],
  });
  const before = parent.children[0] as SceneNode;

  const result = await patch({
    ops: [
      { op: "set", target: { key: "icon" }, props: { src: "<svg><circle/></svg>" } },
      { op: "set", target: { key: "icon" }, props: { opacity: 0.5 } },
    ],
  });

  const after = parent.children[0] as SceneNode;
  expect(after).not.toBe(before);
  expect(before.removed).toBe(true);
  expect(after.name).toBe("Logo");
  expect(after.getPluginData("mirra:key")).toBe("icon");
  expect((after as SceneNode & BlendMixin).opacity).toBe(0.5);
  expect(result.keys["icon"]).toBe(after.id);
});

test("set src on a node that is neither image nor svg says so", async () => {
  await renderCard();

  await expect(
    patch({ ops: [{ op: "set", target: { key: "card" }, props: { src: "<svg/>" } }] }),
  ).rejects.toThrow(/src only applies to an image or svg/);
});

test("set component swaps the main component of an instance", async () => {
  fake.addComponent("Button");
  fake.addComponent("Link");
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  const instance = await buildNode(
    { type: "instance", key: "cta", component: "Button" },
    parent,
    {},
  );

  await patch({ ops: [{ op: "set", target: { key: "cta" }, props: { component: "Link" } }] });

  expect(instance.name).toBe("Link");
  expect((await readNode(instance, 1)).tree).toMatchObject({ component: "Link" });
});

test("set key renames the handle, and refuses one that is taken", async () => {
  await renderCard();

  const result = await patch({
    ops: [{ op: "set", target: { key: "title" }, props: { key: "heading" } }],
  });
  expect(result.keys["heading"]).toBeDefined();
  await expect(
    patch({ ops: [{ op: "set", target: { key: "heading" }, props: { key: "card" } }] }),
  ).rejects.toThrow(/already has the key "card"/);
});

test("a failing op names itself, and what came before is kept as one undo step", async () => {
  const root = await renderCard();
  const commits = fake.undoCommits;

  await expect(
    patch({
      ops: [
        { op: "set", target: { key: "card" }, props: { fill: "#fafafa" } },
        { op: "set", target: { key: "missing" }, props: { opacity: 0.5 } },
      ],
    }),
  ).rejects.toThrow(/op 2 of 2 \(set\) failed: No node with key "missing".*1 op\(s\) before it/);

  expect((await treeOf(root)).fill).toBe("#fafafa");
  expect(fake.undoCommits).toBe(commits + 1);
});
