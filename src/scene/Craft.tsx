// The shared craft, in frame coordinates (origin = centre of the bottom plate).
// The mission picks the frame (titan → frame_titan low rotorcraft chassis, asteroid → frame_asteroid hexagonal truss bus). Its GLB present →
// modules go onto its slot_<dept>_<n> nodes; otherwise the procedural layout with the same contract numbers.
import { useEffect, useMemo } from 'react';
// Runtime data straight from engine/data (not the barrel) so the 3D keeps loading while engine modules are mid-edit.
import type { Build, CraftStats, MissionId, RoleId } from '../engine';
import { COMPONENT_BY_ID } from '../engine/data/components';
import { DEPT_COLOR, FRAME_BY_MISSION, SLOT_TABLE, slotDefOf, slotTransform, type SlotTransform } from './layout';
import { useComponentModel } from './models/loader';
import { collectSlots } from './models/nodes';
import { assignSlots, listUnits } from './models/slots';
import { applyVariant } from './models/toon';
import { Module, Overlay, type Attachment } from './Module';
import { FramePlaceholder } from './Placeholders';

/** Flight-scene effects (all optional; the constructor passes none). Ids are component ids. */
export interface CraftFx {
  /** Switched-off components: dark, mechanics stop. */
  dimIds?: readonly string[];
  /** Components lit with a warning glow this frame (crisis blink). */
  flashIds?: readonly string[];
  flashColor?: 'warn' | 'crit';
  /** Whole craft iced over (freeze crisis). */
  frost?: boolean;
  /** Rotor speed multiplier: 1 flying, → 0 landed. A getter is read every frame (no re-render needed). */
  rotorSpeed?: number | (() => number);
}

interface Props {
  build: Build;
  stats: CraftStats;
  role: RoleId | null;
  reducedMotion: boolean;
  mission: MissionId;
  fx?: CraftFx;
}

export function Craft({ build, stats, role, reducedMotion, mission, fx }: Props) {
  const frameId = FRAME_BY_MISSION[mission];
  const frame = useComponentModel(frameId);
  const slots = useMemo(() => (frame ? collectSlots(frame.scene) : new Map<string, SlotTransform>()), [frame]);
  const { units, overlays } = useMemo(() => listUnits(build, COMPONENT_BY_ID), [build]);

  const flagged = useMemo(() => {
    const m = new Map<string, 'warn' | 'crit'>();
    for (const i of stats.issues) for (const id of i.componentIds) if (build[id]) m.set(id, i.severity === 'critical' ? 'crit' : 'warn');
    return m;
  }, [stats, build]);

  const placed = useMemo(() => {
    const assigned = assignSlots(units, slots.keys());
    const children = new Map<string, Attachment[]>();
    for (const u of units) {
      if (!u.attach) continue;
      const list = children.get(u.attach.parent) ?? [];
      list.push({ key: u.key, def: COMPONENT_BY_ID[u.id], mount: u.attach.mount, highlight: flagged.get(u.id) ?? null });
      children.set(u.attach.parent, list);
    }
    return units.filter((u) => !u.attach).map((u) => {
      const name = assigned.get(u.key);
      const raw = (name && slots.get(name)) || slotTransform(u.dept, u.indexInDept, frameId);
      const n = SLOT_TABLE[frameId][u.dept]?.length ?? 1;
      const d = slotDefOf(frameId, name ?? `slot_${u.dept}_${(u.indexInDept % n) + 1}`);
      const seat = d ? { bay: d.bay, lift: d.lift, cradle: d.cradle, maxFoot: d.maxFoot, color: DEPT_COLOR[u.dept] } : null;
      return { ...u, slot: fitSlot(raw), seat, attachments: children.get(u.key) };
    });
  }, [units, slots, frameId, flagged]);

  const xray = role === 'engineer';
  const frost = !!fx?.frost;
  useEffect(() => { if (frame) applyVariant(frame.scene, { xray, tint: frost ? 'frost' : null }); }, [frame, xray, frost]);
  const dimmed = (id: string) => !!fx?.dimIds?.includes(id);
  const lit = (id: string, base: 'warn' | 'crit' | null) => (fx?.flashIds?.includes(id) ? fx.flashColor ?? 'warn' : base);

  return (
    <group>
      {frame ? <primitive object={frame.scene} /> : <FramePlaceholder xray={xray} frame={frameId} />}
      {xray && <PowerLines stats={stats} />}
      {overlays.map((id) => (
        <group key={id} name={`unit_${id}`}>
          <Overlay
            id={id} mission={mission} frame={frameId} highlight={lit(id, flagged.get(id) ?? null)} reducedMotion={reducedMotion} xray={xray}
            speed={id === 'rotor_system' ? fx?.rotorSpeed ?? 1 : 1} dim={dimmed(id)} frost={frost}
          />
        </group>
      ))}
      {placed.map((u) => (
        <Module
          key={u.key} def={COMPONENT_BY_ID[u.id]} slot={u.slot} highlight={lit(u.id, flagged.get(u.id) ?? null)} reducedMotion={reducedMotion}
          attachments={u.attachments} dim={dimmed(u.id)} frost={frost} seat={u.seat}
        />
      ))}
    </group>
  );
}

/**
 * Readability fit for modules on the hull. Hulls v2 (2026-11-15): every slot sits on the floor of a recessed bay
 * (4 cm below the panel, rim 2 cm proud), so modules stand IN the bay; one wider than its bay stands on an adapter
 * plugged into the bay (Module.tsx, `seat`).
 * The scale makes the 0.1–0.4 m parts read at about 1/3 of the 0.55 m Titan body / 0.9 m asteroid bus.
 */
export const MODULE_SCALE = 1.1;
function fitSlot(s: SlotTransform): SlotTransform {
  return { position: s.position, quaternion: s.quaternion, scale: [s.scale[0] * MODULE_SCALE, s.scale[1] * MODULE_SCALE, s.scale[2] * MODULE_SCALE] };
}

/** Engineer x-ray: a glowing ring inside the hull whose colour shows bus load. */
function PowerLines({ stats }: { stats: CraftStats }) {
  const load = stats.busLimit > 0 ? stats.consumption / stats.busLimit : 2;
  const color = load > 1 ? '#FF5A6A' : load > 0.8 ? '#FFD25C' : '#4CD69A';
  return (
    <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.4, 0.025 + Math.min(load, 1.5) * 0.025, 8, 48]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} />
    </mesh>
  );
}
