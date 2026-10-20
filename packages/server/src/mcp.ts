import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_VERSION } from "./version.js";
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

export function createMcpServer(bridge: PluginBridge): McpServer {
  const server = new McpServer({ name: "Mirra", version: SERVER_VERSION });
  registerPing(server, bridge);
  registerRender(server, bridge);
  registerRead(server, bridge);
  registerPatch(server, bridge);
  registerScreenshot(server, bridge);
  registerTokens(server, bridge);
  registerExport(server, bridge);
  registerFind(server, bridge);
  registerDefine(server, bridge);

  // Arbitrary code against the open document, so it stays opt-in. A client that
  // renders a checkbox into the environment sends "false", which is not "unset".
  if (isOn(process.env["MIRRA_ALLOW_EXEC"])) registerExec(server, bridge);
  return server;
}

export { describeError } from "./tools/text.js";

function isOn(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "false" && value !== "0";
}
