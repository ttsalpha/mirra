import { ADDS } from "./annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RenderParams, RenderResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { inlineAssets } from "./assets.js";
import { describeError, text } from "./text.js";

const DESCRIPTION = `Build a whole screen in the open Figma file from one declarative tree.

The tree mirrors flexbox: a frame carries layout {dir, gap, pad, justify, align}, and a
child sizes itself with w/h set to a number, "fill" or "hug". Node types are frame, text,
rect and ellipse. Colours are hex strings; fill also takes {type:"gradient", stops}.
Give each node you may want to change later a stable "key" and address it from there.`;

export function registerRender(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_render",
    {
      annotations: ADDS,
      title: "Render a UI tree into Figma",
      description: DESCRIPTION,
      inputSchema: RenderParams.shape,
    },
    async (params) => {
      try {
        const result = RenderResult.parse(
          await bridge.request("render", await inlineAssets(params)),
        );
        const keys = Object.entries(result.keys);
        return text([
          `rendered ${result.nodeCount} node(s), root ${result.rootId}`,
          ...(keys.length ? ["keys:", ...keys.map(([key, id]) => `  ${key} -> ${id}`)] : []),
        ]);
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );
}
