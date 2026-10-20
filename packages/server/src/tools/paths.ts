import { resolve, sep } from "node:path";
import { MirraError } from "../errors.js";

/**
 * Where relative paths resolve from and, when set, the only place the tools may
 * read or write. A client that starts the server outside a project should set it.
 */
export function rootDirectory(): string {
  const configured = process.env["MIRRA_ROOT"];
  return configured ? resolve(configured) : process.cwd();
}

export function resolveInRoot(path: string): string {
  const root = rootDirectory();
  const full = resolve(root, path);
  if (!process.env["MIRRA_ROOT"]) return full;

  if (full !== root && !full.startsWith(root + sep)) {
    throw new MirraError(
      `${path} is outside MIRRA_ROOT`,
      "outside_root",
      `This server may only touch files under ${root}.`,
    );
  }
  return full;
}
