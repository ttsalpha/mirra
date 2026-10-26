#!/usr/bin/env node
import { cancel, intro, isCancel, log, multiselect, note, outro, spinner } from "@clack/prompts";
import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEFAULT_PORT, PORT_RANGE_END } from "@mirra/schema";
import { detectClients, registerWithClients, type ClientReport } from "./clients.js";
import { registerPluginWithFigma } from "./figma-settings.js";
import { installPlugin, installServer, isInstalled, PLUGIN_HOME, reveal } from "./install.js";
import { createMcpServer, describeError } from "./mcp.js";
import { PluginBridge } from "./transport.js";

const USAGE = `mirra <command>

  serve    Run the MCP server over stdio (default; this is what Claude Code spawns)
  init     Install the Figma plugin into ~/.mirra/plugin and print the next steps
  doctor   Bind the plugin port and wait for the Figma plugin to connect

Flags:
  -y, --yes     init: accept detected clients without interactive prompt
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

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void bridge.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // A client that goes away without signalling still closes the pipe. Without
  // this the process lives on and holds its port for the rest of the session.
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
}

async function init(): Promise<void> {
  const noConfig = process.argv.includes("--no-config");
  const autoYes = process.argv.includes("-y") || process.argv.includes("--yes");
  const interactive =
    Boolean(process.stdin.isTTY && process.stdout.isTTY) && !autoYes && !process.env["CI"];
  const ui = createUi(interactive);

  ui.intro("Mirra Figma MCP setup");

  let selectedClients: string[] | undefined;

  if (!noConfig) {
    const clients = await detectClients();
    const detected = clients.filter((c) => c.detected).map((c) => c.name);

    if (interactive) {
      const answer = await multiselect({
        message: "Which clients should Mirra be added to?",
        options: clients.map((c) => ({
          value: c.name,
          label: c.name,
          hint: c.detected ? "detected" : "not detected",
        })),
        initialValues: detected,
        required: false,
      });

      if (isCancel(answer)) {
        cancel("Installation cancelled.");
        process.exit(130);
      }

      selectedClients = answer as string[];
    } else {
      selectedClients = detected;
    }
  }

  const { manifest } = await ui.task(
    "Installing the Figma plugin",
    `Plugin installed at ${PLUGIN_HOME}`,
    () => installPlugin(),
  );
  if (!interactive) console.log(`Plugin installed at ${PLUGIN_HOME}`);

  if (noConfig) {
    ui.info("Left every client configuration alone.");
  } else if (selectedClients?.length === 0) {
    ui.info("No clients selected; skipped client configuration.");
  } else {
    const reports = await ui.task(
      "Registering Mirra with your clients",
      "Clients configured",
      async () => registerWithClients(await installServer(), selectedClients),
    );
    for (const report of reports) ui.client(report);
    ui.info("A client that was already running has to be restarted to see the tools.");
  }

  const figma = await ui.task(
    "Registering the plugin with Figma Desktop",
    "Figma Desktop settings read",
    () => registerPluginWithFigma(PLUGIN_HOME),
  );
  const manual = figma.status === "skipped";

  if (figma.status === "registered") ui.success("Registered the plugin with Figma Desktop.");
  else if (figma.status === "already") ui.success("Figma Desktop already knows the plugin.");
  else ui.warn(`Could not register the plugin with Figma Desktop: ${figma.reason}`);

  ui.note(
    "Next, in Figma Desktop",
    manual
      ? [
          "1. Plugins -> Development -> Import plugin from manifest...",
          `   and choose ${manifest}`,
          "2. Open a file, run Mirra, and leave the panel open",
          "3. Ask the agent for mirra_ping; the panel badge should turn green",
        ]
      : [
          "1. Open a file, run Plugins -> Development -> Mirra, and leave the panel open",
          "2. Ask the agent for mirra_ping; the panel badge should turn green",
        ],
  );

  if (manual && !process.argv.includes("--no-reveal")) reveal(manifest);
  ui.outro("Done.");
}

const tildify = (text: string) => text.replace(homedir(), "~");

/** Styled with clack in a terminal; plain lines when piped or in CI. */
function createUi(interactive: boolean) {
  const plain = (message: string) => console.log(message);
  return {
    intro: (title: string) => (interactive ? intro(title) : undefined),
    outro: (message: string) => (interactive ? outro(message) : undefined),
    info: (message: string) => (interactive ? log.info(message) : plain(message)),
    success: (message: string) => (interactive ? log.success(message) : plain(message)),
    warn: (message: string) => (interactive ? log.warn(message) : plain(message)),
    note: (title: string, lines: string[]) =>
      interactive
        ? note(lines.join("\n"), title)
        : plain(`${title}:\n${lines.map((l) => `  ${l}`).join("\n")}`),
    client(report: ClientReport) {
      if (!interactive) {
        plain(`${report.status.padEnd(8)} ${report.client.padEnd(15)} ${report.detail}`);
      } else if (report.status === "written") {
        log.success(`${report.client}: ${tildify(report.detail)}`);
      } else if (report.status === "failed") {
        log.error(`${report.client}: ${tildify(report.detail)}`);
      } else {
        log.message(`${report.client}: ${tildify(report.detail)}`);
      }
    },
    async task<T>(label: string, done: string, work: () => Promise<T>): Promise<T> {
      if (!interactive) return work();
      const spin = spinner();
      spin.start(label);
      try {
        const result = await work();
        spin.stop(done);
        return result;
      } catch (error) {
        spin.error(`${label} failed`);
        throw error;
      }
    },
  };
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
