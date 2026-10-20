import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ScreenshotParams, ScreenshotResult } from "@mirra/schema";
import type { PluginBridge } from "../transport.js";
import { describeError, text } from "./text.js";

const DESCRIPTION = `Export a layer as a PNG and return the image, so the rendered result can be
checked by eye and corrected with mirra_patch. Defaults to the current selection.`;

export function registerScreenshot(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "mirra_screenshot",
    {
      title: "Screenshot a Figma layer",
      description: DESCRIPTION,
      inputSchema: ScreenshotParams.shape,
    },
    async (params) => {
      try {
        const shot = ScreenshotResult.parse(await bridge.request("screenshot", params));
        return {
          content: [
            {
              type: "text" as const,
              text: `${shot.name} (${shot.width}x${shot.height}, ${shot.id})`,
            },
            { type: "image" as const, data: shot.png, mimeType: "image/png" },
          ],
        };
      } catch (error) {
        return text([describeError(error)], true);
      }
    },
  );
}
