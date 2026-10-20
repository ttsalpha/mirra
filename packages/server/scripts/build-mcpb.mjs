import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A one-click bundle for Claude Desktop, which runs it on its own Node and
 * renders `user_config` as a form, so nobody has to edit JSON by hand.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = resolve(root, "mcpb");
const { version, description, homepage } = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);

await rm(stage, { recursive: true, force: true });
await mkdir(resolve(stage, "server"), { recursive: true });
await cp(resolve(root, "dist"), resolve(stage, "server"), { recursive: true });
await cp(resolve(root, "README.md"), resolve(stage, "README.md"));

const manifest = {
  manifest_version: "0.3",
  name: "mirra",
  display_name: "Mirra",
  version,
  description,
  author: { name: "Son Tran @ttsalpha" },
  homepage,
  license: "MIT",
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js", "serve"],
      env: {
        MIRRA_PORT: "${user_config.port}",
        MIRRA_ROOT: "${user_config.root}",
        MIRRA_ALLOW_EXEC: "${user_config.allow_exec}",
      },
    },
  },
  user_config: {
    root: {
      type: "directory",
      title: "Project folder",
      description: "Where assets are read from and written to. Nothing outside it is touched.",
      required: false,
    },
    port: {
      type: "number",
      title: "Port",
      description: "The loopback port the Figma plugin connects to.",
      default: 51730,
      min: 51730,
      max: 51739,
    },
    allow_exec: {
      type: "boolean",
      title: "Allow code execution",
      description:
        "Offer the mirra_exec tool, which runs arbitrary Figma Plugin API code. The plugin panel still has to allow it as well.",
      default: false,
    },
  },
  compatibility: {
    // Figma has no Linux desktop app, and a development plugin needs one.
    platforms: ["darwin", "win32"],
    runtimes: { node: ">=24.0.0" },
  },
};

await writeFile(resolve(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`staged ${stage}\nnow run: npx @anthropic-ai/mcpb pack ${stage}`);
