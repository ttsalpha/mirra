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
