import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * What a client needs to decide whether to ask before running a tool. The
 * hints are the server's word, so they have to match what the tool really does.
 */
export const READS: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

/** Adds to the file without taking anything away. */
export const ADDS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

/** May overwrite or remove what is already there. */
export const CHANGES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
};
