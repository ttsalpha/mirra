import { MirraError } from "../errors.js";

export function text(lines: string[], isError = false) {
  return { content: [{ type: "text" as const, text: lines.join("\n") }], isError };
}

/** Turns any thrown value into the text an MCP client should show. */
export function describeError(error: unknown): string {
  if (error instanceof MirraError) {
    return error.hint ? `${error.message}\n\n${error.hint}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
