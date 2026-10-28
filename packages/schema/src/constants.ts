/** Shared with the Figma plugin bundle, so this module must stay dependency-free. */

/** Bumped whenever the wire format changes incompatibly. */
export const PROTOCOL_VERSION = 1;

export const DEFAULT_PORT = 51730;
export const PORT_RANGE_END = 51739;

/** FigJam shape names as a tree writes them, mapped to the ones the plugin API uses. */
export const SHAPE_TYPES = {
  square: "SQUARE",
  ellipse: "ELLIPSE",
  "rounded-rect": "ROUNDED_RECTANGLE",
  diamond: "DIAMOND",
  "triangle-up": "TRIANGLE_UP",
  "triangle-down": "TRIANGLE_DOWN",
  "parallelogram-right": "PARALLELOGRAM_RIGHT",
  "parallelogram-left": "PARALLELOGRAM_LEFT",
  database: "ENG_DATABASE",
  queue: "ENG_QUEUE",
  file: "ENG_FILE",
  folder: "ENG_FOLDER",
  trapezoid: "TRAPEZOID",
  "predefined-process": "PREDEFINED_PROCESS",
  shield: "SHIELD",
  document: "DOCUMENT_SINGLE",
  documents: "DOCUMENT_MULTIPLE",
  "manual-input": "MANUAL_INPUT",
  hexagon: "HEXAGON",
  chevron: "CHEVRON",
  pentagon: "PENTAGON",
  octagon: "OCTAGON",
  star: "STAR",
  plus: "PLUS",
  "arrow-left": "ARROW_LEFT",
  "arrow-right": "ARROW_RIGHT",
  "summing-junction": "SUMMING_JUNCTION",
  or: "OR",
  "speech-bubble": "SPEECH_BUBBLE",
  "internal-storage": "INTERNAL_STORAGE",
} as const;

export const CONNECTOR_LINES = {
  straight: "STRAIGHT",
  elbow: "ELBOWED",
  curved: "CURVED",
} as const;

export const CONNECTOR_CAPS = {
  none: "NONE",
  arrow: "ARROW_EQUILATERAL",
  "arrow-lines": "ARROW_LINES",
  triangle: "TRIANGLE_FILLED",
  diamond: "DIAMOND_FILLED",
  circle: "CIRCLE_FILLED",
  "erd-zero-or-one": "ERD_ZERO_OR_ONE",
  "erd-one": "ERD_EXACTLY_ONE",
  "erd-zero-or-more": "ERD_ZERO_OR_MORE",
  "erd-one-or-more": "ERD_ONE_OR_MORE",
} as const;

export const MAGNETS = {
  none: "NONE",
  auto: "AUTO",
  top: "TOP",
  left: "LEFT",
  bottom: "BOTTOM",
  right: "RIGHT",
  center: "CENTER",
} as const;

/** The plugin API's own names are these, upper-cased. */
export const CODE_LANGUAGES = [
  "typescript",
  "javascript",
  "cpp",
  "ruby",
  "css",
  "html",
  "json",
  "graphql",
  "python",
  "go",
  "sql",
  "swift",
  "kotlin",
  "rust",
  "bash",
  "dart",
  "plaintext",
] as const;
