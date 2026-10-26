import { CHANGES } from "./annotations.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveInRoot } from "./paths.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ExportParams, ExportResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { describeError, text } from "./text.js";

const DESCRIPTION = `Export layers as PNG or SVG files on disk, for icons and images a tree cannot
describe. Targets are keys or Figma node ids; outDir is relative to where the server runs.`;

export function registerExport(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_export_assets",
    {
      annotations: CHANGES,
      title: "Export Figma layers to files",
      description: DESCRIPTION,
      inputSchema: ExportParams.shape,
    },
    async (params) => {
      try {
        const result = ExportResult.parse(await bridge.request("export", params));
        const directory = resolveInRoot(params.outDir);
        await mkdir(directory, { recursive: true });

        const names = fileNames(result.assets);
        const written: string[] = [];
        for (const [position, asset] of result.assets.entries()) {
          const file = resolve(directory, names[position] as string);
          await writeFile(file, Buffer.from(asset.data, "base64"));
          written.push(file);
        }

        return text([`wrote ${written.length} file(s):`, ...written]);
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );
}

/** Two layers can share a name, and the second must not overwrite the first. */
export function fileNames(assets: { name: string; extension: string }[]): string[] {
  const used = new Set<string>();
  return assets.map((asset) => {
    const base = slug(asset.name);
    let candidate = `${base}.${asset.extension}`;
    for (let copy = 2; used.has(candidate); copy++)
      candidate = `${base}-${copy}.${asset.extension}`;
    used.add(candidate);
    return candidate;
  });
}

/** Layer names are free text, so they cannot become path segments as they are. */
function slug(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "asset";
}
