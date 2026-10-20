import { PROTOCOL_VERSION } from "@mirra/schema/constants";
import type { MainToUi, UiToMain } from "./bridge-messages";
import { readFileKey } from "./file-info";
import { runOp } from "./ops";
import { setExecAllowed } from "./ops/exec";

const PLUGIN_VERSION = "1.1.0";

figma.showUI(__html__, { width: 300, height: 300, themeColors: true });

/** One operation at a time, so two clients cannot interleave or share an undo step. */
let queue: Promise<unknown> = Promise.resolve();

figma.ui.onmessage = (message: UiToMain) => {
  if (message.kind === "ready") return send(context());
  if (message.kind === "allow-exec") return setExecAllowed(message.value);
  if (message.kind !== "request") return;

  queue = queue.then(async () => {
    try {
      const result = await runOp(message.op, message.params);
      send({ kind: "response", id: message.id, ok: true, result });
    } catch (error) {
      send({
        kind: "response",
        id: message.id,
        ok: false,
        error: {
          code: "op_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
};

function context(): MainToUi {
  return {
    kind: "context",
    pluginVersion: PLUGIN_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    fileName: figma.root.name,
    fileKey: readFileKey(),
  };
}

function send(message: MainToUi): void {
  figma.ui.postMessage(message);
}
