// Pure: which installed unit goes onto which `slot_<dept>_<n>` node of the frame.
import type { Build, ComponentDef, Department, MissionId } from '../../engine';

/**
 * Parts authored in frame coordinates (rendered at the frame origin, never on a slot).
 * Mirrors model-contract.json kind=overlay (without the `__<mission>` variants).
 */
export const OVERLAY_IDS = ['rotor_system', 'landing_system', 'thermal_insulation', 'power_bus', 'reinforced_frame'] as const;
export type OverlayId = (typeof OVERLAY_IDS)[number];

export function isOverlay(id: string): id is OverlayId {
  return (OVERLAY_IDS as readonly string[]).includes(id);
}

/** "thermal_insulation__asteroid" → "thermal_insulation". */
export const baseOverlayId = (id: string) => id.replace(/__[a-z0-9]+$/, '');

/** Overlay GLB for this mission: `<id>__<mission>` (e.g. thermal_insulation__asteroid) if the manifest has it, else the plain id. */
export function overlayModelId(id: string, mission: MissionId, available: ReadonlySet<string>): string {
  const variant = `${id}__${mission}`;
  return mission !== 'titan' && available.has(variant) ? variant : id;
}

/** Return-capsule set: with a capsule installed these parts plug into its mounts instead of taking a slot. */
export const CAPSULE_ID = 'return_capsule';
export const CAPSULE_MOUNTS: Readonly<Record<string, string>> = {
  heat_shield: 'mount_heat_shield',
  parachute: 'mount_parachute',
  recovery_beacon: 'mount_beacon',
};

export function parseSlotName(name: string): { dept: string; index: number } | null {
  const m = /^slot_([a-z]+)_(\d+)$/.exec(name);
  if (!m) return null;
  const index = Number(m[2]);
  return index >= 1 ? { dept: m[1], index } : null;
}

export interface Unit {
  key: string;
  id: string;
  /** Model id (def.model ?? def.id). */
  model: string;
  dept: Department;
  /** 0-based position among the slotted units of its department (used by the procedural fallback). */
  indexInDept: number;
  /** Set when the unit plugs into another unit's mount node instead of a frame slot. */
  attach?: { parent: string; mount: string };
}

/**
 * Units that claim their department's slot 1 (hulls v2): the capsule → the gold ring in the asteroid deck centre,
 * the RTG → Titan's rear cradle. Higher = earlier.
 */
const FIRST_IN_DEPT: Readonly<Record<string, number>> = { [CAPSULE_ID]: 2, rtg: 1 };

/**
 * Expand a build into per-instance units (overlays split off: they are drawn once each).
 * The return capsule (and the RTG) are listed first so they get slot_<dept>_1 (deck centre / rear cradle); with a capsule installed,
 * the first heat_shield / parachute / recovery_beacon attach to its mounts and take no slot.
 */
export function listUnits(build: Build, defs: Record<string, ComponentDef | undefined>): { units: Unit[]; overlays: OverlayId[] } {
  const units: Unit[] = [];
  const overlays: OverlayId[] = [];
  const perDept: Partial<Record<Department, number>> = {};
  const hasCapsule = !!defs[CAPSULE_ID] && (build[CAPSULE_ID] ?? 0) > 0;
  const entries = Object.entries(build).sort(([a], [b]) => (FIRST_IN_DEPT[b] ?? 0) - (FIRST_IN_DEPT[a] ?? 0));
  for (const [id, n] of entries) {
    const def = defs[id];
    if (!def || !n) continue;
    if (isOverlay(id)) { overlays.push(id); continue; }
    for (let i = 0; i < n; i++) {
      const key = `${id}#${i}`;
      const model = def.model ?? id;
      const mount = CAPSULE_MOUNTS[id];
      if (hasCapsule && mount && i === 0) {
        units.push({ key, id, model, dept: def.department, indexInDept: -1, attach: { parent: `${CAPSULE_ID}#0`, mount } });
        continue;
      }
      const indexInDept = perDept[def.department] ?? 0;
      perDept[def.department] = indexInDept + 1;
      units.push({ key, id, model, dept: def.department, indexInDept });
    }
  }
  return { units, overlays };
}

/**
 * Fill each department's slots in numeric order (slot_power_1, slot_power_2, …), skipping numbers the frame lacks.
 * Units that do not fit get null → procedural fallback position.
 */
export function assignSlots(units: readonly Pick<Unit, 'key' | 'dept' | 'attach'>[], slotNames: Iterable<string>): Map<string, string | null> {
  const free = new Map<string, { name: string; index: number }[]>();
  for (const name of slotNames) {
    const p = parseSlotName(name);
    if (!p) continue;
    if (!free.has(p.dept)) free.set(p.dept, []);
    free.get(p.dept)!.push({ name, index: p.index });
  }
  for (const list of free.values()) list.sort((a, b) => a.index - b.index);
  const out = new Map<string, string | null>();
  for (const u of units) if (!u.attach) out.set(u.key, free.get(u.dept)?.shift()?.name ?? null);
  return out;
}
