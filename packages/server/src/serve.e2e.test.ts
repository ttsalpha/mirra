import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";
import { afterEach, expect, test } from "vitest";
import type { RequestEnvelope } from "@mirra/schema";

const SERVER_ENTRY = fileURLToPath(new URL("../dist/index.js", import.meta.url));

let client: Client | null = null;
let plugin: WebSocket | null = null;
let sentOps: string[] = [];

afterEach(async () => {
  plugin?.close();
  await client?.close();
  client = null;
  plugin = null;
  sentOps = [];
});

test("mirra_ping reports the file the plugin has open", async () => {
  const port = await freePort();
  client = await startServer(port);

  expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("mirra_ping");

  const offline = await client.callTool({ name: "mirra_ping", arguments: {} });
  expect(offline.isError).toBe(true);
  expect(JSON.stringify(offline.content)).toContain("Plugins -> Development -> Mirra");

  plugin = await connectStubPlugin(port);
  const result = await client.callTool({ name: "mirra_ping", arguments: {} });

  expect(result.isError).toBeFalsy();
  expect(JSON.stringify(result.content)).toContain("Design file");
});

test("mirra_render forwards a validated tree and reports the keys it created", async () => {
  const port = await freePort();
  client = await startServer(port);
  plugin = await connectStubPlugin(port);

  const tool = (await client.listTools()).tools.find((entry) => entry.name === "mirra_render");
  expect(tool?.inputSchema.properties).toHaveProperty("tree");

  const result = await client.callTool({
    name: "mirra_render",
    arguments: {
      tree: {
        type: "frame",
        key: "card",
        layout: { dir: "vertical", gap: 12, pad: 16 },
        fill: "#ffffff",
        radius: 12,
        children: [{ type: "text", key: "title", text: "Welcome back", size: 24 }],
      },
    },
  });

  expect(result.isError).toBeFalsy();
  expect(JSON.stringify(result.content)).toContain("card -> 1:2");
  expect(sentOps).toEqual(["render"]);
});

test("a tree the schema rejects never reaches the plugin", async () => {
  const port = await freePort();
  client = await startServer(port);
  plugin = await connectStubPlugin(port);

  const result = await client.callTool({
    name: "mirra_render",
    arguments: { tree: { type: "frame", fill: "rebeccapurple" } },
  });

  expect(result.isError).toBe(true);
  expect(sentOps).toEqual([]);
});

test("mirra_read returns the tree as JSON and says what it left out", async () => {
  const port = await freePort();
  client = await startServer(port);
  plugin = await connectStubPlugin(port);

  const result = await client.callTool({ name: "mirra_read", arguments: { depth: 2 } });

  expect(result.isError).toBeFalsy();
  const output = JSON.stringify(result.content);
  expect(output).toContain("1 node(s) left out");
  expect(output).toContain("Welcome back");
  expect(sentOps).toEqual(["read"]);
});

test("mirra_patch forwards its ops and reports keys it created", async () => {
  const port = await freePort();
  client = await startServer(port);
  plugin = await connectStubPlugin(port);

  const result = await client.callTool({
    name: "mirra_patch",
    arguments: {
      ops: [
        { op: "set", target: { key: "title" }, props: { text: "Hello again" } },
        { op: "remove", target: { id: "1:9" } },
      ],
    },
  });

  expect(result.isError).toBeFalsy();
  expect(JSON.stringify(result.content)).toContain("applied 2 op(s)");
  expect(sentOps).toEqual(["patch"]);
});

test("mirra_screenshot comes back as an image block", async () => {
  const port = await freePort();
  client = await startServer(port);
  plugin = await connectStubPlugin(port);

  const result = await client.callTool({ name: "mirra_screenshot", arguments: { scale: 2 } });

  expect(result.isError).toBeFalsy();
  const blocks = result.content as { type: string; mimeType?: string; data?: string }[];
  expect(blocks.map((block) => block.type)).toEqual(["text", "image"]);
  expect(blocks[1]).toMatchObject({ mimeType: "image/png", data: "iVBORw==" });
});

test("mirra_tokens reports the variables the file defines", async () => {
  const port = await freePort();
  client = await startServer(port);
  plugin = await connectStubPlugin(port);

  const result = await client.callTool({ name: "mirra_tokens", arguments: {} });

  expect(result.isError).toBeFalsy();
  expect(JSON.stringify(result.content)).toContain("$color/primary");
  expect(sentOps).toEqual(["tokens"]);
});

test("mirra_export_assets writes the files it is handed", async () => {
  const port = await freePort();
  client = await startServer(port);
  plugin = await connectStubPlugin(port);
  const outDir = await mkdtemp(join(tmpdir(), "mirra-assets-"));

  const result = await client.callTool({
    name: "mirra_export_assets",
    arguments: { targets: [{ key: "icon" }], format: "svg", outDir },
  });

  expect(result.isError).toBeFalsy();
  expect(await readdir(outDir)).toEqual(["cart-icon.svg"]);
  expect(await readFile(join(outDir, "cart-icon.svg"), "utf8")).toBe("<svg/>");
});

/** Runs `mirra serve` the way Claude Code spawns it. */
async function startServer(port: number): Promise<Client> {
  const started = new Client({ name: "test", version: "0" });
  await started.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_ENTRY, "serve"],
      env: { ...(process.env as Record<string, string>), MIRRA_PORT: String(port) },
      stderr: "ignore",
    }),
  );
  return started;
}

/** Stands in for the plugin: records the ops it is asked for, answers canned results. */
async function connectStubPlugin(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve) => socket.once("open", resolve));

  socket.on("message", (raw) => {
    const envelope = JSON.parse(String(raw)) as RequestEnvelope;
    sentOps.push(envelope.op);
    socket.send(JSON.stringify({ id: envelope.id, ok: true, result: stubResult(envelope.op) }));
  });

  socket.send(
    JSON.stringify({
      type: "hello",
      protocolVersion: 1,
      pluginVersion: "0.1.0",
      fileKey: null,
      fileName: "Design file",
    }),
  );
  return socket;
}

function stubResult(op: string) {
  if (op === "render") return { rootId: "1:1", nodeCount: 2, keys: { card: "1:2" } };
  if (op === "patch") return { applied: 2, keys: {} };
  if (op === "tokens") {
    return {
      collections: [
        {
          name: "Theme",
          modes: ["Light"],
          variables: [{ ref: "$color/primary", type: "COLOR", values: { Light: "#ff0000" } }],
        },
      ],
      styles: { paint: [], text: [], effect: [] },
    };
  }
  if (op === "export") {
    return {
      assets: [
        {
          id: "1:4",
          name: "Cart icon",
          extension: "svg",
          data: Buffer.from("<svg/>").toString("base64"),
        },
      ],
    };
  }
  if (op === "screenshot") {
    return { id: "1:1", name: "Card", width: 320, height: 180, scale: 1, png: "iVBORw==" };
  }
  if (op === "read") {
    return {
      nodes: [
        {
          id: "1:1",
          tree: {
            type: "frame",
            name: "Card",
            children: [{ type: "text", name: "Title", text: "Welcome back" }],
          },
        },
      ],
      skipped: 1,
    };
  }
  return { fileName: "Design file", fileKey: null, currentPage: "Page 1", selectionCount: 2 };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}
