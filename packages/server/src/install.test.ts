import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "mirra-home-"));
  process.env["HOME"] = home;
  vi.resetModules();
});

afterEach(() => {
  delete process.env["HOME"];
});

async function fakeDist(root: string): Promise<string> {
  const dist = join(root, "node_modules/@ttsalpha/mirra/dist");
  await mkdir(join(dist, "plugin"), { recursive: true });
  await writeFile(join(dist, "index.js"), "// server\n");
  for (const file of ["main.js", "ui.html", "manifest.json"]) {
    await writeFile(join(dist, "plugin", file), "{}\n");
  }
  return dist;
}

test("an npx cache is recognised, a normal install is not", async () => {
  const { isTransientInstall } = await import("./install.js");

  expect(isTransientInstall("/Users/x/.npm/_npx/9f3/node_modules/@ttsalpha/mirra/dist")).toBe(true);
  expect(isTransientInstall("/opt/homebrew/lib/node_modules/@ttsalpha/mirra/dist")).toBe(false);
  expect(isTransientInstall("/Users/x/projects/mirra/packages/server/dist")).toBe(false);
  expect(isTransientInstall("/Users/x/_npx-notes/dist")).toBe(false);
});

test("a server run from an npx cache is copied somewhere stable", async () => {
  const { installServer, SERVER_HOME } = await import("./install.js");
  const dist = await fakeDist(join(home, ".npm/_npx/9f3"));

  const entry = await installServer(dist);

  expect(entry).toBe(join(SERVER_HOME, "index.js"));
  expect(await readdir(SERVER_HOME)).toEqual(["index.js"]);
});

test("an older layout under the server directory is cleared out", async () => {
  const { installServer, SERVER_HOME } = await import("./install.js");
  const dist = await fakeDist(join(home, ".npm/_npx/9f3"));

  await mkdir(join(SERVER_HOME, "plugin"), { recursive: true });
  await writeFile(join(SERVER_HOME, "plugin", "manifest.json"), "{}\n");

  await installServer(dist);

  expect(await readdir(SERVER_HOME)).toEqual(["index.js"]);
});

test("a server run from anywhere else is left where it is", async () => {
  const { installServer } = await import("./install.js");
  const dist = await fakeDist(join(home, "lib"));

  expect(await installServer(dist)).toBe(join(dist, "index.js"));
});

test("the plugin is installed on its own, and only once", async () => {
  const { installPlugin, installServer, PLUGIN_HOME, SERVER_HOME } = await import("./install.js");
  const dist = await fakeDist(join(home, ".npm/_npx/9f3"));

  await installPlugin(join(dist, "plugin"));
  await installServer(dist);

  expect((await readdir(PLUGIN_HOME)).sort()).toEqual(["main.js", "manifest.json", "ui.html"]);
  expect(await readdir(SERVER_HOME)).not.toContain("plugin");
});
