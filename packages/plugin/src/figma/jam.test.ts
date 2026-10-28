import { beforeEach, expect, test } from "vitest";
import { UINode } from "@mirra/schema";
import type { UINode as UINodeSpec } from "@mirra/schema";
import { buildNode, type Deferred } from "./build";
import { installFakeFigma } from "./fake-figma";
import { readNode } from "./read";
import { find } from "../ops/find";
import { patch } from "../ops/patch";
import { ping } from "../ops/ping";
import { define } from "../ops/define";
import { tokens } from "../ops/tokens";

let fake: ReturnType<typeof installFakeFigma>;

beforeEach(() => {
  fake = installFakeFigma();
  fake.editorType = "figjam";
});

async function render(spec: UINodeSpec): Promise<SceneNode> {
  const parent = fake.page as unknown as BaseNode & ChildrenMixin;
  const deferred: Deferred = [];
  const node = await buildNode(spec, parent, {}, undefined, deferred);
  for (const place of deferred) place();
  return node;
}

async function read(node: SceneNode): Promise<UINodeSpec> {
  const outcome = await readNode(node, 10);
  expect(outcome.skipped).toBe(0);
  return UINode.parse(outcome.tree);
}

type Section = Extract<UINodeSpec, { type: "section" }>;

const board: Section = {
  type: "section",
  key: "board",
  name: "Checkout flow",
  w: 900,
  h: 500,
  fill: "#f5f5f5",
  children: [
    // Listed first, so the connector is bound before its ends exist.
    {
      type: "connector",
      key: "flow",
      from: "cart",
      to: { key: "pay", magnet: "left" },
      line: "curved",
      endCap: "triangle",
      startCap: "none",
      text: "next",
    },
    {
      type: "sticky",
      key: "cart",
      text: "Cart",
      fill: "#ffc943",
      wide: true,
      author: true,
      at: { x: 40, y: 60 },
    },
    {
      type: "shape",
      key: "pay",
      name: "Pay",
      shape: "diamond",
      w: 200,
      h: 120,
      rotation: 10,
      text: "Pay?",
      font: { family: "Roboto", style: "Bold" },
      size: 20,
      color: "#222222",
      fill: "#e0f0ff",
      stroke: { color: "#0066cc", width: 2 },
      at: { x: 400, y: 80 },
    },
    {
      type: "table",
      name: "Plans",
      rows: [
        ["Plan", "Price"],
        ["Free", "0"],
      ],
      colWidths: [100, 80],
      at: { x: 40, y: 300 },
    },
    {
      type: "code",
      name: "Snippet",
      code: "const a = 1;",
      language: "typescript",
      at: { x: 400, y: 300 },
    },
    { type: "link", url: "https://example.com/docs", at: { x: 700, y: 300 } },
  ],
};

test("a board survives render then read, with connectors keeping their keys", async () => {
  const first = await read(await render(board));
  expect(first).toMatchObject({
    type: "section",
    key: "board",
    name: "Checkout flow",
    w: 900,
    h: 500,
  });

  const children = (first as Section).children ?? [];
  const byType = (type: string) => children.find((child) => child.type === type);
  expect(byType("connector")).toMatchObject({
    from: "cart",
    to: { key: "pay", magnet: "left" },
    line: "curved",
    startCap: "none",
    endCap: "triangle",
    text: "next",
  });
  expect(byType("sticky")).toMatchObject({
    text: "Cart",
    wide: true,
    author: true,
    at: { x: 40, y: 60 },
  });
  expect(byType("shape")).toMatchObject({
    shape: "diamond",
    w: 200,
    h: 120,
    rotation: 10,
    text: "Pay?",
    font: { family: "Roboto", style: "Bold" },
    size: 20,
    color: "#222222",
    stroke: { color: "#0066cc", width: 2 },
  });
  expect(byType("table")).toMatchObject({
    rows: [
      ["Plan", "Price"],
      ["Free", "0"],
    ],
    colWidths: [100, 80],
  });
  expect(byType("code")).toMatchObject({ code: "const a = 1;", language: "typescript" });
  expect(byType("link")).toMatchObject({ url: "https://example.com/docs" });
});

test("reading is idempotent for a board", async () => {
  const once = await read(await render(board));
  const twice = await read(await render(once));
  expect(twice).toEqual(once);
});

test("a section lays its children out and grows to hold them", async () => {
  const section = (await render({
    type: "section",
    layout: { dir: "horizontal", gap: 16, pad: 24 },
    children: [
      { type: "sticky", text: "a" },
      { type: "sticky", text: "b" },
      { type: "sticky", text: "c" },
    ],
  })) as SectionNode;

  expect(section.children.map((child) => child.x)).toEqual([24, 280, 536]);
  expect(section.children.map((child) => child.y)).toEqual([24, 24, 24]);
  expect([section.width, section.height]).toEqual([800, 288]);
});

test("wrap breaks lines at the section's width", async () => {
  const section = (await render({
    type: "section",
    w: 560,
    layout: { dir: "horizontal", gap: 16, pad: 24, wrap: true },
    children: [
      { type: "sticky", text: "a" },
      { type: "sticky", text: "b" },
      { type: "sticky", text: "c" },
    ],
  })) as SectionNode;

  expect(section.children.map((child) => [child.x, child.y])).toEqual([
    [24, 24],
    [280, 24],
    [24, 280],
  ]);
  expect([section.width, section.height]).toEqual([560, 544]);
});

test("wrap without a width to break at is refused", async () => {
  await expect(
    render({ type: "section", layout: { dir: "horizontal", wrap: true }, children: [] }),
  ).rejects.toThrow(/wrap needs a fixed w/);
});

test("a child with its own position stays out of the layout", async () => {
  const section = (await render({
    type: "section",
    layout: { dir: "vertical", gap: 10, pad: 0 },
    children: [
      { type: "sticky", text: "pinned", at: { x: 500, y: 500 } },
      { type: "sticky", text: "flows" },
    ],
  })) as SectionNode;

  const [pinned, flows] = section.children;
  expect([pinned?.x, pinned?.y]).toEqual([500, 500]);
  expect([flows?.x, flows?.y]).toEqual([0, 0]);
});

test("a connector to a key that exists nowhere says which end failed", async () => {
  await expect(
    render({
      type: "section",
      children: [{ type: "connector", from: "ghost", to: { x: 1, y: 1 } }],
    }),
  ).rejects.toThrow(/connector from: no node with key "ghost"/);
});

test("a connector can join a node that is already on the page", async () => {
  const existing = await render({ type: "sticky", key: "old", text: "old" });
  const connector = (await render({
    type: "connector",
    from: "old",
    to: { x: 10, y: 20 },
  })) as ConnectorNode;

  expect(connector.connectorStart).toMatchObject({ endpointNodeId: existing.id, magnet: "AUTO" });
  expect(connector.connectorEnd).toEqual({ position: { x: 10, y: 20 } });
});

test("patch retargets a connector and rewrites a table in place", async () => {
  await render(board);

  await patch({
    ops: [
      { op: "set", target: { key: "flow" }, props: { to: "cart", line: "straight" } },
      { op: "set", target: { key: "cart" }, props: { text: "Basket", fill: "#00ff00" } },
      {
        op: "set",
        target: { id: fake.page.findAll((node) => node.type === "TABLE")[0]!.id },
        props: {
          rows: [
            ["Plan", "Price", "Seats"],
            ["Pro", "9", "5"],
            ["Team", "29", "50"],
          ],
        },
      },
    ],
  });

  const tree = (await read(
    fake.page.findAll((node) => node.type === "SECTION")[0] as never,
  )) as Section;
  const table = tree.children?.find((child) => child.type === "table");
  expect(table).toMatchObject({
    rows: [
      ["Plan", "Price", "Seats"],
      ["Pro", "9", "5"],
      ["Team", "29", "50"],
    ],
  });
  expect(tree.children?.find((child) => child.type === "connector")).toMatchObject({
    to: "cart",
    line: "straight",
  });
  expect(tree.children?.find((child) => child.type === "sticky")).toMatchObject({
    text: "Basket",
    fill: "#00ff00",
  });
});

test("patch can reflow a section", async () => {
  await render({
    type: "section",
    key: "col",
    children: [
      { type: "sticky", text: "a" },
      { type: "sticky", text: "b" },
    ],
  });

  await patch({
    ops: [
      {
        op: "set",
        target: { key: "col" },
        props: { layout: { dir: "vertical", gap: 8, pad: 10 } },
      },
    ],
  });

  const section = fake.page.findAll((node) => node.type === "SECTION")[0] as unknown as SectionNode;
  expect(section.children.map((child) => [child.x, child.y])).toEqual([
    [10, 10],
    [10, 258],
  ]);
});

test("props a FigJam node cannot take are refused, not dropped", async () => {
  await render({ type: "sticky", key: "s", text: "x" });
  await expect(
    patch({ ops: [{ op: "set", target: { key: "s" }, props: { radius: 8 } }] }),
  ).rejects.toThrow(/radius cannot be set on a sticky/);
  await expect(
    patch({ ops: [{ op: "set", target: { key: "s" }, props: { align: "center" } }] }),
  ).rejects.toThrow(/align cannot be set on a sticky/);
});

test("FigJam props are refused on a design node", async () => {
  fake.editorType = "figma";
  await render({ type: "rect", key: "r", w: 10, h: 10 });
  await expect(
    patch({ ops: [{ op: "set", target: { key: "r" }, props: { wide: true } }] }),
  ).rejects.toThrow(/wide cannot be set on a rectangle/);
});

test("a frame in FigJam points at what to use instead", async () => {
  await expect(render({ type: "frame", children: [] })).rejects.toThrow(/Use sticky, shape/);
});

test("variables and styles are refused in FigJam rather than failing deep inside", async () => {
  await expect(render({ type: "sticky", text: "x", fill: "$color/primary" })).rejects.toThrow(
    /FigJam has no variables/,
  );
  await expect(render({ type: "sticky", text: "x", size: "$text/size" })).rejects.toThrow(
    /no variables/,
  );
  await expect(define({ collection: "c" })).rejects.toThrow(/FigJam has no variables/);
  expect(await tokens()).toEqual({ collections: [], styles: { paint: [], text: [], effect: [] } });
});

test("find knows the FigJam kinds", async () => {
  await render(board);
  const stickies = await find({ kind: "sticky" });
  expect(stickies.nodes.map((node) => node.key)).toEqual(["cart"]);
  expect((await find({ kind: "connector" })).nodes).toHaveLength(1);
  expect((await find({ kind: "section" })).nodes).toHaveLength(1);
});

test("ping reports which editor it runs in", async () => {
  expect(ping().editorType).toBe("figjam");
  fake.editorType = "figma";
  expect(ping().editorType).toBe("figma");
});

test("a section in Figma Design still reads back as a frame", async () => {
  fake.editorType = "figma";
  const section = await render({ type: "section", children: [] });
  expect(await read(section)).toMatchObject({ type: "frame" });
});

test("a straight connector attaches at the centre, and refuses another side", async () => {
  const section = (await render({
    type: "section",
    children: [
      { type: "sticky", key: "a", text: "a" },
      { type: "sticky", key: "b", text: "b", at: { x: 400, y: 0 } },
      { type: "connector", key: "line", from: "a", to: "b", line: "straight" },
    ],
  })) as SectionNode;
  const connector = section.children.find((child) => child.type === "CONNECTOR") as ConnectorNode;
  expect(connector.connectorStart).toMatchObject({ magnet: "CENTER" });
  expect(await read(section)).toMatchObject({
    children: expect.arrayContaining([
      expect.objectContaining({ type: "connector", from: "a", to: "b" }),
    ]),
  });

  await expect(
    render({
      type: "section",
      children: [
        { type: "sticky", key: "c", text: "c" },
        {
          type: "connector",
          from: { key: "c", magnet: "top" },
          to: { x: 1, y: 1 },
          line: "straight",
        },
      ],
    }),
  ).rejects.toThrow(/straight line can only attach at the centre/);
});

test("patching an attached connector to straight moves its ends to the centre", async () => {
  await render({
    type: "section",
    children: [
      { type: "sticky", key: "a", text: "a" },
      { type: "sticky", key: "b", text: "b", at: { x: 400, y: 0 } },
      { type: "connector", key: "line", from: "a", to: "b" },
    ],
  });
  await patch({ ops: [{ op: "set", target: { key: "line" }, props: { line: "straight" } }] });
  const connector = fake.page.findAll(
    (node) => node.type === "CONNECTOR",
  )[0] as unknown as ConnectorNode;
  expect(connector.connectorLineType).toBe("STRAIGHT");
  expect(connector.connectorEnd).toMatchObject({ magnet: "CENTER" });
});

test("a table's fill reads back from its cells", async () => {
  const table = await render({ type: "table", rows: [["a"]], fill: "#fff7e0" });
  expect(await read(table)).toMatchObject({ fill: "#fff7e0" });
});

test("a link card is waited for, so a layout sees its final height", async () => {
  const section = (await render({
    type: "section",
    layout: { dir: "horizontal" },
    children: [{ type: "link", url: "https://example.com" }],
  })) as SectionNode;
  expect(section.children).toHaveLength(1);
});

test("wrap on an existing section breaks at the width it already has", async () => {
  const section = (await render({
    type: "section",
    key: "row",
    w: 560,
    children: [
      { type: "sticky", text: "a" },
      { type: "sticky", text: "b" },
      { type: "sticky", text: "c" },
    ],
  })) as SectionNode;
  await patch({
    ops: [
      {
        op: "set",
        target: { key: "row" },
        props: { layout: { dir: "horizontal", gap: 16, pad: 24, wrap: true } },
      },
    ],
  });
  expect(section.children.map((child) => [child.x, child.y])).toEqual([
    [24, 24],
    [280, 24],
    [24, 280],
  ]);
});

test("a font survives read, and a text-only patch leaves it alone", async () => {
  await render({
    type: "shape",
    key: "s",
    text: "Hi",
    font: { family: "Roboto", style: "Bold" },
  });
  await patch({ ops: [{ op: "set", target: { key: "s" }, props: { text: "Hello" } }] });
  const node = fake.page.findAll(
    (n) => n.type === "SHAPE_WITH_TEXT",
  )[0] as unknown as ShapeWithTextNode;
  expect(await read(node)).toMatchObject({
    text: "Hello",
    font: { family: "Roboto", style: "Bold" },
  });
});

test("find skips table cells, which a FigJam page walk includes", async () => {
  await render({ type: "table", key: "t", rows: [["a", "b"]] });
  expect((await find({ key: "t" })).nodes).toHaveLength(1);
  expect((await find({ name: "Table" })).nodes).toHaveLength(1);
});

test("Inter reads back too, so a bold or regular style is not lost", async () => {
  const node = await render({
    type: "sticky",
    text: "x",
    font: { family: "Inter", style: "Bold" },
  });
  expect(await read(node)).toMatchObject({ font: { family: "Inter", style: "Bold" } });
});

const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

test("a gif is placed from its bytes and reads back as the file it came from", async () => {
  const node = await render({
    type: "gif",
    key: "anim",
    src: PIXEL,
    srcRef: "media/anim.gif",
    w: 120,
    h: 80,
  });
  expect(node.type).toBe("MEDIA");
  expect(await read(node)).toMatchObject({
    type: "gif",
    key: "anim",
    src: "media/anim.gif",
    w: 120,
    h: 80,
  });
});

test("a gif with nothing remembered about its source is left out of a read, and counted", async () => {
  const node = await render({ type: "gif", src: PIXEL, w: 10, h: 10 });
  // Inline bytes are small enough to be remembered, so clear them the way a foreign gif has none.
  node.setPluginData("mirra:src", "");
  const outcome = await readNode(node, 3);
  expect(outcome.tree).toBeNull();
  expect(outcome.skipped).toBe(1);
});

test("a table cell can carry its own fill and text colour", async () => {
  const table = await render({
    type: "table",
    fill: "#fff7e0",
    rows: [
      ["a", { text: "b", fill: "#ff0000", color: "#ffffff" }],
      ["c", "d"],
    ],
  });
  expect(await read(table)).toMatchObject({
    fill: "#fff7e0",
    rows: [
      ["a", { text: "b", fill: "#ff0000", color: "#ffffff" }],
      ["c", "d"],
    ],
  });
});

test("find can locate the kinds mirra only reads", async () => {
  expect((await find({ kind: "gif" })).nodes).toHaveLength(0);
  expect((await find({ kind: "stamp" })).nodes).toHaveLength(0);
});
