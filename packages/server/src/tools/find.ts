import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FindParams, FindResult, PagesParams, PagesResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { describeError, text } from "./text.js";

const FIND = `Locate layers by name, kind or mirra key, so an existing design can be targeted
without clicking in Figma first. Searches the current page unless scope is "document".`;

const PAGES = `List the pages of the file, and switch to one by name or id. Every other tool works
on the current page, so start here when the layer you want is elsewhere.`;

export function registerFind(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_find",
    { title: "Find Figma layers", description: FIND, inputSchema: FindParams.shape },
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
    { title: "List or switch Figma pages", description: PAGES, inputSchema: PagesParams.shape },
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
