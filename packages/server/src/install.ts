import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MIRRA_HOME = join(homedir(), ".mirra");
export const PLUGIN_HOME = join(MIRRA_HOME, "plugin");
export const SERVER_HOME = join(MIRRA_HOME, "server");

const DIST = fileURLToPath(new URL(".", import.meta.url));
const BUNDLED_PLUGIN = resolve(DIST, "plugin");

/** Copies the bundled plugin to a stable path Figma can import from. */
export async function installPlugin(): Promise<{ manifest: string; version: string }> {
  await mkdir(PLUGIN_HOME, { recursive: true });
  await cp(BUNDLED_PLUGIN, PLUGIN_HOME, { recursive: true });

  const manifest = join(PLUGIN_HOME, "manifest.json");
  return { manifest, version: await installedVersion() };
}

export async function installedVersion(): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(join(PLUGIN_HOME, "manifest.json"), "utf8"));
    return typeof manifest.name === "string" ? manifest.name : "unknown";
  } catch {
    return "not installed";
  }
}

export async function isInstalled(): Promise<boolean> {
  try {
    await access(join(PLUGIN_HOME, "manifest.json"));
    return true;
  } catch {
    return false;
  }
}

/** An npx cache is cleared and renamed between versions, so a client pointed there breaks. */
export async function installServer(): Promise<string> {
  const running = resolve(DIST, "index.js");
  if (!DIST.includes(`${sep}_npx${sep}`)) return running;

  await mkdir(SERVER_HOME, { recursive: true });
  await cp(DIST, SERVER_HOME, { recursive: true });
  return join(SERVER_HOME, "index.js");
}

/** Opens the folder so the manifest can be picked in Figma's import dialog. */
export function reveal(path: string): void {
  if (platform() !== "darwin") return;
  spawn("open", ["-R", path], { stdio: "ignore", detached: true }).unref();
}
