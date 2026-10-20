import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

/**
 * One file, so the never-published `@mirra/schema` travels inside it. The real
 * npm dependencies stay external.
 */
const root = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [resolve(root, "src/index.ts")],
  outfile: resolve(root, "dist/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // ws is CommonJS and needs a real `require` to reach Node's builtins.
  banner: {
    js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);",
  },
  // Optional native speedups ws works without.
  external: ["bufferutil", "utf-8-validate"],
  logLevel: "info",
});
