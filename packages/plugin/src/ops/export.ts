import type { ExportParams, ExportResult } from "@mirra/schema";
import { NodeIndex } from "../figma/target";

export async function exportAssets(params: ExportParams): Promise<ExportResult> {
  const index = new NodeIndex();
  const format = params.format ?? "png";
  const assets: ExportResult["assets"] = [];

  for (const target of params.targets) {
    const node = await index.resolve(target);
    const bytes = await node.exportAsync(
      format === "svg"
        ? { format: "SVG" }
        : { format: "PNG", constraint: { type: "SCALE", value: params.scale ?? 1 } },
    );
    assets.push({
      id: node.id,
      name: node.name,
      extension: format,
      data: figma.base64Encode(bytes),
    });
  }

  return { assets };
}
