import { spawnSync } from "node:child_process";
import { access, copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { realpath } from "node:fs/promises";

export type ClientReport = {
  client: string;
  status: "written" | "skipped" | "failed";
  detail: string;
};

const SERVER_NAME = "mirra";

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

type Target = {
  client: string;
  file: string;
  /** VS Code calls the map `servers` and wants a `type`; the others use `mcpServers`. */
  key: "mcpServers" | "servers";
  typed?: boolean;
};

function targets(): Target[] {
  const home = homedir();
  return [
    {
      client: "Claude Desktop",
      file: join(home, "Library/Application Support/Claude/claude_desktop_config.json"),
      key: "mcpServers",
    },
    { client: "Cursor", file: join(home, ".cursor/mcp.json"), key: "mcpServers" },
    {
      client: "VS Code",
      file: join(home, "Library/Application Support/Code/User/mcp.json"),
      key: "servers",
      typed: true,
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
    const config = JSON.parse(raw) as Record<string, unknown>;
    const servers = (config[target.key] ?? {}) as Record<string, unknown>;

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

/** Claude Code keeps session state in its config, so its own CLI edits it. */
function claudeCode(node: string, entryPoint: string): ClientReport {
  const probe = spawnSync("claude", ["--version"], { stdio: "ignore" });
  if (probe.error)
    return { client: "Claude Code", status: "skipped", detail: "claude not on PATH" };

  const result = spawnSync(
    "claude",
    ["mcp", "add", "-s", "user", SERVER_NAME, "--", node, entryPoint, "serve"],
    { stdio: "pipe", encoding: "utf8" },
  );

  if (result.status === 0)
    return { client: "Claude Code", status: "written", detail: "user scope" };
  return {
    client: "Claude Code",
    status: "failed",
    detail: (result.stderr || result.stdout || "claude mcp add failed").trim().split("\n")[0] ?? "",
  };
}

export function serverEntryPoint(): string {
  return resolve(fileDirectory(), "index.js");
}

function fileDirectory(): string {
  return dirname(new URL(import.meta.url).pathname);
}
