import type { DefineParams, DefineResult } from "@mirra/schema";

type VariableSpec = NonNullable<DefineParams["variables"]>[number];
import { rgba, toEffects, toPaints } from "../figma/values";
import { fromRef, isRef, toRef } from "../figma/tokens";

const TYPES = {
  color: "COLOR",
  number: "FLOAT",
  string: "STRING",
  boolean: "BOOLEAN",
} as const;

export async function define(params: DefineParams): Promise<DefineResult> {
  if (figma.editorType === "figjam") {
    throw new Error("FigJam has no variables or styles to define. Open a Figma Design file.");
  }

  const styles = await defineStyles(params.styles);
  if (!params.collection) {
    return { modes: [], styles, created: [], updated: [], notes: [] };
  }

  const collection = await collectionNamed(params.collection);
  const notes = addModes(collection, params.modes ?? []);

  const existing = new Map(
    (await figma.variables.getLocalVariablesAsync())
      .filter((variable) => variable.variableCollectionId === collection.id)
      .map((variable) => [variable.name, variable]),
  );

  const created: string[] = [];
  const updated: string[] = [];

  for (const spec of params.variables ?? []) {
    let variable = existing.get(spec.name);
    if (variable) {
      updated.push(spec.name);
    } else {
      variable = figma.variables.createVariable(spec.name, collection, TYPES[spec.type]);
      existing.set(spec.name, variable);
      created.push(spec.name);
    }

    for (const mode of collection.modes) {
      const raw = perMode(spec.value, mode.name);
      if (raw === undefined) continue;
      variable.setValueForMode(mode.modeId, await toValue(raw, spec.type, existing));
    }
  }

  figma.commitUndo();
  return {
    collection: collection.name,
    modes: collection.modes.map((mode) => mode.name),
    styles,
    created,
    updated,
    notes,
  };
}

async function collectionNamed(name: string): Promise<VariableCollection> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  return (
    collections.find((candidate) => candidate.name === name) ??
    figma.variables.createVariableCollection(name)
  );
}

/** Figma caps modes per plan, so a refused mode is reported, not fatal. */
function addModes(collection: VariableCollection, modes: string[]): string[] {
  const notes: string[] = [];

  for (const [index, name] of modes.entries()) {
    const existing = collection.modes[index];
    if (existing) {
      if (existing.name !== name) collection.renameMode(existing.modeId, name);
      continue;
    }
    try {
      collection.addMode(name);
    } catch (error) {
      notes.push(`mode "${name}" not added: ${error instanceof Error ? error.message : error}`);
    }
  }

  return notes;
}

function perMode(
  value: VariableSpec["value"],
  mode: string,
): string | number | boolean | undefined {
  if (typeof value !== "object") return value;
  // A file with fewer modes than the caller expected still deserves a value.
  return value[mode] ?? value["default"] ?? Object.values(value)[0];
}

/** Styles are addressed by name, so an existing one is updated in place. */
async function defineStyles(defs: DefineParams["styles"]): Promise<string[]> {
  if (!defs) return [];
  const touched: string[] = [];

  for (const spec of defs.paint ?? []) {
    const style =
      (await figma.getLocalPaintStylesAsync()).find((candidate) => candidate.name === spec.name) ??
      figma.createPaintStyle();
    style.name = spec.name;
    style.paints = toPaints(spec.fill);
    touched.push(toRef(spec.name));
  }

  for (const spec of defs.text ?? []) {
    const style =
      (await figma.getLocalTextStylesAsync()).find((candidate) => candidate.name === spec.name) ??
      figma.createTextStyle();
    const font: FontName = { family: spec.font.family, style: spec.font.style ?? "Regular" };
    await figma.loadFontAsync(font);

    style.name = spec.name;
    style.fontName = font;
    style.fontSize = spec.size;
    if (spec.lineHeight !== undefined) {
      style.lineHeight =
        spec.lineHeight === "auto" ? { unit: "AUTO" } : { unit: "PIXELS", value: spec.lineHeight };
    }
    if (spec.letterSpacing !== undefined) {
      style.letterSpacing = { unit: "PIXELS", value: spec.letterSpacing };
    }
    touched.push(toRef(spec.name));
  }

  for (const spec of defs.effect ?? []) {
    const style =
      (await figma.getLocalEffectStylesAsync()).find((candidate) => candidate.name === spec.name) ??
      figma.createEffectStyle();
    style.name = spec.name;
    style.effects = toEffects(spec.effects);
    touched.push(toRef(spec.name));
  }

  return touched;
}

async function toValue(
  raw: string | number | boolean,
  type: VariableSpec["type"],
  known: Map<string, Variable>,
): Promise<VariableValue> {
  if (isRef(raw)) {
    const name = fromRef(raw as string);
    const target =
      known.get(name) ??
      (await figma.variables.getLocalVariablesAsync()).find((variable) => variable.name === name);
    if (!target) throw new Error(`No variable named "${name}" to alias`);
    return figma.variables.createVariableAlias(target);
  }

  if (type === "color") {
    if (typeof raw !== "string")
      throw new Error(`A colour variable needs a hex string, got ${raw}`);
    return rgba(raw);
  }
  return raw;
}
