import type { ReadParams, ReadResult, UINode } from "@mirra/schema";
import { readNode } from "../figma/read";
import { buildNameIndex } from "../figma/tokens";

const DEFAULT_DEPTH = 6;
const DEFAULT_LIMIT = 200;

export async function read(params: ReadParams): Promise<ReadResult> {
  const targets = params.nodeId ? [await resolve(params.nodeId)] : [...figma.currentPage.selection];
  if (!targets.length) {
    throw new Error("Nothing is selected: select a layer in Figma, or pass a nodeId");
  }

  // Built once so bound variables and text styles read back as "$name".
  const names = await buildNameIndex();
  const nodes: { id: string; tree: UINode }[] = [];
  let skipped = 0;

  for (const target of targets) {
    const outcome = readNode(
      target,
      params.depth ?? DEFAULT_DEPTH,
      names,
      params.limit ?? DEFAULT_LIMIT,
    );
    skipped += outcome.skipped;
    if (outcome.tree) nodes.push({ id: target.id, tree: outcome.tree });
  }

  return { nodes, skipped };
}

async function resolve(nodeId: string): Promise<SceneNode> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`No node with id ${nodeId} in this file`);
  if (node.type === "DOCUMENT" || node.type === "PAGE") {
    throw new Error(`${node.type} is not a layer: pass a frame or a shape`);
  }
  return node as SceneNode;
}
