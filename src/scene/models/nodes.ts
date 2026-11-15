// Transforms of named nodes relative to a model root (slots, mounts).
import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { SlotTransform } from '../layout';
import { parseSlotName } from './slots';

const inv = new Matrix4();
const rel = new Matrix4();

/** Transform of `node` in the coordinate system of `root` (root's own transform excluded). */
export function relativeTransform(root: Object3D, node: Object3D): SlotTransform {
  root.updateWorldMatrix(true, true);
  inv.copy(root.matrixWorld).invert();
  rel.multiplyMatrices(inv, node.matrixWorld);
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  rel.decompose(p, q, s);
  return { position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w], scale: [s.x, s.y, s.z] };
}

export function findNode(root: Object3D, name: string): Object3D | null {
  return root.getObjectByName(name) ?? null;
}

export function nodeTransform(root: Object3D, name: string): SlotTransform | null {
  const n = findNode(root, name);
  return n ? relativeTransform(root, n) : null;
}

/** All `slot_<dept>_<n>` nodes of a frame, in frame coordinates. */
export function collectSlots(root: Object3D): Map<string, SlotTransform> {
  const out = new Map<string, SlotTransform>();
  const found: Object3D[] = [];
  root.traverse((o) => { if (parseSlotName(o.name)) found.push(o); });
  for (const o of found) if (!out.has(o.name)) out.set(o.name, relativeTransform(root, o));
  return out;
}
