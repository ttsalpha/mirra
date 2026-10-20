import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDefine } from "./tools/define.js";
import { registerExec } from "./tools/exec.js";
import { registerExport } from "./tools/export.js";
import { registerFind } from "./tools/find.js";
import { registerPatch } from "./tools/patch.js";
import { registerPing } from "./tools/ping.js";
import { registerRead } from "./tools/read.js";
import { registerRender } from "./tools/render.js";
import { registerScreenshot } from "./tools/screenshot.js";
import { registerTokens } from "./tools/tokens.js";
import type { PluginBridge } from "./transport.js";

export const SERVER_VERSION = "1.0.0";

export function createMcpServer(bridge: PluginBridge): McpServer {
  const server = new McpServer({ name: "mirra", version: SERVER_VERSION });
  registerPing(server, bridge);
  registerRender(server, bridge);
  registerRead(server, bridge);
  registerPatch(server, bridge);
  registerScreenshot(server, bridge);
  registerTokens(server, bridge);
  registerExport(server, bridge);
  registerFind(server, bridge);
  registerDefine(server, bridge);

  // Arbitrary code against the open document, so it stays opt-in.
  if (process.env["MIRRA_ALLOW_EXEC"]) registerExec(server, bridge);
  return server;
}

export { describeError } from "./tools/text.js";
