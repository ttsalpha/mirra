import { READS } from "./annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ReadParams, ReadResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { describeError, text } from "./text.js";

const DESCRIPTION = `Read layers out of the open Figma file as the same tree mirra_render takes,
so a design can be edited or turned into code without learning a second format.
Reads the current selection unless a nodeId is given, and at most 200 nodes unless limit
says otherwise, so a large design cannot fill the context in one call.
Components, component sets, groups and sections read back as frames, and vectors as the
svg markup that redraws them, so a file someone else designed still comes back whole.
In FigJam a section reads back as a section, with every child's position in "at", and
stickies, shapes, connectors, tables, code blocks and links read as their own types. A GIF
reads back only when mirra placed it, as the file it came from. Stamps, highlights, washi
tape and widgets are left out and counted; mirra_find can still locate them.`;

export function registerRead(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_read",
    {
      annotations: READS,
      title: "Read Figma layers as a UI tree",
      description: DESCRIPTION,
      inputSchema: ReadParams.shape,
    },
    async (params) => {
      try {
        const result = ReadResult.parse(await bridge.request("read", params));
        const note = result.skipped
          ? [
              `${result.skipped} node(s) left out: unsupported type, or past the depth or node limit`,
            ]
          : [];
        return text([...note, JSON.stringify(result.nodes, null, 2)]);
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );
}
