import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ReadParams, ReadResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { describeError, text } from "./text.js";

const DESCRIPTION = `Read layers out of the open Figma file as the same tree mirra_render takes,
so a design can be edited or turned into code without learning a second format.
Reads the current selection unless a nodeId is given.`;

export function registerRead(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_read",
    {
      title: "Read Figma layers as a UI tree",
      description: DESCRIPTION,
      inputSchema: ReadParams.shape,
    },
    async (params) => {
      try {
        const result = ReadResult.parse(await bridge.request("read", params));
        const note = result.skipped
          ? [`${result.skipped} node(s) left out: unsupported type, or past the depth limit`]
          : [];
        return text([...note, JSON.stringify(result.nodes, null, 2)]);
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );
}
