import { CHANGES } from "./annotations.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ExecParams, ExecResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { describeError, text } from "./text.js";

const DESCRIPTION = `Run Plugin API code in the open file and return what it evaluates to.
The body is an async function receiving \`figma\`; use it only for what the typed tools cannot do.`;

/** Registered only when MIRRA_ALLOW_EXEC is set; the panel still has to allow it. */
export function registerExec(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_exec",
    {
      annotations: CHANGES,
      title: "Run Plugin API code",
      description: DESCRIPTION,
      inputSchema: ExecParams.shape,
    },
    async (params) => {
      try {
        const result = ExecResult.parse(await bridge.request("exec", params));
        return text([result.result]);
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );
}
