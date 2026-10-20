import { z } from "zod";

export * from "./constants.js";
import { Effect, Fill, NodeProps, UINode } from "./tree.js";

export const OpName = z.enum([
  "ping",
  "render",
  "read",
  "patch",
  "screenshot",
  "tokens",
  "export",
  "find",
  "pages",
  "exec",
  "define",
]);
export type OpName = z.infer<typeof OpName>;

/** server -> plugin */
export const RequestEnvelope = z.object({
  id: z.string(),
  op: OpName,
  params: z.unknown().optional(),
});
export type RequestEnvelope = z.infer<typeof RequestEnvelope>;

export const ErrorBody = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export const ResponseEnvelope = z.discriminatedUnion("ok", [
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.string(), ok: z.literal(false), error: ErrorBody }),
]);
export type ResponseEnvelope = z.infer<typeof ResponseEnvelope>;

/** plugin -> server, unsolicited */
export const HelloMessage = z.object({
  type: z.literal("hello"),
  protocolVersion: z.number(),
  pluginVersion: z.string(),
  fileKey: z.string().nullable(),
  fileName: z.string(),
});
export type HelloMessage = z.infer<typeof HelloMessage>;

export const LogMessage = z.object({
  type: z.literal("log"),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
});
export type LogMessage = z.infer<typeof LogMessage>;

export const PluginMessage = z.union([ResponseEnvelope, HelloMessage, LogMessage]);
export type PluginMessage = z.infer<typeof PluginMessage>;

export const RenderParams = z.object({
  tree: UINode,
  /** Where to put the root. Defaults to the current page. */
  parentId: z.string().optional(),
  /** Absolute position for the root; defaults to the middle of the viewport. */
  at: z.object({ x: z.number(), y: z.number() }).optional(),
  /** Select the new root and scroll it into view. */
  reveal: z.boolean().optional(),
});
export type RenderParams = z.infer<typeof RenderParams>;

export const RenderResult = z.object({
  rootId: z.string(),
  nodeCount: z.number(),
  /** Every node that carried a `key`, so later patches can address it. */
  keys: z.record(z.string(), z.string()),
});
export type RenderResult = z.infer<typeof RenderResult>;

/** A node already in the file: by the key `render` wrote, or by Figma's own id. */
export const Target = z.union([z.object({ key: z.string() }), z.object({ id: z.string() })]);
export type Target = z.infer<typeof Target>;

export const PatchOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), target: Target, props: NodeProps }),
  z.object({
    op: z.literal("append"),
    target: Target,
    tree: UINode,
    /** Position among the existing children; appended last by default. */
    index: z.number().int().nonnegative().optional(),
  }),
  z.object({ op: z.literal("replace"), target: Target, tree: UINode }),
  z.object({ op: z.literal("remove"), target: Target }),
  z.object({
    op: z.literal("move"),
    target: Target,
    /** Defaults to the node's current parent. */
    parent: Target.optional(),
    index: z.number().int().nonnegative().optional(),
  }),
]);
export type PatchOp = z.infer<typeof PatchOp>;

export const PatchParams = z.object({
  ops: z.array(PatchOp).min(1),
  reveal: z.boolean().optional(),
});
export type PatchParams = z.infer<typeof PatchParams>;

export const PatchResult = z.object({
  applied: z.number(),
  /** Keys of any nodes the patch created. */
  keys: z.record(z.string(), z.string()),
});
export type PatchResult = z.infer<typeof PatchResult>;

export const ScreenshotParams = z.object({
  /** Defaults to the current selection, or the page if nothing is selected. */
  target: Target.optional(),
  scale: z.number().min(0.1).max(4).optional(),
});
export type ScreenshotParams = z.infer<typeof ScreenshotParams>;

export const ScreenshotResult = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
  /** base64 PNG. */
  png: z.string(),
});
export type ScreenshotResult = z.infer<typeof ScreenshotResult>;

export const NodeKind = z.enum([
  "frame",
  "text",
  "rect",
  "ellipse",
  "instance",
  "component",
  "group",
  "vector",
  "any",
]);

export const FindParams = z.object({
  /** Case-insensitive substring of the layer name. */
  name: z.string().optional(),
  kind: NodeKind.optional(),
  /** A key written by render or patch. */
  key: z.string().optional(),
  /** "document" loads every page first, which can be slow in a large file. */
  scope: z.enum(["page", "document"]).optional(),
  /** Select the matches in Figma and scroll them into view. */
  select: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export type FindParams = z.infer<typeof FindParams>;

export const FindResult = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      page: z.string(),
      key: z.string().optional(),
    }),
  ),
  truncated: z.boolean(),
});
export type FindResult = z.infer<typeof FindResult>;

export const PagesParams = z.object({
  /** Page id or exact name to switch to. */
  select: z.string().optional(),
});
export type PagesParams = z.infer<typeof PagesParams>;

export const PagesResult = z.object({
  pages: z.array(z.object({ id: z.string(), name: z.string(), current: z.boolean() })),
});
export type PagesResult = z.infer<typeof PagesResult>;

export const ExecParams = z.object({ code: z.string() });
export type ExecParams = z.infer<typeof ExecParams>;

export const ExecResult = z.object({ result: z.string() });
export type ExecResult = z.infer<typeof ExecResult>;

const TokenValue = z.union([z.string(), z.number(), z.boolean()]);

export const StyleDefs = z.object({
  paint: z.array(z.object({ name: z.string(), fill: Fill })).optional(),
  text: z
    .array(
      z.object({
        name: z.string(),
        font: z.object({ family: z.string(), style: z.string().optional() }),
        size: z.number().positive(),
        lineHeight: z.union([z.number().positive(), z.literal("auto")]).optional(),
        letterSpacing: z.number().optional(),
      }),
    )
    .optional(),
  effect: z.array(z.object({ name: z.string(), effects: z.array(Effect) })).optional(),
});
export type StyleDefs = z.infer<typeof StyleDefs>;

export const DefineParams = z.object({
  collection: z.string().optional(),
  styles: StyleDefs.optional(),
  /** Modes to create or reuse, in order. Defaults to the collection's first mode. */
  modes: z.array(z.string()).optional(),
  variables: z
    .array(
      z.object({
        /** Without the "$", e.g. "color/primary". */
        name: z.string(),
        type: z.enum(["color", "number", "string", "boolean"]),
        /** One value, or one per mode name. A "$ref" value becomes an alias. */
        value: z.union([TokenValue, z.record(z.string(), TokenValue)]),
      }),
    )
    .optional(),
});
export type DefineParams = z.infer<typeof DefineParams>;

export const DefineResult = z.object({
  collection: z.string().optional(),
  /** The modes the collection ended up with; a plan may cap how many it allows. */
  modes: z.array(z.string()),
  styles: z.array(z.string()),
  created: z.array(z.string()),
  updated: z.array(z.string()),
  /** What the file would not let us do, rather than failing the whole call. */
  notes: z.array(z.string()),
});
export type DefineResult = z.infer<typeof DefineResult>;

export const TokensParams = z.object({});
export type TokensParams = z.infer<typeof TokensParams>;

const VariableValue = z.union([z.string(), z.number(), z.boolean()]);

export const TokensResult = z.object({
  collections: z.array(
    z.object({
      name: z.string(),
      modes: z.array(z.string()),
      variables: z.array(
        z.object({
          /** The name a tree refers to, e.g. "$color/primary". */
          ref: z.string(),
          type: z.string(),
          /** Value per mode name; an alias reads as another "$ref". */
          values: z.record(z.string(), VariableValue),
        }),
      ),
    }),
  ),
  styles: z.object({
    paint: z.array(z.object({ ref: z.string(), fill: z.string().optional() })),
    text: z.array(z.object({ ref: z.string(), font: z.string(), size: z.number().optional() })),
    effect: z.array(z.object({ ref: z.string() })),
  }),
});
export type TokensResult = z.infer<typeof TokensResult>;

export const ExportParams = z.object({
  targets: z.array(Target).min(1),
  format: z.enum(["png", "svg"]).optional(),
  scale: z.number().min(0.1).max(4).optional(),
  /** Directory the server writes into, relative to MIRRA_ROOT or its own. */
  outDir: z.string(),
});
export type ExportParams = z.infer<typeof ExportParams>;

export const ExportResult = z.object({
  assets: z.array(
    z.object({ id: z.string(), name: z.string(), extension: z.string(), data: z.string() }),
  ),
});
export type ExportResult = z.infer<typeof ExportResult>;

export const ReadParams = z.object({
  /** Defaults to the current selection. */
  nodeId: z.string().optional(),
  /** How many levels of children to walk. */
  depth: z.number().int().min(0).max(20).optional(),
});
export type ReadParams = z.infer<typeof ReadParams>;

export const ReadResult = z.object({
  nodes: z.array(z.object({ id: z.string(), tree: UINode })),
  /** Nodes left out because the DSL has no shape for them yet, or depth ran out. */
  skipped: z.number(),
});
export type ReadResult = z.infer<typeof ReadResult>;

export const PingResult = z.object({
  fileName: z.string(),
  fileKey: z.string().nullable(),
  currentPage: z.string(),
  selectionCount: z.number(),
});
export type PingResult = z.infer<typeof PingResult>;
