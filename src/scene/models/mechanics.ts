// Runtime for procedural mechanics on a cloned model: drives pivot_* rotations / slides and fx_glow pulses.
import { Mesh, Quaternion, Vector3, type Material, type Object3D } from 'three';
import { mechanicsFor, motionValue, type Axis, type Motion } from './mechanicsRules';
import { markOwnMaterial } from './toon';

const AXIS: Record<Axis, Vector3> = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };
const tmpQ = new Quaternion();

type Driver = (t: number, reduced: boolean) => void;

type Emissive = Material & { emissiveIntensity: number };
const hasEmissive = (m: Material): m is Emissive => 'emissiveIntensity' in m;

function glowMeshes(fx: Object3D): Mesh[] {
  // fx_glow is an empty next to (or inside) the glowing mesh: take emissive meshes among the parent's subtree.
  const parent = fx.parent ?? fx;
  const out: Mesh[] = [];
  parent.traverse((o) => {
    if (!(o instanceof Mesh) || o.userData.inkOutline) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m.name === 'M_Emissive' || (hasEmissive(m) && 'emissive' in m && (m as { emissive: { getHex(): number } }).emissive.getHex() !== 0))) out.push(o);
  });
  return out;
}

export interface Mechanics {
  count: number;
  update(dt: number, reducedMotion: boolean): void;
}

export function createMechanics(root: Object3D, modelId?: string): Mechanics {
  const names: string[] = [];
  root.traverse((o) => { if (o.name) names.push(o.name); });
  const drivers: Driver[] = [];
  for (const { node, motion } of mechanicsFor(new Set(names), modelId)) {
    root.traverse((o) => {
      if (o.name !== node) return;
      // Rest pose for scenes that take a pivot over (flight: arm reach, lid, chute) — see holdMechanics().
      o.userData.restQuaternion ??= o.quaternion.clone();
      o.userData.restPosition ??= o.position.clone();
      const d = makeDriver(o, motion);
      drivers.push((t, reduced) => { if (!o.userData.mechHold) d(t, reduced); });
    });
  }
  let t = 0;
  return {
    count: drivers.length,
    update(dt, reduced) {
      t += Math.min(dt, 0.1);
      for (const d of drivers) d(t, reduced);
    },
  };
}

/**
 * Flight scenes drive some pivots themselves (robotic arm reach, container lid, parachute canopy, beacon):
 * `hold` stops the procedural driver for that node (it keeps its last pose); the rest pose is in
 * userData.restQuaternion / restPosition (captured before the first driver ran).
 */
export function holdMechanics(node: Object3D, hold = true): void {
  node.userData.mechHold = hold;
  node.userData.restQuaternion ??= node.quaternion.clone();
  node.userData.restPosition ??= node.position.clone();
}

/** Per-instance emissive materials so one instance's glow/blink does not leak into other clones. */
function ownGlow(meshes: Mesh[]) {
  return meshes.map((mesh) => {
    const own = (mesh.material as Material).clone();
    mesh.material = own;
    markOwnMaterial(mesh);
    return { mat: own as Emissive, base: hasEmissive(own) ? own.emissiveIntensity || 1 : 1 };
  }).filter((x) => hasEmissive(x.mat));
}

function makeDriver(o: Object3D, m: Motion): Driver {
  if (m.kind === 'scale') {
    return () => { o.scale.setScalar(m.value); };
  }
  if (m.kind === 'blink') {
    const own: Mesh[] = [];
    o.traverse((c) => { if (c instanceof Mesh && !c.userData.inkOutline && !Array.isArray(c.material)) own.push(c); });
    // led_* are the lamps themselves; an fx_* empty (beacon) blinks the emissive meshes next to it.
    const items = ownGlow(own.length ? own : glowMeshes(o));
    return (t, reduced) => {
      const k = motionValue(m, t, reduced);
      for (const { mat, base } of items) mat.emissiveIntensity = base * k;
    };
  }
  if (m.kind === 'pulse') {
    const items = ownGlow(glowMeshes(o));
    return (t, reduced) => {
      const k = motionValue(m, t, reduced);
      for (const { mat, base } of items) mat.emissiveIntensity = base * k;
    };
  }
  if (m.kind === 'slide') {
    const rest = o.position.clone();
    const axis = AXIS[m.axis];
    return (t, reduced) => { o.position.copy(rest).addScaledVector(axis, motionValue(m, t, reduced)); };
  }
  const rest = o.quaternion.clone();
  const axis = AXIS[m.axis];
  return (t, reduced) => {
    o.quaternion.copy(rest).multiply(tmpQ.setFromAxisAngle(axis, motionValue(m, t, reduced)));
  };
}
