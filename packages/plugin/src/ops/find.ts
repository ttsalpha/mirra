import type { FindParams, FindResult } from "@mirra/schema";
import { KEY_FIELD } from "../figma/build";

const DEFAULT_LIMIT = 50;

const KINDS: Record<string, string[]> = {
  frame: ["FRAME"],
  text: ["TEXT"],
  rect: ["RECTANGLE"],
  ellipse: ["ELLIPSE"],
  instance: ["INSTANCE"],
  component: ["COMPONENT", "COMPONENT_SET"],
  group: ["GROUP"],
  vector: ["VECTOR"],
  section: ["SECTION"],
  sticky: ["STICKY"],
  shape: ["SHAPE_WITH_TEXT"],
  connector: ["CONNECTOR"],
  table: ["TABLE"],
  code: ["CODE_BLOCK"],
  link: ["EMBED", "LINK_UNFURL"],
  gif: ["MEDIA"],
  // Nodes mirra can locate and read the position of, but not create.
  stamp: ["STAMP"],
  highlight: ["HIGHLIGHT"],
  washi: ["WASHI_TAPE"],
  widget: ["WIDGET"],
};

export async function find(params: FindParams): Promise<FindResult> {
  const pages =
    params.scope === "document"
      ? (await figma.loadAllPagesAsync(), figma.root.children)
      : [figma.currentPage];

  const limit = params.limit ?? DEFAULT_LIMIT;
  const needle = params.name?.toLowerCase();
  const kinds = params.kind && params.kind !== "any" ? KINDS[params.kind] : undefined;
  const matches: FindResult["nodes"] = [];
  let truncated = false;

  for (const page of pages) {
    for (const node of page.findAll(() => true)) {
      // FigJam table cells turn up in the walk but are not layers: no name, no plugin data.
      if ((node.type as string) === "TABLE_CELL") continue;
      if (kinds && !kinds.includes(node.type)) continue;
      if (needle && !node.name.toLowerCase().includes(needle)) continue;

      const key = node.getPluginData(KEY_FIELD);
      if (params.key && key !== params.key) continue;

      if (matches.length >= limit) {
        truncated = true;
        break;
      }
      matches.push({
        id: node.id,
        name: node.name,
        kind: node.type,
        page: page.name,
        ...(key ? { key } : {}),
      });
    }
  }

  if (params.select && matches.length) {
    const selected = matches
      .map((match) => figma.currentPage.findOne((node) => node.id === match.id))
      .filter((node): node is SceneNode => node !== null);
    if (selected.length) {
      figma.currentPage.selection = selected;
      figma.viewport.scrollAndZoomIntoView(selected);
    }
  }

  return { nodes: matches, truncated };
}
