import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TokensResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { describeError, text } from "./text.js";

const DESCRIPTION = `List the variables and styles of the open file, with the "$name" each one
answers to. Pass those names as fill, color or style in a tree and the rendered node stays
bound to the design system instead of to a hardcoded value.`;

export function registerTokens(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_tokens",
    { title: "List design tokens", description: DESCRIPTION },
    async () => {
      try {
        const result = TokensResult.parse(await bridge.request("tokens"));
        return text([JSON.stringify(result, null, 2)]);
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );
}
