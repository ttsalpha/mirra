/**
 * A hand-rolled stand-in for the Figma sandbox, holding just enough of the API
 * that `buildNode` and `readNode` exercise. Test-only: no entry point imports it,
 * so it never reaches the plugin bundle.
 */

const MIXED = Symbol("figma.mixed");

/** What `loadFontAsync` has been asked for, since FigJam refuses writes to unloaded fonts. */
const loadedFonts = new Set<string>();

let nextId = 1;

class FakeNode {
  readonly type: string = "NODE";
  readonly id = `1:${nextId++}`;
  name = "Node";
  removed = false;
  parent: FakeFrame | FakePage | null = null;
  visible = true;
  opacity = 1;
  width = 100;
  height = 100;
  fills: unknown[] = [];
  strokes: unknown[] = [];
  strokeWeight: number = 1;
  strokeAlign = "INSIDE";
  effects: unknown[] = [];
  layoutSizingHorizontal: "FIXED" | "HUG" | "FILL" = "FIXED";
  minWidth: number | null = null;
  maxWidth: number | null = null;
  minHeight: number | null = null;
  maxHeight: number | null = null;
  layoutPositioning: "AUTO" | "ABSOLUTE" = "AUTO";
  constraints = { horizontal: "MIN", vertical: "MIN" };
  rotation = 0;
  boundVariables: Record<string, { type: string; id: string }> = {};
  layoutSizingVertical: "FIXED" | "HUG" | "FILL" = "FIXED";
  x = 0;
  y = 0;
  private readonly pluginData: Record<string, string> = {};

  getPluginData(key: string): string {
    return this.pluginData[key] ?? "";
  }

  setPluginData(key: string, value: string): void {
    this.pluginData[key] = value;
  }

  setBoundVariable(field: string, variable: { id: string }): void {
    this.boundVariables[field] = { type: "VARIABLE_ALIAS", id: variable.id };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  remove(): void {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
    this.removed = true;
  }

  async exportAsync(settings?: { format?: string }): Promise<Uint8Array | string> {
    if (settings?.format === "SVG_STRING") return `<svg data-name="${this.name}" />`;
    return new Uint8Array([137, 80, 78, 71]);
  }
}

class FakeCorners extends FakeNode {
  topLeftRadius = 0;
  topRightRadius = 0;
  bottomRightRadius = 0;
  bottomLeftRadius = 0;
}

class FakeFrame extends FakeCorners {
  readonly type = "FRAME";
  name = "Frame";
  // Figma hands every new frame an opaque white fill.
  fills: unknown[] = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
  children: FakeNode[] = [];
  layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL" = "NONE";
  itemSpacing = 0;
  paddingTop = 0;
  paddingRight = 0;
  paddingBottom = 0;
  paddingLeft = 0;
  primaryAxisAlignItems = "MIN";
  counterAxisAlignItems = "MIN";
  layoutWrap: "WRAP" | "NO_WRAP" = "NO_WRAP";
  clipsContent = true;

  appendChild(child: FakeNode): void {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    this.children.push(child);
    child.parent = this;
  }

  insertChild(index: number, child: FakeNode): void {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    this.children.splice(index, 0, child);
    child.parent = this;
  }
}

class FakeRectangle extends FakeCorners {
  readonly type = "RECTANGLE";
  name = "Rectangle";
}

class FakeEllipse extends FakeNode {
  readonly type = "ELLIPSE";
  name = "Ellipse";
  cornerRadius: number = 0;
}

class FakeGroup extends FakeNode {
  readonly type = "GROUP";
  name = "Group";
  children: FakeNode[] = [];

  appendChild(child: FakeNode): void {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    this.children.push(child);
    child.parent = this as unknown as FakeFrame;
  }
}

class FakeVector extends FakeNode {
  readonly type = "VECTOR";
  name = "Vector";
}

/** A type the DSL has no shape for, and no way to export either. */
class FakeSlice extends FakeNode {
  readonly type = "SLICE";
  name = "Slice";
}

class FakeComponent extends FakeNode {
  readonly type = "COMPONENT";
  name = "Component";
  children: FakeNode[] = [];

  createInstance(): FakeInstance {
    const instance = new FakeInstance();
    instance.name = this.name;
    return instance;
  }
}

class FakeInstance extends FakeNode {
  readonly type = "INSTANCE";
  name = "Instance";
  // Figma names component properties with an id suffix, and so does this.
  componentProperties: Record<string, { type: string; value: string | boolean }> = {
    "Label#1:1": { type: "TEXT", value: "Button" },
    "Disabled#1:2": { type: "BOOLEAN", value: false },
  };

  swapComponent(component: FakeComponent): void {
    this.name = component.name;
  }

  setProperties(properties: Record<string, string | boolean>): void {
    for (const [name, value] of Object.entries(properties)) {
      if (!(name in this.componentProperties)) {
        throw new Error(
          `in setProperties: Could not find a component property with name: '${name}'`,
        );
      }
      this.componentProperties[name] = {
        type: typeof value === "boolean" ? "BOOLEAN" : "TEXT",
        value,
      };
    }
  }
}

class FakeSvgFrame extends FakeFrame {
  name = "SVG";
}

class FakeText extends FakeNode {
  readonly type = "TEXT";
  name = "Text";
  characters = "";
  fontName: unknown = { family: "Inter", style: "Regular" };
  fontSize: unknown = 16;
  lineHeight: unknown = { unit: "AUTO" };
  letterSpacing: unknown = { unit: "PIXELS", value: 0 };
  textAlignHorizontal = "LEFT";
  textStyleId: string = "";

  async setTextStyleIdAsync(id: string): Promise<void> {
    this.textStyleId = id;
  }
}

/** The text layer FigJam nodes carry, which has no alignment or line height. */
class FakeSublayer {
  characters = "";
  #font = { family: "Inter", style: "Medium" };
  // FigJam reports no family for the layer as a whole, though the glyphs have one.
  get fontName(): unknown {
    return { family: "", style: "" };
  }
  set fontName(font: { family: string; style: string }) {
    this.#font = font;
  }
  getRangeFontName(): unknown {
    return this.#font;
  }
  fontSize: unknown = 16;
  letterSpacing: unknown = { unit: "PIXELS", value: 0 };
  fills: unknown[] = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
}

class FakeSticky extends FakeNode {
  readonly type = "STICKY";
  name = "Sticky";
  width = 240;
  height = 240;
  text = new FakeSublayer();
  isWideWidth = false;
  authorVisible = false;
  fills: unknown[] = [{ type: "SOLID", color: { r: 1, g: 0.79, b: 0.26 }, opacity: 1 }];
}

class FakeShape extends FakeNode {
  readonly type = "SHAPE_WITH_TEXT";
  name = "Shape";
  width = 208;
  height = 208;
  shapeType = "SQUARE";
  text = new FakeSublayer();
}

class FakeConnector extends FakeNode {
  readonly type = "CONNECTOR";
  name = "Connector";
  text = new FakeSublayer();
  #line = "ELBOWED";
  #start: unknown = { position: { x: 0, y: 0 } };
  #end: unknown = { position: { x: 200, y: 0 } };

  // FigJam only lets a straight line sit on the centre magnet.
  #check(line: string, end: unknown, what: string): void {
    const magnet = (end as { magnet?: string }).magnet;
    if (line === "STRAIGHT" && magnet && magnet !== "CENTER" && magnet !== "NONE") {
      throw new Error(
        `in set_${what}: Straight connector endpoints may only use the CENTER or NONE magnets.`,
      );
    }
  }

  get connectorLineType(): string {
    return this.#line;
  }
  set connectorLineType(line: string) {
    this.#check(line, this.#start, "connectorStart");
    this.#check(line, this.#end, "connectorEnd");
    this.#line = line;
  }
  get connectorStart(): unknown {
    return this.#start;
  }
  set connectorStart(end: unknown) {
    this.#check(this.#line, end, "connectorStart");
    this.#start = end;
  }
  get connectorEnd(): unknown {
    return this.#end;
  }
  set connectorEnd(end: unknown) {
    this.#check(this.#line, end, "connectorEnd");
    this.#end = end;
  }
  connectorStartStrokeCap = "NONE";
  connectorEndStrokeCap = "ARROW_EQUILATERAL";
}

class FakeMedia extends FakeNode {
  readonly type = "MEDIA";
  name = "GIF";
  mediaData: { hash: string };

  constructor(hash: string) {
    super();
    this.mediaData = { hash };
  }
}

class FakeCodeBlock extends FakeNode {
  readonly type = "CODE_BLOCK";
  name = "Code";
  #code = "";

  get code(): string {
    return this.#code;
  }
  set code(value: string) {
    if (!loadedFonts.has("Source Code Pro Medium")) {
      throw new Error(
        'in set_code: Cannot write to node with unloaded font "Source Code Pro Medium".',
      );
    }
    this.#code = value;
  }
  codeLanguage = "PLAINTEXT";
}

/** Shows up when a page is walked, but has no name or plugin data, like FigJam's. */
class FakeCell {
  readonly type = "TABLE_CELL";
  text = new FakeSublayer();
  fills: unknown[] = [];
  width = 120;
  height = 40;
}

class FakeTable extends FakeNode {
  readonly type = "TABLE";
  name = "Table";
  cells: FakeCell[][];

  constructor(rows: number, columns: number) {
    super();
    this.cells = Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => new FakeCell()),
    );
    // As in FigJam: a fill set on the table lands on its cells, and reads back as something else.
    Object.defineProperty(this, "fills", {
      get: () => [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.1 }],
      set: (paints: unknown[]) => this.cells.flat().forEach((cell) => (cell.fills = paints)),
    });
  }

  get children(): FakeCell[] {
    return this.cells.flat();
  }

  get numRows(): number {
    return this.cells.length;
  }

  get numColumns(): number {
    return this.cells[0]?.length ?? 0;
  }

  cellAt(row: number, column: number): FakeCell {
    const cell = this.cells[row]?.[column];
    if (!cell) throw new Error(`No cell at ${row}, ${column}`);
    return cell;
  }

  insertRow(at: number): void {
    this.cells.splice(
      at,
      0,
      Array.from({ length: this.numColumns }, () => new FakeCell()),
    );
  }

  removeRow(at: number): void {
    this.cells.splice(at, 1);
  }

  insertColumn(at: number): void {
    for (const row of this.cells) row.splice(at, 0, new FakeCell());
  }

  removeColumn(at: number): void {
    for (const row of this.cells) row.splice(at, 1);
  }

  resizeColumn(column: number, width: number): void {
    for (const row of this.cells) {
      const cell = row[column];
      if (cell) cell.width = width;
    }
  }

  resizeRow(row: number, height: number): void {
    for (const cell of this.cells[row] ?? []) cell.height = height;
  }
}

class FakeSection extends FakeNode {
  readonly type = "SECTION";
  name = "Section";
  width = 640;
  height = 640;
  fills: unknown[] = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
  cornerRadius = 0;
  children: FakeNode[] = [];

  appendChild(child: FakeNode): void {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    this.children.push(child);
    child.parent = this as unknown as FakeFrame;
  }

  insertChild(index: number, child: FakeNode): void {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    this.children.splice(index, 0, child);
    child.parent = this as unknown as FakeFrame;
  }

  resizeWithoutConstraints(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }
}

class FakePage {
  readonly type = "PAGE";
  readonly id = "0:1";
  name = "Page 1";
  children: FakeNode[] = [];
  selection: FakeNode[] = [];

  appendChild(child: FakeNode): void {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    this.children.push(child);
    child.parent = this;
  }

  insertChild(index: number, child: FakeNode): void {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    this.children.splice(index, 0, child);
    child.parent = this;
  }

  findAll(predicate: (node: FakeNode) => boolean): FakeNode[] {
    const found: FakeNode[] = [];
    const walk = (node: FakeNode | FakePage) => {
      if (node !== this && predicate(node as FakeNode)) found.push(node as FakeNode);
      if ("children" in node) (node.children as FakeNode[]).forEach(walk);
    };
    walk(this);
    return found;
  }

  findOne(predicate: (node: FakeNode) => boolean): FakeNode | null {
    return this.findAll(predicate)[0] ?? null;
  }

  findAllWithCriteria({
    pluginData,
    types,
  }: {
    pluginData?: { keys?: string[] };
    types?: string[];
  }): FakeNode[] {
    const found: FakeNode[] = [];
    const walk = (node: FakeNode | FakePage) => {
      if (node instanceof FakeNode) {
        const byType = types ? types.includes(node.type) : true;
        const byData = pluginData?.keys
          ? pluginData.keys.some((key) => node.getPluginData(key))
          : true;
        if (byType && byData) found.push(node);
      }
      if ("children" in node) node.children.forEach(walk);
    };
    walk(this);
    return found;
  }
}

type FakeVariable = {
  id: string;
  name: string;
  resolvedType: string;
  variableCollectionId: string;
  valuesByMode: Record<string, unknown>;
  setValueForMode?: (modeId: string, value: unknown) => void;
};

type FakeTextStyle = { id: string; name: string; fontName: FontName; fontSize: number };

export type FakeFigma = {
  /** "figjam" turns off what FigJam lacks, the way the real editor does. */
  editorType: "figma" | "figjam";
  page: FakePage;
  pages: FakePage[];
  current: FakePage;
  undoCommits: number;
  variables: FakeVariable[];
  collections: {
    id: string;
    name: string;
    modes: { modeId: string; name: string }[];
    addMode?: (name: string) => void;
    renameMode?: (modeId: string, name: string) => void;
  }[];
  textStyles: FakeTextStyle[];
  paintStyles: { id: string; name: string; paints: unknown[] }[];
  addComponent(name: string): void;
  /** Cast at the call site: the node classes stay private to this file. */
  addGroup(name: string): unknown;
  addVector(name: string): unknown;
  addSlice(name: string): unknown;
  addVariable(name: string, type?: string): FakeVariable;
};

/** Installs the fake on `globalThis` and hands back the page everything lands on. */
export function installFakeFigma(): FakeFigma {
  nextId = 1;
  loadedFonts.clear();
  const page = new FakePage();
  const state: FakeFigma = {
    editorType: "figma",
    page,
    pages: [page],
    current: page,
    undoCommits: 0,
    variables: [],
    collections: [],
    textStyles: [],
    paintStyles: [],
    addComponent: (name: string) => {
      const component = new FakeComponent();
      component.name = name;
      page.appendChild(component);
    },
    addGroup: (name: string) => {
      const group = new FakeGroup();
      group.name = name;
      page.appendChild(group);
      return group;
    },
    addVector: (name: string) => {
      const vector = new FakeVector();
      vector.name = name;
      page.appendChild(vector);
      return vector;
    },
    addSlice: (name: string) => {
      const slice = new FakeSlice();
      slice.name = name;
      page.appendChild(slice);
      return slice;
    },
    addVariable: (name: string, type = "FLOAT") => {
      const variable = {
        id: `v${state.variables.length + 1}`,
        name,
        resolvedType: type,
        variableCollectionId: "c1",
        valuesByMode: {} as Record<string, unknown>,
      };
      state.variables.push(variable);
      return variable;
    },
  };

  const nodesById = () => {
    const found = new Map<string, FakeNode>();
    const walk = (node: FakeNode | FakePage) => {
      if (node instanceof FakeNode) found.set(node.id, node);
      if ("children" in node) node.children.forEach(walk);
    };
    walk(page);
    return found;
  };

  const track = <T extends FakeNode>(node: T): T => node;

  (globalThis as Record<string, unknown>)["figma"] = {
    mixed: MIXED,
    get editorType() {
      return state.editorType;
    },
    get currentPage() {
      return state.current;
    },
    root: {
      name: "Test file",
      get children() {
        return state.pages;
      },
    },
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView: () => {} },
    createFrame: () => {
      if (state.editorType === "figjam")
        throw new Error("figma.createFrame is not available in FigJam");
      return track(new FakeFrame());
    },
    createSticky: () => track(new FakeSticky()),
    createShapeWithText: () => track(new FakeShape()),
    createConnector: () => track(new FakeConnector()),
    createCodeBlock: () => track(new FakeCodeBlock()),
    createGif: (hash: string) => track(new FakeMedia(hash)),
    createSection: () => track(new FakeSection()),
    createTable: (rows = 2, columns = 2) => track(new FakeTable(rows, columns)),
    createLinkPreviewAsync: async (url: string) => {
      const embed = new FakeNode() as FakeNode & Record<string, unknown>;
      Object.defineProperty(embed, "type", { value: "LINK_UNFURL" });
      embed["linkUnfurlData"] = { url, title: null, description: null, provider: null };
      return track(embed);
    },
    createPage: () => {
      const page = new FakePage();
      page.name = "Page";
      state.pages.push(page);
      return page;
    },
    setCurrentPageAsync: async (page: FakePage) => {
      state.current = page;
    },
    createComponentFromNode: (node: FakeNode) => {
      const component = new FakeComponent();
      component.name = node.name;
      node.parent?.appendChild(component);
      node.remove();
      return track(component);
    },
    createNodeFromSvg: (markup: string) => {
      const frame = new FakeSvgFrame();
      frame.name = markup.includes("<circle") ? "Circle" : "SVG";
      return track(frame);
    },
    createImage: (bytes: Uint8Array) => ({
      hash: `img-${bytes.length}`,
      getSizeAsync: async () => ({ width: 64, height: 64 }),
    }),
    base64Decode: (data: string) => new Uint8Array(Buffer.from(data, "base64")),
    createRectangle: () => track(new FakeRectangle()),
    createEllipse: () => track(new FakeEllipse()),
    createText: () => track(new FakeText()),
    loadFontAsync: async (font: { family: string; style: string }) => {
      if (!font.family) throw new Error(`Cannot load font family "": family is not available`);
      loadedFonts.add(`${font.family} ${font.style}`);
    },
    getNodeByIdAsync: async (id: string) => nodesById().get(id) ?? null,
    loadAllPagesAsync: async () => {},
    commitUndo: () => {
      state.undoCommits += 1;
    },
    base64Encode: (bytes: Uint8Array) => Buffer.from(bytes).toString("base64"),
    getLocalTextStylesAsync: async () => state.textStyles,
    getLocalPaintStylesAsync: async () => state.paintStyles,
    getLocalEffectStylesAsync: async () => [],
    variables: {
      getLocalVariablesAsync: async () => state.variables,
      getLocalVariableCollectionsAsync: async () => state.collections,
      createVariableCollection: (name: string) => {
        const collection = {
          id: `c${state.collections.length + 1}`,
          name,
          modes: [{ modeId: "m1", name: "Mode 1" }],
          addMode(modeName: string) {
            this.modes.push({ modeId: `m${this.modes.length + 1}`, name: modeName });
          },
          renameMode(modeId: string, modeName: string) {
            const mode = this.modes.find((candidate) => candidate.modeId === modeId);
            if (mode) mode.name = modeName;
          },
        };
        state.collections.push(collection);
        return collection;
      },
      createVariable: (name: string, collection: { id: string }, type: string) => {
        const variable = {
          id: `v${state.variables.length + 1}`,
          name,
          resolvedType: type,
          variableCollectionId: collection.id,
          valuesByMode: {} as Record<string, unknown>,
          setValueForMode(modeId: string, value: unknown) {
            this.valuesByMode[modeId] = value;
          },
        };
        state.variables.push(variable);
        return variable;
      },
      createVariableAlias: (variable: { id: string }) => ({
        type: "VARIABLE_ALIAS",
        id: variable.id,
      }),
      setBoundVariableForPaint: (paint: SolidPaint, field: string, variable: FakeVariable) => ({
        ...paint,
        boundVariables: { [field]: { type: "VARIABLE_ALIAS", id: variable.id } },
      }),
    },
  };

  return state;
}
