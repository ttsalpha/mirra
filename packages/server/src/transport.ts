import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  DEFAULT_PORT,
  PORT_RANGE_END,
  PROTOCOL_VERSION,
  PluginMessage,
  type HelloMessage,
  type OpName,
  type RequestEnvelope,
} from "@mirra/schema";
import { MirraError } from "./errors.js";

// The plugin connects to "localhost", which Chromium resolves to ::1 first and
// 127.0.0.1 second, so both loopback addresses get a listener.
const HOSTS = ["127.0.0.1", "::1"] as const;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Figma does the work, so the op decides the wait. */
const TIMEOUT_MS: Partial<Record<OpName, number>> = {
  ping: 5_000,
  pages: 10_000,
  render: 120_000,
  patch: 120_000,
  export: 120_000,
  define: 60_000,
  exec: 120_000,
};

/**
 * WebSockets ignore CORS, so without this any open page could connect, kick the
 * real plugin off and feed the agent invented results. The plugin iframe sends
 * "null" or nothing; a real page always sends its own origin.
 */
export function originAllowed(origin: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  if (process.env["MIRRA_ALLOW_ORIGIN"] === origin) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === "figma.com" || hostname.endsWith(".figma.com");
  } catch {
    return false;
  }
}

const UPDATE_HINT =
  "Run `npx @ttsalpha/mirra init` to install both halves from the same version, then run the plugin again in Figma.";

const OPEN_PLUGIN_HINT =
  "Open the file in Figma Desktop, then Plugins -> Development -> Mirra, and keep the panel open.";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type BridgeStatus = {
  port: number | null;
  connected: boolean;
  hello: HelloMessage | null;
};

/**
 * Hosts the WebSocket the plugin connects to and turns message pairs into
 * promises. One plugin at a time: a newer connection replaces the old one,
 * which is what a plugin reload looks like from here.
 */
export class PluginBridge {
  #servers: WebSocketServer[] = [];
  #socket: WebSocket | null = null;
  #hello: HelloMessage | null = null;
  #protocolMismatch: string | null = null;
  #port: number | null = null;
  readonly #pending = new Map<string, Pending>();

  get status(): BridgeStatus {
    return { port: this.#port, connected: this.#socket !== null, hello: this.#hello };
  }

  /** Set while a connected plugin speaks a protocol this server does not. */
  get protocolMismatch(): string | null {
    return this.#protocolMismatch;
  }

  async listen(preferredPort?: number): Promise<number> {
    const first = preferredPort ?? DEFAULT_PORT;
    const last = preferredPort ?? PORT_RANGE_END;
    let lastError: unknown;

    for (let port = first; port <= last; port++) {
      try {
        const primary = await openServer(HOSTS[0], port);
        this.#servers = [primary];
        this.#port = actualPort(primary, port);

        // A machine without IPv6 loopback simply gets the one listener.
        try {
          this.#servers.push(await openServer(HOSTS[1], this.#port));
        } catch {
          log("no IPv6 loopback; listening on 127.0.0.1 only");
        }

        for (const server of this.#servers) {
          server.on("connection", (socket) => this.#attach(socket));
        }
        return this.#port;
      } catch (error) {
        lastError = error;
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      }
    }

    throw new MirraError(
      `No free port in ${first}-${last} (last error: ${String(lastError)})`,
      "no_free_port",
      "Another Mirra session is probably running. Close the other Claude Code window, or set MIRRA_PORT to a free port.",
    );
  }

  async close(): Promise<void> {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new MirraError("Server shutting down", "shutdown"));
      this.#pending.delete(id);
    }
    this.#socket?.close(1001, "server shutting down");
    await Promise.all(
      this.#servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    this.#servers = [];
    this.#port = null;
  }

  async request(op: OpName, params?: unknown, timeoutMs = TIMEOUT_MS[op] ?? DEFAULT_TIMEOUT_MS) {
    const socket = this.#socket;
    if (!socket) {
      throw new MirraError("No Figma plugin is connected", "plugin_offline", OPEN_PLUGIN_HINT);
    }
    // ping is how the drift gets diagnosed, so it is the one op still allowed.
    if (this.#protocolMismatch && op !== "ping") {
      throw new MirraError(this.#protocolMismatch, "protocol_mismatch", UPDATE_HINT);
    }

    const id = randomUUID();
    const envelope: RequestEnvelope = { id, op, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new MirraError(
            `Plugin did not answer "${op}" within ${timeoutMs}ms`,
            "timeout",
            "Check the Mirra panel in Figma: it may have disconnected or hit an error.",
          ),
        );
      }, timeoutMs);

      this.#pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify(envelope));
    });
  }

  #attach(socket: WebSocket): void {
    if (this.#socket) this.#socket.close(4000, "replaced by a newer plugin connection");
    this.#socket = socket;
    this.#hello = null;

    socket.on("message", (raw) => this.#onMessage(String(raw)));
    socket.on("close", () => {
      if (this.#socket === socket) {
        this.#socket = null;
        this.#hello = null;
      }
    });
    socket.on("error", (error) => log("plugin socket error:", error.message));
  }

  #onMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return log("dropped non-JSON message from plugin");
    }

    const message = PluginMessage.safeParse(parsed);
    if (!message.success) return log("dropped unknown message from plugin");

    const data = message.data;
    if ("type" in data) {
      if (data.type === "log") return log(`[plugin:${data.level}] ${data.message}`);
      this.#hello = data;
      this.#protocolMismatch =
        data.protocolVersion === PROTOCOL_VERSION
          ? null
          : `The plugin speaks protocol v${data.protocolVersion}, this server speaks v${PROTOCOL_VERSION}`;
      if (this.#protocolMismatch) log(this.#protocolMismatch);
      return log(`plugin connected: ${data.fileName} (plugin v${data.pluginVersion})`);
    }

    const pending = this.#pending.get(data.id);
    if (!pending) return;
    this.#pending.delete(data.id);
    clearTimeout(pending.timer);

    if (data.ok) pending.resolve(data.result);
    else pending.reject(new MirraError(data.error.message, data.error.code, data.error.hint));
  }
}

/** Port 0 asks the OS for a free port, so read back what it handed us. */
function actualPort(wss: WebSocketServer, requested: number): number {
  const address = wss.options.server?.address() ?? null;
  return typeof address === "object" && address ? address.port : requested;
}

function openServer(host: string, port: number): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    // An HTTP server of our own, so /health can tell a blocked network apart
    // from a blocked WebSocket upgrade, and so every attempt is logged.
    const http: Server = createServer((request, response) => {
      const origin = request.headers.origin;
      log(`http ${request.method} ${request.url} from ${request.socket.remoteAddress}`);
      response.writeHead(200, {
        "content-type": "text/plain",
        // Only the plugin may read the body; another page can at most see a 200.
        ...(originAllowed(origin) ? { "access-control-allow-origin": origin ?? "*" } : {}),
      });
      response.end("mirra");
    });
    const wss = new WebSocketServer({
      server: http,
      verifyClient: ({ origin }, done) => {
        if (originAllowed(origin)) return done(true);
        log(`refused a connection from origin ${origin}`);
        done(false, 403, "origin not allowed");
      },
    });

    // ws re-emits the http server's errors on itself. Without a listener here,
    // a port already in use would kill the process instead of falling through
    // to the next port.
    wss.on("error", (error) => log(`websocket server error: ${error.message}`));

    http.listen(port, host);
    const onError = (error: Error) => {
      http.close();
      reject(error);
    };
    http.once("error", onError);
    http.once("listening", () => {
      http.off("error", onError);
      resolve(wss);
    });
  });
}

/** stdout belongs to the MCP stdio transport, so diagnostics go to stderr. */
function log(...parts: unknown[]): void {
  console.error("[mirra]", ...parts);
}
