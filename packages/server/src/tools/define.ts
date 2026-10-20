import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DefineParams, DefineResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { describeError, text } from "./text.js";

const DESCRIPTION = `Create or update the design system itself: variables in a collection, and
paint, text or effect styles. A value of "$other/name" becomes an alias to that variable, and a
value keyed by mode name sets one value per mode. Both halves are optional.`;

export function registerDefine(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_define_tokens",
    { title: "Define Figma variables", description: DESCRIPTION, inputSchema: DefineParams.shape },
    async (params) => {
      try {
        const result = DefineResult.parse(await bridge.request("define", params));
        return text([
          ...(result.collection
            ? [
                `collection ${result.collection} (modes: ${result.modes.join(", ")})`,
                `created: ${result.created.join(", ") || "none"}`,
                `updated: ${result.updated.join(", ") || "none"}`,
              ]
            : []),
          ...(result.styles.length ? [`styles: ${result.styles.join(", ")}`] : []),
          ...result.notes,
        ]);
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );
}
