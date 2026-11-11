import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let home: string;
let figmaRunning = false;

// pgrep exits 1 when nothing matches, which is how a closed Figma looks.
vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    _args: string[],
    done: (error: Error | null, stdout: string, stderr: string) => void,
  ) => done(figmaRunning ? null : new Error("no match"), figmaRunning ? "4321\n" : "", ""),
}));

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "mirra-figma-"));
  figmaRunning = false;
  process.env["HOME"] = home;
  vi.stubEnv("APPDATA", undefined);
  vi.stubEnv("LOCALAPPDATA", undefined);
  vi.resetModules();
});

afterEach(() => {
  delete process.env["HOME"];
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function settingsFile(value: unknown): Promise<string> {
  const { settingsCandidates } = await load();
  const path = settingsCandidates()[0]!;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
  return path;
}

async function load() {
  return import("./figma-settings.js");
}

test("on Windows the Roaming folder is tried before Local", async () => {
  const { settingsCandidates } = await load();

  expect(settingsCandidates("win32")).toEqual([
    join(home, "AppData/Roaming/Figma/settings.json"),
    join(home, "AppData/Local/Figma/settings.json"),
  ]);
});

const pluginDir = () => join(home, ".mirra/plugin");

test("a first run writes the manifest, code and ui trio", async () => {
  const path = await settingsFile({ theme: "dark", localFileExtensions: [] });
  const { registerPluginWithFigma } = await load();

  expect(await registerPluginWithFigma(pluginDir())).toEqual({ status: "registered" });

  const settings = JSON.parse(await readFile(path, "utf8"));
  expect(settings.theme).toBe("dark");
  expect(
    settings.localFileExtensions.map((entry: { manifestPath: string }) => entry.manifestPath),
  ).toEqual([
    join(pluginDir(), "manifest.json"),
    join(pluginDir(), "main.js"),
    join(pluginDir(), "ui.html"),
  ]);
});

test("a second run leaves the file alone", async () => {
  const path = await settingsFile({ localFileExtensions: [] });
  const { registerPluginWithFigma } = await load();

  await registerPluginWithFigma(pluginDir());
  const after = await readFile(path, "utf8");

  expect(await registerPluginWithFigma(pluginDir())).toEqual({ status: "already" });
  expect(await readFile(path, "utf8")).toBe(after);
});

test("entries from an older install are replaced, other plugins are kept", async () => {
  const other = {
    id: 1,
    manifestPath: "/Users/x/other/manifest.json",
    lastKnownPluginId: "other",
    fileMetadata: { type: "manifest", codeFileId: 2, uiFileIds: [] },
  };
  const path = await settingsFile({
    localFileExtensions: [
      other,
      {
        id: 2,
        manifestPath: "/Users/x/other/code.js",
        fileMetadata: { type: "code", manifestFileId: 1 },
      },
      {
        id: 3,
        manifestPath: join(home, ".mirra/server/plugin/manifest.json"),
        lastKnownPluginId: "mirra-figma-bridge",
        fileMetadata: { type: "manifest", codeFileId: 4, uiFileIds: [5] },
      },
      {
        id: 4,
        manifestPath: join(home, ".mirra/server/plugin/main.js"),
        fileMetadata: { type: "code", manifestFileId: 3 },
      },
      { id: 9, manifestPath: "/gone/ui.html", fileMetadata: { type: "ui", manifestFileId: 99 } },
    ],
  });
  const { registerPluginWithFigma } = await load();

  expect(await registerPluginWithFigma(pluginDir())).toEqual({ status: "registered" });

  const { localFileExtensions } = JSON.parse(await readFile(path, "utf8"));
  expect(localFileExtensions).toHaveLength(5);
  expect(localFileExtensions.slice(0, 2)).toEqual([
    other,
    {
      id: 2,
      manifestPath: "/Users/x/other/code.js",
      fileMetadata: { type: "code", manifestFileId: 1 },
    },
  ]);
  expect(localFileExtensions[2].id).toBe(3);
  expect(localFileExtensions[2].manifestPath).toBe(join(pluginDir(), "manifest.json"));
});

test("a missing settings file is reported, not thrown", async () => {
  const { registerPluginWithFigma } = await load();
  const outcome = await registerPluginWithFigma(pluginDir());
  expect(outcome.status).toBe("skipped");
});

test("an unreadable settings file is reported rather than skipped over", async () => {
  const { settingsCandidates, registerPluginWithFigma } = await load();
  await mkdir(settingsCandidates()[0]!, { recursive: true });

  const outcome = await registerPluginWithFigma(pluginDir());

  expect(outcome).toMatchObject({ status: "skipped", reason: expect.stringContaining("EISDIR") });
});

test("a running Figma is left untouched", async () => {
  const path = await settingsFile({ localFileExtensions: [] });
  figmaRunning = true;
  const { registerPluginWithFigma } = await load();

  const outcome = await registerPluginWithFigma(pluginDir());
  expect(outcome).toEqual({ status: "skipped", reason: "Figma Desktop is running; quit it first" });
  expect(JSON.parse(await readFile(path, "utf8")).localFileExtensions).toEqual([]);
});
