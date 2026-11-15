// Slot layout in FRAME coordinates (origin = centre of the bottom plate), hulls v2 (2026-11-15).
// Same numbers as docs/05 Assets/Batches/parts/hulls_v2_contract.txt and scripts/model-contract.json "frames",
// so placeholders and real GLB slots line up. Used when the frame GLB is missing, or has no slot node for a unit.
import type { Department, MissionId } from '../engine';

export const DEPT_COLOR: Record<Department, string> = {
  power: '#FF9A4A',
  propulsion: '#B8A9F0',
  navigation: '#CFE8FF',
  science: '#5BE0E6',
  comms: '#FF9EC7',
  structure: '#F7F8FF',
  recovery: '#FFD25C',
};

/** frame_titan v2: low rounded "bathtub" chassis 1.1 (X) × 1.6 (Z) × 0.55, 4 outrigger arms with motor pads. */
export const FRAME = {
  halfWidth: 0.55,
  halfLength: 0.8,
  deckY: 0.55,
  /** Recess of every bay / socket floor below its panel. */
  bayDepth: 0.04,
  /** Motor pad top centres (rotor_system sits on them). */
  pads: [[1, 0.62, 1.05], [-1, 0.62, 1.05], [-1, 0.62, -1.05], [1, 0.62, -1.05]] as [number, number, number][],
  /** Coaxial rotor hubs above each pad: lower (pivot_rotor_<n>_lo) and upper (pivot_rotor_<n>). */
  rotorHubY: [0.74, 0.92] as [number, number],
  rotorSpan: 0.9,
  skidY: -0.45,
  skidX: 0.62,
};

/** frame_asteroid v2: hexagonal truss bus, apothem 0.65 (corner radius 0.75), flat face to +Z, y 0…0.9. */
export const HEX = {
  apothem: 0.65,
  cornerRadius: 0.65 / Math.cos(Math.PI / 6),
  height: 0.9,
  /** Top of the gold capsule ring collar (slot_recovery_1). */
  ringTopY: 0.95,
  footY: -0.35,
  footR: 0.95,
  legAngles: [90, 210, 330],
};

export type FrameId = 'frame_titan' | 'frame_asteroid';
export const FRAME_BY_MISSION: Record<MissionId, FrameId> = { titan: 'frame_titan', asteroid: 'frame_asteroid' };

type V3 = [number, number, number];
/**
 * One slot: p = bay-floor centre, n = outward normal (local +Y), bay = opening size along the slot's local X and Z,
 * lift = height of the adapter a module wider than the bay stands on (bay floor → above the rim and the flat overlay parts),
 * cradle = tall modules lie on their side here (Titan's crosswise RTG saddle),
 * maxFoot = room around the bay (frame metres): a module whose footprint is bigger gets scaled down to fit (Titan rear belly,
 * between the landing-gear struts).
 */
export interface SlotDef { p: V3; n: V3; bay: [number, number]; lift: number; cradle?: boolean; maxFoot?: number }

const UP: V3 = [0, 1, 0], DOWN: V3 = [0, -1, 0], PX: V3 = [1, 0, 0], NX: V3 = [-1, 0, 0], PZ: V3 = [0, 0, 1], NZ: V3 = [0, 0, -1];
/** Adapter heights: bay floor → rim top (0.04 recess + 0.02 rim) + clearance over the flat overlay parts (≤ 0.02 proud). */
const LIFT = 0.08;
/** Room for a module on Titan's two rear belly sockets (between the landing-gear struts). */
const TITAN_REAR_BELLY_ROOM = 0.4;
const s = (x: number, y: number, z: number, n: V3): SlotDef => {
  const cradle = n[1] > 0.5 && z < -0.4;
  return {
    p: [x, y, z], n,
    // Titan v2.1 bays: ±X sides 0.27 × 0.27, nose / rear 0.28 × 0.33, deck sockets 0.26, crosswise RTG saddle 0.84 × 0.51 (V-blocks), belly Ø0.28.
    bay: n[1] > 0.5 ? (cradle ? [0.84, 0.51] : [0.26, 0.26]) : n[1] < -0.5 ? [0.28, 0.28] : n[0] ? [0.27, 0.27] : [0.28, 0.33],
    // Belly rims stand 0.026 proud → a bit more lift there.
    lift: n[1] < -0.5 ? LIFT + 0.01 : LIFT,
    ...(cradle ? { cradle } : {}),
  };
};

/** frame_titan v2. Mirrors scripts/model-contract.json frames.frame_titan.slots. */
export const SLOT_TABLE_TITAN: Partial<Record<Department, SlotDef[]>> = {
  power: [s(0, 0.53, -0.56, UP), s(0.51, 0.28, -0.54, PX), s(-0.51, 0.28, -0.54, NX), s(0.51, 0.28, -0.18, PX), s(-0.51, 0.28, -0.18, NX), s(0.28, 0.28, -0.76, NZ)],
  structure: [s(0.51, 0.28, 0.18, PX), s(-0.51, 0.28, 0.18, NX), s(0.51, 0.28, 0.54, PX), s(-0.51, 0.28, 0.54, NX)],
  science: [s(0, 0.28, 0.76, PZ), s(-0.305, 0.28, 0.76, PZ), s(0.305, 0.28, 0.76, PZ), s(-0.3, 0.51, 0.55, UP), s(0.3, 0.51, 0.55, UP)],
  navigation: [s(0, 0.51, 0.55, UP), s(0, 0.51, 0.22, UP), s(0, 0.51, -0.11, UP), s(-0.28, 0.28, -0.76, NZ)],
  comms: [s(-0.3, 0.51, 0.22, UP), s(0.3, 0.51, 0.22, UP), s(-0.3, 0.51, -0.11, UP), s(0.3, 0.51, -0.11, UP)],
  propulsion: [s(0, 0.04, 0.4, DOWN), s(-0.28, 0.04, -0.3, DOWN), s(0.28, 0.04, -0.3, DOWN)],
};

const r3 = (v: number) => Math.round(v * 1e4) / 1e4;
/** Side slot on hexagon face `deg`, `off` along the face's local +X = (cos a, 0, −sin a), bay floor 0.61 from the centre. */
/** Asteroid side bays: lower (y 0.27) 0.46 × 0.30, upper (y 0.65) 0.26 × 0.24. */
const face = (deg: number, off: number, y: number): SlotDef => {
  const a = (deg * Math.PI) / 180, d = HEX.apothem - FRAME.bayDepth;
  const n: V3 = [r3(Math.sin(a)), 0, r3(Math.cos(a))];
  return { p: [r3(n[0] * d + Math.cos(a) * off), y, r3(n[2] * d - Math.sin(a) * off)], n, bay: y < 0.5 ? [0.46, 0.3] : [0.26, 0.24], lift: LIFT };
};
/** Asteroid deck sockets Ø0.20, belly sockets Ø0.24, engine mount Ø0.36 (0.03 deep), capsule ring collar Ø0.84 (no recess, no adapter). */
const deck = (deg: number, r: number, y = 0.87, n: V3 = UP, bay = 0.2): SlotDef => {
  const a = (deg * Math.PI) / 180;
  return { p: [r3(Math.sin(a) * r), y, r3(Math.cos(a) * r)], n, bay: [bay, bay], lift: bay > 0.8 ? 0 : LIFT - 0.01 };
};

/** frame_asteroid v2. Mirrors scripts/model-contract.json frames.frame_asteroid.slots. */
export const SLOT_TABLE_ASTEROID: Partial<Record<Department, SlotDef[]>> = {
  power: [180, 120, 240, 60, 300, 0].map((a) => face(a, 0, 0.27)),
  science: [face(0, -0.16, 0.65), face(0, 0.16, 0.65), face(300, 0.16, 0.65), face(60, -0.16, 0.65)],
  structure: [face(180, 0.16, 0.65), face(180, -0.16, 0.65), face(240, -0.16, 0.65), face(120, 0.16, 0.65)],
  navigation: [face(60, 0.16, 0.65), face(120, -0.16, 0.65), face(240, 0.16, 0.65), face(300, -0.16, 0.65)],
  comms: [30, 150, 210, 330].map((a) => deck(a, 0.56)),
  recovery: [deck(0, 0, HEX.ringTopY, UP, 0.84), deck(90, 0.56), deck(270, 0.56), deck(180, 0.53)],
  propulsion: [deck(0, 0, 0.03, DOWN, 0.36), deck(30, 0.42, 0.03, DOWN, 0.24), deck(150, 0.42, 0.03, DOWN, 0.24), deck(270, 0.42, 0.03, DOWN, 0.24)],
};

// Per-slot fits from scripts/check-bays.mjs --modules (v2.1): higher adapters where wide modules would touch the rail
// cable bundle (Titan comms sockets next to the deck edge) or the capsule ring collar (asteroid recovery 2..4);
// Titan's rear belly sockets sit next to the landing-gear struts, so big modules there are scaled to the room left.
for (const d of SLOT_TABLE_TITAN.comms!) d.lift = 0.11;
for (const d of SLOT_TABLE_ASTEROID.recovery!.slice(1)) d.lift = 0.1;
for (const d of SLOT_TABLE_TITAN.propulsion!.slice(1)) d.maxFoot = TITAN_REAR_BELLY_ROOM;

export const SLOT_TABLE: Record<FrameId, Partial<Record<Department, SlotDef[]>>> = {
  frame_titan: SLOT_TABLE_TITAN,
  frame_asteroid: SLOT_TABLE_ASTEROID,
};

export interface SlotTransform {
  position: [number, number, number];
  /** [x, y, z, w]; local +Y = outward normal. */
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function quatFromBasis(X: V3, Y: V3, Z: V3): [number, number, number, number] {
  const [m00, m10, m20] = X, [m01, m11, m21] = Y, [m02, m12, m22] = Z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

/** Table entry of a named slot of a frame (null for unknown names). */
export function slotDefOf(frame: FrameId, slotName: string): SlotDef | null {
  const m = /^slot_([a-z]+)_(\d+)$/.exec(slotName);
  return (m && SLOT_TABLE[frame][m[1] as Department]?.[Number(m[2]) - 1]) || null;
}

/** Local basis of a slot: +Y = outward normal, +Z = world up for side slots, world +Z for deck / belly slots. */
export function slotBasis(n: V3): { X: V3; Y: V3; Z: V3 } {
  const Z: V3 = Math.abs(n[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0];
  return { X: cross(n, Z), Y: n, Z };
}

/**
 * Fallback slot for the index-th unit of a department. Overflow (more units than slots) reuses the slots,
 * shifted 0.12 m per extra round along the slot's local X so they don't fully overlap.
 */
export function slotTransform(dept: Department, index: number, frame: FrameId = 'frame_titan'): SlotTransform {
  const list = SLOT_TABLE[frame][dept] ?? SLOT_TABLE[frame].structure!;
  const n = list.length;
  const { p, n: normal } = list[index % n];
  const { X, Y, Z } = slotBasis(normal);
  const k = Math.floor(index / n) * 0.12 * (index % 2 ? -1 : 1);
  const position: V3 = [p[0] + X[0] * k, p[1] + X[1] * k, p[2] + X[2] * k];
  return { position, quaternion: quatFromBasis(X, Y, Z), scale: [1, 1, 1] };
}

/**
 * return_capsule mounts when its GLB is missing (contract: Ø 0.7 gumdrop, 0.45 tall on a 0.12 clamp ring).
 * Heat shield under the capsule, parachute on top, beacon on the +Z side (its +Y = outward = +Z).
 */
export const CAPSULE_MOUNT_DEFAULT: Record<string, SlotTransform> = {
  mount_heat_shield: { position: [0, 0.12, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
  mount_parachute: { position: [0, 0.57, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
  mount_beacon: { position: [0, 0.3, 0.29], quaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], scale: [1, 1, 1] },
};
