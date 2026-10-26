import type { PatchParams, PatchResult } from "@mirra/schema";
import {
  applyBounds,
  applyIdentity,
  KEY_FIELD,
  applyConstraints,
  applyProps,
  applyRotation,
  applySizing,
  buildNode,
  pin,
  type Deferred,
} from "../figma/build";
import { NodeIndex } from "../figma/target";

export async function patch(params: PatchParams): Promise<PatchResult> {
  const index = new NodeIndex();
  const keys: Record<string, string> = {};
  const touched: SceneNode[] = [];
  const deferred: Deferred = [];

  let failure: Error | null = null;
  let applied = 0;

  // Figma has no transaction to roll back, so a failure stops here, keeps what the
  // earlier ops did as one undo step, and says which op it was.
  try {
    for (const op of params.ops) {
      await run(op, index, keys, touched, deferred);
      applied += 1;
    }
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    const kept =
      applied === 0
        ? ""
        : ` The ${applied} op(s) before it were applied; Cmd+Z undoes them together.`;
    failure = new Error(
      `op ${applied + 1} of ${params.ops.length} (${params.ops[applied]?.op}) failed: ${cause}.${kept}`,
    );
  }

  for (const place of deferred) place();

  if (params.reveal) {
    const alive = touched.filter((node) => !node.removed);
    if (alive.length) {
      figma.currentPage.selection = alive;
      figma.viewport.scrollAndZoomIntoView(alive);
    }
  }

  // One Cmd+Z undoes the whole patch rather than each property in it.
  figma.commitUndo();

  if (failure) throw failure;
  return { applied, keys };
}

async function run(
  op: PatchParams["ops"][number],
  index: NodeIndex,
  keys: Record<string, string>,
  touched: SceneNode[],
  deferred: Deferred,
): Promise<void> {
  const node = await index.resolve(op.target);

  switch (op.op) {
    case "set": {
      const target = await applyIdentity(node, op.props, keys);
      if (target !== node) index.invalidate();
      await applyProps(target, op.props);
      applyBounds(target, op.props);
      applyConstraints(target, op.props);
      applySizing(target, op.props.w, "Horizontal");
      applySizing(target, op.props.h, "Vertical");
      applyRotation(target, op.props);
      if (op.props.at) deferred.push(() => pin(target, op.props.at));
      touched.push(target);
      break;
    }
    case "append": {
      const child = await buildNode(op.tree, asContainer(node), keys, undefined, deferred);
      if (op.index !== undefined) asContainer(node).insertChild(op.index, child);
      index.invalidate();
      touched.push(child);
      break;
    }
    case "replace": {
      const parent = node.parent;
      if (!parent || !("insertChild" in parent)) {
        throw new Error(`${node.name} has no parent to replace it in`);
      }
      const at = parent.children.indexOf(node);
      const created = await buildNode(op.tree, parent, keys, undefined, deferred);
      parent.insertChild(at, created);
      node.remove();
      index.invalidate();
      touched.push(created);
      break;
    }
    case "component": {
      // The node is consumed, so its key moves to the component that replaces it.
      const key = node.getPluginData(KEY_FIELD);
      const component = figma.createComponentFromNode(node);
      component.name = op.name ?? node.name;
      if (key) {
        component.setPluginData(KEY_FIELD, key);
        keys[key] = component.id;
      }
      index.invalidate();
      touched.push(component);
      break;
    }
    case "move": {
      const parent = op.parent ? await index.resolve(op.parent) : node.parent;
      if (!parent || !("insertChild" in parent)) {
        throw new Error(`${node.name} has nowhere to move to`);
      }
      const container = parent as BaseNode & ChildrenMixin;
      const at = op.index ?? container.children.length;
      container.insertChild(Math.min(at, container.children.length), node);
      index.invalidate();
      touched.push(node);
      break;
    }
    case "remove": {
      node.remove();
      index.invalidate();
      break;
    }
  }
}

function asContainer(node: SceneNode): BaseNode & ChildrenMixin {
  if (!("appendChild" in node)) {
    throw new Error(`A ${node.type.toLowerCase()} cannot contain children`);
  }
  return node as BaseNode & ChildrenMixin;
}
