import type { Target } from "@mirra/schema";
import { KEY_FIELD } from "./build";

/**
 * Looks nodes up by the key `render` wrote, or by Figma's own id. The key index
 * is built once per patch and dropped whenever the patch adds or removes nodes.
 */
export class NodeIndex {
  #byKey: Map<string, SceneNode> | null = null;

  invalidate(): void {
    this.#byKey = null;
  }

  async resolve(target: Target): Promise<SceneNode> {
    if ("id" in target) {
      const node = await figma.getNodeByIdAsync(target.id);
      if (!node) throw new Error(`No node with id ${target.id} in this file`);
      if (node.type === "DOCUMENT" || node.type === "PAGE") {
        throw new Error(`${node.type} is not a layer: target a frame or a shape`);
      }
      return node as SceneNode;
    }

    const found = this.#index().get(target.key);
    if (!found) {
      throw new Error(
        `No node with key "${target.key}" on this page. Keys live on the nodes mirra rendered; ` +
          `mirra_read reports the ones that are there.`,
      );
    }
    return found;
  }

  #index(): Map<string, SceneNode> {
    if (this.#byKey) return this.#byKey;

    const byKey = new Map<string, SceneNode>();
    for (const node of figma.currentPage.findAllWithCriteria({
      pluginData: { keys: [KEY_FIELD] },
    })) {
      byKey.set(node.getPluginData(KEY_FIELD), node);
    }
    this.#byKey = byKey;
    return byKey;
  }
}
