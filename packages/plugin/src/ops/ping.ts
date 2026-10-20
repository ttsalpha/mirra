import type { PingResult } from "@mirra/schema";
import { readFileKey } from "../file-info";

export function ping(): PingResult {
  return {
    fileName: figma.root.name,
    fileKey: readFileKey(),
    currentPage: figma.currentPage.name,
    selectionCount: figma.currentPage.selection.length,
  };
}
