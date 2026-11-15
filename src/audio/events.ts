// Pure: which sounds a change of the room state asks for (docs/03 Design/Sound.md).
// No WebAudio, no React — the engine (engine.ts) turns events and layers into sound; tests cover this file.
import { MISSIONS, type CapsuleStage, type CrisisKind, type MissionId, type Outcome, type RoomState, type Stage } from '../engine';

/** What the sound cares about in a room, flattened (cheap to compare every state update). */
export interface AudioSnapshot {
  code: string;
  stage: Stage;
  mission: MissionId;
  /** Total installed modules (stage build). */
  modules: number;
  /** decisionLog length + kind of the last one. */
  decisions: number;
  lastDecision: 'approve' | 'veto' | null;
  crisisId: string | null;
  crisisKind: CrisisKind | null;
  /** The last finished crisis: was the root problem fixed? */
  lastCrisisResolved: boolean | null;
  /** Delivered Tactical Radio messages; whether the newest delivered one is an emergency phrase. */
  radio: number;
  radioEmergency: boolean;
  signal: 'ok' | 'delay' | 'interference' | 'lost' | null;
  phase: string | null;
  route: 'flying' | 'landed' | 'stopped' | null;
  storm: boolean;
  drive: 'ion' | 'chem' | null;
  capsule: CapsuleStage | null;
  sampling: 'idle' | 'reach' | 'grab' | 'jam' | 'stowed' | 'failed' | null;
  sealed: boolean;
  outcome: Outcome | null;
}

export function snapshotOf(room: RoomState | null): AudioSnapshot | null {
  if (!room) return null;
  const f = room.flight;
  const a = f?.asteroid;
  const radio = (f?.radio ?? []).filter((m) => m.delivered);
  const newest = radio.reduce<(typeof radio)[number] | null>((b, m) => (!b || m.deliverTick >= b.deliverTick ? m : b), null);
  const last = f?.history?.length ? f.history[f.history.length - 1] : null;
  const log = room.decisionLog ?? [];
  const d = log.length ? log[log.length - 1] : null;
  const live = room.stage === 'flight' && !!f;
  return {
    code: room.code,
    stage: room.stage,
    mission: room.mission,
    modules: Object.values(room.build ?? {}).reduce((s, n) => s + n, 0),
    decisions: log.length,
    lastDecision: d ? (d.kind === 'veto' ? 'veto' : 'approve') : null,
    crisisId: live ? (f.crisis?.id ?? null) : null,
    crisisKind: live ? (f.crisis?.kind ?? null) : null,
    lastCrisisResolved: last ? last.resolved : null,
    radio: radio.length,
    radioEmergency: !!newest?.emergency,
    signal: live ? f.signal : null,
    phase: live ? (MISSIONS[f.mission].phases[f.phaseIndex]?.id ?? null) : null,
    route: live ? f.route : null,
    storm: live && !!f.storm && f.tick >= f.storm.from && f.tick < f.storm.until,
    drive: live && a ? a.drive : null,
    capsule: live && a ? a.capsule : null,
    sampling: live && a ? a.sampling : null,
    sealed: !!a?.sample.sealed,
    outcome: room.stage === 'report' ? (room.report?.outcome ?? null) : null,
  };
}

export type SfxId =
  | 'click' | 'install' | 'remove' | 'approve' | 'veto'
  | 'launch' | 'phase'
  | 'crisis' | 'crisis-resolved' | 'crisis-closed'
  | 'radio' | 'radio-sos' | 'signal-lost' | 'signal-back'
  | 'grab' | 'jam' | 'seal'
  | 'capsule-sep' | 'chute' | 'touchdown' | 'beacon'
  | 'outcome-perfect' | 'outcome-success' | 'outcome-partial' | 'outcome-failed';

export const ALL_SFX: SfxId[] = [
  'click', 'install', 'remove', 'approve', 'veto', 'launch', 'phase', 'crisis', 'crisis-resolved', 'crisis-closed',
  'radio', 'radio-sos', 'signal-lost', 'signal-back', 'grab', 'jam', 'seal', 'capsule-sep', 'chute', 'touchdown', 'beacon',
  'outcome-perfect', 'outcome-success', 'outcome-partial', 'outcome-failed',
];

/**
 * One-shot sounds for a state change. Nothing on the first state of a room (a reload or a join lands in the
 * middle of a crisis — no buzzer for something that already started) and nothing when the room code changes.
 */
export function soundEvents(prev: AudioSnapshot | null, next: AudioSnapshot | null): SfxId[] {
  if (!prev || !next || prev.code !== next.code) return [];
  const out: SfxId[] = [];
  const add = (id: SfxId) => { if (!out.includes(id)) out.push(id); };

  if (next.stage === 'build' && prev.stage === 'build') {
    if (next.modules > prev.modules) add('install');
    else if (next.modules < prev.modules) add('remove');
  }
  if (next.decisions > prev.decisions && next.lastDecision) add(next.lastDecision);
  if (next.stage === 'launch' && prev.stage !== 'launch') add('launch');

  if (next.stage === 'flight') {
    if (next.crisisId && next.crisisId !== prev.crisisId) add('crisis');
    else if (!next.crisisId && prev.crisisId) add(next.lastCrisisResolved ? 'crisis-resolved' : 'crisis-closed');
    if (next.radio > prev.radio) add(next.radioEmergency ? 'radio-sos' : 'radio');
    if (next.signal === 'lost' && prev.signal !== 'lost' && prev.signal !== null) add('signal-lost');
    if (prev.signal === 'lost' && next.signal !== 'lost') add('signal-back');
    if (next.phase && prev.phase && next.phase !== prev.phase) add('phase');
    if (next.sampling !== prev.sampling) {
      if (next.sampling === 'grab') add('grab');
      if (next.sampling === 'jam') add('jam');
    }
    if (next.sealed && !prev.sealed) add('seal');
    if (next.capsule !== prev.capsule && prev.capsule !== null) {
      if (next.capsule === 'separated') add('capsule-sep');
      if (next.capsule === 'chute') add('chute');
      if (next.capsule === 'landed') add('touchdown');
      if (next.capsule === 'found') add('beacon');
    }
  }
  if (next.outcome && !prev.outcome) add(`outcome-${next.outcome}` as SfxId);
  return out;
}

export type Ambience = 'hq' | 'space' | 'titan' | 'earth' | null;

/** Continuous layers: what should be humming right now (0..1 levels, engine ramps between them). */
export interface Layers {
  ambience: Ambience;
  /** Titan methane rain, 0..1 (a storm is heavier). */
  rain: number;
  /** Rotorcraft blades. */
  rotor: number;
  /** Attitude-thruster puffs (asteroid approach / station keeping / sampling). */
  thrusters: boolean;
  /** Cruise engine hum. */
  drive: 'ion' | 'chem' | null;
  /** Signal noise: lost = 1, interference = 0.5. */
  static: number;
  /** Capsule (or Titan entry) plasma rumble. */
  reentry: number;
  /** The launch sequence is running (the engine starts it on the `launch` event and fades it when this goes false). */
  launch: boolean;
}

export const SILENT: Layers = { ambience: null, rain: 0, rotor: 0, thrusters: false, drive: null, static: 0, reentry: 0, launch: false };

export function layersFor(s: AudioSnapshot | null): Layers {
  if (!s) return { ...SILENT, ambience: 'hq' }; // home screen: the agency hall
  if (s.stage === 'launch') return { ...SILENT, ambience: 'earth', launch: true }; // night wind at the pad under the sequence
  if (s.stage !== 'flight') return { ...SILENT, ambience: 'hq' };
  const st = s.signal === 'lost' ? 1 : s.signal === 'interference' ? 0.5 : 0;
  if (s.mission === 'titan') {
    if (s.phase === 'cruise') return { ...SILENT, ambience: 'space', drive: 'chem', static: st };
    const entry = s.phase === 'entry';
    return {
      ...SILENT,
      ambience: 'titan',
      rain: s.storm ? 1 : 0.35,
      rotor: !entry && s.route === 'flying' ? 1 : 0,
      reentry: entry ? 0.6 : 0,
      static: st,
    };
  }
  // Asteroid
  const cap = s.capsule;
  if (cap === 'landed' || cap === 'found' || cap === 'lost') return { ...SILENT, ambience: 'earth', static: st };
  const reentry = cap === 'entry' ? 1 : cap === 'chute' ? 0.3 : 0;
  const cruising = s.phase === 'cruise' || (s.phase === 'return' && (cap === 'stowed' || cap === null));
  return {
    ...SILENT,
    ambience: cap === 'chute' ? 'earth' : 'space',
    drive: cruising ? s.drive : null,
    thrusters: s.phase === 'approach' || s.phase === 'site' || s.phase === 'sampling' || s.phase === 'stow',
    reentry,
    static: st,
  };
}

/**
 * Who may hear what. Local mode (and the home screen, before the mode is known): every player is a tab of one
 * browser — only the focused tab makes sound, no cacophony of 4 tabs. Online: one player per device, a visible tab plays.
 */
export function audibility(mode: 'local' | 'online' | null, focused: boolean, visible: boolean): { ambience: boolean; sfx: boolean } {
  if (mode !== 'online') return { ambience: focused, sfx: focused };
  return { ambience: visible, sfx: visible };
}
