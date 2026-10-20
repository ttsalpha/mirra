import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, "dist");
const watch = process.argv.includes("--watch");

const shared = { bundle: true, format: "iife", target: "es2020", logLevel: "info" };

/** The sandbox loads dist/main.js; the panel is one self-contained HTML file. */
const mainOptions = {
  ...shared,
  entryPoints: [resolve(root, "src/main.ts")],
  outfile: resolve(dist, "main.js"),
};
const uiOptions = {
  ...shared,
  entryPoints: [resolve(root, "src/ui.ts")],
  write: false,
  outfile: resolve(dist, "ui.js"),
};

const inlineUi = {
  name: "inline-ui",
  setup(build) {
    build.onEnd(async (result) => {
      const script = result.outputFiles?.[0]?.text;
      if (!script) return;
      const template = await readFile(resolve(root, "src/ui.html"), "utf8");
      await mkdir(dist, { recursive: true });
      await writeFile(
        resolve(dist, "ui.html"),
        template.replace("/*__MIRRA_UI__*/", () => script),
      );
    });
  },
};

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(mainOptions),
    esbuild.context({ ...uiOptions, plugins: [inlineUi] }),
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
} else {
  await Promise.all([
    esbuild.build(mainOptions),
    esbuild.build({ ...uiOptions, plugins: [inlineUi] }),
  ]);
}
