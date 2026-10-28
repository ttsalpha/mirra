import { ADDS } from "./annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RenderParams, RenderResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { inlineAssets } from "./assets.js";
import { describeError, text } from "./text.js";

const DESCRIPTION = `Build a whole screen in the open Figma file, or a board in FigJam, from one declarative tree.

The tree mirrors flexbox: a frame carries layout {dir, gap, pad, justify, align}, and a
child sizes itself with w/h set to a number, "fill" or "hug". Node types are frame, text,
rect, ellipse, instance, svg and image. Colours are hex strings; fill also takes
{type:"gradient", stops}. A "$name" binds a variable: a colour on fill, stroke or text
colour, a number on gap, pad, radius, stroke width, size, lineHeight or letterSpacing.
Any node takes rotation in degrees, counter-clockwise.
Give each node you may want to change later a stable "key" and address it from there.

FigJam (mirra_ping reports the editor) has no frames, auto layout, variables or components.
Build a board from one section, the way a design starts from one frame. Node types:
  section    children; w, h, fill, stroke, radius; layout {dir, gap, pad, align, wrap}
  sticky     text, fill, wide, author
  shape      shape ("diamond", "database", "rounded-rect"...), text, fill, stroke, w, h
  connector  from, to, line, startCap, endCap, text
  table      rows, colWidths, rowHeights, fill
  code       code, language
  link       url
  gif        src (a file path or data URI), w, h
Position a node with at {x, y} inside its section. A section's layout places the children
that have no "at"; wrap needs a fixed w or h. A connector end is a key, {key, magnet}, {id}
or {x, y}; the connector routes itself, may be listed before the nodes it joins, and a
straight one attaches at the centre. A table row is an array of cells, each a string or
{text, fill, color}. Text on a sticky, shape or table takes font, size, letterSpacing and color.`;

export function registerRender(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_render",
    {
      annotations: ADDS,
      title: "Render a UI tree into Figma or FigJam",
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
