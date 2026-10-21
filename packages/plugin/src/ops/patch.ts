import type { PatchParams, PatchResult } from "@mirra/schema";
import {
  applyBounds,
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

  for (const op of params.ops) {
    const node = await index.resolve(op.target);

    switch (op.op) {
      case "set": {
        await applyProps(node, op.props);
        applyBounds(node, op.props);
        applyConstraints(node, op.props);
        applySizing(node, op.props.w, "Horizontal");
        applySizing(node, op.props.h, "Vertical");
        applyRotation(node, op.props);
        if (op.props.at) deferred.push(() => pin(node, op.props.at));
        touched.push(node);
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

  return { applied: params.ops.length, keys };
}

function asContainer(node: SceneNode): BaseNode & ChildrenMixin {
  if (!("appendChild" in node)) {
    throw new Error(`A ${node.type.toLowerCase()} cannot contain children`);
  }
  return node as BaseNode & ChildrenMixin;
}
