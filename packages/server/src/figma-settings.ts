import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { promisify } from "node:util";

import { appDataDir } from "./app-data.js";
import { MIRRA_HOME } from "./install.js";

/** Roaming first on Windows; Local for odd installs. */
export function settingsCandidates(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "darwin") return [join(appDataDir(platform), "Figma/settings.json")];
  if (platform === "win32") {
    const local = process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData/Local");
    return [join(appDataDir(platform), "Figma/settings.json"), join(local, "Figma/settings.json")];
  }
  return [join(homedir(), ".config/Figma/settings.json")];
}

/** Only a missing file falls through; a locked one would hide the real settings. */
async function findSettings(): Promise<{ path: string; raw: string } | null> {
  for (const path of settingsCandidates()) {
    try {
      return { path, raw: await readFile(path, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}

const PLUGIN_ID = "mirra-figma-bridge";

type Entry = {
  id: number;
  manifestPath: string;
  lastKnownName?: string;
  lastKnownPluginId?: string;
  cachedContainsWidget?: boolean;
  fileMetadata:
    | { type: "manifest"; codeFileId: number; uiFileIds: number[] }
    | { type: "code" | "ui"; manifestFileId: number };
};

export type RegisterOutcome =
  { status: "registered" } | { status: "already" } | { status: "skipped"; reason: string };

/**
 * Figma records imported development plugins in its own settings file, which is
 * undocumented and rewritten from memory when the app quits — hence the "only while
 * Figma is closed" rule and the soft failure that sends the caller back to a manual import.
 */
export async function registerPluginWithFigma(pluginDir: string): Promise<RegisterOutcome> {
  if (await isFigmaRunning()) {
    return { status: "skipped", reason: "Figma Desktop is running; quit it first" };
  }

  let found: Awaited<ReturnType<typeof findSettings>>;
  try {
    found = await findSettings();
  } catch (error) {
    return { status: "skipped", reason: error instanceof Error ? error.message : String(error) };
  }
  if (!found) {
    return {
      status: "skipped",
      reason: `no settings file at ${settingsCandidates().join(" or ")}`,
    };
  }
  const { path: settingsFile, raw } = found;

  try {
    const settings: Record<string, unknown> = JSON.parse(raw);
    const entries: unknown = settings["localFileExtensions"];
    if (!Array.isArray(entries)) {
      return { status: "skipped", reason: "unfamiliar settings format" };
    }

    const next = rebuild(entries as Entry[], pluginDir);
    if (!next) return { status: "already" };

    settings["localFileExtensions"] = next;
    const temporary = join(dirname(settingsFile), `.mirra-${process.pid}.json`);
    await writeFile(temporary, JSON.stringify(settings, null, 2));
    await rename(temporary, settingsFile);
    return { status: "registered" };
  } catch (error) {
    return { status: "skipped", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Drops every entry Mirra owns — including the orphans older versions left behind — and
 * puts back one clean trio. Returns null when the settings already say exactly that.
 */
function rebuild(entries: Entry[], pluginDir: string): Entry[] | null {
  const mine = entries.filter((entry) => isMine(entry, entries));
  if (isCleanTrio(mine, pluginDir)) return null;

  const others = entries.filter((entry) => !mine.includes(entry));
  return [...others, ...entriesFor(pluginDir, nextId(others))];
}

function isCleanTrio(mine: Entry[], pluginDir: string): boolean {
  const manifest = mine.find((entry) => entry.fileMetadata.type === "manifest");
  if (mine.length !== 3 || !manifest || manifest.fileMetadata.type !== "manifest") return false;
  if (manifest.manifestPath !== join(pluginDir, "manifest.json")) return false;

  const { codeFileId, uiFileIds } = manifest.fileMetadata;
  const paths = new Map(mine.map((entry) => [entry.id, entry.manifestPath]));
  return (
    paths.get(codeFileId) === join(pluginDir, "main.js") &&
    uiFileIds.length === 1 &&
    paths.get(uiFileIds[0]!) === join(pluginDir, "ui.html")
  );
}

function isMine(entry: Entry, all: Entry[]): boolean {
  if (entry.lastKnownPluginId === PLUGIN_ID) return true;
  if (entry.manifestPath.startsWith(`${MIRRA_HOME}${sep}`)) return true;
  const metadata = entry.fileMetadata;
  return metadata.type !== "manifest" && !all.some((e) => e.id === metadata.manifestFileId);
}

async function isFigmaRunning(): Promise<boolean> {
  const run = promisify(execFile);
  try {
    if (process.platform === "win32") {
      const { stdout } = await run("tasklist", ["/fi", "imagename eq Figma.exe", "/nh"]);
      return stdout.includes("Figma.exe");
    }
    await run("pgrep", ["-x", "Figma"]);
    return true;
  } catch {
    return false;
  }
}

function nextId(entries: Entry[]): number {
  return entries.reduce((highest, entry) => Math.max(highest, entry.id), 0) + 1;
}

function entriesFor(pluginDir: string, first: number): Entry[] {
  const [manifestId, codeId, uiId] = [first, first + 1, first + 2];
  return [
    {
      id: manifestId,
      manifestPath: join(pluginDir, "manifest.json"),
      lastKnownName: "Mirra",
      lastKnownPluginId: PLUGIN_ID,
      cachedContainsWidget: false,
      fileMetadata: { type: "manifest", codeFileId: codeId, uiFileIds: [uiId] },
    },
    {
      id: codeId,
      manifestPath: join(pluginDir, "main.js"),
      fileMetadata: { type: "code", manifestFileId: manifestId },
    },
    {
      id: uiId,
      manifestPath: join(pluginDir, "ui.html"),
      fileMetadata: { type: "ui", manifestFileId: manifestId },
    },
  ];
}
