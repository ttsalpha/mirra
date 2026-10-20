import type { ScreenshotParams, ScreenshotResult } from "@mirra/schema";
import { NodeIndex } from "../figma/target";

export async function screenshot(params: ScreenshotParams): Promise<ScreenshotResult> {
  const node = params.target
    ? await new NodeIndex().resolve(params.target)
    : figma.currentPage.selection[0];

  if (!node) {
    throw new Error("Nothing is selected: select a layer in Figma, or pass a target");
  }

  const bytes = await node.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: params.scale ?? 1 },
  });

  const box = node as SceneNode & LayoutMixin;
  return {
    id: node.id,
    name: node.name,
    width: Math.round(box.width),
    height: Math.round(box.height),
    png: figma.base64Encode(bytes),
  };
}
