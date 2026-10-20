import type { ExecParams, ExecResult } from "@mirra/schema";

/**
 * The escape hatch for whatever the typed ops do not cover. It runs arbitrary
 * code against the open document, so it needs both MIRRA_ALLOW_EXEC on the
 * server and the checkbox in the panel.
 */
let allowed = false;

/** Driven by the checkbox in the plugin panel; stays on until it is unticked
 * or the panel closes, since reopening it starts a fresh sandbox. */
export function setExecAllowed(value: boolean): void {
  allowed = value;
}

export async function exec(params: ExecParams): Promise<ExecResult> {
  if (!allowed) {
    throw new Error(
      'Code execution is off. Tick "Allow code execution" in the Mirra panel in Figma.',
    );
  }

  let run: (figma: PluginAPI) => unknown;
  try {
    run = new Function("figma", `"use strict"; return (async () => { ${params.code} })();`) as (
      figma: PluginAPI,
    ) => unknown;
  } catch (error) {
    throw new Error(`Could not compile the code: ${message(error)}`);
  }

  const result = await run(figma);
  figma.commitUndo();
  return { result: describe(result) };
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value, replacer, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Figma nodes are cyclic, so they are reported by id rather than serialised. */
function replacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && "id" in value && "type" in value) {
    const node = value as { id: string; type: string; name?: string };
    return `${node.type} ${node.id}${node.name ? ` (${node.name})` : ""}`;
  }
  return value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
