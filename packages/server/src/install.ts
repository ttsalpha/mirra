import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, rm } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MIRRA_HOME = join(homedir(), ".mirra");
export const PLUGIN_HOME = join(MIRRA_HOME, "plugin");
export const SERVER_HOME = join(MIRRA_HOME, "server");

const DIST = fileURLToPath(new URL(".", import.meta.url));
const BUNDLED_PLUGIN = resolve(DIST, "plugin");

/** Copies the bundled plugin to a stable path Figma can import from. */
export async function installPlugin(
  from: string = BUNDLED_PLUGIN,
): Promise<{ manifest: string; version: string }> {
  await mkdir(PLUGIN_HOME, { recursive: true });
  await cp(from, PLUGIN_HOME, { recursive: true });

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
export function isTransientInstall(directory: string): boolean {
  return directory.includes(`${sep}_npx${sep}`);
}

export async function installServer(from: string = DIST): Promise<string> {
  if (!isTransientInstall(from)) return resolve(from, "index.js");

  const plugin = resolve(from, "plugin");
  // Wiped first, so an older layout leaves nothing behind.
  await rm(SERVER_HOME, { recursive: true, force: true });
  await mkdir(SERVER_HOME, { recursive: true });
  // Copying the bundled plugin too would offer Figma a second one to import.
  await cp(from, SERVER_HOME, {
    recursive: true,
    filter: (source) => source !== plugin && !source.startsWith(plugin + sep),
  });
  return join(SERVER_HOME, "index.js");
}

/** Opens the folder so the manifest can be picked in Figma's import dialog. */
export function reveal(path: string): void {
  if (platform() !== "darwin") return;
  spawn("open", ["-R", path], { stdio: "ignore", detached: true }).unref();
}
