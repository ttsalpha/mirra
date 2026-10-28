import type { TokensResult } from "@mirra/schema";

/** "color/primary" in Figma is "$color/primary" in a tree. */
export function toRef(name: string): string {
  return `$${name}`;
}

export function fromRef(ref: string): string {
  return ref.startsWith("$") ? ref.slice(1) : ref;
}

export function isRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("$");
}

export function inFigJam(): boolean {
  return figma.editorType === "figjam";
}

function requireDesign(what: string): void {
  if (inFigJam()) throw new Error(`FigJam has no variables or styles, so ${what} cannot be used`);
}

/** Resolves "$name" references to the variables and styles of the open file. */
export class TokenIndex {
  #variables: Map<string, Variable> | null = null;
  #textStyles: Map<string, TextStyle> | null = null;

  async variable(ref: string): Promise<Variable> {
    requireDesign(`the variable "${ref}"`);
    if (!this.#variables) {
      const all = await figma.variables.getLocalVariablesAsync();
      this.#variables = new Map(all.map((variable) => [variable.name, variable]));
    }
    const found = this.#variables.get(fromRef(ref));
    if (!found) throw new Error(`No variable named "${fromRef(ref)}" in this file`);
    return found;
  }

  async textStyle(ref: string): Promise<TextStyle> {
    requireDesign(`the text style "${ref}"`);
    if (!this.#textStyles) {
      const all = await figma.getLocalTextStylesAsync();
      this.#textStyles = new Map(all.map((style) => [style.name, style]));
    }
    const found = this.#textStyles.get(fromRef(ref));
    if (!found) throw new Error(`No text style named "${fromRef(ref)}" in this file`);
    return found;
  }
}

/** Reverse direction: ids back to the "$name" a tree can refer to. */
export type NameIndex = {
  variable(id: string): string | undefined;
  style(id: string): string | undefined;
};

export const EMPTY_NAMES: NameIndex = { variable: () => undefined, style: () => undefined };

export async function buildNameIndex(): Promise<NameIndex> {
  if (inFigJam()) return EMPTY_NAMES;

  const variables = new Map<string, string>();
  const styles = new Map<string, string>();

  for (const variable of await figma.variables.getLocalVariablesAsync()) {
    variables.set(variable.id, toRef(variable.name));
  }
  for (const style of await figma.getLocalTextStylesAsync()) {
    styles.set(style.id, toRef(style.name));
  }

  return { variable: (id) => variables.get(id), style: (id) => styles.get(id) };
}

export async function readTokens(): Promise<TokensResult> {
  if (inFigJam()) {
    return { collections: [], styles: { paint: [], text: [], effect: [] } };
  }

  const variables = await figma.variables.getLocalVariablesAsync();
  const byId = new Map(variables.map((variable) => [variable.id, variable]));
  const collections = await figma.variables.getLocalVariableCollectionsAsync();

  return {
    collections: collections.map((collection) => ({
      name: collection.name,
      modes: collection.modes.map((mode) => mode.name),
      variables: variables
        .filter((variable) => variable.variableCollectionId === collection.id)
        .map((variable) => ({
          ref: toRef(variable.name),
          type: variable.resolvedType,
          values: valuesByMode(variable, collection, byId),
        })),
    })),
    styles: {
      paint: (await figma.getLocalPaintStylesAsync()).map((style) => ({
        ref: toRef(style.name),
        ...(solidHex(style.paints) ? { fill: solidHex(style.paints) } : {}),
      })),
      text: (await figma.getLocalTextStylesAsync()).map((style) => ({
        ref: toRef(style.name),
        font: `${style.fontName.family} ${style.fontName.style}`,
        size: style.fontSize,
      })),
      effect: (await figma.getLocalEffectStylesAsync()).map((style) => ({
        ref: toRef(style.name),
      })),
    },
  };
}

function valuesByMode(
  variable: Variable,
  collection: VariableCollection,
  byId: Map<string, Variable>,
): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};

  for (const mode of collection.modes) {
    const raw = variable.valuesByMode[mode.modeId];
    if (raw === undefined) continue;

    if (typeof raw === "object" && "type" in raw && raw.type === "VARIABLE_ALIAS") {
      const alias = byId.get(raw.id);
      values[mode.name] = alias ? toRef(alias.name) : `$unknown:${raw.id}`;
    } else if (typeof raw === "object" && "r" in raw) {
      values[mode.name] = hex(raw);
    } else {
      values[mode.name] = raw as string | number | boolean;
    }
  }

  return values;
}

function solidHex(paints: readonly Paint[]): string | undefined {
  const paint = paints[0];
  return paint && paint.type === "SOLID"
    ? hex({ ...paint.color, a: paint.opacity ?? 1 })
    : undefined;
}

function hex({ r, g, b, a = 1 }: RGB & { a?: number }): string {
  const channel = (value: number) =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  const rgb = `#${channel(r)}${channel(g)}${channel(b)}`;
  return a >= 1 ? rgb : `${rgb}${channel(a)}`;
}
