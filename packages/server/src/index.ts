#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_PORT, PORT_RANGE_END } from "@mirra/schema";
import { registerWithClients } from "./clients.js";
import { registerPluginWithFigma } from "./figma-settings.js";
import { installPlugin, installServer, isInstalled, PLUGIN_HOME, reveal } from "./install.js";
import { createMcpServer, describeError } from "./mcp.js";
import { PluginBridge } from "./transport.js";

const USAGE = `mirra <command>

  serve    Run the MCP server over stdio (default; this is what Claude Code spawns)
  init     Install the Figma plugin into ~/.mirra/plugin and print the next steps
  doctor   Bind the plugin port and wait for the Figma plugin to connect

Flags:
  --no-reveal   init: do not open the folder on a manual import
  --no-config   init: do not touch any client's configuration

Environment:
  MIRRA_PORT   Bind this exact port instead of scanning ${DEFAULT_PORT}-${PORT_RANGE_END}
`;

const preferredPort = process.env["MIRRA_PORT"] ? Number(process.env["MIRRA_PORT"]) : undefined;

switch (process.argv[2] ?? "serve") {
  case "serve":
    await serve();
    break;
  case "init":
    await init();
    break;
  case "doctor":
    await doctor();
    break;
  case "--help":
  case "-h":
  case "help":
    process.stdout.write(USAGE);
    break;
  default:
    process.stderr.write(USAGE);
    process.exit(1);
}

async function serve(): Promise<void> {
  const bridge = new PluginBridge();
  try {
    const port = await bridge.listen(preferredPort);
    console.error(`[mirra] listening on ws://127.0.0.1:${port}`);
  } catch (error) {
    console.error(`[mirra] ${describeError(error)}`);
    process.exit(1);
  }

  const server = createMcpServer(bridge);
  await server.connect(new StdioServerTransport());

  const shutdown = () => {
    void bridge.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function init(): Promise<void> {
  const { manifest } = await installPlugin();
  const lines = [`Plugin installed at ${PLUGIN_HOME}`, ""];

  if (process.argv.includes("--no-config")) {
    lines.push("Left every client configuration alone.", "");
  } else {
    const reports = await registerWithClients(await installServer());
    lines.push("Clients:");
    for (const report of reports) {
      lines.push(`  ${report.status.padEnd(8)} ${report.client.padEnd(15)} ${report.detail}`);
    }
    lines.push("", "A client that was already running has to be restarted to see the tools.", "");
  }

  const figma = await registerPluginWithFigma(PLUGIN_HOME);
  const manual = figma.status === "skipped";
  if (manual) {
    lines.push(
      `Could not register the plugin with Figma Desktop: ${figma.reason}`,
      "Then, in Figma Desktop:",
      "  1. Plugins -> Development -> Import plugin from manifest...",
      `     and choose ${manifest}`,
      "  2. Open a file, run Mirra, and leave the panel open",
      "  3. Ask the agent for mirra_ping; the panel badge should turn green",
    );
  } else {
    lines.push(
      figma.status === "registered"
        ? "Registered the plugin with Figma Desktop."
        : "Figma Desktop already knows the plugin.",
      "Then, in Figma Desktop:",
      "  1. Open a file, run Plugins -> Development -> Mirra, and leave the panel open",
      "  2. Ask the agent for mirra_ping; the panel badge should turn green",
    );
  }

  if (manual && !process.argv.includes("--no-reveal")) reveal(manifest);
  console.log(lines.join("\n"));
}

async function doctor(): Promise<void> {
  const bridge = new PluginBridge();
  try {
    const port = await bridge.listen(preferredPort);
    console.log(`port      ok    ws://127.0.0.1:${port}`);
  } catch (error) {
    console.log(`port      FAIL  ${describeError(error)}`);
    process.exit(1);
  }

  console.log(
    (await isInstalled())
      ? `plugin    ok    installed at ${PLUGIN_HOME}`
      : "plugin    warn  not installed; run `mirra init`",
  );

  const connected = await waitFor(() => bridge.status.connected, 5_000);
  if (!connected) {
    console.log(
      "socket    FAIL  no connection after 5s\n" +
        "                Open the file in Figma Desktop, then Plugins -> Development -> Mirra.",
    );
    await bridge.close();
    process.exit(1);
  }

  const hello = bridge.status.hello;
  console.log(`socket    ok    plugin v${hello?.pluginVersion} on "${hello?.fileName}"`);
  await bridge.close();
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
}
