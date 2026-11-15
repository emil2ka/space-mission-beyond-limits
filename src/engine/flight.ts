// Flight simulation (ТЗ §9–10). One call = one tick (TICK_SECONDS real seconds, TICK_HOURS game hours).
// Order per tick: blackout autonomy → activity → energy → bus protection → heat → route → science → link → crises → phases.
// Every consequence is written to `causes` with `causeIds` (component ids and readiness issue ids) for the report.
import { trustEffects } from './rules';
import { TICK_HOURS } from './constants';
import { MISSIONS } from './data/missions';
import { TARGET_DEFS, TITAN, WAYPOINT_DEFS, type ScienceMode, type ScienceTargetId, type TargetDef, type WaypointId } from './data/titan';
import { ASTEROID, ASTEROID_TARGET_DEFS, SITE_BY_ID } from './data/asteroid';
import { UPGRADE_FX } from './data/economy';
import { evaluateRules, type ActionKind, type AutonomyRule } from './autonomy';
import { detectAsteroidCrisis, detectCrisis, genericCrisisAllowed, genericSlotsUsed, resolveCrisis } from './crises';
import {
  asteroidActivity, asteroidPhaseDone, initAsteroid, onAsteroidFinal, onAsteroidPhaseEnd, onAsteroidPhaseStart,
  SCIENCE_PHASES_ASTEROID, stepAsteroid, type AsteroidFlight,
} from './asteroid';
import { noteRulesFired, stepComms, trackCommand, type CommandRecord, type RadioMsg, type RuleFired } from './blackout';
import { stepEnergy } from './energy';
import { recordReplay, type ReplayRecorder } from './replay';
import { rng } from './rng';
import {
  ANTENNAS, CAMERAS, heatFor, loadsFor, memoryCap, memoryUsed, nameOf, overRatio, overweightSpeed,
  pickShed, sumWatts, telemetry, thermalOf, type Activity,
} from './sim';
import { computeStats, installed } from './stats';
import {
  evictFor, noteAimLoss, onLinkBack, onPowerDrop, queueIndex, stepTasks, taskBandwidth, taskLoss, taskQuality, taskRate, type TaskFlight,
} from './tasks';
import type { Build, CraftStats, MissionId, Mods, RoleId } from './types';
import { join, m, ru, type Msg } from './msg';

/** Cause-event text + its message. */
const ev = (msg: Msg) => ({ text: ru(msg), i18n: { text: msg } });

export type { ScienceMode, ScienceTargetId, WaypointId } from './data/titan';
export type { AsteroidFlight } from './asteroid';

/** Science target definitions of a mission. */
export const targetDefsFor = (mission: MissionId): TargetDef[] => (mission === 'asteroid' ? ASTEROID_TARGET_DEFS : TARGET_DEFS);

export interface CauseEvent {
  tick: number;
  kind: 'shed' | 'battery-empty' | 'thermal' | 'signal' | 'phase' | 'data' | 'crisis' | 'mass' | 'autonomy' | 'route' | 'science' | 'radio' | 'command';
  causeIds: string[];
  text: string;
  /** Machine key for the report (e.g. 'battery-empty', 'bus-trip', 'memory-full', 'route-short'). */
  ref?: string;
  /** The same text as a message, for the player's language (decision 0013 §5). */
  i18n?: { text?: Msg };
}

export interface Waypoint { id: WaypointId; name: string; reached: boolean; mode: ScienceMode | null }

export interface ScienceTarget {
  id: ScienceTargetId;
  name: string;
  /** Instruments that can collect it (any of). */
  need: string[];
  required: number;
  collected: number;
  sent: number;
  /** An instrument for it is installed and working. */
  possible: boolean;
  /** In onboard memory, not yet sent. */
  stored: number;
  /** Lost: memory full or corrupted packets. */
  lost: number;
  /** Average quality of collected data, 0..1. */
  quality: number;
}

export type CrisisKind = 'power_drop' | 'signal_distortion' | 'freeze' | 'overheat' | 'debris_alert' | 'arm_jam';

export interface CrisisOption {
  id: string;
  role: RoleId;
  label: string;
  hint: string;
  /** Parts this option acts on (for highlighting). */
  nodeIds?: string[];
  /** label / hint as messages (the Russian strings above are rendered from them). */
  i18n?: { label?: Msg; hint?: Msg };
}

export interface ActiveCrisis {
  id: string;
  kind: CrisisKind;
  title: string;
  text: string;
  /** Components that caused it (3D sparks + report). */
  nodeIds: string[];
  startedTick: number;
  deadlineTick: number;
  options: CrisisOption[];
  chosen: Partial<Record<RoleId, string>>;
  /** Component + readiness issue ids behind the trigger. */
  causeIds: string[];
  /** Power Drop: overloaded bus / low battery. Overheat: critical heat / heat piled up while «hot». Debris: seen late (no radar / nav camera). */
  variant?: 'bus' | 'battery' | 'critical' | 'warm' | 'late';
  /** text as a message. */
  i18n?: { text?: Msg };
}

export interface CrisisRecord {
  id: string;
  kind: CrisisKind;
  variant?: ActiveCrisis['variant'];
  title: string;
  startedTick: number;
  endedTick: number;
  causeIds: string[];
  nodeIds: string[];
  chosen: Partial<Record<RoleId, string>>;
  /** Labels of the chosen options. */
  chosenLabels: Partial<Record<RoleId, string>>;
  /** Who decided: the team, an Autonomy Planner rule, or Safe Protocol. */
  by: 'team' | 'autonomy' | 'safe';
  ruleIds: string[];
  /** Root problem fixed for good. */
  resolved: boolean;
  /** Human sentences: what happened as a result. */
  effects: string[];
  /** Snapshot numbers for the report. */
  numbers: Record<string, number>;
  /** effects (aligned) and chosenLabels as messages. */
  i18n?: { effects?: Msg[]; chosenLabels?: Partial<Record<RoleId, Msg>> };
}

export interface Blackout {
  from: number;
  /** -1 while still going. */
  to: number;
  reason: 'entry' | 'escalation' | 'no-link';
  by: 'autonomy' | 'safe';
  ruleIds: string[];
}

export interface FlightState {
  mission: MissionId;
  tick: number;
  phaseIndex: number;
  phaseTick: number;
  stored: number;
  off: string[];
  hull: number;
  dataOnboard: number;
  dataSent: number;
  signal: 'ok' | 'delay' | 'interference' | 'lost';
  done: boolean;
  causes: CauseEvent[];

  // ── M1 contract ──
  waypoints: Waypoint[];
  waypointIndex: number;
  /** 0..1 towards waypoints[waypointIndex] (1 while standing at it). */
  waypointProgress: number;
  targets: ScienceTarget[];
  crisis: ActiveCrisis | null;
  crisesSeen: CrisisKind[];
  thermal: CraftStats['thermalState'];
  route: 'flying' | 'landed' | 'stopped';

  // ── extra (engine-owned, read-only for UI) ──
  /** Current heat balance (game units). */
  heat: number;
  power: { generation: number; demand: number; busLoad: number; busLimit: number; net: number };
  /** Memory is full: new data is lost (ТЗ «Data Queue Full»). */
  queueFull: boolean;
  memoryCap: number;
  /** Ticks left at the current waypoint (0 = flying). */
  dwellLeft: number;
  holdUntil: number;
  sciencePausedUntil: number;
  camsPausedUntil: number;
  lostUntil: number;
  storm: { from: number; until: number; factor: number; loss: number; amp: boolean } | null;
  ecoLink: boolean;
  extraLoad: number;
  heatAdj: number;
  speedFactor: number;
  coldTicks: number;
  hotTicks: number;
  /** Consecutive ticks at «hot» or above. */
  warmTicks: number;
  lastCrisisEnd: number;
  broken: string[];
  history: CrisisRecord[];
  blackouts: Blackout[];
  /** Ticks the craft stood still when it should have flown. */
  stoppedTicks: number;
  /** Team Trust when the flight started (report applies penalties to it). */
  trustAtStart: number;
  /** 0013 §3: extra seconds (ticks) on every crisis decision timer («Слаженная команда»). Missing in old states. */
  crisisBonus?: number;
  /** Delay of commands and confirmations, ticks. */
  delayTicks: number;
  /** Data lost because memory was full / to corrupted packets. */
  lostMemory: number;
  lostNoise: number;

  // ── M2: radio, commands, autonomy notes (src/engine/blackout.ts) ──
  /** Tactical Radio messages (delivered ones are also in `causes` as kind 'radio'). */
  radio: RadioMsg[];
  /** Ground → craft commands with the signal delay. */
  commands: CommandRecord[];
  /** Science «send first» choice for the downlink queue. */
  downlinkFirst: ScienceTargetId | null;
  /** Blackout (its `from` tick) where comms already ran the DSN search. */
  antennaSearchedAt: number | null;
  /** Every time an Autonomy Planner rule fired (log + report). */
  rulesFired: RuleFired[];

  // ── M3 ──
  /** Asteroid Sample Return state (undefined on Titan). */
  asteroid?: AsteroidFlight;
  /** Agency upgrades the flight was launched with (computeStats uses them). */
  mods?: Mods;
  /** PDU v2: loads shed on an empty battery that come back once it recovers. */
  autoShed?: string[];
  /** Asteroid: seeded jam plan for the chosen site (set when sampling starts). */
  jamPlan?: { at: number; hits: boolean; risk: number };

  // ── M5 ──
  /** Report replay recorder (src/engine/replay.ts); moved into report.replay and dropped when the flight ends. */
  replay?: ReplayRecorder;

  // ── Individual Tasks (src/engine/tasks.ts, decision 0013 §1) ──
  /** Flight modifiers from the role tasks (undefined when the team never opened the task screen). */
  tasks?: TaskFlight;
}

export function startFlight(mission: MissionId, build: Build, opts: { teamTrust?: number; mods?: Mods; tasks?: TaskFlight | null } = {}): FlightState {
  const def = MISSIONS[mission];
  const mods: Mods | undefined = opts.mods?.upgrades.length ? { upgrades: [...opts.mods.upgrades], ...(opts.mods.extraSlot ? { extraSlot: opts.mods.extraSlot } : {}) } : undefined;
  const stats = computeStats(build, def, mods);
  const titan = def.phases.some((p) => p.id === 'survey');
  const defs = targetDefsFor(mission);
  return {
    mission, tick: 0, phaseIndex: 0, phaseTick: 0,
    stored: stats.capacityWh, off: [], hull: 100,
    dataOnboard: 0, dataSent: 0, signal: 'delay', done: false, causes: [],
    waypoints: titan ? WAYPOINT_DEFS.map((w) => ({ id: w.id, name: w.name, reached: false, mode: null })) : [],
    waypointIndex: 0, waypointProgress: 0,
    targets: defs.map((t) => {
      const need = t.rates.map((r) => r.instrument);
      return { id: t.id, name: t.name, need, required: t.required, collected: 0, sent: 0, stored: 0, lost: 0, quality: 0, possible: need.some((id) => (build[id] ?? 0) > 0) };
    }),
    crisis: null, crisesSeen: [], thermal: stats.thermalState, route: 'flying',
    heat: stats.heatBalance,
    power: { generation: stats.generation, demand: 0, busLoad: 0, busLimit: stats.busLimit, net: stats.generation },
    queueFull: false, memoryCap: memoryCap(stats), dwellLeft: 0,
    holdUntil: 0, sciencePausedUntil: 0, camsPausedUntil: 0, lostUntil: 0, storm: null,
    ecoLink: false, extraLoad: 0, heatAdj: 0, speedFactor: 1, coldTicks: 0, hotTicks: 0, warmTicks: 0,
    lastCrisisEnd: -999, broken: [], history: [], blackouts: [], stoppedTicks: 0,
    trustAtStart: opts.teamTrust ?? 100, crisisBonus: trustEffects(opts.teamTrust ?? 100).crisisBonus, delayTicks: def.signalDelay, lostMemory: 0, lostNoise: 0,
    radio: [], commands: [], downlinkFirst: null, antennaSearchedAt: null, rulesFired: [],
    ...(mission === 'asteroid' ? { asteroid: initAsteroid(build) } : {}),
    ...(mods ? { mods } : {}),
    ...(opts.tasks ? { tasks: structuredClone(opts.tasks) } : {}),
  };
}

/** Seeded storm plan: survey tick it starts at and whether it hits (always without Signal Amplifier). */
export function stormPlan(seed: number, build: Build): { at: number; hits: boolean } {
  const r = rng((seed ^ 0x5bd1e995) >>> 0);
  const [a, b] = TITAN.storm.window;
  const at = a + Math.floor(r() * (b - a));
  const amp = (build.signal_amp ?? 0) > 0;
  return { at, hits: !amp || r() < TITAN.storm.chanceWithAmp };
}

const BLACKOUT_ACTIONS: ActionKind[] = ['shed_secondary', 'keep_collecting_store', 'stop_risky_maneuvers', 'point_antenna_earth', 'prepare_return'];

export function stepFlight(f: FlightState, build: Build, seed: number, rules: AutonomyRule[] = []): FlightState {
  if (f.done) return f;
  const mission = MISSIONS[f.mission];
  const stats = computeStats(build, mission, f.mods);
  const n: FlightState = structuredClone(f);
  const isAst = !!n.asteroid;
  n.tick = f.tick + 1;
  const t = n.tick;
  const phase = mission.phases[f.phaseIndex];
  const pt = f.phaseTick;
  const cause = (e: Omit<CauseEvent, 'tick'>) => n.causes.push({ tick: t, ...e });
  const has = (id: string) => (build[id] ?? 0) > 0;

  // 0. Storm (Signal Distortion source) — seeded, depends on Signal Amplifier.
  if (phase.id === 'survey' && !n.storm) {
    const plan = stormPlan(seed, build);
    if (pt === plan.at && plan.hits) {
      const amp = has('signal_amp');
      n.storm = { from: t, until: t + TITAN.storm.length, factor: amp ? TITAN.storm.ampFactor : TITAN.storm.factor, loss: amp ? TITAN.storm.ampLoss : TITAN.storm.loss, amp };
      cause({ kind: 'signal', ref: 'storm', causeIds: amp ? ['signal_amp', ...ANTENNAS.filter(has)] : ['signal_amp'], ...ev(m(amp ? 'fl.stormAmp' : 'fl.storm')) });
    }
  }
  const stormOn = !!n.storm && t < n.storm.until;

  // 1. Signal lost? → Autonomy Planner rules, otherwise Safe Protocol (ТЗ §8).
  const entryBlackout = phase.id === 'entry' && pt < TITAN.entryBlackoutTicks;
  const lost = stats.bandwidth === 0 || entryBlackout || t < n.lostUntil;
  let pauseNow = false;
  let holdNow = false;
  const open = n.blackouts.find((b) => b.to === -1);
  if (lost) {
    const fired = evaluateRules(rules, telemetry(n, stats, 'lost'), build, stats.ruleSlots).filter((r) => BLACKOUT_ACTIONS.includes(r.action));
    let sci: boolean | null = null;
    for (const r of fired) {
      if (r.action === 'shed_secondary' && sci === null) sci = false;
      if (r.action === 'keep_collecting_store' && sci === null) sci = true;
      if (r.action === 'stop_risky_maneuvers') holdNow = true;
      if (r.action === 'prepare_return' && n.asteroid?.sample.collected) n.asteroid.prepFired = true;
      if (r.action === 'point_antenna_earth' && n.lostUntil > t + TITAN.storm.escalationLostPointed) {
        n.lostUntil = t + TITAN.storm.escalationLostPointed;
        cause({ kind: 'autonomy', ref: 'rule-point', causeIds: [r.ruleId], ...ev(m('fl.rulePoint')) });
      }
    }
    if (fired.length === 0) { pauseNow = true; holdNow = true; } else pauseNow = sci === false;
    const by = fired.length ? 'autonomy' : 'safe';
    const fresh = fired.filter((r) => !open?.ruleIds.includes(r.ruleId));
    if (fresh.length) noteRulesFired(n, rules, fresh, 'blackout', m('fl.ctx.blackout'));
    if (!open) {
      const reason: Blackout['reason'] = stats.bandwidth === 0 ? 'no-link' : entryBlackout ? 'entry' : 'escalation';
      n.blackouts.push({ from: t, to: -1, reason, by, ruleIds: fired.map((r) => r.ruleId) });
      cause({
        kind: 'autonomy', ref: by === 'safe' ? 'blackout-safe' : 'blackout-rules', causeIds: by === 'safe' ? ['safe-protocol', 'flight_computer'] : fired.map((r) => r.ruleId),
        ...ev(by === 'safe' ? m('fl.blackoutSafe') : m('fl.blackoutRules', { n: fired.length })),
      });
    } else {
      for (const r of fired) if (!open.ruleIds.includes(r.ruleId)) open.ruleIds.push(r.ruleId);
      if (by === 'autonomy') open.by = 'autonomy';
    }
  } else if (open) {
    open.to = t;
    cause({ kind: 'signal', ref: 'link-back', causeIds: [], ...ev(m('fl.linkBack', { ticks: t - open.from })) });
    onLinkBack(n, open, seed, cause); // Individual Tasks: the antenna has lost Earth — comms re-aims
  }
  stepTasks(n, cause);

  // 1b. Radio + ground commands move along the link (delayed in a blackout).
  n.radio = n.radio ?? []; n.commands = n.commands ?? []; n.rulesFired = n.rulesFired ?? [];
  stepComms(n, build, lost, cause);

  // 2. Activity: what is switched on.
  const survey = phase.id === 'survey';
  const routeLeft = n.waypointIndex < n.waypoints.length;
  const sciencePhase = isAst ? SCIENCE_PHASES_ASTEROID.includes(phase.id) : phase.id === 'entry' || survey;
  const science = sciencePhase && !pauseNow && t >= n.sciencePausedUntil;
  const cameras = t >= n.camsPausedUntil;
  const held = holdNow || t < n.holdUntil;
  const rotorOk = has('rotor_system') && !n.off.includes('rotor_system');
  const wp = n.waypoints[n.waypointIndex];
  const dwelling = survey && n.dwellLeft > 0;
  const mode: ScienceMode = wp?.mode ?? 'fast';
  const wantsFly = (phase.id === 'entry' && pt >= TITAN.rotorDeployTick) || (survey && routeLeft && !dwelling);
  const hovering = dwelling && mode === 'fast';
  const rotor = rotorOk && !held && (wantsFly || hovering);
  const act: Activity = isAst ? asteroidActivity(n, build, phase.id, pt, held, science, cameras) : { rotor, science, cameras, cruise: phase.id === 'cruise' };

  // 3. Energy (ТЗ §6).
  const loads = loadsFor(n, build, mission, stats, act);
  const hasPdu = has('pdu') && !n.off.includes('pdu');
  const demandBefore = sumWatts(loads, n.off);
  const e = stepEnergy({ stored: n.stored, capacityWh: stats.capacityWh, generation: stats.generation, loads, off: n.off, hasPdu });
  n.stored = e.stored;
  n.off = e.off;
  if (stats.smartShed) n.autoShed = [...(n.autoShed ?? []), ...e.shed];
  for (const id of e.shed) {
    const top = stats.consumptionByLoad.filter((l) => l.id !== 'frame').slice(0, 3).map((l) => l.id);
    cause({
      kind: 'shed', ref: 'battery-empty', causeIds: [id, 'deficit', ...top],
      ...ev(m('fl.batteryEmpty', { name: nameOf(id), demand: demandBefore, gen: stats.generation })),
    });
  }

  // 3b. PDU v2: bring back what the empty battery switched off, one line per tick, once there is charge again.
  if (stats.smartShed && n.autoShed?.length && stats.capacityWh > 0 && (n.stored / stats.capacityWh) * 100 > UPGRADE_FX.pduV2RestorePct) {
    const id = n.autoShed.shift()!;
    if (n.off.includes(id) && !n.broken.includes(id)) {
      n.off = n.off.filter((x) => x !== id);
      cause({ kind: 'shed', ref: 'pdu-restore', causeIds: ['pdu', id], ...ev(m('fl.pduRestore', { name: nameOf(id) })) });
    }
  }

  // 4. Bus protection: once Power Drop has happened (or no crisis slot is left), an overloaded bus trips at once.
  let busLoad = sumWatts(loads, n.off);
  if (stats.busLimit > 0 && busLoad > stats.busLimit && n.crisis?.kind !== 'power_drop'
    && (n.crisesSeen.includes('power_drop') || (isAst ? genericSlotsUsed(n) >= ASTEROID.crisis.maxGeneric : n.crisesSeen.length >= TITAN.crisis.max))) {
    const ids = pickShed(loads, n.off, busLoad - stats.busLimit, hasPdu);
    for (const id of ids) {
      n.off.push(id);
      cause({ kind: 'shed', ref: 'bus-trip', causeIds: ['power_bus', 'bus-overload', id], ...ev(m('fl.busTrip', { name: nameOf(id), load: busLoad, limit: stats.busLimit })) });
    }
    busLoad = sumWatts(loads, n.off);
  }
  n.power = { generation: stats.generation, demand: busLoad, busLoad, busLimit: stats.busLimit, net: Math.round((stats.generation - busLoad) * 10) / 10 };

  // 5. Heat.
  n.heat = heatFor(n, build, mission, act, n.off);
  const prevThermal = n.thermal;
  n.thermal = thermalOf(n.heat);
  n.coldTicks = n.thermal === 'freezing' ? n.coldTicks + 1 : 0;
  n.hotTicks = n.thermal === 'overheat' ? n.hotTicks + 1 : 0;
  n.warmTicks = phase.id !== 'cruise' && (n.thermal === 'overheat' || n.thermal === 'hot') ? n.warmTicks + 1 : 0;
  if (n.thermal !== prevThermal && (n.thermal === 'freezing' || n.thermal === 'overheat')) {
    cause({ kind: 'thermal', ref: n.thermal, causeIds: n.thermal === 'freezing' ? ['freeze', 'cold', 'thermal_insulation', 'heater'] : ['overheat', 'hot', 'rtg', 'thermal_radiator'], ...ev(m(n.thermal === 'freezing' ? 'fl.cooling' : 'fl.heating', { heat: n.heat })) });
  }

  // 6. Route between waypoints.
  const rotorNow = rotor && !n.off.includes('rotor_system');
  if (survey && routeLeft) {
    if (n.dwellLeft > 0) {
      n.dwellLeft--;
      n.waypointProgress = 1;
      if (n.dwellLeft === 0) {
        cause({ kind: 'route', ref: 'waypoint-left', causeIds: [], ...ev(m('fl.waypointLeft', { name: wp.name })) });
        n.waypointIndex++;
        n.waypointProgress = 0;
      }
    } else if (rotorNow) {
      n.waypointProgress = Math.min(1, n.waypointProgress + (overweightSpeed(stats) * n.speedFactor) / TITAN.legTicks);
      if (n.waypointProgress >= 1) {
        wp.reached = true;
        n.dwellLeft = TITAN.dwell[wp.mode ?? 'fast'];
        cause({ kind: 'route', ref: 'waypoint', causeIds: [], ...ev(m('fl.waypoint', { name: wp.name, mode: m(wp.mode === 'precise' ? 'fl.waypointPrecise' : 'fl.waypointFast') })) });
      }
    } else if (has('rotor_system') && !n.off.includes('rotor_system')) {
      n.stoppedTicks++; // held by a crisis option, Safe Protocol or a rule
    }
  }
  if (isAst) {
    stepAsteroid(n, build, stats, phase.id, pt, held, rules, cause);
    if (held && ['approach', 'sampling'].includes(phase.id)) n.stoppedTicks++;
  }
  n.route = (() => {
    if (isAst) return phase.id === 'sampling' || phase.id === 'site' ? 'landed' : 'flying';
    if (phase.id === 'cruise') return 'flying';
    if (phase.id === 'entry') return rotorNow || pt < TITAN.rotorDeployTick ? 'flying' : 'stopped';
    if (survey) {
      if (!routeLeft) return 'landed';
      if (n.dwellLeft > 0 || n.waypointProgress >= 1) return mode === 'precise' || !rotorNow ? 'landed' : 'flying';
      return rotorNow ? 'flying' : 'stopped';
    }
    return n.waypoints.length && n.waypoints.some((w) => !w.reached) ? 'stopped' : 'landed';
  })();

  // 7. Science → memory.
  const atWaypoint = survey && wp && wp.reached && n.waypointIndex < n.waypoints.length;
  const landed = atWaypoint && (mode === 'precise' || !rotorNow);
  const thermalQ = TITAN.thermalQuality[n.thermal] ?? 1;
  const cap = memoryCap(stats);
  n.memoryCap = cap;
  let free = Math.max(0, cap - memoryUsed(n));
  let lostToMemory = 0;
  const defs = targetDefsFor(f.mission);
  const ast = n.asteroid;
  const touched = !!ast && (ast.samplingProgress > 0 || ast.sample.collected);
  for (const tg of n.targets) {
    const def = defs.find((d) => d.id === tg.id)!;
    tg.possible = tg.need.some((id) => has(id) && !n.off.includes(id) && !n.broken.includes(id));
    if (!science) continue;
    let amount = 0;
    let qsum = 0;
    for (const r of def.rates) {
      const count = build[r.instrument] ?? 0;
      if (!count || n.off.includes(r.instrument) || n.broken.includes(r.instrument)) continue;
      if (CAMERAS.includes(r.instrument) && !cameras) continue;
      let rate = 0;
      let q = r.quality * thermalQ * taskQuality(n.tasks, r.instrument);
      if (r.phases) {
        rate = r.phases[phase.id] ?? 0;
        if (r.contact?.includes(phase.id) && !touched) rate = 0;
        if (r.sample?.includes(phase.id) && !ast?.sample.collected) rate = 0;
        if (tg.id === 'composition' && ast?.site && phase.id !== 'approach') { rate *= SITE_BY_ID[ast.site].science; q *= SITE_BY_ID[ast.site].quality; }
      } else if (phase.id === 'entry') rate = r.entry ?? 0;
      else if (atWaypoint) {
        rate = (r.dwell ?? 0) * TITAN.modeRate[mode] + (landed ? r.landed ?? 0 : 0);
        q *= TITAN.modeQuality[mode];
        if (r.landed && !has('landing_system')) q *= TITAN.noLandingGearQuality;
      } else if (rotorNow) rate = r.flying ?? 0;
      else rate = (r.dwell ?? 0) * 0.5;
      if (stormOn && CAMERAS.includes(r.instrument)) q *= TITAN.storm.cameraQuality;
      const a = taskRate(n.tasks, r.instrument, rate * count);
      amount += a;
      qsum += a * q;
    }
    if (amount <= 0) continue;
    const room = Math.max(0, tg.required * TITAN.dataCapFactor - tg.collected);
    const want = Math.min(amount, room);
    if (want > free) free += evictFor(n, tg.id, want - free, cause); // comms queue: overwrite less important data
    const take = Math.min(want, free);
    if (want > take) lostToMemory += want - take;
    tg.lost += want - take;
    if (take > 0) {
      const q = qsum / amount;
      tg.quality = (tg.quality * tg.collected + q * take) / (tg.collected + take);
      tg.collected += take;
      tg.stored += take;
      free -= take;
    }
  }
  n.lostMemory += lostToMemory;
  const wasFull = n.queueFull;
  n.queueFull = lostToMemory > 0;
  if (n.queueFull && !wasFull && !n.causes.some((c) => c.ref === 'memory-full')) {
    cause({ kind: 'data', ref: 'memory-full', causeIds: ['data_storage', 'data_buffer', ...ANTENNAS.filter(has)], ...ev(m('fl.memoryFull', { cap })) });
  }

  // 8. Signal + downlink.
  n.signal = lost ? 'lost' : stormOn ? 'interference' : mission.signalDelay > 0 ? 'delay' : 'ok';
  if (!lost) {
    const fullBudget = stats.bandwidth * TICK_HOURS * (n.ecoLink ? 0.5 : 1) * (stormOn ? n.storm!.factor : 1);
    let budget = fullBudget * taskBandwidth(n.tasks); // antenna pointing (Individual Tasks)
    const loss = 1 - (1 - (stormOn ? n.storm!.loss : 0)) * (1 - taskLoss(n.tasks)); // storm + packets that miss Earth
    const order = [...n.targets].filter((x) => x.stored > 0).sort((a, b) => {
      if (n.downlinkFirst && (a.id === n.downlinkFirst) !== (b.id === n.downlinkFirst)) return a.id === n.downlinkFirst ? -1 : 1;
      const ra = Math.max(0, a.required - a.sent), rb = Math.max(0, b.required - b.sent);
      if ((ra > 0) !== (rb > 0)) return ra > 0 ? -1 : 1;
      return (n.tasks?.queue ? queueIndex(n.tasks, a.id) - queueIndex(n.tasks, b.id) : 0) || ra - rb;
    });
    for (const tg of order) {
      if (budget <= 0) break;
      const take = Math.min(budget, tg.stored);
      budget -= take;
      tg.stored -= take;
      tg.sent += take * (1 - loss);
      tg.lost += take * loss;
      n.lostNoise += take * loss;
    }
    noteAimLoss(n.tasks, fullBudget, n.targets.reduce((s, x) => s + x.stored, 0));
  }
  n.dataOnboard = memoryUsed(n);
  n.dataSent = n.targets.reduce((s, x) => s + x.sent, 0);
  for (const tg of n.targets) {
    if (tg.sent >= tg.required && !n.causes.some((c) => c.ref === `delivered:${tg.id}`)) {
      cause({ kind: 'science', ref: `delivered:${tg.id}`, causeIds: tg.need.filter(has), ...ev(m('fl.delivered', { name: tg.name })) });
    }
  }

  // 9. Crises: resolve by deadline, or detect a new one (one at a time).
  if (n.crisis) {
    if (t >= n.crisis.deadlineTick) resolveCrisis(n, build, stats, rules);
  } else {
    const snap = { loads, busLoad: demandBefore, stormOn, phaseId: phase.id };
    const c = (isAst ? detectAsteroidCrisis(n, build, stats, phase.id, pt, seed) : null)
      ?? (genericCrisisAllowed(n) ? detectCrisis(n, build, stats, snap) : null);
    if (c) {
      // 0013 §3, «Слаженная команда» (Team Trust ≥ 80 at launch): more time to decide. The blackout link is not touched.
      if (n.crisisBonus) c.deadlineTick += n.crisisBonus;
      if (c.kind === 'power_drop') onPowerDrop(n, c, cause); // Individual Tasks: harsher with a badly routed grid
      n.crisis = c;
      n.crisesSeen.push(c.kind);
      cause({ kind: 'crisis', ref: `crisis:${c.kind}`, causeIds: c.causeIds, ...ev(m('fl.crisis', { title: c.title, text: c.i18n?.text ?? c.text })) });
    }
  }

  // 10. Phases.
  n.phaseTick = f.phaseTick + 1;
  const surveyDone = (survey && n.waypointIndex >= n.waypoints.length) || (isAst && asteroidPhaseDone(n, phase.id));
  if (n.phaseTick >= phase.ticks || surveyDone) {
    if (isAst) onAsteroidPhaseEnd(n, build, phase.id, cause);
    if (survey && n.waypoints.some((w) => !w.reached)) {
      const missed = n.waypoints.filter((w) => !w.reached).map((w) => w.name);
      cause({ kind: 'route', ref: 'route-short', causeIds: routeCauses(n, build, stats), ...ev(m('fl.routeShort', { missed: join(missed, ', ') })) });
      n.dwellLeft = 0;
    }
    if (survey) {
      n.dwellLeft = 0;
      if (n.waypoints[n.waypointIndex]?.reached) { n.waypointIndex++; n.waypointProgress = 0; }
    }
    n.phaseIndex = f.phaseIndex + 1;
    n.phaseTick = 0;
    if (n.phaseIndex >= mission.phases.length) {
      if (n.crisis) resolveCrisis(n, build, stats, rules);
      if (isAst) onAsteroidFinal(n, build, cause);
      const ob = n.blackouts.find((b) => b.to === -1);
      if (ob) ob.to = t;
      n.done = true;
      cause({ kind: 'phase', ref: 'final', causeIds: [], ...ev(m('fl.final')) });
    } else {
      const next = mission.phases[n.phaseIndex];
      cause({ kind: 'phase', causeIds: [], ...ev(m('fl.phase', { name: next.name })) });
      if (next.id === 'entry') onEntry(n, build, stats, cause);
      if (isAst) onAsteroidPhaseStart(n, build, next.id, seed, cause);
    }
  }
  recordReplay(f, n);
  return n;
}

/** Entry into the atmosphere: an overweight craft enters harder and its rotors work harder (ТЗ test C). */
function onEntry(n: FlightState, build: Build, stats: CraftStats, cause: (e: Omit<CauseEvent, 'tick'>) => void) {
  const ratio = overRatio(stats);
  if (ratio <= 0) return;
  const over = stats.mass - stats.massLimit;
  const dmg = Math.min(TITAN.overweight.hullMax, Math.round(ratio * TITAN.overweight.hullPerRatio));
  n.hull = Math.max(0, n.hull - dmg);
  const extra = Math.round(ratio * TITAN.overweight.drawPerRatio * 100);
  const slower = Math.round((1 - Math.max(TITAN.overweight.minSpeed, 1 - ratio * TITAN.overweight.speedPerRatio)) * 100);
  cause({
    kind: 'mass', ref: 'overweight', causeIds: ['mass', ...heaviest(build)],
    ...ev(m('fl.overweight', { over, dmg, extra, slower })),
  });
}

/** Two heaviest installed parts (what the report suggests to reconsider). */
function heaviest(build: Build): string[] {
  return installed(build).sort((a, b) => b.def.mass * b.count - a.def.mass * a.count).slice(0, 2).map((x) => x.def.id);
}

function routeCauses(n: FlightState, build: Build, stats: CraftStats): string[] {
  const ids: string[] = [];
  if (!(build.rotor_system > 0)) ids.push('rotor_system');
  if (n.off.includes('rotor_system')) {
    ids.push('rotor_system');
    const why = n.causes.find((c) => c.causeIds[0] === 'rotor_system' && c.kind === 'shed');
    if (why) ids.push(...why.causeIds.slice(1));
  }
  if (overRatio(stats) > 0) ids.push('mass');
  if (n.speedFactor < 1) ids.push('slow');
  if (n.stoppedTicks > 0) ids.push('holds');
  if (n.waypoints.filter((w) => w.reached && w.mode === 'precise').length >= 2) ids.push('precise');
  return [...new Set(ids)];
}

/** Science officer picks the measurement mode for a waypoint (before or while standing at it). */
export function setScienceMode(f: FlightState, waypoint: WaypointId, mode: ScienceMode): { flight: FlightState; error?: string; errorMsg?: Msg } {
  const fail = (k: string) => { const errorMsg = m(k); return { flight: f, error: ru(errorMsg), errorMsg }; };
  const i = f.waypoints.findIndex((w) => w.id === waypoint);
  if (i < 0) return fail('fl.err.noWaypoint');
  if (i < f.waypointIndex) return fail('fl.err.waypointPassed');
  const n = structuredClone(f);
  const w = n.waypoints[i];
  const old = w.mode ?? 'fast';
  w.mode = mode;
  if (i === n.waypointIndex && n.dwellLeft > 0) n.dwellLeft = Math.max(1, n.dwellLeft + TITAN.dwell[mode] - TITAN.dwell[old]);
  const label = m('fl.modeLabel', { mode: m(mode === 'precise' ? 'fl.modeLabelPrecise' : 'fl.modeLabelFast'), name: w.name });
  trackCommand(n, { role: 'science', kind: 'science_mode', label: ru(label), shown: true, i18n: { label } });
  n.causes.push({ tick: n.tick, kind: 'science', ref: `mode:${w.id}`, causeIds: [], ...ev(m('fl.modeChosen', { mode: m(mode === 'precise' ? 'fl.modeChosenPrecise' : 'fl.modeChosenFast'), name: w.name })) });
  return { flight: n };
}
