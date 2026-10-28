import type { EditorType, ErrorBody, OpName } from "@mirra/schema";

export type UiToMain =
  | { kind: "ready" }
  | { kind: "request"; id: string; op: OpName; params: unknown }
  | { kind: "allow-exec"; value: boolean };

export type MainToUi =
  | {
      kind: "context";
      pluginVersion: string;
      protocolVersion: number;
      fileName: string;
      fileKey: string | null;
      editorType: EditorType;
    }
  | { kind: "response"; id: string; ok: true; result: unknown }
  | { kind: "response"; id: string; ok: false; error: ErrorBody };
