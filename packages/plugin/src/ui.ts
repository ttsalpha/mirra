import { DEFAULT_PORT, PORT_RANGE_END, PROTOCOL_VERSION } from "@mirra/schema/constants";
import type { RequestEnvelope } from "@mirra/schema";
import type { MainToUi, UiToMain } from "./bridge-messages";

const PORTS = Array.from({ length: PORT_RANGE_END - DEFAULT_PORT + 1 }, (_, i) => DEFAULT_PORT + i);
const CONNECT_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 1500;
const MAX_LOGS = 10;

type Status = "offline" | "connecting" | "online";

let context: Extract<MainToUi, { kind: "context" }> | null = null;
let socket: WebSocket | null = null;
let status: Status = "offline";
let connectedPort: number | null = null;
const logs: string[] = [];

const dot = element("dot");
const stateLabel = element("state");
const portLabel = element("port");
const logList = element("log");

const allowExec = element("allow-exec") as HTMLInputElement;
allowExec.addEventListener("change", () => {
  toMain({ kind: "allow-exec", value: allowExec.checked });
  log(`code execution ${allowExec.checked ? "allowed" : "blocked"}`);
});

element("reconnect").addEventListener("click", () => {
  socket?.close();
  void connect();
});

window.onmessage = (event: MessageEvent) => {
  const message = event.data?.pluginMessage as MainToUi | undefined;
  if (!message) return;

  if (message.kind === "context") {
    const first = context === null;
    context = message;
    if (first) void connect();
    return;
  }

  // A reply the sandbox produced for a server request: pass it straight through.
  const { kind: _kind, ...envelope } = message;
  socket?.send(JSON.stringify(envelope));
};

// A blocked connection looks identical to a missing server, so surface the
// browser's own reason for refusing it.
document.addEventListener("securitypolicyviolation", (event) => {
  log(`blocked by CSP: ${event.blockedURI}`);
});

toMain({ kind: "ready" });

/** Tells a blocked local network apart from a blocked WebSocket upgrade. */
async function probe(port: number): Promise<void> {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    log(`probe ${port}: http ${response.status}`);
  } catch (error) {
    log(`probe ${port}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function connect(): Promise<void> {
  if (status === "connecting") return;
  setStatus("connecting", null);

  const winner = await race();
  if (winner) return attach(winner.socket, winner.port);

  // Figma's renderer opens sockets slowly, so a failed race is worth explaining.
  await probe(PORTS[0] as number);
  log("no server found, retrying");
  setStatus("offline", null);
  setTimeout(() => void connect(), RETRY_DELAY_MS);
}

/**
 * Opens every candidate port at once and keeps the first socket to answer.
 * Trying them one at a time makes a slow open look like a missing server.
 */
function race(): Promise<{ socket: WebSocket; port: number } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const sockets: WebSocket[] = [];

    const closeAll = (keep: WebSocket | null) => {
      for (const socket of sockets) if (socket !== keep) socket.close();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      closeAll(null);
      resolve(null);
    }, CONNECT_TIMEOUT_MS);

    for (const port of PORTS) {
      let candidate: WebSocket;
      try {
        candidate = new WebSocket(`ws://localhost:${port}`);
      } catch (error) {
        log(`cannot open ${port}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      sockets.push(candidate);
      candidate.onopen = () => {
        if (settled) return candidate.close();
        settled = true;
        clearTimeout(timer);
        closeAll(candidate);
        resolve({ socket: candidate, port });
      };
      candidate.onerror = () => {};
    }

    if (!sockets.length) {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function attach(candidate: WebSocket, port: number): void {
  socket = candidate;
  setStatus("online", port);
  log(`connected on ${port}`);

  candidate.onmessage = (event) => {
    let envelope: RequestEnvelope;
    try {
      envelope = JSON.parse(String(event.data));
    } catch {
      return log("dropped malformed message");
    }
    toMain({ kind: "request", id: envelope.id, op: envelope.op, params: envelope.params });
  };

  candidate.onclose = () => {
    if (socket !== candidate) return;
    socket = null;
    log("disconnected");
    setStatus("offline", null);
    setTimeout(() => void connect(), RETRY_DELAY_MS);
  };

  candidate.onerror = () => log("socket error");

  candidate.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      pluginVersion: context?.pluginVersion ?? "unknown",
      fileKey: context?.fileKey ?? null,
      fileName: context?.fileName ?? "unknown",
    }),
  );
}

function setStatus(next: Status, port: number | null): void {
  status = next;
  connectedPort = port;
  dot.className = `dot ${next}`;
  stateLabel.textContent = {
    offline: "Disconnected",
    connecting: "Connecting…",
    online: "Connected",
  }[next];
  portLabel.textContent = connectedPort ? `localhost:${connectedPort}` : "—";
}

function log(message: string): void {
  logs.unshift(`${new Date().toLocaleTimeString()}  ${message}`);
  logs.length = Math.min(logs.length, MAX_LOGS);
  logList.textContent = logs.join("\n");
}

function toMain(message: UiToMain): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in the panel markup`);
  return node;
}
