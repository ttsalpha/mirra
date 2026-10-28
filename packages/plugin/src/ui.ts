import { DEFAULT_PORT, PORT_RANGE_END, PROTOCOL_VERSION } from "@mirra/schema/constants";
import type { RequestEnvelope } from "@mirra/schema";
import type { MainToUi, UiToMain } from "./bridge-messages";

const PORTS = Array.from({ length: PORT_RANGE_END - DEFAULT_PORT + 1 }, (_, i) => DEFAULT_PORT + i);
const CONNECT_TIMEOUT_MS = 5000;
const RESCAN_MS = 5000;
const MAX_LOGS = 10;

type Status = "offline" | "connecting" | "online";

let context: Extract<MainToUi, { kind: "context" }> | null = null;
let inflight: Promise<void> | null = null;
let connectingLabel = "Connecting…";
let status: Status | null = null;
const logs: string[] = [];

/** Every server that answered, so two clients can drive one Figma file. */
const sockets = new Map<number, WebSocket>();

/** Which socket asked for what, so the reply goes back to that client alone. */
const askedBy = new Map<string, WebSocket>();

const dot = element("dot");
const stateLabel = element("state");
const logList = element("log");
const hint = element("hint");

const allowExec = element("allow-exec") as HTMLInputElement;
allowExec.addEventListener("change", () => {
  toMain({ kind: "allow-exec", value: allowExec.checked });
  log(`code execution ${allowExec.checked ? "allowed" : "blocked"}`);
});

const reconnect = element("reconnect") as HTMLButtonElement;
reconnect.addEventListener("click", async () => {
  // Disabled until the scan settles, so a second click cannot tear down the first attempt.
  reconnect.disabled = true;
  connectingLabel = "Reconnecting…";
  for (const socket of sockets.values()) socket.close();
  sockets.clear();
  setStatus("connecting");
  log("reconnecting");
  try {
    await inflight;
    await scan();
  } finally {
    connectingLabel = "Connecting…";
    reconnect.disabled = false;
  }
});

window.onmessage = (event: MessageEvent) => {
  const message = event.data?.pluginMessage as MainToUi | undefined;
  if (!message) return;

  if (message.kind === "context") {
    const first = context === null;
    context = message;
    if (first) {
      void scan();
      setInterval(() => void scan(), RESCAN_MS);
    }
    return;
  }

  // A reply the sandbox produced: pass it straight back to whoever asked.
  const { kind: _kind, ...envelope } = message;
  const socket = askedBy.get(envelope.id);
  askedBy.delete(envelope.id);
  socket?.send(JSON.stringify(envelope));
};

// A blocked connection looks identical to a missing server, so surface the
// browser's own reason for refusing it.
document.addEventListener("securitypolicyviolation", (event) => {
  log(`blocked by CSP: ${event.blockedURI}`);
});

toMain({ kind: "ready" });

/**
 * Opens every port that is not connected yet. Holding all of them at once is
 * what lets several clients work at the same time, and it means a client that
 * starts later is picked up on the next pass rather than ignored.
 */
function scan(): Promise<void> {
  inflight ??= runScan().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runScan(): Promise<void> {
  // A rescan from the background leaves "Disconnected" and its hint standing, rather than flashing.
  if (!sockets.size && status !== "offline") setStatus("connecting");
  await Promise.all(PORTS.filter((port) => !sockets.has(port)).map(open));

  if (sockets.size) return setStatus("online");
  await probe(PORTS[0] as number);
  setStatus("offline");
}

function open(port: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let candidate: WebSocket;
    try {
      candidate = new WebSocket(`ws://localhost:${port}`);
    } catch (error) {
      log(`cannot open ${port}: ${error instanceof Error ? error.message : String(error)}`);
      return resolve();
    }

    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      candidate.close();
      done();
    }, CONNECT_TIMEOUT_MS);

    candidate.onopen = () => {
      attach(candidate, port);
      done();
    };
    candidate.onerror = () => done();
  });
}

function attach(socket: WebSocket, port: number): void {
  sockets.set(port, socket);
  setStatus("online");
  log(`connected on ${port}`);

  socket.onmessage = (event) => {
    let envelope: RequestEnvelope;
    try {
      envelope = JSON.parse(String(event.data));
    } catch {
      return log("dropped malformed message");
    }
    askedBy.set(envelope.id, socket);
    toMain({ kind: "request", id: envelope.id, op: envelope.op, params: envelope.params });
  };

  socket.onclose = () => {
    if (sockets.get(port) !== socket) return;
    sockets.delete(port);
    log(`lost ${port}`);
    setStatus(sockets.size ? "online" : "offline");
  };

  socket.onerror = () => log(`socket error on ${port}`);

  socket.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      pluginVersion: context?.pluginVersion ?? "unknown",
      fileKey: context?.fileKey ?? null,
      fileName: context?.fileName ?? "unknown",
      editorType: context?.editorType ?? "figma",
    }),
  );
}

/** Tells a blocked local network apart from a blocked WebSocket upgrade. */
async function probe(port: number): Promise<void> {
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    log(`probe ${port}: http ${response.status}`);
  } catch (error) {
    log(`probe ${port}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function setStatus(next: Status): void {
  status = next;
  dot.className = `dot ${next}`;

  const ports = [...sockets.keys()].sort((a, b) => a - b);
  stateLabel.textContent =
    next === "online"
      ? `Connected${ports.length > 1 ? ` · ${ports.length}` : ""}`
      : next === "connecting"
        ? connectingLabel
        : "Disconnected";
  stateLabel.title = ports.map((port) => `:${port}`).join(" ");
  hint.hidden = next !== "offline";
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
