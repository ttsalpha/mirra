import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { access, copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { realpath } from "node:fs/promises";

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

export type Target = {
  client: string;
  file: string;
  /** VS Code calls the map `servers` and wants a `type`; the others use `mcpServers`. */
  key: "mcpServers" | "servers";
  typed?: boolean;
};

/** Both platforms lay the same folders out; only the directory above them moves. */
export function targets(platform: NodeJS.Platform = process.platform): Target[] {
  const home = homedir();
  const support =
    platform === "win32"
      ? (process.env["APPDATA"] ?? join(home, "AppData/Roaming"))
      : join(home, "Library/Application Support");

  return [
    {
      client: "Claude Desktop",
      file: join(support, "Claude/claude_desktop_config.json"),
      key: "mcpServers",
    },
    { client: "Cursor", file: join(home, ".cursor/mcp.json"), key: "mcpServers" },
    {
      client: "VS Code",
      file: join(support, "Code/User/mcp.json"),
      key: "servers",
      typed: true,
    },
    {
      client: "Antigravity",
      file: join(home, ".gemini/config/mcp_config.json"),
      key: "mcpServers",
    },
  ];
}

export async function registerWithClients(entryPoint: string): Promise<ClientReport[]> {
  const node = await stableNodePath();
  const reports: ClientReport[] = [];

  for (const target of targets()) {
    reports.push(await writeEntry(target, node, entryPoint));
  }
  reports.push(claudeCode(node, entryPoint));
  return reports;
}

/**
 * These files hold other people's servers and their secrets, so the entry is
 * merged into what is already there and the previous file is kept beside it.
 */
async function writeEntry(target: Target, node: string, entryPoint: string): Promise<ClientReport> {
  try {
    await access(target.file);
  } catch {
    return { client: target.client, status: "skipped", detail: "not installed" };
  }

  try {
    const raw = await readFile(target.file, "utf8");
    const config = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const servers = (config[target.key] ?? {}) as Record<string, unknown>;

    delete servers[LEGACY_NAME];
    servers[SERVER_NAME] = {
      ...(target.typed ? { type: "stdio" } : {}),
      command: node,
      args: [entryPoint, "serve"],
    };
    config[target.key] = servers;

    await copyFile(target.file, `${target.file}.mirra-backup`);
    const temporary = join(dirname(target.file), `.${SERVER_NAME}-${process.pid}.json`);
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`);
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
