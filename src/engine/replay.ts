// 3D replay of the key moments for the Mission Report (docs/03 Design/Mission Report.md: «3D-повтор ключевых моментов —
// запуск, главный кризис, финал»). Pure, deterministic: frames are derived from the flight state only.
//
// While flying, `flight.replay` keeps a small recorder: a tail of the last ticks (pre-roll) and short windows opened by
// triggers — the start of the flight, every crisis (only the best one is kept once it is over), the last waypoint
// arrival (Titan) or the capsule leaving the craft (asteroid). At the end `pickReplay` puts launch + main crisis + final
// into `report.replay` and the recorder is dropped from the flight (room state is broadcast to every player).
// Frames carry exactly what the scenes take as props (src/scene/flight/types.ts, src/scene/asteroid/types.ts).
import { MISSIONS } from './data/missions';
import type { AsteroidSiteId, CapsuleStage } from './data/asteroid';
import type { AsteroidFlight } from './asteroid';
import type { CrisisKind, CrisisRecord, FlightState } from './flight';
import type { MissionId } from './types';

/** One snapshot. Short keys: the report travels to every player. Missing optional key = default (0 / false / none). */
export interface ReplayFrame {
  /** Flight tick. */
  t: number;
  /** Phase index in MISSIONS[mission].phases. */
  ph: number;
  /** Signal: o ok · d delay · i interference · l lost. */
  sg: 'o' | 'd' | 'i' | 'l';
  /** Index into window.offs (switched-off components); missing = nothing off. */
  o?: number;
  /** 1-based index into window.crises; missing = no crisis on screen. */
  c?: number;
  // ── Titan ──
  /** waypointIndex / waypointProgress (0..1, 2 decimals). */
  wi?: number;
  wp?: number;
  /** route: f flying · l landed · s stopped. */
  rt?: 'f' | 'l' | 's';
  /** Methane storm on. */
  st?: 1;
  // ── Asteroid ──
  /** approach 0..1. */
  ap?: number;
  si?: AsteroidSiteId;
  sm?: AsteroidFlight['sampling'];
  /** Sample sealed. */
  sl?: 1;
  /** Debris stream. */
  db?: 1;
  /** Capsule stage (missing = 'stowed') and progress inside it. */
  cp?: CapsuleStage;
  cq?: number;
}

export type ReplayKind = 'launch' | 'crisis' | 'final';

export interface ReplayWindow {
  kind: ReplayKind;
  /** Tick of the trigger (crisis start, waypoint arrival, capsule separation, flight end). */
  tick: number;
  /** Crisis id (CrisisRecord.id) for kind 'crisis'. */
  ref?: string;
  /** Distinct switched-off sets; offs[0] is always []. */
  offs: string[][];
  crises: { kind: CrisisKind; nodeIds: string[] }[];
  frames: ReplayFrame[];
  /** Recording only: ticks still to record (removed when closed). */
  left?: number;
  /** Recording only: frame step in ticks. */
  stride?: number;
}

export interface Replay {
  v: 1;
  mission: MissionId;
  /** Chronological: launch, main crisis (if any), final. */
  windows: ReplayWindow[];
}

/** Raw tail snapshot (before it is packed into a window). */
interface Snap { f: Omit<ReplayFrame, 'o' | 'c'>; off: string[]; cr: { kind: CrisisKind; nodeIds: string[] } | null }

export interface ReplayRecorder {
  tail: Snap[];
  wins: ReplayWindow[];
}

/** Recording plan (ticks). Every value keeps the report within a few KB. */
export const REPLAY = {
  /** Pre-roll tail: every `stride` ticks, this many snapshots. */
  stride: 2, tail: 10,
  launch: 4,
  crisisBefore: 6, crisisAfter: 24,
  /** Titan: the last waypoint arrival — approach before, landing / hovering after. */
  arrivalBefore: 20, arrivalAfter: 10,
  /** Asteroid: capsule from separation to the end of the flight, sparser (its motion is slow and linear). */
  capsuleStride: 4,
} as const;

/** How hard a crisis hit (report highlights pick the main crisis by this). */
export function crisisImpact(h: CrisisRecord) {
  return (h.resolved ? 2 : 8) + (h.by === 'team' ? 0 : 3);
}

/** The main crisis: highest impact, the earliest on a tie (same as the report highlights). */
export function mainCrisis(history: CrisisRecord[]): CrisisRecord | undefined {
  let best: CrisisRecord | undefined;
  for (const h of history) if (!best || crisisImpact(h) > crisisImpact(best)) best = h;
  return best;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const SIG: Record<FlightState['signal'], ReplayFrame['sg']> = { ok: 'o', delay: 'd', interference: 'i', lost: 'l' };
const RT: Record<FlightState['route'], NonNullable<ReplayFrame['rt']>> = { flying: 'f', landed: 'l', stopped: 's' };

function snap(n: FlightState): Snap {
  const f: Snap['f'] = { t: n.tick, ph: Math.min(n.phaseIndex, MISSIONS[n.mission].phases.length - 1), sg: SIG[n.signal] };
  const a = n.asteroid;
  if (a) {
    f.ap = r2(a.approach);
    if (a.site) f.si = a.site;
    if (a.sampling !== 'idle') f.sm = a.sampling;
    if (a.sample.sealed) f.sl = 1;
    if (a.debris) f.db = 1;
    if (a.capsule !== 'stowed') { f.cp = a.capsule; f.cq = r2(a.capsuleProgress); }
  } else {
    f.wi = n.waypointIndex;
    f.wp = r2(n.waypointProgress);
    f.rt = RT[n.route];
    if (n.storm && n.tick >= n.storm.from && n.tick < n.storm.until) f.st = 1;
  }
  return { f, off: [...n.off].sort(), cr: n.crisis ? { kind: n.crisis.kind, nodeIds: [...n.crisis.nodeIds] } : null };
}

function pack(w: ReplayWindow, s: Snap): ReplayFrame {
  const fr: ReplayFrame = { ...s.f };
  if (s.off.length) {
    const key = s.off.join(',');
    let i = w.offs.findIndex((o) => o.join(',') === key);
    if (i < 0) { w.offs.push(s.off); i = w.offs.length - 1; }
    fr.o = i;
  }
  if (s.cr) {
    const key = `${s.cr.kind}:${s.cr.nodeIds.join(',')}`;
    let i = w.crises.findIndex((c) => `${c.kind}:${c.nodeIds.join(',')}` === key);
    if (i < 0) { w.crises.push(s.cr); i = w.crises.length - 1; }
    fr.c = i + 1;
  }
  return fr;
}

function open(kind: ReplayKind, tick: number, left: number, stride: number, pre: Snap[], ref?: string): ReplayWindow {
  const w: ReplayWindow = { kind, tick, ...(ref ? { ref } : {}), offs: [[]], crises: [], frames: [], left, stride };
  for (const s of pre) w.frames.push(pack(w, s));
  return w;
}

/** Called by stepFlight after every tick: `prev` = state before the tick, `n` = after (mutated: n.replay). */
export function recordReplay(prev: FlightState, n: FlightState) {
  const rec: ReplayRecorder = n.replay ?? { tail: [], wins: [] };
  n.replay = rec;
  const t = n.tick;
  const s = snap(n);

  // Windows still recording.
  for (const w of rec.wins) {
    if (!w.left) continue;
    w.left--;
    if (t % (w.stride ?? REPLAY.stride) === 0 || n.done || w.left === 0) w.frames.push(pack(w, s));
    if (w.left <= 0 || n.done) { delete w.left; delete w.stride; }
  }

  // Triggers.
  const tailFrom = (from: number) => rec.tail.filter((x) => x.f.t >= from && x.f.t < t);
  if (!rec.wins.some((w) => w.kind === 'launch') && prev.tick === 0) {
    rec.wins.push(open('launch', t, REPLAY.launch, REPLAY.stride, [s]));
  }
  if (n.crisis && n.crisis.id !== prev.crisis?.id) {
    rec.wins.push(open('crisis', t, REPLAY.crisisAfter, REPLAY.stride, [...tailFrom(t - REPLAY.crisisBefore), s], n.crisis.id));
  }
  const reached = (f: FlightState) => f.waypoints.filter((w) => w.reached).length;
  const finalTrigger = n.asteroid
    ? n.asteroid.capsule !== 'stowed' && prev.asteroid?.capsule === 'stowed'
    : reached(n) > reached(prev);
  if (finalTrigger) {
    rec.wins = rec.wins.filter((w) => w.kind !== 'final');
    rec.wins.push(n.asteroid
      ? open('final', t, 999, REPLAY.capsuleStride, [s])
      : open('final', t, REPLAY.arrivalAfter, REPLAY.stride, [...tailFrom(t - REPLAY.arrivalBefore), s]));
  }
  if (n.done && !rec.wins.some((w) => w.kind === 'final')) {
    // No arrival / capsule: the last ticks of the flight.
    const w = open('final', t, 0, REPLAY.stride, [...tailFrom(t - REPLAY.stride * REPLAY.tail), s]);
    delete w.left; delete w.stride;
    rec.wins.push(w);
  }
  if (n.done) for (const w of rec.wins) { delete w.left; delete w.stride; }

  // Keep only the best finished crisis window (+ the one still recording or still unresolved).
  const crisisWins = rec.wins.filter((w) => w.kind === 'crisis');
  if (crisisWins.length > 1) {
    const done = crisisWins.filter((w) => !w.left && n.history.some((h) => h.id === w.ref));
    const best = mainCrisis(n.history.filter((h) => done.some((w) => w.ref === h.id)));
    rec.wins = rec.wins.filter((w) => w.kind !== 'crisis' || !done.includes(w) || w.ref === best?.id);
  }

  // Pre-roll tail.
  if (t % REPLAY.stride === 0) {
    rec.tail.push(s);
    if (rec.tail.length > REPLAY.tail) rec.tail.shift();
  }
  if (n.done) rec.tail = [];
}

/** Report replay: launch → main crisis → final. Null when the flight was recorded before replays existed. */
export function pickReplay(f: FlightState): Replay | null {
  const wins = f.replay?.wins;
  if (!wins?.length) return null;
  const clean = (w: ReplayWindow): ReplayWindow => {
    const { left: _l, stride: _s, ...rest } = w;
    return structuredClone(rest);
  };
  const main = mainCrisis(f.history);
  const out = [
    wins.find((w) => w.kind === 'launch'),
    main ? wins.find((w) => w.kind === 'crisis' && w.ref === main.id) : undefined,
    wins.find((w) => w.kind === 'final'),
  ].filter((w): w is ReplayWindow => !!w && w.frames.length > 0).map(clean);
  return out.length ? { v: 1, mission: f.mission, windows: out } : null;
}
