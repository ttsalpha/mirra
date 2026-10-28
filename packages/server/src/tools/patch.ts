import { CHANGES } from "./annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PatchParams, PatchResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { inlineAssets } from "./assets.js";
import { describeError, text } from "./text.js";

const DESCRIPTION = `Change layers that already exist, addressed by the "key" they were rendered with
(or by Figma node id). Ops are "set" to change properties, "append" to add a child tree,
"replace" to swap a node for a new tree, "move", "component" to turn a node into one, and
"remove". The whole patch is one undo step.
In FigJam, "set" also takes text, fill, shape, wide, from, to, line, startCap, endCap, rows,
code and language, and a layout on a section reflows its children. A prop a node cannot
take is refused by name rather than ignored.`;

export function registerPatch(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_patch",
    {
      annotations: CHANGES,
      title: "Patch existing Figma layers",
      description: DESCRIPTION,
      inputSchema: PatchParams.shape,
    },
    async (params) => {
      try {
        const result = PatchResult.parse(await bridge.request("patch", await inlineAssets(params)));
        const created = Object.entries(result.keys);
        return text([
          `applied ${result.applied} op(s)`,
          ...(created.length
            ? ["new keys:", ...created.map(([key, id]) => `  ${key} -> ${id}`)]
            : []),
        ]);
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );
}
