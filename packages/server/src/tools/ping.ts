import { READS } from "./annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PingResult } from "@mirra/schema";
import { SERVER_VERSION } from "../version.js";
import type { PluginBridge } from "../transport.js";
import { describeError, text } from "./text.js";

export function registerPing(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_ping",
    {
      annotations: READS,
      title: "Ping the Figma plugin",
      description:
        "Check that the Mirra plugin is connected, and report the open file, current page and selection size.",
    },
    async () => {
      try {
        const result = PingResult.parse(await bridge.request("ping"));
        const drifted = result.pluginVersion !== SERVER_VERSION;

        return text([
          `file: ${result.fileName}${result.fileKey ? ` (${result.fileKey})` : ""}`,
          `page: ${result.currentPage}`,
          `selection: ${result.selectionCount} node(s)`,
          `port: ${bridge.status.port}`,
          `server ${SERVER_VERSION}, plugin ${result.pluginVersion}`,
          ...(drifted
            ? [
                "",
                "The two halves are different versions. Run `npx @ttsalpha/mirra init`, then run",
                "the plugin again in Figma so both come from the same release.",
              ]
            : []),
        ]);
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );
}
