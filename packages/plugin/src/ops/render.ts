import type { RenderParams, RenderResult, UINode } from "@mirra/schema";
import { buildNode, type Deferred } from "../figma/build";

export async function render(params: RenderParams): Promise<RenderResult> {
  const parent = params.parentId ? await resolveParent(params.parentId) : figma.currentPage;
  const keys: Record<string, string> = {};
  const deferred: Deferred = [];
  const root = await buildNode(params.tree, parent, keys, undefined, deferred);

  for (const place of deferred) place();

  const at = params.at ?? centreOfViewport(root);
  if ("x" in root && "y" in root && parent.type === "PAGE") {
    root.x = at.x;
    root.y = at.y;
  }

  if (params.reveal !== false) {
    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);
  }

  // Without this the whole render collapses into the user's previous undo step.
  figma.commitUndo();

  return { rootId: root.id, nodeCount: countNodes(params.tree), keys };
}

async function resolveParent(parentId: string): Promise<BaseNode & ChildrenMixin> {
  const node = await figma.getNodeByIdAsync(parentId);
  if (!node) throw new Error(`No node with id ${parentId} in this file`);
  if (!("appendChild" in node)) throw new Error(`${node.type} cannot contain children`);
  return node as BaseNode & ChildrenMixin;
}

function centreOfViewport(node: SceneNode): { x: number; y: number } {
  const { center } = figma.viewport;
  return { x: Math.round(center.x - node.width / 2), y: Math.round(center.y - node.height / 2) };
}

function countNodes(spec: UINode): number {
  if (spec.type !== "frame") return 1;
  return 1 + (spec.children ?? []).reduce((total, child) => total + countNodes(child), 0);
}
