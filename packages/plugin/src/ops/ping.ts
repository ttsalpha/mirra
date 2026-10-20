import type { PingResult } from "@mirra/schema";
import { readFileKey } from "../file-info";
import { PLUGIN_VERSION } from "../version";

export function ping(): PingResult {
  return {
    fileName: figma.root.name,
    fileKey: readFileKey(),
    currentPage: figma.currentPage.name,
    selectionCount: figma.currentPage.selection.length,
    pluginVersion: PLUGIN_VERSION,
  };
}
