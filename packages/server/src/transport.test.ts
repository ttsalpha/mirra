import { createServer } from "node:net";
import { WebSocket } from "ws";
import { afterEach, expect, test } from "vitest";
import { DEFAULT_PORT, PORT_RANGE_END, type RequestEnvelope } from "@mirra/schema";
import { MirraError } from "./errors.js";
import { PluginBridge } from "./transport.js";

let bridge: PluginBridge | null = null;
let blocker: ReturnType<typeof createServer> | null = null;

/** Holds the first free port in the range, so the bridge has to step past it. */
async function occupy(from: number): Promise<number> {
  for (let port = from; port <= PORT_RANGE_END; port++) {
    const server = createServer();
    const bound = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (bound) {
      blocker = server;
      return port;
    }
  }
  throw new Error("the whole mirra port range is busy");
}

afterEach(async () => {
  await bridge?.close();
  bridge = null;
});

/** Stands in for the plugin's iframe: answers every request with a canned result. */
/** The greeting is what carries the protocol version, and it arrives on its own. */
async function untilGreeted(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (bridge?.status.hello) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the plugin never greeted the bridge");
}

async function fakePlugin(
  port: number,
  reply: (envelope: RequestEnvelope) => unknown,
  protocolVersion = 1,
): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve) => socket.once("open", resolve));
  socket.on("message", (raw) => {
    const envelope = JSON.parse(String(raw)) as RequestEnvelope;
    socket.send(JSON.stringify({ id: envelope.id, ok: true, result: reply(envelope) }));
  });
  socket.send(
    JSON.stringify({
      type: "hello",
      protocolVersion,
      pluginVersion: "0.1.0",
      fileKey: null,
      fileName: "Test file",
    }),
  );
  return socket;
}

test("reports a usable hint instead of hanging when no plugin is connected", async () => {
  bridge = new PluginBridge();
  await bridge.listen(0);

  await expect(bridge.request("ping")).rejects.toMatchObject({ code: "plugin_offline" });
  await expect(bridge.request("ping")).rejects.toBeInstanceOf(MirraError);
});

test("round-trips a request to the connected plugin", async () => {
  bridge = new PluginBridge();
  const port = await bridge.listen(0);
  await fakePlugin(port, () => ({ pong: true }));

  await expect(bridge.request("ping")).resolves.toEqual({ pong: true });
  expect(bridge.status.connected).toBe(true);
  expect(bridge.status.hello?.fileName).toBe("Test file");
});

test("moves to the next port when the first one is taken", async () => {
  const occupied = await occupy(DEFAULT_PORT);
  try {
    bridge = new PluginBridge();
    const port = await bridge.listen();

    expect(port).toBeGreaterThan(occupied);
    expect(port).toBeLessThanOrEqual(PORT_RANGE_END);
  } finally {
    await new Promise((resolve) => blocker?.close(resolve));
    blocker = null;
  }
});

test("a plugin on another protocol is refused, except by ping", async () => {
  bridge = new PluginBridge();
  const port = await bridge.listen(0);
  await fakePlugin(port, () => ({ pong: true }), 99);
  await untilGreeted();

  await expect(bridge.request("render", { tree: {} })).rejects.toMatchObject({
    code: "protocol_mismatch",
  });
  await expect(bridge.request("ping")).resolves.toEqual({ pong: true });
});

test("times out with a hint when the plugin never answers", async () => {
  bridge = new PluginBridge();
  const port = await bridge.listen(0);
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve) => socket.once("open", resolve));

  await expect(bridge.request("ping", undefined, 50)).rejects.toMatchObject({ code: "timeout" });
  socket.close();
});

test("a reconnecting plugin replaces the stale connection", async () => {
  bridge = new PluginBridge();
  const port = await bridge.listen(0);
  const first = await fakePlugin(port, () => ({ from: "first" }));
  const closed = new Promise((resolve) => first.once("close", resolve));

  await fakePlugin(port, () => ({ from: "second" }));
  await closed;

  await expect(bridge.request("ping")).resolves.toEqual({ from: "second" });
});

test("a request in flight fails at once when the plugin disconnects", async () => {
  bridge = new PluginBridge();
  const port = await bridge.listen(0);
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve) => socket.once("open", resolve));

  const pending = bridge.request("render", { tree: {} }, 10_000);
  const outcome = expect(pending).rejects.toMatchObject({ code: "plugin_disconnected" });
  socket.close();

  await outcome;
});

test("a request in flight fails when a newer plugin replaces its connection", async () => {
  bridge = new PluginBridge();
  const port = await bridge.listen(0);
  const first = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve) => first.once("open", resolve));

  const pending = bridge.request("render", { tree: {} }, 10_000);
  const outcome = expect(pending).rejects.toMatchObject({ code: "plugin_disconnected" });
  await fakePlugin(port, () => ({}));

  await outcome;
});
