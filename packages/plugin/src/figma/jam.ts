import { CONNECTOR_CAPS, CONNECTOR_LINES, MAGNETS, SHAPE_TYPES } from "@mirra/schema/constants";
import type { ConnectorEnd, Layout, NodeProps, UINode } from "@mirra/schema";
import { KEY_FIELD, stripDataUri, type Deferred } from "./build";
import { isRef } from "./tokens";
import { toPadding, toPaints } from "./values";

/** What an op needs to bind connectors to nodes that may not exist yet. */
export type JamContext = { keys: Record<string, string>; deferred: Deferred };

type JamSpec = Extract<
  UINode,
  { type: "sticky" | "shape" | "connector" | "section" | "table" | "code" | "link" | "gif" }
>;

/** Node types FigJam has and Figma Design lacks, plus the section both share. */
const JAM_TYPES = new Set([
  "STICKY",
  "SHAPE_WITH_TEXT",
  "CONNECTOR",
  "SECTION",
  "TABLE",
  "CODE_BLOCK",
  "EMBED",
  "LINK_UNFURL",
  "MEDIA",
]);

export function isJamNode(node: SceneNode): boolean {
  return JAM_TYPES.has(node.type);
}

export function isJamSpec(spec: UINode): spec is JamSpec {
  return (
    spec.type === "sticky" ||
    spec.type === "shape" ||
    spec.type === "connector" ||
    spec.type === "section" ||
    spec.type === "table" ||
    spec.type === "code" ||
    spec.type === "link" ||
    spec.type === "gif"
  );
}

export async function makeJam(spec: JamSpec): Promise<SceneNode> {
  switch (spec.type) {
    case "sticky":
      return figma.createSticky();
    case "shape":
      return figma.createShapeWithText();
    case "connector":
      return figma.createConnector();
    case "section":
      return figma.createSection();
    case "table":
      return figma.createTable(spec.rows.length, columnCount(spec.rows));
    case "code":
      return figma.createCodeBlock();
    case "link":
      return figma.createLinkPreviewAsync(spec.url);
    case "gif": {
      const image = figma.createImage(figma.base64Decode(stripDataUri(spec.src)));
      return figma.createGif(image.hash);
    }
  }
}

const TEXT_PROPS = ["text", "font", "size", "letterSpacing", "color"];
// Present on every node the build step handles, so never a reason to refuse.
const ALWAYS = ["type", "children", "key", "name", "opacity", "visible", "at"];

const ALLOWED: Record<string, string[]> = {
  STICKY: [...TEXT_PROPS, "fill", "wide", "author"],
  SHAPE_WITH_TEXT: [...TEXT_PROPS, "fill", "stroke", "shape", "w", "h", "rotation"],
  CONNECTOR: [...TEXT_PROPS, "stroke", "from", "to", "line", "startCap", "endCap"],
  SECTION: ["fill", "stroke", "radius", "layout", "w", "h"],
  TABLE: ["rows", "colWidths", "rowHeights", "fill", "font", "size", "color"],
  CODE_BLOCK: ["code", "language"],
  MEDIA: ["src", "srcRef", "w", "h"],
  EMBED: ["url"],
  LINK_UNFURL: ["url"],
};

/** A prop the node cannot take would otherwise be dropped without a word. */
export function checkJamProps(node: SceneNode, props: NodeProps): void {
  const allowed = ALLOWED[node.type] ?? [];
  const refused = Object.entries(props)
    .filter(([name, value]) => value !== undefined && !ALWAYS.includes(name))
    .map(([name]) => name)
    .filter((name) => !allowed.includes(name));

  if (refused.length) {
    throw new Error(`${refused.join(", ")} cannot be set on a ${label(node)}`);
  }
}

/** Misuse the other way round: a FigJam-only prop aimed at a node that is not one. */
export function checkNotJamProps(node: SceneNode, props: NodeProps): void {
  const only = [
    "shape",
    "wide",
    "author",
    "from",
    "to",
    "line",
    "startCap",
    "endCap",
    "rows",
    "colWidths",
    "rowHeights",
    "code",
    "language",
  ] as const;
  const stray = only.filter((name) => props[name] !== undefined);
  if (stray.length) throw new Error(`${stray.join(", ")} cannot be set on a ${label(node)}`);
}

function label(node: SceneNode): string {
  return node.type.toLowerCase().replace(/_/g, " ");
}

/** Everything a FigJam node takes beyond the props a design node shares. */
export async function applyJam(node: SceneNode, props: NodeProps, ctx: JamContext): Promise<void> {
  switch (node.type) {
    case "STICKY":
      if (props.wide !== undefined) node.isWideWidth = props.wide;
      if (props.author !== undefined) node.authorVisible = props.author;
      await writeText(node.text, props);
      return;
    case "SHAPE_WITH_TEXT":
      if (props.shape) node.shapeType = SHAPE_TYPES[props.shape];
      await writeText(node.text, props);
      return;
    case "CONNECTOR":
      applyConnector(node, props, ctx);
      await writeText(node.text, props);
      return;
    case "TABLE":
      await applyTable(node, props);
      return;
    case "CODE_BLOCK":
      // The block's font is not readable, and writing code fails until it is loaded.
      if (props.code !== undefined) {
        await figma.loadFontAsync(CODE_FONT);
        node.code = props.code;
      }
      if (props.language) node.codeLanguage = props.language.toUpperCase() as never;
      return;
  }
}

/** Sublayers need their font loaded first, and have no line height, alignment or style. */
async function writeText(layer: TextSublayerNode, props: NodeProps): Promise<void> {
  if (props.lineHeight !== undefined || props.align !== undefined || props.style !== undefined) {
    throw new Error("lineHeight, align and style are not available on text inside a FigJam node");
  }

  // Colour needs no font, so a node that only changes colour never loads one.
  const writesGlyphs =
    props.text !== undefined ||
    props.font !== undefined ||
    props.size !== undefined ||
    props.letterSpacing !== undefined;

  if (writesGlyphs) {
    const found = readFont(layer);
    const usable = found !== undefined;
    const current = found ?? FALLBACK_FONT;
    const font = props.font
      ? { family: props.font.family, style: props.font.style ?? current.style }
      : current;
    await figma.loadFontAsync(font);
    if (props.font || !usable) layer.fontName = font;
  }

  if (props.text !== undefined) layer.characters = props.text;
  if (props.size !== undefined) layer.fontSize = literal(props.size);
  if (props.letterSpacing !== undefined) {
    layer.letterSpacing = { unit: "PIXELS", value: literal(props.letterSpacing) };
  }
  if (props.color !== undefined) {
    if (typeof props.color === "string" && isRef(props.color)) throw noVariables(props.color);
    layer.fills = toPaints(props.color);
  }
}

/** A sublayer's `fontName` can report no family; the font of its first character is the dependable read. */
export function readFont(layer: TextSublayerNode): FontName | undefined {
  if (layer.fontName !== figma.mixed && layer.fontName.family) return layer.fontName;
  if (!layer.characters.length) return undefined;
  const ranged = layer.getRangeFontName(0, 1);
  return ranged !== figma.mixed && ranged.family ? ranged : undefined;
}

const CODE_FONT: FontName = { family: "Source Code Pro", style: "Medium" };

const FALLBACK_FONT: FontName = { family: "Inter", style: "Medium" };

function literal(value: number | string): number {
  if (typeof value === "number") return value;
  throw noVariables(value);
}

function noVariables(ref: string): Error {
  return new Error(`FigJam has no variables or styles, so "${ref}" cannot be used. Pass a value.`);
}

function applyConnector(node: ConnectorNode, props: NodeProps, ctx: JamContext): void {
  if (props.line === "straight") {
    // FigJam refuses a straight line on any magnet but the centre, so ends already
    // attached on another side move there first.
    node.connectorStart = centred(node.connectorStart);
    node.connectorEnd = centred(node.connectorEnd);
  }
  if (props.line) node.connectorLineType = CONNECTOR_LINES[props.line];
  if (props.startCap) node.connectorStartStrokeCap = CONNECTOR_CAPS[props.startCap];
  if (props.endCap) node.connectorEndStrokeCap = CONNECTOR_CAPS[props.endCap];

  // The nodes a connector joins may be built after it, so binding waits for the tree.
  const { from, to } = props;
  if (from === undefined && to === undefined) return;
  ctx.deferred.push(() => {
    const straight = node.connectorLineType === "STRAIGHT";
    if (from !== undefined) node.connectorStart = endpoint(from, ctx.keys, "from", straight);
    if (to !== undefined) node.connectorEnd = endpoint(to, ctx.keys, "to", straight);
  });
}

function centred(end: ConnectorEndpoint): ConnectorEndpoint {
  return "magnet" in end && end.magnet !== "CENTER" && end.magnet !== "NONE"
    ? { ...end, magnet: "CENTER" }
    : end;
}

function endpoint(
  end: ConnectorEnd,
  keys: Record<string, string>,
  side: "from" | "to",
  straight: boolean,
): ConnectorEndpoint {
  const spec = typeof end === "string" ? { key: end } : end;
  if ("x" in spec) return { position: { x: spec.x, y: spec.y } };

  let id: string | undefined;
  if ("id" in spec) {
    id = spec.id;
  } else {
    id = keys[spec.key] ?? idOfKey(spec.key);
    if (!id) {
      throw new Error(
        `connector ${side}: no node with key "${spec.key}" in this tree or on the page`,
      );
    }
  }
  const magnet = spec.magnet ?? (straight ? "center" : "auto");
  if (straight && magnet !== "center" && magnet !== "none") {
    throw new Error(
      `connector ${side}: a straight line can only attach at the centre, not "${magnet}". ` +
        `Use line "elbow" or "curved" to pick a side.`,
    );
  }
  return { endpointNodeId: id, magnet: MAGNETS[magnet] };
}

function idOfKey(key: string): string | undefined {
  return figma.currentPage
    .findAllWithCriteria({ pluginData: { keys: [KEY_FIELD] } })
    .find((node) => node.getPluginData(KEY_FIELD) === key)?.id;
}

type Cells = NonNullable<NodeProps["rows"]>;

function columnCount(rows: Cells): number {
  return Math.max(1, ...rows.map((row) => row.length));
}

/** Grows or trims the grid to fit, then writes every cell, so `rows` always means the whole table. */
async function applyTable(table: TableNode, props: NodeProps): Promise<void> {
  if (props.rows) {
    const wantedColumns = columnCount(props.rows);
    while (table.numRows < props.rows.length) table.insertRow(table.numRows);
    while (table.numRows > props.rows.length) table.removeRow(table.numRows - 1);
    while (table.numColumns < wantedColumns) table.insertColumn(table.numColumns);
    while (table.numColumns > wantedColumns) table.removeColumn(table.numColumns - 1);
  }

  const styling =
    props.font ||
    props.size !== undefined ||
    props.color !== undefined ||
    props.rows?.some((row) => row.some((cell) => typeof cell === "object"));
  if (props.rows || styling) {
    for (let row = 0; row < table.numRows; row += 1) {
      for (let column = 0; column < table.numColumns; column += 1) {
        const cell = table.cellAt(row, column);
        const entry = props.rows?.[row]?.[column];
        const own = typeof entry === "object" ? entry : undefined;
        if (own?.fill !== undefined) cell.fills = toPaints(own.fill);
        const color = own?.color ?? props.color;
        await writeText(cell.text, {
          ...(props.rows ? { text: typeof entry === "object" ? entry.text : (entry ?? "") } : {}),
          ...(props.font ? { font: props.font } : {}),
          ...(props.size === undefined ? {} : { size: props.size }),
          ...(color === undefined ? {} : { color }),
        });
      }
    }
  }

  props.colWidths?.forEach((width, column) => {
    if (column < table.numColumns) table.resizeColumn(column, width);
  });
  props.rowHeights?.forEach((height, row) => {
    if (row < table.numRows) table.resizeRow(row, height);
  });
}

/** A link card resizes after it loads, so a layout needs to wait for its final height. */
export async function settled(node: SceneNode): Promise<void> {
  let last = -1;
  for (let attempt = 0; attempt < 20 && node.height !== last; attempt += 1) {
    last = node.height;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The sides a section was given, which its content must not change. */
export function fixedSize(spec: { w?: unknown; h?: unknown }): { w?: number; h?: number } {
  return {
    ...(typeof spec.w === "number" ? { w: spec.w } : {}),
    ...(typeof spec.h === "number" ? { h: spec.h } : {}),
  };
}

const DEFAULT_SECTION_PAD = 24;

/** Places a section's children (those without `at`; connectors route themselves), then fits it to them. */
export function settleSection(
  section: SectionNode,
  layout: Layout | undefined,
  pinned: ReadonlySet<SceneNode>,
  fixed: { w?: number; h?: number },
): void {
  const pad = padding(layout);

  if (layout) {
    const flow = section.children.filter(
      (child) => child.type !== "CONNECTOR" && !pinned.has(child),
    );
    place(flow, layout, pad, fixed);
  }

  const placed = section.children.filter((child) => child.type !== "CONNECTOR");
  if (!placed.length && fixed.w === undefined && fixed.h === undefined) return;

  const right = Math.max(0, ...placed.map((child) => child.x + child.width));
  const bottom = Math.max(0, ...placed.map((child) => child.y + child.height));
  section.resizeWithoutConstraints(
    Math.max(1, fixed.w ?? right + pad.right),
    Math.max(1, fixed.h ?? bottom + pad.bottom),
  );
}

type Pad = { top: number; right: number; bottom: number; left: number };

function padding(layout: Layout | undefined): Pad {
  const { top, right, bottom, left } = toPadding(layout?.pad ?? DEFAULT_SECTION_PAD);
  return { top: literal(top), right: literal(right), bottom: literal(bottom), left: literal(left) };
}

function place(
  items: readonly SceneNode[],
  layout: Layout,
  pad: Pad,
  fixed: { w?: number; h?: number },
): void {
  const horizontal = layout.dir === "horizontal";
  const gap = layout.gap === undefined ? 0 : literal(layout.gap);
  const extent = horizontal ? fixed.w : fixed.h;

  if (layout.wrap && extent === undefined) {
    throw new Error(
      `wrap needs a fixed ${horizontal ? "w" : "h"} on the section to know where to break`,
    );
  }

  const mainOf = (node: SceneNode) => (horizontal ? node.width : node.height);
  const crossOf = (node: SceneNode) => (horizontal ? node.height : node.width);
  const start = horizontal ? pad.left : pad.top;
  const limit =
    layout.wrap && extent !== undefined ? extent - (horizontal ? pad.right : pad.bottom) : Infinity;

  const lines: { items: SceneNode[]; main: number; cross: number }[] = [];
  let line = { items: [] as SceneNode[], main: 0, cross: 0 };
  for (const item of items) {
    const size = mainOf(item);
    const next = line.items.length ? line.main + gap + size : size;
    if (line.items.length && start + next > limit) {
      lines.push(line);
      line = { items: [], main: 0, cross: 0 };
      line.main = size;
    } else {
      line.main = next;
    }
    line.items.push(item);
    line.cross = Math.max(line.cross, crossOf(item));
  }
  if (line.items.length) lines.push(line);

  let cross = horizontal ? pad.top : pad.left;
  for (const row of lines) {
    let main = start;
    for (const item of row.items) {
      const slack = row.cross - crossOf(item);
      const offset = layout.align === "center" ? slack / 2 : layout.align === "end" ? slack : 0;
      if (horizontal) {
        item.x = main;
        item.y = cross + offset;
      } else {
        item.y = main;
        item.x = cross + offset;
      }
      main += mainOf(item) + gap;
    }
    cross += row.cross + gap;
  }
}
