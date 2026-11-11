import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { realpath } from "node:fs/promises";

import { appDataDir } from "./app-data.js";

export type ClientReport = {
  client: string;
  status: "written" | "skipped" | "failed";
  detail: string;
};

const SERVER_NAME = "Mirra";

/** What earlier versions wrote, removed so a client does not list it twice. */
const LEGACY_NAME = "mirra";

/**
 * A version manager puts `node` behind a path that changes with every shell,
 * so the real file is what a GUI client has to be told about.
 */
export async function stableNodePath(): Promise<string> {
  try {
    return await realpath(process.execPath);
  } catch {
    return process.execPath;
  }
}

type JsonTarget = {
  format: "json";
  /** VS Code calls the map `servers` and wants a `type`; the others use `mcpServers`. */
  key: "mcpServers" | "servers";
  typed?: boolean;
};

/** Shared with the ChatGPT desktop app. */
type TomlTarget = { format: "toml" };

export type Target = {
  client: string;
  file: string;
  /** Marks the app as installed before it has written a config; leave out when the folder is shared with another tool. */
  appDir?: string;
} & (JsonTarget | TomlTarget);

/** Both platforms lay the same folders out; only the directory above them moves. */
export function targets(platform: NodeJS.Platform = process.platform): Target[] {
  const home = homedir();
  const support = appDataDir(platform);
  const codexHome = process.env["CODEX_HOME"] ?? join(home, ".codex");

  return [
    {
      client: "Claude Desktop",
      file: join(support, "Claude/claude_desktop_config.json"),
      appDir: join(support, "Claude"),
      format: "json",
      key: "mcpServers",
    },
    {
      client: "Cursor",
      file: join(home, ".cursor/mcp.json"),
      appDir: join(home, ".cursor"),
      format: "json",
      key: "mcpServers",
    },
    {
      client: "VS Code",
      file: join(support, "Code/User/mcp.json"),
      appDir: join(support, "Code"),
      format: "json",
      key: "servers",
      typed: true,
    },
    {
      client: "Antigravity",
      file: join(home, ".gemini/config/mcp_config.json"),
      format: "json",
      key: "mcpServers",
    },
    {
      client: "Codex",
      file: join(codexHome, "config.toml"),
      appDir: codexHome,
      format: "toml",
    },
  ];
}

export type DetectedClient = {
  name: string;
  detected: boolean;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isTargetDetected(target: Target): Promise<boolean> {
  return (
    (await exists(target.file)) || (target.appDir !== undefined && (await exists(target.appDir)))
  );
}

export function isClaudeCodeDetected(): boolean {
  const probe = runClaude(["--version"]);
  return !probe.error && probe.status === 0;
}

export async function detectClients(
  platform: NodeJS.Platform = process.platform,
): Promise<DetectedClient[]> {
  const list: DetectedClient[] = [];
  for (const target of targets(platform)) {
    list.push({
      name: target.client,
      detected: await isTargetDetected(target),
    });
  }
  list.push({
    name: "Claude Code",
    detected: isClaudeCodeDetected(),
  });

  const detected = list.filter((c) => c.detected);
  const notDetected = list.filter((c) => !c.detected);
  return [...detected, ...notDetected];
}

export async function registerWithClients(
  entryPoint: string,
  selectedClients?: string[],
): Promise<ClientReport[]> {
  const node = await stableNodePath();
  const reports: ClientReport[] = [];

  for (const target of targets()) {
    const selected = selectedClients?.includes(target.client);
    if (selectedClients && !selected) continue;
    reports.push(await writeEntry(target, node, entryPoint, selected === true));
  }
  if (!selectedClients || selectedClients.includes("Claude Code")) {
    reports.push(claudeCode(node, entryPoint));
  }
  return reports;
}

/**
 * These files hold other people's servers and their secrets, so the entry is
 * merged into what is already there and the previous file is kept beside it.
 */
async function writeEntry(
  target: Target,
  node: string,
  entryPoint: string,
  createIfMissing: boolean,
): Promise<ClientReport> {
  const fileExists = await exists(target.file);
  if (!fileExists) {
    const canCreate =
      createIfMissing && target.appDir !== undefined && (await exists(target.appDir));
    if (!canCreate) return { client: target.client, status: "skipped", detail: "not installed" };
  }

  try {
    if (!fileExists) await mkdir(dirname(target.file), { recursive: true });
    const raw = fileExists ? await readFile(target.file, "utf8") : "";
    const content =
      target.format === "toml"
        ? mergeToml(raw, node, entryPoint)
        : mergeJson(raw, target, node, entryPoint);

    if (fileExists) {
      await copyFile(target.file, `${target.file}.mirra-backup`);
    }
    const temporary = join(dirname(target.file), `.${SERVER_NAME}-${process.pid}.tmp`);
    await writeFile(temporary, content);
    await rename(temporary, target.file);

    return { client: target.client, status: "written", detail: target.file };
  } catch (error) {
    return {
      client: target.client,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function mergeJson(raw: string, target: JsonTarget, node: string, entryPoint: string): string {
  const config = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
  const servers = (config[target.key] ?? {}) as Record<string, unknown>;

  delete servers[LEGACY_NAME];
  servers[SERVER_NAME] = {
    ...(target.typed ? { type: "stdio" } : {}),
    command: node,
    args: [entryPoint, "serve"],
  };
  config[target.key] = servers;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function isMirra(path: string[]): boolean {
  return path[0] === "mcp_servers" && (path[1] === SERVER_NAME || path[1] === LEGACY_NAME);
}

/** No TOML parser in the bundle: Mirra's tables are cut line by line, other forms refused. */
export function mergeToml(raw: string, node: string, entryPoint: string): string {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const kept: string[] = [];
  // May belong to the next table.
  let pending: string[] = [];
  let table: string[] = [];
  let skipping = false;
  const state: ScanState = { string: null, depth: 0 };

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (state.string !== null || state.depth > 0) {
      scanValue(line, 0, state);
      if (!skipping) kept.push(line);
      continue;
    }

    if (trimmed.startsWith("[")) {
      table = parseKey(trimmed, trimmed.startsWith("[[") ? 2 : 1).path;
      const mine = isMirra(table);
      if (!mine) kept.push(...pending, line);
      pending = [];
      skipping = mine;
      continue;
    }

    if (trimmed === "" || trimmed.startsWith("#")) {
      (skipping ? pending : kept).push(line);
      continue;
    }

    const key = parseKey(line, 0);
    const full = [...table, ...key.path];
    if (!skipping && (isMirra(full) || (full.length === 1 && full[0] === "mcp_servers"))) {
      throw new Error(
        `config.toml declares ${full.join(".")} in a form init cannot edit; ` +
          `remove it or move it into its own [mcp_servers.${SERVER_NAME}] table`,
      );
    }
    scanValue(line, key.end, state);
    if (skipping) pending = [];
    else kept.push(line);
  }
  kept.push(...pending);

  const body = kept.join(eol).replace(/\s+$/, "");
  // JSON escapes are valid TOML strings, so Windows backslashes survive.
  const entry = [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${JSON.stringify(node)}`,
    `args = [${JSON.stringify(entryPoint)}, "serve"]`,
  ].join(eol);
  return `${body ? `${body}${eol}${eol}` : ""}${entry}${eol}`;
}

/** Spans lines, so a `[` inside a value is not read as a header. */
type ScanState = { string: '"""' | "'''" | null; depth: number };

function scanValue(line: string, from: number, state: ScanState): void {
  let i = from;
  while (i < line.length) {
    if (state.string !== null) {
      if (state.string === '"""' && line[i] === "\\") i += 2;
      else if (line.startsWith(state.string, i)) {
        i += 3;
        state.string = null;
      } else i += 1;
      continue;
    }
    const char = line[i]!;
    if (char === "#") return;
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      state.string = line.slice(i, i + 3) as ScanState["string"];
      i += 3;
    } else if (char === '"' || char === "'") {
      i = closingQuote(line, i) + 1;
    } else {
      if (char === "[" || char === "{") state.depth += 1;
      if (char === "]" || char === "}") state.depth -= 1;
      i += 1;
    }
  }
}

function closingQuote(line: string, open: number): number {
  const quote = line[open];
  for (let i = open + 1; i < line.length; i += 1) {
    if (quote === '"' && line[i] === "\\") i += 1;
    else if (line[i] === quote) return i;
  }
  return line.length;
}

function parseKey(text: string, from: number): { path: string[]; end: number } {
  const path: string[] = [];
  let i = from;
  while (i < text.length) {
    while (text[i] === " " || text[i] === "\t") i += 1;
    const char = text[i];
    if (char === '"' || char === "'") {
      const close = closingQuote(text, i);
      const quoted = text.slice(i, close + 1);
      path.push(char === '"' ? unescape(quoted) : quoted.slice(1, -1));
      i = close + 1;
    } else {
      const bare = /^[A-Za-z0-9_-]+/.exec(text.slice(i))?.[0] ?? "";
      path.push(bare);
      i += bare.length;
    }
    while (text[i] === " " || text[i] === "\t") i += 1;
    if (text[i] !== ".") break;
    i += 1;
  }
  return { path, end: i };
}

function unescape(quoted: string): string {
  try {
    return JSON.parse(quoted) as string;
  } catch {
    return quoted.slice(1, -1);
  }
}

/**
 * On Windows `claude` is a `.cmd` shim, which only runs through a shell, and a
 * shell joins the arguments into one string without quoting them itself.
 */
function runClaude(args: string[]): SpawnSyncReturns<string> {
  const windows = process.platform === "win32";
  const quoted = windows ? args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)) : args;
  return spawnSync("claude", quoted, { stdio: "pipe", encoding: "utf8", shell: windows });
}

/** Claude Code keeps session state in its config, so its own CLI edits it. */
function claudeCode(node: string, entryPoint: string): ClientReport {
  // Through a shell a missing command is an exit code rather than an error.
  const probe = runClaude(["--version"]);
  if (probe.error || probe.status !== 0)
    return { client: "Claude Code", status: "skipped", detail: "claude not on PATH" };

  runClaude(["mcp", "remove", "-s", "user", LEGACY_NAME]);
  runClaude(["mcp", "remove", "-s", "user", SERVER_NAME]);
  const result = runClaude([
    "mcp",
    "add",
    "-s",
    "user",
    SERVER_NAME,
    "--",
    node,
    entryPoint,
    "serve",
  ]);

  if (result.status === 0)
    return { client: "Claude Code", status: "written", detail: "user scope" };
  return {
    client: "Claude Code",
    status: "failed",
    detail: (result.stderr || result.stdout || "claude mcp add failed").trim().split("\n")[0] ?? "",
  };
}
