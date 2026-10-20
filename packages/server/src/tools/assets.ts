import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { resolveInRoot } from "./paths.js";

const MIME = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

/**
 * `src` may be inline content or a path. The plugin sandbox cannot read files,
 * so paths are inlined here and remembered in `srcRef` for `read` to report.
 */
export async function inlineAssets<T>(tree: T): Promise<T> {
  if (Array.isArray(tree)) {
    return (await Promise.all(tree.map((item) => inlineAssets(item)))) as T;
  }
  if (!tree || typeof tree !== "object") return tree;

  const node = { ...(tree as Record<string, unknown>) };
  for (const [key, value] of Object.entries(node)) {
    if (key !== "src") node[key] = await inlineAssets(value);
  }

  const src = node["src"];
  if (typeof src === "string" && isPath(src)) {
    node["srcRef"] = src;
    node["src"] = node["type"] === "svg" ? await readSvg(src) : await readImage(src);
  }

  return node as T;
}

function isPath(src: string): boolean {
  if (src.startsWith("data:") || src.trimStart().startsWith("<")) return false;
  return true;
}

async function readSvg(path: string): Promise<string> {
  return readFile(resolveInRoot(path), "utf8");
}

async function readImage(path: string): Promise<string> {
  const file = resolveInRoot(path);
  const type = MIME.get(extname(file).toLowerCase());
  if (!type) throw new Error(`Unsupported image type: ${extname(file) || file}`);
  return `data:${type};base64,${(await readFile(file)).toString("base64")}`;
}
