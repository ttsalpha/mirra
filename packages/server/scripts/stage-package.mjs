import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Puts what the published package needs beside it: the built plugin for
 * `mirra init`, and the README and LICENSE, which npm only takes from here.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const pluginSource = resolve(root, "../plugin");
const target = resolve(root, "dist/plugin");

await mkdir(target, { recursive: true });
await cp(resolve(pluginSource, "dist/main.js"), resolve(target, "main.js"));
await cp(resolve(pluginSource, "dist/ui.html"), resolve(target, "ui.html"));

// The manifest moves up a level, so its paths lose the dist/ prefix.
const manifest = JSON.parse(await readFile(resolve(pluginSource, "manifest.json"), "utf8"));
manifest.main = "main.js";
manifest.ui = "ui.html";
await writeFile(resolve(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

for (const file of ["README.md", "LICENSE"]) {
  await cp(resolve(repo, file), resolve(root, file));
}
