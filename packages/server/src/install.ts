import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_HOME = join(homedir(), ".mirra", "plugin");

const BUNDLED_PLUGIN = resolve(fileURLToPath(new URL(".", import.meta.url)), "plugin");

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

/** Opens the folder so the manifest can be picked in Figma's import dialog. */
export function reveal(path: string): void {
  if (platform() !== "darwin") return;
  spawn("open", ["-R", path], { stdio: "ignore", detached: true }).unref();
}
