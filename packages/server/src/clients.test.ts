import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { registerWithClients, stableNodePath, targets } from "./clients.js";

const ENTRY = "/opt/mirra/dist/index.js";

let home: string;
let path: string | undefined;

const DESKTOP = "Library/Application Support/Claude/claude_desktop_config.json";
const CURSOR = ".cursor/mcp.json";
const VSCODE = "Library/Application Support/Code/User/mcp.json";
const ANTIGRAVITY = ".gemini/config/mcp_config.json";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "mirra-clients-"));
  process.env["HOME"] = home;

  // An empty PATH keeps the real `claude` CLI out of the test.
  path = process.env["PATH"];
  process.env["PATH"] = join(home, "nowhere");
});

afterEach(() => {
  delete process.env["HOME"];
  if (path !== undefined) process.env["PATH"] = path;
});

async function write(relative: string, config: unknown): Promise<string> {
  const file = join(home, relative);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

async function read(relative: string): Promise<Record<string, never>> {
  return JSON.parse(await readFile(join(home, relative), "utf8"));
}

test("the entry is merged in, leaving the other servers alone", async () => {
  await write(DESKTOP, {
    mcpServers: { other: { command: "npx", args: ["-y", "other-mcp"] } },
    preferences: { menuBarEnabled: false },
  });

  const reports = await registerWithClients(ENTRY);

  const config = (await read(DESKTOP)) as unknown as {
    mcpServers: Record<string, { command: string; args: string[] }>;
    preferences: unknown;
  };
  expect(Object.keys(config.mcpServers).sort()).toEqual(["Mirra", "other"]);
  expect(config.mcpServers["other"]?.args).toEqual(["-y", "other-mcp"]);
  expect(config.preferences).toEqual({ menuBarEnabled: false });
  expect(config.mcpServers["Mirra"]?.args).toEqual([ENTRY, "serve"]);
  expect(reports.find((report) => report.client === "Claude Desktop")?.status).toBe("written");
});

test("the lowercase entry an older version wrote is replaced, not doubled", async () => {
  await write(DESKTOP, { mcpServers: { mirra: { command: "stale", args: ["old"] } } });

  await registerWithClients(ENTRY);

  const config = (await read(DESKTOP)) as unknown as { mcpServers: Record<string, unknown> };
  expect(Object.keys(config.mcpServers)).toEqual(["Mirra"]);
});

test("the previous file is kept beside the new one", async () => {
  const file = await write(CURSOR, { mcpServers: { context7: { url: "https://example.test" } } });

  await registerWithClients(ENTRY);

  const backup = JSON.parse(await readFile(`${file}.mirra-backup`, "utf8"));
  expect(backup.mcpServers).toEqual({ context7: { url: "https://example.test" } });
});

test("VS Code keeps its own shape", async () => {
  await write(VSCODE, { inputs: [], servers: { github: { type: "http", url: "https://x.test" } } });

  await registerWithClients(ENTRY);

  const config = (await read(VSCODE)) as unknown as {
    servers: Record<string, { type?: string }>;
    inputs: unknown[];
  };
  expect(config.servers["Mirra"]).toMatchObject({ type: "stdio", command: expect.any(String) });
  expect(config.servers["github"]).toBeDefined();
  expect(config.inputs).toEqual([]);
});

test("Antigravity merges into mcp_config.json using mcpServers", async () => {
  await write(ANTIGRAVITY, {
    mcpServers: { other: { command: "npx", args: ["-y", "other-mcp"] } },
  });

  const reports = await registerWithClients(ENTRY);

  const config = (await read(ANTIGRAVITY)) as unknown as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  expect(Object.keys(config.mcpServers).sort()).toEqual(["Mirra", "other"]);
  expect(config.mcpServers["other"]?.args).toEqual(["-y", "other-mcp"]);
  expect(config.mcpServers["Mirra"]?.args).toEqual([ENTRY, "serve"]);
  expect(reports.find((report) => report.client === "Antigravity")?.status).toBe("written");
});

test("an empty config file is populated rather than failing to parse JSON", async () => {
  const file = await write(ANTIGRAVITY, {});
  await writeFile(file, "");

  const reports = await registerWithClients(ENTRY);

  const config = (await read(ANTIGRAVITY)) as unknown as {
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  expect(config.mcpServers["Mirra"]?.args).toEqual([ENTRY, "serve"]);
  expect(reports.find((report) => report.client === "Antigravity")?.status).toBe("written");
});

test("a client that is not installed is skipped rather than created", async () => {
  const reports = await registerWithClients(ENTRY);

  expect(reports.filter((report) => report.status === "skipped").length).toBeGreaterThan(0);
  await expect(read(DESKTOP)).rejects.toThrow();
});

test("a config that is not JSON is reported, not overwritten", async () => {
  const file = await write(CURSOR, {});
  await writeFile(file, "{ this is not json");

  const reports = await registerWithClients(ENTRY);

  expect(reports.find((report) => report.client === "Cursor")?.status).toBe("failed");
  expect(await readFile(file, "utf8")).toBe("{ this is not json");
});

test("Claude Code is skipped when its CLI is not on PATH", async () => {
  const reports = await registerWithClients(ENTRY);

  expect(reports.find((report) => report.client === "Claude Code")).toMatchObject({
    status: "skipped",
    detail: "claude not on PATH",
  });
});

test("each platform keeps the same folders, under the directory it calls its own", () => {
  const appData = process.env["APPDATA"];
  delete process.env["APPDATA"];

  expect(targets("darwin").map((target) => target.file)).toEqual([
    join(home, DESKTOP),
    join(home, CURSOR),
    join(home, VSCODE),
    join(home, ANTIGRAVITY),
  ]);
  expect(targets("win32").map((target) => target.file)).toEqual([
    join(home, "AppData/Roaming/Claude/claude_desktop_config.json"),
    join(home, CURSOR),
    join(home, "AppData/Roaming/Code/User/mcp.json"),
    join(home, ANTIGRAVITY),
  ]);

  if (appData !== undefined) process.env["APPDATA"] = appData;
});

test("the node path written out is a real file, not a shell shim", async () => {
  const node = await stableNodePath();

  expect(node).not.toContain("_multishells");
  await expect(readFile(node)).resolves.toBeDefined();
});
