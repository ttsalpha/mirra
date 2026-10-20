import type {
  DefineParams,
  ExecParams,
  ExportParams,
  FindParams,
  OpName,
  PagesParams,
  PatchParams,
  ReadParams,
  RenderParams,
  ScreenshotParams,
} from "@mirra/schema";
import { define } from "./define";
import { exec } from "./exec";
import { exportAssets } from "./export";
import { find } from "./find";
import { pages } from "./pages";
import { patch } from "./patch";
import { ping } from "./ping";
import { read } from "./read";
import { render } from "./render";
import { screenshot } from "./screenshot";
import { tokens } from "./tokens";

export async function runOp(op: OpName, raw: unknown): Promise<unknown> {
  // An op with only optional fields may arrive with no params at all.
  const params = (raw ?? {}) as never;

  switch (op) {
    case "ping":
      return ping();
    case "render":
      return render(params as RenderParams);
    case "read":
      return read(params as ReadParams);
    case "patch":
      return patch(params as PatchParams);
    case "screenshot":
      return screenshot(params as ScreenshotParams);
    case "tokens":
      return tokens();
    case "export":
      return exportAssets(params as ExportParams);
    case "find":
      return find(params as FindParams);
    case "pages":
      return pages(params as PagesParams);
    case "exec":
      return exec(params as ExecParams);
    case "define":
      return define(params as DefineParams);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown op: ${String(exhaustive)}`);
    }
  }
}
