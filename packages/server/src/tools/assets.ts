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
    if (REMOTE.test(src)) {
      throw new Error(
        `Remote URLs are not supported (${src}). Download the file and pass its path, or pass the SVG markup or a data URI.`,
      );
    }
    // A `patch` set carries no type, so the extension has to say what the file is.
    const svg = node["type"] === "svg" || (node["type"] === undefined && /\.svg$/i.test(src));
    node["srcRef"] = src;
    node["src"] = svg ? await readSvg(src) : await readImage(src);
  }

  return node as T;
}

const REMOTE = /^[a-z][a-z0-9+.-]*:\/\//i;

function isPath(src: string): boolean {
  if (src.startsWith("data:") || src.trimStart().startsWith("<")) return false;
  return true;
}

async function read(path: string, encoding?: "utf8"): Promise<string | Buffer> {
  try {
    return await (encoding
      ? readFile(resolveInRoot(path), encoding)
      : readFile(resolveInRoot(path)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(
      `Cannot read "${path}": no such file. src is a file path, inline SVG markup or a data URI.`,
    );
  }
}

async function readSvg(path: string): Promise<string> {
  return (await read(path, "utf8")) as string;
}

async function readImage(path: string): Promise<string> {
  const file = resolveInRoot(path);
  const type = MIME.get(extname(file).toLowerCase());
  if (!type) throw new Error(`Unsupported image type: ${extname(file) || file}`);
  return `data:${type};base64,${((await read(path)) as Buffer).toString("base64")}`;
}
