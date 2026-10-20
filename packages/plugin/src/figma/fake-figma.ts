/**
 * A hand-rolled stand-in for the Figma sandbox, holding just enough of the API
 * that `buildNode` and `readNode` exercise. Test-only: no entry point imports it,
 * so it never reaches the plugin bundle.
 */

const MIXED = Symbol("figma.mixed");

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

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  remove(): void {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
    this.removed = true;
  }

  async exportAsync(): Promise<Uint8Array> {
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

class FakeComponent extends FakeNode {
  readonly type = "COMPONENT";
  name = "Component";

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
      if (node instanceof FakeNode && predicate(node)) found.push(node);
      if ("children" in node) node.children.forEach(walk);
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
  page: FakePage;
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
};

/** Installs the fake on `globalThis` and hands back the page everything lands on. */
export function installFakeFigma(): FakeFigma {
  nextId = 1;
  const page = new FakePage();
  const state: FakeFigma = {
    page,
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
    currentPage: page,
    root: { name: "Test file" },
    viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView: () => {} },
    createFrame: () => track(new FakeFrame()),
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
    loadFontAsync: async () => {},
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
