import type { ScreenshotParams, ScreenshotResult } from "@mirra/schema";
import { NodeIndex } from "../figma/target";

const DEFAULT_MAX_EDGE = 1200;

/** A frame can be larger than a client will take, so the scale gives way. */
function fittingScale(
  wanted: number,
  box: { width: number; height: number },
  maxEdge: number,
): number {
  const longest = Math.max(box.width, box.height) * wanted;
  if (longest <= maxEdge) return wanted;
  return Math.max(0.01, (wanted * maxEdge) / longest);
}

export async function screenshot(params: ScreenshotParams): Promise<ScreenshotResult> {
  const node = params.target
    ? await new NodeIndex().resolve(params.target)
    : figma.currentPage.selection[0];

  if (!node) {
    throw new Error("Nothing is selected: select a layer in Figma, or pass a target");
  }

  const box = node as SceneNode & LayoutMixin;
  const scale = fittingScale(params.scale ?? 1, box, params.maxEdge ?? DEFAULT_MAX_EDGE);
  const bytes = await node.exportAsync({
    format: "PNG",
    constraint: { type: "SCALE", value: scale },
  });

  return {
    id: node.id,
    name: node.name,
    width: Math.round(box.width * scale),
    height: Math.round(box.height * scale),
    scale,
    png: figma.base64Encode(bytes),
  };
}
