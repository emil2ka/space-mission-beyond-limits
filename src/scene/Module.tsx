// One installed module on a slot: real GLB if listed in the manifest, otherwise a coloured placeholder.
// The slot transform is in frame coordinates with local +Y = outward; the module is placed with an identity
// transform under it. Flies in along an arc when mounted (docs/05 Assets/Animations.md).
// Modules can carry attachments on their mount_* nodes (return capsule → heat shield, parachute, beacon).
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Box3, Mesh, Quaternion, Vector3, type Group, type Material, type Object3D } from 'three';
import type { ComponentDef, MissionId } from '../engine';
import { CAPSULE_MOUNT_DEFAULT, DEPT_COLOR, type FrameId, type SlotTransform } from './layout';
import { useComponentModel, useModelManifest } from './models/loader';
import { createMechanics } from './models/mechanics';
import { nodeTransform } from './models/nodes';
import { baseOverlayId, overlayModelId } from './models/slots';
import { applyVariant, isOwnMaterial, type Tint } from './models/toon';
import { ModulePlaceholder, OverlayPlaceholder } from './Placeholders';

export type Highlight = 'ok' | 'warn' | 'crit' | null;
const highlightColor = (h: Highlight | undefined) => (h === 'crit' ? '#FF5A6A' : h === 'warn' ? '#FF9A4A' : null);

export interface Attachment {
  key: string;
  def: ComponentDef;
  mount: string;
  highlight?: Highlight;
}

interface Props {
  def: ComponentDef;
  slot: SlotTransform;
  highlight?: Highlight;
  reducedMotion: boolean;
  attachments?: Attachment[];
  /** Flight: module switched off (dark, mechanics stop). */
  dim?: boolean;
  /** Flight: iced over. */
  frost?: boolean;
  /** The bay this module plugs into (hulls v2): decides whether it stands on the bay floor or on an adapter. */
  seat?: Seat | null;
}

/**
 * Bay seat (frame metres, along the slot's local X / Z). A module whose base fits the opening stands on the bay floor;
 * a wider one stands on an ADAPTER plugged into the bay, `lift` above the floor (rim top + clearance over cables / bumpers).
 * `cradle`: a tall module (the RTG) lies on its side, its axis along the slot's X (Titan's crosswise RTG saddle).
 */
export interface Seat { bay: [number, number]; lift: number; cradle?: boolean; color: string; /** Room around the bay: bigger modules are scaled down to it. */ maxFoot?: number }

/** Height of the base slice (module metres) that has to fit into the bay opening. */
const BASE_SLICE = 0.05;
const ADAPTER_PLAY = 0.03;
/** Titan RTG saddle: V-block tops are 0.09 above the slot. */
const CRADLE_LIFT = 0.1;

const UP = new Vector3(0, 1, 0);

export function Module({ def, slot, highlight, reducedMotion, attachments, dim = false, frost = false, seat }: Props) {
  const group = useRef<Group>(null);
  const t = useRef(reducedMotion ? 1 : 0);
  const model = useComponentModel(def.model ?? def.id);
  const mech = useMemo(() => (model ? createMechanics(model.scene, model.id) : null), [model]);
  const glow = highlightColor(highlight);
  const tint: Tint = dim ? 'dim' : frost ? 'frost' : null;
  useEffect(() => { if (model) applyVariant(model.scene, { highlight: glow, tint }); }, [model, glow, tint]);

  // Lying (cradle) pose and the bay fit, from the model's own box.
  const fit = useMemo(() => {
    if (!seat || !model) return { lift: 0, lie: null as null | { position: [number, number, number] }, foot: [0, 0] as [number, number], shrink: 1 };
    const b = modelBox(model.scene);
    const h = b.max.y - b.min.y, w = b.max.x - b.min.x, d = b.max.z - b.min.z;
    const k = slot.scale[0];
    // Not enough room around this bay (Titan's rear belly, between the gear struts): scale the module down to the room.
    const shrink = seat.maxFoot && Math.max(w, d) * k > seat.maxFoot ? seat.maxFoot / (Math.max(w, d) * k) : 1;
    // Rotation +90° about Z: module +Y → −X. Re-centre along X and put the side of the cylinder on the floor.
    const lie = seat.cradle && h > 1.2 * Math.max(w, d) ? { position: [(b.min.y + b.max.y) / 2, -b.min.x, -(b.min.z + b.max.z) / 2] as [number, number, number] } : null;
    const foot = baseFootprint(model.scene);
    // A lying module rests in the cradle's V-blocks (no adapter); anything else in the cradle stands on an adapter above the
    // V-blocks; elsewhere a module needs its base inside the opening, or it gets an adapter.
    if (lie) return { lift: 0, lie, foot, shrink };
    const ks = k * shrink;
    const fits = !seat.cradle && foot[0] * ks <= seat.bay[0] - 0.02 && foot[1] * ks <= seat.bay[1] - 0.02;
    return { lift: fits ? 0 : seat.cradle ? Math.max(seat.lift, CRADLE_LIFT) : seat.lift, lie, foot: [foot[0] * shrink, foot[1] * shrink] as [number, number], shrink };
  }, [seat, model, slot.scale]);

  const target = useMemo(() => {
    const q = new Quaternion(...slot.quaternion);
    const n = new Vector3(0, 1, 0).applyQuaternion(q);
    return { p: new Vector3(...slot.position).addScaledVector(n, fit.lift), q, n, s: new Vector3(...slot.scale) };
  }, [slot, fit.lift]);
  const shrink = fit.shrink;

  // Mount points: from the GLB's mount_* nodes, else the contract numbers (placeholder capsule).
  const mounts = useMemo(() => {
    const out = new Map<string, SlotTransform>();
    for (const a of attachments ?? []) {
      out.set(a.mount, (model && nodeTransform(model.scene, a.mount)) || CAPSULE_MOUNT_DEFAULT[a.mount] || CAPSULE_MOUNT_DEFAULT.mount_parachute);
    }
    return out;
  }, [attachments, model]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    if (t.current < 1) t.current = Math.min(1, t.current + dt / 0.6);
    const u = 1 - easeOutBack(t.current);
    // Arc: from outside the slot (along its normal) and above, settling onto the slot plate.
    g.position.copy(target.p).addScaledVector(target.n, u * 1.2).addScaledVector(UP, Math.max(u, 0) ** 2 * 1.8);
    g.quaternion.copy(target.q);
    g.scale.copy(target.s);
    if (dim) { if (model) darkenOwnGlow(model.scene); } else mech?.update(dt, reducedMotion);
  });

  return (
    <group ref={group} position={slot.position} name={`unit_${def.id}`}>
      {seat && fit.lift > 0 ? <Adapter seat={seat} lift={fit.lift} scale={slot.scale[0]} foot={fit.foot} /> : null}
      {model
        ? (fit.lie
          ? <group position={fit.lie.position} rotation={[0, 0, Math.PI / 2]}><primitive object={model.scene} /></group>
          : <group scale={shrink}><primitive object={model.scene} /></group>)
        : <ModulePlaceholder id={def.id} color={DEPT_COLOR[def.department]} emissive={glow ?? '#000000'} />}
      {attachments?.map((a) => (
        <Module key={a.key} def={a.def} slot={mounts.get(a.mount)!} highlight={a.highlight} reducedMotion={reducedMotion} dim={dim} frost={frost} />
      ))}
    </group>
  );
}

interface OverlayProps {
  id: string;
  mission: MissionId;
  frame: FrameId;
  highlight?: Highlight;
  reducedMotion: boolean;
  xray: boolean;
  /** Flight: mechanics speed multiplier (rotors spin down on landing). 1 = normal, 0 = hold pose. */
  speed?: number | (() => number);
  dim?: boolean;
  frost?: boolean;
}

/**
 * Overlay parts (rotors, landing gear, insulation, power bus, reinforced frame) sit at the frame origin.
 * Uses `<id>__<mission>` when the manifest has it (frame_asteroid variants), else the plain id, else a placeholder.
 */
export function Overlay({ id, mission, frame, highlight, reducedMotion, xray, speed = 1, dim = false, frost = false }: OverlayProps) {
  const manifest = useModelManifest();
  const modelId = overlayModelId(id, mission, manifest.ids);
  const model = useComponentModel(modelId);
  const mech = useMemo(() => (model ? createMechanics(model.scene, model.id) : null), [model]);
  const glow = highlightColor(highlight);
  const see = xray && baseOverlayId(id) === 'thermal_insulation';
  const tint: Tint = dim ? 'dim' : frost ? 'frost' : null;
  useEffect(() => { if (model) applyVariant(model.scene, { highlight: glow, xray: see, tint }); }, [model, glow, see, tint]);
  useFrame((_, dt) => {
    if (dim) { if (model) darkenOwnGlow(model.scene); return; }
    const k = typeof speed === 'function' ? speed() : speed;
    if (k > 0) mech?.update(dt * k, reducedMotion);
  });
  if (model) return <primitive object={model.scene} />;
  return <OverlayPlaceholder id={id} frame={frame} reducedMotion={reducedMotion} emissive={glow ?? '#000000'} xray={see} />;
}

/** Switched-off module: its per-instance glow materials (LEDs, beacons) go dark; shared ones use the 'dim' variant. */
function darkenOwnGlow(root: Object3D) {
  root.traverse((o) => {
    if (!(o instanceof Mesh) || o.userData.inkOutline || !isOwnMaterial(o)) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]) as Material[]) {
      if ('emissiveIntensity' in m) (m as Material & { emissiveIntensity: number }).emissiveIntensity = 0;
    }
  });
}

function easeOutBack(x: number) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

const footprintCache = new WeakMap<Object3D, [number, number]>();
/** X / Z extent of the module's base slice (y < BASE_SLICE), in module metres. */
function baseFootprint(root: Object3D): [number, number] {
  const hit = footprintCache.get(root);
  if (hit) return hit;
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const v = new Vector3();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  root.traverse((o) => {
    const pos = (o as Mesh).isMesh ? (o as Mesh).geometry.getAttribute('position') : null;
    if (!pos || o.userData.inkOutline) return;
    const m = o.matrixWorld.clone().premultiply(inv);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (v.y > BASE_SLICE) continue;
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
    }
  });
  const out: [number, number] = x1 > x0 ? [x1 - x0, z1 - z0] : [0, 0];
  footprintCache.set(root, out);
  return out;
}

const boxCache = new WeakMap<Object3D, Box3>();
/** Bounding box of the module in its own (root) space, ink outlines excluded. */
function modelBox(root: Object3D): Box3 {
  const hit = boxCache.get(root);
  if (hit) return hit;
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const box = new Box3();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || o.userData.inkOutline) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld.clone().premultiply(inv)));
  });
  boxCache.set(root, box);
  return box;
}

/**
 * Adapter for a module wider than its bay: a graphite block plugged into the bay (opening minus play) from the bay floor
 * up to the module base, with a department-colour collar, so the module reads as plugged in, not floating.
 */
function Adapter({ seat, lift, scale, foot }: { seat: Seat; lift: number; scale: number; foot: [number, number] }) {
  // As big as the module base (+ a small lip), never wider than the bay opening.
  const h = lift / scale;
  const w = Math.min((seat.bay[0] - ADAPTER_PLAY) / scale, foot[0] + 0.04 / scale), d = Math.min((seat.bay[1] - ADAPTER_PLAY) / scale, foot[1] + 0.04 / scale);
  return (
    <group position={[0, -h / 2, 0]}>
      <mesh><boxGeometry args={[w, h, d]} /><meshToonMaterial color="#3A3550" /></mesh>
      <mesh position={[0, h / 2 - 0.012 / scale, 0]}><boxGeometry args={[w + 0.02 / scale, 0.024 / scale, d + 0.02 / scale]} /><meshToonMaterial color={seat.color} /></mesh>
    </group>
  );
}
