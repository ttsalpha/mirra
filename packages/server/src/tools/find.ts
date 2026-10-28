import { ADDS, READS } from "./annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FindParams, FindResult, PagesParams, PagesResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { describeError, text } from "./text.js";

const FIND = `Locate layers by name, kind or mirra key, so an existing design can be targeted
without clicking in Figma first. Searches the current page unless scope is "document".
Kinds include the FigJam ones: section, sticky, shape, connector, table, code, link, gif,
and the read-only stamp, highlight, washi and widget.`;

const PAGES = `List the pages of the file, add one, or switch to one by name or id. Every other
tool works on the current page, so start here when the layer you want is elsewhere.
A FigJam file has a single page.`;

export function registerFind(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_find",
    {
      annotations: READS,
      title: "Find Figma layers",
      description: FIND,
      inputSchema: FindParams.shape,
    },
    async (params) => {
      try {
        const result = FindResult.parse(await bridge.request("find", params));
        if (!result.nodes.length) return text(["no matches"]);
        return text([
          ...result.nodes.map(
            (node) =>
              `${node.id}  ${node.kind.toLowerCase().padEnd(12)} ${node.name}` +
              `${node.key ? `  [key: ${node.key}]` : ""}  (${node.page})`,
          ),
          ...(result.truncated ? ["", "more matches exist: raise limit or narrow the query"] : []),
        ]);
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );

  server.registerTool(
    "mirra_pages",
    {
      // Not read-only: it can add a page and change which one is current.
      annotations: ADDS,
      title: "List, add or switch Figma pages",
      description: PAGES,
      inputSchema: PagesParams.shape,
    },
    async (params) => {
      try {
        const result = PagesResult.parse(await bridge.request("pages", params));
        return text(
          result.pages.map((page) => `${page.current ? "*" : " "} ${page.id}  ${page.name}`),
        );
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );
}
