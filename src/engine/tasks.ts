// Individual Tasks (TZ screen 10, decision 0013 §1): four role mini-games between the constructor and the readiness check.
// Pure and deterministic: setup (what each role sees) → score (0..1 → grade) → flight modifiers (TaskFlight) that
// flight.ts, sim.ts and crises.ts read → report lines. Numbers live in data/tasks.ts.
// In flight the same mechanics return as short crisis actions: re-aim after a blackout, isolate a node in Power Drop,
// lower the measurement intensity in Overheat.
import { COMPONENT_BY_ID } from './data/components';
import { MISSIONS } from './data/missions';
import { TARGET_DEFS } from './data/titan';
import { ASTEROID_TARGET_DEFS } from './data/asteroid';
import {
  CALIB_BASE, CALIBRATED, GOALS, GRADE_AT, KEEP_VALUE, TASK_ROLES, TASKS,
  type Grade, type MeasureMode,
} from './data/tasks';
import { chooseOption } from './crises';
import { rng } from './rng';
import { computeStats, installed } from './stats';
import { isInstrument, nameMsg, thermalOf } from './sim';
import { join, m, ru, type Msg, type Params } from './msg';
import { THERMAL } from './constants';
import type { ActiveCrisis, Blackout, CauseEvent, CrisisOption, FlightState, ScienceTargetId } from './flight';
import type { CauseChain } from './report';
import type { Build, CraftStats, MissionId, Mods, RoleId } from './types';

export type { Grade, MeasureMode } from './data/tasks';
export { TASKS, TASK_ROLES, GOALS, SPECTRA, GRADE_AT } from './data/tasks';

/**
 * Engine prose (log, crisis options, report chains) lives in the dictionary (`task.*`, src/i18n/dict/engine_room.ts):
 * the engine keeps the Russian text and attaches the message (`i18n`). The task screen has its own TEXT in src/ui/screens/Tasks.tsx.
 */
const tm = (k: string, p?: Params) => m(`task.${k}`, p);
const GOAL_IDS = new Set(['atmo_profile', 'surface_images', 'surface_chem', 'route', 'env_temp', 'sample', 'composition', 'capsule', 'site_images']);
/** `{ text, i18n: { text } }` for a cause event. */
const said = (msg: Msg) => ({ text: ru(msg), i18n: { text: msg } });
/** Error result: Russian `error` + `errorMsg`. */
const fault = (k: string, p?: Params) => { const msg = tm(`error.${k}`, p); return { error: ru(msg), errorMsg: msg }; };
/** Crisis option texts: Russian `label` / `hint` + `i18n`. */
const optText = (label: Msg, hint: Msg) => ({ label: ru(label), hint: ru(hint), i18n: { label, hint } });
/** Report chain texts: Russian `what` / `why` / `couldDo` + `i18n`. */
const chainText = (what: Msg, why: Msg, couldDo: Msg) => ({ what: ru(what), why: ru(why), couldDo: ru(couldDo), i18n: { what, why, couldDo } });
const tc = (k: string, p?: Params) => tm(`chain.${k}`, p);
const modeMsg_ = (mode: MeasureMode) => tm(`mode.${mode}`);
const lineMsg = (line: Line) => tm(`line.${line}`);
const namesMsg = (ids: string[]) => join(ids.map(nameMsg), ', ');
const hullMsg = (hull: number) => (hull ? tm('log.harshHull', { n: hull }) : '');

// ── Types ──

export type Line = 'main' | 'secondary';
export interface CommanderAnswer { goals: string[]; sacrifice: string[] }
export interface EngineerAnswer { lines: Record<string, Line> }
export interface ScienceAnswer { knobs: Record<string, number>; mode: MeasureMode }
export interface CommsAnswer { aim: { x: number; y: number }; queue: ScienceTargetId[] }
export interface TaskAnswers { commander: CommanderAnswer; engineer: EngineerAnswer; science: ScienceAnswer; comms: CommsAnswer }
export type AnyAnswer = TaskAnswers[RoleId];

/** Why a score is what it is: machine ids + numbers (the UI words them). */
export interface TaskNote { id: string; n?: Record<string, number | string> }

export interface TaskResult {
  role: RoleId;
  skipped: boolean;
  answer: AnyAnswer | null;
  by: string;
  /** Attempt (agency.history.length) and the build signature it was done for: a mismatch makes it stale. */
  attempt: number;
  key: string;
  score: number;
  grade: Grade;
  notes: TaskNote[];
}

export interface TasksState { results: Partial<Record<RoleId, TaskResult>> }

export interface TaskCtx { mission: MissionId; build: Build; seed: number; attempt: number; mods?: Mods }

/** Context of a room (the parts tasks read). */
export function taskCtx(s: { mission: MissionId; build: Build; seed: number; agency?: { history: unknown[]; upgrades: Mods['upgrades']; extraSlot?: Mods['extraSlot'] } }): TaskCtx {
  return { mission: s.mission, build: s.build, seed: s.seed, attempt: s.agency?.history.length ?? 0, mods: s.agency ? { upgrades: s.agency.upgrades, extraSlot: s.agency.extraSlot } : undefined };
}

// ── Small helpers ──

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const r2 = (x: number) => Math.round(x * 100) / 100;
const has = (b: Build, id: string) => (b[id] ?? 0) > 0;
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const rand = (ctx: Pick<TaskCtx, 'seed' | 'attempt' | 'mission'>, salt: string) => rng((ctx.seed ^ hash(`${ctx.mission}:${ctx.attempt}:${salt}`)) >>> 0);
export const gradeOf = (score: number): Grade => (score >= GRADE_AT.excellent ? 'excellent' : score >= GRADE_AT.good ? 'good' : 'weak');
const targetDefs = (m: MissionId) => (m === 'asteroid' ? ASTEROID_TARGET_DEFS : TARGET_DEFS);

/**
 * Ordering score 0..1: items earlier in `order` weigh more; 1 = the most valuable first, 0 = reversed.
 * Ties (equal values) never cost points.
 */
export function orderScore(order: string[], value: (id: string) => number): number {
  const n = order.length;
  if (n < 2) return 1;
  const vals = order.map(value);
  const w = (k: number) => n - k;
  const s = vals.reduce((acc, v, k) => acc + v * w(k), 0);
  const desc = [...vals].sort((a, b) => b - a).reduce((acc, v, k) => acc + v * w(k), 0);
  const asc = [...vals].sort((a, b) => a - b).reduce((acc, v, k) => acc + v * w(k), 0);
  return desc === asc ? 1 : clamp((s - asc) / (desc - asc));
}

/** Shuffle by the task seed (default orders must not be the answer). */
function shuffled<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── Commander: mission priorities + sacrifice order ──

export interface GoalCard { id: string; value: number; possible: boolean; systems: string[]; targets: ScienceTargetId[] }
export interface SacrificeItem { id: string; watts: number; instrument: boolean; goals: string[] }
export interface CommanderSetup { goals: GoalCard[]; items: SacrificeItem[]; locked: { id: string; watts: number }[]; initial: CommanderAnswer }

export function commanderSetup(ctx: TaskCtx): CommanderSetup {
  const goals = GOALS[ctx.mission].map((g) => {
    const systems = g.systems.filter((id) => has(ctx.build, id));
    return { id: g.id, value: g.value, possible: systems.length > 0, systems, targets: g.targets };
  });
  const items: SacrificeItem[] = [];
  const locked: { id: string; watts: number }[] = [];
  for (const { def, count } of installed(ctx.build, ctx.mods)) {
    if (!def.consumption) continue;
    const watts = def.consumption * count;
    if (def.priority <= 1) { locked.push({ id: def.id, watts }); continue; }
    items.push({ id: def.id, watts, instrument: isInstrument(def), goals: goals.filter((g) => g.systems.includes(def.id)).map((g) => g.id) });
  }
  const r = rand(ctx, 'commander');
  return {
    goals, items, locked,
    // Naive start: goals shuffled, sacrifice «biggest first» (on Titan that is the rotor — the lesson).
    initial: { goals: shuffled(goals.map((g) => g.id), r), sacrifice: [...items].sort((a, b) => b.watts - a.watts || a.id.localeCompare(b.id)).map((i) => i.id) },
  };
}

/** How much the mission needs a system (higher = sacrifice later), with the commander's goal ranking for instruments. */
export function keepValue(ctx: TaskCtx, id: string, goalOrder: string[]): number {
  const fixed = KEEP_VALUE[ctx.mission][id];
  if (fixed !== undefined) return fixed;
  const def = COMPONENT_BY_ID[id];
  if (def && isInstrument(def)) {
    const goals = GOALS[ctx.mission];
    const ranks = goals.filter((g) => g.systems.includes(id)).map((g) => goalOrder.indexOf(g.id)).filter((i) => i >= 0);
    return ranks.length ? 1 + (goals.length - Math.min(...ranks)) : 1;
  }
  return TASKS.commander.otherKeep;
}

function normCommander(a: CommanderAnswer, s: CommanderSetup): CommanderAnswer {
  const g = s.goals.map((x) => x.id);
  const i = s.items.map((x) => x.id);
  const keep = (order: string[] | undefined, all: string[]) => [...(order ?? []).filter((id) => all.includes(id)), ...all.filter((id) => !(order ?? []).includes(id))];
  return { goals: [...new Set(keep(a?.goals, g))], sacrifice: [...new Set(keep(a?.sacrifice, i))] };
}

function scoreCommander(a: CommanderAnswer, ctx: TaskCtx) {
  const s = commanderSetup(ctx);
  const ans = normCommander(a, s);
  const value = (id: string) => { const g = s.goals.find((x) => x.id === id)!; return g.possible ? g.value : 0; };
  const goal = orderScore(ans.goals, value);
  const keep = ans.sacrifice.map((id) => keepValue(ctx, id, ans.goals));
  let inv = 0, max = 0;
  for (let i = 0; i < keep.length; i++) for (let j = i + 1; j < keep.length; j++) {
    max += Math.abs(keep[i] - keep[j]);
    if (keep[i] > keep[j]) inv += keep[i] - keep[j];
  }
  const sacrifice = max === 0 ? 1 : 1 - inv / max;
  const score = TASKS.commander.goalWeight * goal + (1 - TASKS.commander.goalWeight) * sacrifice;
  const notes: TaskNote[] = [{ id: 'goals', n: { pct: Math.round(goal * 100) } }, { id: 'sacrifice', n: { pct: Math.round(sacrifice * 100) } }];
  const impossibleHigh = ans.goals.findIndex((id) => !value(id));
  if (impossibleHigh >= 0 && ans.goals.slice(impossibleHigh).some((id) => value(id) > 0)) notes.push({ id: 'goal-impossible', n: { goal: ans.goals[impossibleHigh] } });
  const firstBad = ans.sacrifice.slice(0, 2).find((id) => keepValue(ctx, id, ans.goals) >= TASKS.engineer.mustMainKeep);
  if (firstBad) notes.push({ id: 'sacrifice-critical', n: { node: firstBad } });
  const main = ans.goals.filter((id) => s.goals.find((g) => g.id === id)?.targets.length && value(id) > 0).slice(0, 2);
  return { score, answer: ans, notes, preview: { main, first: ans.sacrifice.slice(0, 3), goal: r2(goal), sacrifice: r2(sacrifice) } };
}

// ── Engineer: power line routing ──

export interface Consumer { id: string; watts: number; priority: number; mustMain: boolean }
export interface EngineerSetup { consumers: Consumer[]; frame: number; caps: { main: number; secondary: number; bus: number }; initial: EngineerAnswer }

export function engineerSetup(ctx: TaskCtx): EngineerSetup {
  const mission = MISSIONS[ctx.mission];
  const stats = computeStats(ctx.build, mission, ctx.mods);
  const E = TASKS.engineer;
  const consumers: Consumer[] = installed(ctx.build, ctx.mods)
    .filter((x) => x.def.consumption)
    .map(({ def, count }) => ({
      id: def.id, watts: def.consumption! * count, priority: def.priority,
      mustMain: def.priority <= E.mustMainPriority || (KEEP_VALUE[ctx.mission][def.id] ?? 0) >= E.mustMainKeep,
    }))
    .sort((a, b) => a.priority - b.priority || b.watts - a.watts);
  const main = Math.round(stats.busLimit * E.mainShare);
  return {
    consumers, frame: mission.baseLoad,
    caps: { main, secondary: stats.busLimit - main, bus: stats.busLimit },
    // Start: everything hangs on the main line — the overload is what the engineer fixes.
    initial: { lines: Object.fromEntries(consumers.map((c) => [c.id, 'main' as Line])) },
  };
}

export function lineLoads(s: EngineerSetup, lines: Record<string, Line>) {
  const main = s.frame + s.consumers.filter((c) => (lines[c.id] ?? 'main') === 'main').reduce((x, c) => x + c.watts, 0);
  const secondary = s.consumers.filter((c) => lines[c.id] === 'secondary').reduce((x, c) => x + c.watts, 0);
  const over = Math.max(0, main - s.caps.main) + Math.max(0, secondary - s.caps.secondary);
  return { main, secondary, over };
}

/** Smallest overload any routing with critical systems on the main line can reach. */
function bestOverload(s: EngineerSetup): number {
  const free = s.consumers.filter((c) => !c.mustMain);
  const fixed = s.frame + s.consumers.filter((c) => c.mustMain).reduce((x, c) => x + c.watts, 0);
  const over = (m: number, sec: number) => Math.max(0, m - s.caps.main) + Math.max(0, sec - s.caps.secondary);
  if (free.length <= 14) {
    let best = Infinity;
    for (let mask = 0; mask < 1 << free.length; mask++) {
      let m = fixed, sec = 0;
      free.forEach((c, i) => { if (mask & (1 << i)) sec += c.watts; else m += c.watts; });
      best = Math.min(best, over(m, sec));
      if (best === 0) break;
    }
    return best;
  }
  let m = fixed, sec = 0;
  for (const c of [...free].sort((a, b) => b.watts - a.watts)) { if (sec + c.watts <= s.caps.secondary) sec += c.watts; else m += c.watts; }
  return over(m, sec);
}

function scoreEngineer(a: EngineerAnswer, ctx: TaskCtx) {
  const s = engineerSetup(ctx);
  const E = TASKS.engineer;
  const lines: Record<string, Line> = Object.fromEntries(s.consumers.map((c) => [c.id, a?.lines?.[c.id] === 'secondary' ? 'secondary' : 'main']));
  const load = lineLoads(s, lines);
  const best = bestOverload(s);
  const excess = Math.max(0, load.over - best);
  const must = s.consumers.filter((c) => c.mustMain);
  const w = (c: Consumer) => (c.priority <= 1 ? 1.5 : 1);
  const wrong = must.filter((c) => lines[c.id] === 'secondary');
  const critShare = must.length ? wrong.reduce((x, c) => x + w(c), 0) / must.reduce((x, c) => x + w(c), 0) : 0;
  const sheddable = s.consumers.filter((c) => !c.mustMain);
  const emptySecondary = sheddable.length > 0 && !sheddable.some((c) => lines[c.id] === 'secondary');
  const overloadPen = excess > 0 ? Math.min(E.overloadMax, E.overloadBase + excess / Math.max(1, s.caps.bus)) : 0;
  const score = clamp(1 - E.critWeight * critShare - overloadPen - (emptySecondary ? E.emptySecondary : 0));
  const notes: TaskNote[] = [];
  for (const c of wrong) notes.push({ id: 'crit-secondary', n: { node: c.id } });
  if (excess > 0) {
    const which: Line = load.main - s.caps.main >= load.secondary - s.caps.secondary ? 'main' : 'secondary';
    notes.push({ id: 'overload', n: { line: which, load: which === 'main' ? load.main : load.secondary, cap: which === 'main' ? s.caps.main : s.caps.secondary, excess } });
  }
  if (best > 0) notes.push({ id: 'bus-small', n: { over: best } });
  if (emptySecondary) notes.push({ id: 'secondary-empty' });
  return { score, answer: { lines }, notes, preview: { ...load, best, excess, caps: s.caps, wrong: wrong.map((c) => c.id) } };
}

// ── Science: calibration + measurement mode ──

export interface CalibInstrument { id: string; peak: number; start: number }
/** Thermal risk of a heat balance: 0 = safe margin, 1 = close to «hot» or already cold, 2 = hot, 3 = overheat / freezing. */
export type ThermalRisk = 0 | 1 | 2 | 3;
export interface ModePreview { mode: MeasureMode; rate: number; heatDelta: number; heat: number; thermal: CraftStats['thermalState']; risk: ThermalRisk }
export interface ScienceSetup { instruments: CalibInstrument[]; modes: ModePreview[]; best: MeasureMode; initial: ScienceAnswer }

/** Heat of the installed instruments (what the measurement mode scales). */
export function instrumentHeat(build: Build, mods?: Mods): number {
  return installed(build, mods).filter((x) => isInstrument(x.def)).reduce((s, x) => s + x.def.heat * x.count, 0);
}

export function thermalRisk(heat: number): ThermalRisk {
  if (heat >= THERMAL.overheat || heat <= THERMAL.freezing) return 3;
  if (heat >= THERMAL.hot) return 2;
  if (heat >= THERMAL.hot - TASKS.science.margin || heat <= THERMAL.cold) return 1;
  return 0;
}

export function scienceSetup(ctx: TaskCtx): ScienceSetup {
  const S = TASKS.science;
  const instruments = CALIBRATED[ctx.mission].filter((id) => has(ctx.build, id)).map((id) => {
    const r = rand(ctx, `calib:${id}`);
    const peak = r2(clamp((CALIB_BASE[id] ?? 0.5) + (r() * 2 - 1) * S.jitter, 0.12, 0.88));
    const off = (0.22 + r() * 0.1) * (peak > 0.5 ? -1 : 1);
    return { id, peak, start: r2(clamp(peak + off, 0.04, 0.96)) };
  });
  const stats = computeStats(ctx.build, MISSIONS[ctx.mission], ctx.mods);
  const ih = instrumentHeat(ctx.build, ctx.mods);
  const modes = (['cautious', 'normal', 'intensive'] as MeasureMode[]).map((mode) => {
    const m = S.modes[ctx.mission][mode];
    const heatDelta = Math.round(ih * (m.heat - 1));
    const heat = stats.heatBalance + heatDelta;
    return { mode, rate: m.rate, heatDelta, heat, thermal: thermalOf(heat), risk: thermalRisk(heat) };
  });
  // Best: the lowest thermal risk; on a tie the one that collects more.
  const best = [...modes].sort((a, b) => a.risk - b.risk || b.rate - a.rate)[0].mode;
  return { instruments, modes, best, initial: { knobs: Object.fromEntries(instruments.map((i) => [i.id, i.start])), mode: 'normal' } };
}

export const calibAccuracy = (knob: number, peak: number) => clamp(1 - Math.abs(knob - peak) / TASKS.science.tolerance);
export const calibQuality = (acc: number) => TASKS.science.qualityMin + (1 - TASKS.science.qualityMin) * acc;
/** Usable data rate of a calibrated instrument (badly tuned → frames rejected). */
export const calibRate = (acc: number) => TASKS.science.rateMin + (TASKS.science.rateMax - TASKS.science.rateMin) * acc;

function scoreScience(a: ScienceAnswer, ctx: TaskCtx) {
  const s = scienceSetup(ctx);
  const mode: MeasureMode = (['cautious', 'normal', 'intensive'] as const).includes(a?.mode) ? a.mode : 'normal';
  const accs = s.instruments.map((i) => ({ id: i.id, acc: calibAccuracy(a?.knobs?.[i.id] ?? i.start, i.peak) }));
  const calib = accs.length ? accs.reduce((x, y) => x + y.acc, 0) / accs.length : 1;
  const chosen = s.modes.find((m) => m.mode === mode)!;
  const best = s.modes.find((m) => m.mode === s.best)!;
  const gap = chosen.risk - best.risk;
  const modeScore = mode === s.best || gap <= 0 ? 1 : gap === 1 ? 0.5 : 0;
  const score = TASKS.science.calibWeight * calib + (1 - TASKS.science.calibWeight) * modeScore;
  const notes: TaskNote[] = accs.filter((x) => x.acc < 0.85).map((x) => ({ id: 'calib-off', n: { node: x.id, pct: Math.round(x.acc * 100) } }));
  if (modeScore < 1) notes.push({ id: 'mode', n: { mode, best: s.best, thermal: chosen.thermal } });
  const quality = accs.length ? accs.reduce((x, y) => x + calibQuality(y.acc), 0) / accs.length : 1;
  return {
    score, answer: { knobs: Object.fromEntries(accs.map((x) => [x.id, a?.knobs?.[x.id] ?? s.instruments.find((i) => i.id === x.id)!.start])), mode }, notes,
    preview: { quality: r2(quality), dataPct: Math.round((chosen.rate - 1) * 100), heatDelta: chosen.heatDelta, thermal: chosen.thermal, calib: r2(calib), accs },
  };
}

// ── Comms: antenna pointing + packet queue ──

export interface CommsSetup {
  /** Earth on the radar (radius 1). The UI uses it only through the noisy signal meter. */
  earth: { x: number; y: number };
  beam: number;
  noise: number;
  antenna: string | null;
  targets: { id: ScienceTargetId; possible: boolean }[];
  initial: CommsAnswer;
}

/** Narrowest beam of the installed antennas (High-Gain is precise and demanding, omni is forgiving). */
export function beamOf(build: Build): { beam: number; antenna: string | null } {
  const ids = ['antenna_high_gain', 'antenna_standard', 'antenna_omni'].filter((id) => has(build, id));
  if (!ids.length) return { beam: TASKS.comms.beam.antenna_omni, antenna: null };
  return { beam: TASKS.comms.beam[ids[0]], antenna: ids[0] };
}

export function earthAt(ctx: Pick<TaskCtx, 'seed' | 'attempt' | 'mission'>, salt = 'earth'): { x: number; y: number } {
  const r = rand(ctx, salt);
  const a = r() * Math.PI * 2;
  const d = 0.35 + r() * 0.45;
  return { x: r2(Math.cos(a) * d), y: r2(Math.sin(a) * d) };
}

export const aimAccuracy = (aim: { x: number; y: number }, earth: { x: number; y: number }, beam: number) =>
  clamp(1 - (Math.hypot(aim.x - earth.x, aim.y - earth.y) / beam) ** 2);
/** True signal strength (0..1) — the UI adds noise. */
export const signalAt = (aim: { x: number; y: number }, earth: { x: number; y: number }, beam: number) =>
  Math.exp(-1.5 * (Math.hypot(aim.x - earth.x, aim.y - earth.y) / beam) ** 2);
export const bandwidthFactor = (acc: number) => TASKS.comms.bandwidthMin + (TASKS.comms.bandwidthMax - TASKS.comms.bandwidthMin) * acc;

export function commsSetup(ctx: TaskCtx): CommsSetup {
  const { beam, antenna } = beamOf(ctx.build);
  const targets = targetDefs(ctx.mission).map((t) => ({ id: t.id, possible: t.rates.some((r) => has(ctx.build, r.instrument)) }));
  return {
    earth: earthAt(ctx), beam, noise: TASKS.comms.noise[ctx.mission], antenna, targets,
    initial: { aim: { x: 0, y: 0 }, queue: shuffled(targets.map((t) => t.id), rand(ctx, 'queue')) },
  };
}

/** Value of a science target for the packet queue (its goal's value; 0 if nothing can collect it). */
export function targetValue(mission: MissionId, id: ScienceTargetId, possible: boolean): number {
  if (!possible) return 0;
  return GOALS[mission].find((g) => g.targets.includes(id))?.value ?? 1;
}

function scoreComms(a: CommsAnswer, ctx: TaskCtx) {
  const s = commsSetup(ctx);
  const C = TASKS.comms;
  const aim = a?.aim && Number.isFinite(a.aim.x) && Number.isFinite(a.aim.y) ? { x: clamp(a.aim.x, -1, 1), y: clamp(a.aim.y, -1, 1) } : { x: 0, y: 0 };
  const acc = s.antenna ? aimAccuracy(aim, s.earth, s.beam) : 0;
  const ids = s.targets.map((t) => t.id);
  const queue = [...new Set([...(a?.queue ?? []).filter((id) => ids.includes(id)), ...ids])];
  const q = orderScore(queue, (id) => targetValue(ctx.mission, id as ScienceTargetId, s.targets.find((t) => t.id === id)!.possible));
  const score = C.aimWeight * acc + (1 - C.aimWeight) * q;
  const notes: TaskNote[] = [];
  if (acc < 0.85) notes.push({ id: 'aim', n: { pct: Math.round(acc * 100) } });
  if (q < 0.85) notes.push({ id: 'queue', n: { pct: Math.round(q * 100), first: queue[0] } });
  return { score, answer: { aim: { x: r2(aim.x), y: r2(aim.y) }, queue }, notes, preview: { acc: r2(acc), bandwidth: r2(bandwidthFactor(acc)), queue: r2(q) } };
}

// ── Scoring entry point ──

export type TaskScore = { score: number; grade: Grade; answer: AnyAnswer; notes: TaskNote[]; preview: Record<string, unknown> };

export function scoreTask(role: RoleId, answer: AnyAnswer | null, ctx: TaskCtx): TaskScore {
  const r = role === 'commander' ? scoreCommander(answer as CommanderAnswer, ctx)
    : role === 'engineer' ? scoreEngineer(answer as EngineerAnswer, ctx)
    : role === 'science' ? scoreScience(answer as ScienceAnswer, ctx)
    : scoreComms(answer as CommsAnswer, ctx);
  const score = r2(clamp(r.score));
  return { score, grade: gradeOf(score), answer: r.answer, notes: r.notes, preview: r.preview };
}

/** Typed previews for the UI. */
export const previewCommander = (a: CommanderAnswer, ctx: TaskCtx) => scoreCommander(a, ctx).preview;
export const previewEngineer = (a: EngineerAnswer, ctx: TaskCtx) => scoreEngineer(a, ctx).preview;
export const previewScience = (a: ScienceAnswer, ctx: TaskCtx) => scoreScience(a, ctx).preview;
export const previewComms = (a: CommsAnswer, ctx: TaskCtx) => scoreComms(a, ctx).preview;

/** Build signature of what a role's task depends on: a change makes the result stale (redo it). */
export function taskKey(role: RoleId, ctx: TaskCtx): string {
  const b = ctx.build;
  const ids = (pred: (id: string) => boolean) => Object.keys(b).filter((id) => b[id] > 0 && pred(id)).sort().map((id) => `${id}${b[id]}`).join(',');
  const cons = (id: string) => !!COMPONENT_BY_ID[id]?.consumption;
  const body = role === 'commander' ? ids(cons)
    : role === 'engineer' ? `${ids((id) => cons(id) || id === 'power_bus')}|${ctx.mods?.upgrades.filter((u) => u === 'pdu_v2' || u === 'fc_v2' || u === 'better_antennas').join(',') ?? ''}`
    : role === 'science' ? ids((id) => CALIBRATED[ctx.mission].includes(id))
    : ids((id) => COMPONENT_BY_ID[id]?.department === 'comms' || targetDefs(ctx.mission).some((t) => t.rates.some((r) => r.instrument === id)));
  return `${ctx.mission}|${body}`;
}

// ── Room side ──

export type TaskStatus = 'todo' | 'done' | 'stale';

export function taskStatus(tasks: TasksState | undefined | null, role: RoleId, ctx: TaskCtx): TaskStatus {
  const r = tasks?.results[role];
  if (!r) return 'todo';
  return r.attempt === ctx.attempt && r.key === taskKey(role, ctx) ? 'done' : 'stale';
}

export function tasksReady(tasks: TasksState | undefined | null, ctx: TaskCtx): { ready: boolean; waiting: RoleId[] } {
  const waiting = TASK_ROLES.filter((r) => taskStatus(tasks, r, ctx) !== 'done');
  return { ready: waiting.length === 0, waiting };
}

interface PlayerLike { id: string; role: RoleId | null; online: boolean; roles?: RoleId[] }

/** Roles a player holds (2–3 player rooms may give one player several roles). */
export const heldRoles = (p: PlayerLike): RoleId[] => (p.roles?.length ? p.roles : p.role ? [p.role] : []);

/** Roles this player may do the task of: own roles; in demo also every role nobody else holds. */
export function taskRolesOf(room: { demo: boolean; players: PlayerLike[] }, playerId: string): RoleId[] {
  const me = room.players.find((p) => p.id === playerId);
  if (!me) return [];
  const mine = heldRoles(me);
  if (!room.demo) return TASK_ROLES.filter((r) => mine.includes(r));
  const others = new Set(room.players.filter((p) => p.id !== playerId).flatMap(heldRoles));
  return TASK_ROLES.filter((r) => mine.includes(r) || !others.has(r));
}

/** Submit (answer) or skip (null) a role task. Returns the new tasks state or an error. */
export function submitTask(
  room: { demo: boolean; hostId: string; players: PlayerLike[]; tasks?: TasksState | null } & Parameters<typeof taskCtx>[0],
  playerId: string, role: RoleId, answer: AnyAnswer | null,
): { tasks?: TasksState; result?: TaskResult; error?: string; errorMsg?: Msg } {
  const allowed = taskRolesOf(room, playerId).includes(role);
  if (!allowed) {
    // The host may skip the task of a role whose player is offline (the team must not get stuck).
    const holder = room.players.find((p) => heldRoles(p).includes(role));
    if (!(answer === null && playerId === room.hostId && holder && !holder.online)) return fault(holder && !holder.online ? 'offline' : 'role');
  }
  const ctx = taskCtx(room);
  const s = answer === null ? null : scoreTask(role, answer, ctx);
  const result: TaskResult = {
    role, skipped: answer === null, answer: s ? s.answer : null, by: playerId, attempt: ctx.attempt, key: taskKey(role, ctx),
    score: s ? s.score : 0, grade: s ? s.grade : 'weak', notes: s ? s.notes : [{ id: 'skipped' }],
  };
  return { tasks: { results: { ...(room.tasks?.results ?? {}), [role]: result } }, result };
}

// ── Flight modifiers ──

export interface TaskFlight {
  grades: Record<RoleId, Grade>;
  scores: Record<RoleId, number>;
  skipped: RoleId[];
  /** Commander: ranked goal ids and the sacrifice order (null = skipped). */
  goals: string[] | null;
  sacrifice: string[] | null;
  /** Engineer: line of each consumer (null = skipped). */
  lines: Record<string, Line> | null;
  /** Why Power Drop is harsher (engineer overload / skip) and by how much; commander skip shortens the timer too. */
  harsh: { why: 'overload' | 'skip' | null; deadline: number; hull: number; line?: Line; load?: number; cap?: number };
  /** Science: quality multiplier per instrument; measurement mode and its rate / instrument-heat factors. */
  calib: Record<string, number>;
  calibAvg: number;
  /**
   * Data-rate multipliers per instrument, by role: science (calibration: rejected frames), commander (mission plan focus),
   * engineer (voltage sag on an overloaded line). Missing = 1.
   */
  rateBy: Record<string, { science: number; commander: number; engineer: number; /** quality × (plan, line sag) */ quality: number }>;
  mode: MeasureMode;
  rate: number;
  heat: number;
  /** Comms: pre-flight pointing accuracy, current accuracy, auto re-aim tick, beam; packet queue (null = skipped). */
  aimBase: number;
  aim: number;
  aimUntil: number;
  beam: number;
  /** Where Earth is after the last blackout (re-aim widget), seeded. */
  reaim: { x: number; y: number; from: number } | null;
  queue: ScienceTargetId[] | null;
  /** What the modifiers did (report). */
  log: {
    evicted: number; evictedFrom: string[]; aimLost: number; aimDrops: number; reaims: number; modeData: number; calibLoss: number;
    /** Data units gained (+) or lost (−) through each role's rate multiplier (approximate, for the report). */
    dataBy: { science: number; commander: number; engineer: number };
    emergency: string[]; isolated: string[]; shedSecondary: string[]; harshHit: number; lowered: MeasureMode | null; overheatAfterIntensive: boolean;
  };
}

/** Flight modifiers from the room's task results (null when the team never opened the task screen). */
export function flightTasks(tasks: TasksState | null | undefined, ctx: TaskCtx): TaskFlight | null {
  if (!tasks) return null;
  const valid = (role: RoleId) => (taskStatus(tasks, role, ctx) === 'done' ? tasks.results[role]! : null);
  if (!TASK_ROLES.some((r) => valid(r))) return null;
  const res = Object.fromEntries(TASK_ROLES.map((r) => [r, valid(r)])) as Record<RoleId, TaskResult | null>;
  const done = (r: RoleId) => !!res[r] && !res[r]!.skipped;
  const C = TASKS.comms, E = TASKS.engineer;

  const cmd = done('commander') ? scoreCommander(res.commander!.answer as CommanderAnswer, ctx) : null;
  const eng = done('engineer') ? scoreEngineer(res.engineer!.answer as EngineerAnswer, ctx) : null;
  const sci = done('science') ? scoreScience(res.science!.answer as ScienceAnswer, ctx) : null;
  const com = done('comms') ? scoreComms(res.comms!.answer as CommsAnswer, ctx) : null;

  const sSetup = scienceSetup(ctx);
  const calib: Record<string, number> = {};
  for (const i of sSetup.instruments) {
    const knob = sci ? (sci.answer as ScienceAnswer).knobs[i.id] ?? i.start : null;
    calib[i.id] = r2(knob === null ? TASKS.science.qualityMin : calibQuality(calibAccuracy(knob, i.peak)));
  }
  const vals = Object.values(calib);
  const mode: MeasureMode = sci ? (sci.answer as ScienceAnswer).mode : 'normal';
  const m = TASKS.science.modes[ctx.mission][mode];

  let harsh: TaskFlight['harsh'] = { why: null, deadline: 0, hull: 0 };
  if (!eng) harsh = { why: 'skip', deadline: E.overloadDeadline, hull: E.overloadHull };
  else if (eng.preview.excess > 0) {
    const ov = eng.notes.find((n) => n.id === 'overload')!.n!;
    harsh = { why: 'overload', deadline: E.overloadDeadline, hull: E.overloadHull, line: ov.line as Line, load: Number(ov.load), cap: Number(ov.cap) };
  }
  if (!cmd) harsh = { ...harsh, deadline: harsh.deadline + TASKS.commander.skipDeadline };

  // Data-rate multipliers of every data-producing instrument.
  const F = TASKS.commander.focus;
  const goals = cmd ? (cmd.answer as CommanderAnswer).goals : null;
  const lines = eng ? (eng.answer as EngineerAnswer).lines : null;
  const sagOf: Record<Line, number> = { main: 1, secondary: 1 };
  if (eng && eng.preview.excess > 0) {
    const p = eng.preview;
    sagOf.main = clamp((p.caps.main + p.best) / Math.max(1, p.main), E.sagMin, 1);
    sagOf.secondary = clamp((p.caps.secondary + p.best) / Math.max(1, p.secondary), E.sagMin, 1);
  }
  const rateBy: TaskFlight['rateBy'] = {};
  const producers = [...new Set(targetDefs(ctx.mission).flatMap((t) => t.rates.map((r) => r.instrument)))].filter((id) => has(ctx.build, id));
  for (const id of producers) {
    const k = sSetup.instruments.find((i) => i.id === id);
    const science = !k ? 1 : sci ? calibRate(calibAccuracy((sci.answer as ScienceAnswer).knobs[id] ?? k.start, k.peak)) : TASKS.science.rateMin;
    let commander = F.skip;
    if (goals) {
      const ranks = GOALS[ctx.mission].filter((g) => g.systems.includes(id)).map((g) => goals.indexOf(g.id)).filter((i) => i >= 0);
      const best = ranks.length ? Math.min(...ranks) : -1;
      commander = best < 0 ? 1 : best < F.topN ? F.top : best === goals.length - 1 ? F.last : 1;
    }
    const engineer = !eng ? E.skipSag : sagOf[lines?.[id] ?? 'main'];
    const planQ = !goals ? TASKS.commander.focusQuality.skip : commander === F.last ? TASKS.commander.focusQuality.last : 1;
    rateBy[id] = { science: r2(science), commander, engineer: r2(engineer), quality: r2(planQ * engineer) };
  }

  const aim = com ? com.preview.acc : C.skipAim;
  return {
    grades: Object.fromEntries(TASK_ROLES.map((r) => [r, res[r]?.grade ?? 'weak'])) as Record<RoleId, Grade>,
    scores: Object.fromEntries(TASK_ROLES.map((r) => [r, res[r]?.score ?? 0])) as Record<RoleId, number>,
    skipped: TASK_ROLES.filter((r) => !done(r)),
    goals: cmd ? (cmd.answer as CommanderAnswer).goals : null,
    sacrifice: cmd ? (cmd.answer as CommanderAnswer).sacrifice : null,
    lines: eng ? (eng.answer as EngineerAnswer).lines : null,
    harsh,
    calib, calibAvg: vals.length ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : 1, rateBy,
    mode, rate: m.rate, heat: m.heat,
    aimBase: aim, aim, aimUntil: 0, beam: beamOf(ctx.build).beam, reaim: null,
    queue: com ? (com.answer as CommsAnswer).queue : null,
    log: { evicted: 0, evictedFrom: [], aimLost: 0, aimDrops: 0, reaims: 0, modeData: 0, calibLoss: 0, dataBy: { science: 0, commander: 0, engineer: 0 }, emergency: [], isolated: [], shedSecondary: [], harshHit: 0, lowered: null, overheatAfterIntensive: false },
  };
}

/** Shed rank of a load (higher = shed earlier): secondary line first, then (with a working PDU) the commander's sacrifice order. */
export function loadRank(tk: TaskFlight | undefined | null, id: string, pdu: boolean): number | undefined {
  if (!tk) return undefined;
  let rank = tk.lines?.[id] === 'secondary' ? 100 : 0;
  if (pdu && tk.sacrifice) { const i = tk.sacrifice.indexOf(id); if (i >= 0) rank += tk.sacrifice.length - i; }
  return rank;
}

/** Data quality multiplier of an instrument: calibration × mission plan × line sag. */
export const taskQuality = (tk: TaskFlight | undefined | null, id: string) => (tk ? Math.max(TASKS.floor.quality, (tk.calib[id] ?? 1) * (tk.rateBy?.[id]?.quality ?? 1)) : 1);
/** Share of sent packets that miss Earth (antenna pointing). */
export const taskLoss = (tk: TaskFlight | undefined | null) => (tk ? TASKS.comms.loss * (1 - Math.min(1, tk.aim)) : 0);
/** Instrument heat multiplier (measurement mode). */
export const taskHeat = (tk: TaskFlight | undefined | null) => tk?.heat ?? 1;
/** Downlink multiplier (antenna pointing). */
export const taskBandwidth = (tk: TaskFlight | undefined | null) => (tk ? bandwidthFactor(tk.aim) : 1);

/**
 * Science data rate of an instrument with every task multiplier (measurement mode, calibration, mission plan, line sag);
 * remembers what each role added or cost (approximate, for the report).
 */
export function taskRate(tk: TaskFlight | undefined | null, instrument: string, rate: number): number {
  if (!tk || rate <= 0) return rate;
  const f = tk.rateBy?.[instrument] ?? { science: 1, commander: 1, engineer: 1 };
  const total = tk.rate * Math.max(TASKS.floor.rate, f.science * f.commander * f.engineer);
  tk.log.modeData += rate * (tk.rate - 1);
  if (tk.log.dataBy) {
    tk.log.dataBy.science += rate * (f.science - 1);
    tk.log.dataBy.commander += rate * (f.commander - 1);
    tk.log.dataBy.engineer += rate * (f.engineer - 1);
  }
  return rate * total;
}

/** Queue position of a science target (lower = more important; missing = last). */
export function queueIndex(tk: TaskFlight | undefined | null, id: string): number {
  const i = tk?.queue?.indexOf(id as ScienceTargetId) ?? -1;
  return i < 0 ? 99 : i;
}

type Cause = (e: Omit<CauseEvent, 'tick'>) => void;

/** Memory full: free room for `tg` by overwriting less important stored data (comms queue). Returns units freed. */
export function evictFor(n: FlightState, tgId: string, need: number, cause: Cause): number {
  const tk = n.tasks;
  if (!tk?.queue || need <= 0) return 0;
  const mine = queueIndex(tk, tgId);
  let freed = 0;
  const victims = n.targets.filter((t) => t.stored > 0 && queueIndex(tk, t.id) > mine).sort((a, b) => queueIndex(tk, b.id) - queueIndex(tk, a.id));
  for (const v of victims) {
    if (freed >= need) break;
    const x = Math.min(v.stored, need - freed);
    v.stored -= x;
    v.lost += x;
    freed += x;
    if (!tk.log.evictedFrom.includes(v.id)) {
      tk.log.evictedFrom.push(v.id);
      cause({ kind: 'data', ref: `task-evict:${v.id}`, causeIds: ['task:comms', 'data_storage', 'data_buffer'], ...said(tm('log.evict', { lost: v.name, kept: n.targets.find((t) => t.id === tgId)?.name ?? tgId })) });
    }
  }
  tk.log.evicted += freed;
  return freed;
}

/** Downlink budget lost to pointing this tick (only when data was waiting). */
export function noteAimLoss(tk: TaskFlight | undefined | null, fullBudget: number, waiting: number) {
  if (!tk) return;
  const lost = fullBudget * Math.max(0, 1 - bandwidthFactor(tk.aim));
  if (lost > 0 && waiting > 0) tk.log.aimLost += Math.min(lost, waiting);
}

/** Once per tick: the flight computer finds Earth on its own after a while. */
export function stepTasks(n: FlightState, cause: Cause) {
  const tk = n.tasks;
  if (!tk || !tk.aimUntil || n.tick < tk.aimUntil) return;
  tk.aimUntil = 0;
  tk.aim = Math.max(tk.aim, tk.aimBase);
  tk.reaim = null;
  cause({ kind: 'signal', ref: 'task-aim-auto', causeIds: ['task:comms'], ...said(tm('log.aimAuto', { pct: Math.round(bandwidthFactor(tk.aim) * 100) })) });
}

/** The link is back after a blackout: the antenna has lost Earth (comms can re-aim). */
export function onLinkBack(n: FlightState, b: Blackout, seed: number, cause: Cause) {
  const tk = n.tasks;
  if (!tk || b.reason === 'no-link') return;
  tk.aim = Math.min(tk.aim, TASKS.comms.reaimDrop);
  tk.aimUntil = n.tick + TASKS.comms.autoReaimTicks;
  tk.reaim = { ...earthAt({ seed, attempt: 0, mission: n.mission }, `reaim:${b.from}`), from: n.tick };
  tk.log.aimDrops++;
  cause({ kind: 'signal', ref: 'task-aim-lost', causeIds: ['task:comms'], ...said(tm('log.aimLost', { pct: Math.round(bandwidthFactor(tk.aim) * 100) })) });
}

/** Comms re-aims the antenna in flight (radar widget). */
export function reaimAntenna(f: FlightState, role: RoleId, aim: { x: number; y: number }): { flight: FlightState; error?: string; errorMsg?: Msg } {
  if (role !== 'comms') return { flight: f, ...fault('comms') };
  if (!f.tasks) return { flight: f, ...fault('noTasks') };
  if (!f.tasks.reaim || f.signal === 'lost') return { flight: f, ...fault('noReaim') };
  const n = structuredClone(f);
  const tk = n.tasks!;
  const acc = aimAccuracy({ x: clamp(aim.x, -1, 1), y: clamp(aim.y, -1, 1) }, tk.reaim!, tk.beam);
  // The pre-flight pointing table limits it: re-aiming finds Earth again, but not more precisely than the table.
  tk.aim = r2(Math.max(TASKS.comms.reaimDrop, Math.min(acc, tk.aimBase)));
  tk.aimUntil = 0;
  tk.reaim = null;
  tk.log.reaims++;
  n.causes.push({ tick: n.tick, kind: 'command', ref: 'task-reaim', causeIds: ['task:comms'], ...said(tm('log.reaim', { pct: Math.round(bandwidthFactor(tk.aim) * 100) })) });
  return { flight: n };
}

/** Power Drop just started: a badly routed / unrouted grid makes it harsher; no agreed sacrifice order costs time. */
export function onPowerDrop(n: FlightState, c: ActiveCrisis, cause: Cause) {
  const h = n.tasks?.harsh;
  if (!h || (!h.deadline && !h.hull)) return;
  const before = c.deadlineTick;
  c.deadlineTick = Math.max(c.startedTick + 6, c.deadlineTick - h.deadline);
  const sec = before - c.deadlineTick;
  if (h.hull) n.hull = Math.max(0, n.hull - h.hull);
  n.tasks!.log.harshHit = sec;
  const why = tm(h.why === 'overload' ? 'log.harshOverload' : h.why === 'skip' ? 'log.harshSkip' : 'log.harshCommander');
  cause({ kind: 'crisis', ref: 'task-harsh', causeIds: [h.why ? 'task:engineer' : 'task:commander'], ...said(tm('log.harsh', { why, sec, hull: hullMsg(h.hull) })) });
}

/** Commander's «Emergency Decision» in Power Drop: shed by the agreed sacrifice order until `need` W are cut. */
export function emergencyOption(n: FlightState, active: { id: string; watts: number }[], need: number): CrisisOption | null {
  const order = n.tasks?.sacrifice;
  if (!order?.length) return null;
  const pick: string[] = [];
  let cut = 0;
  for (const id of order) {
    if (cut >= need) break;
    const l = active.find((x) => x.id === id);
    if (!l || n.off.includes(id)) continue;
    pick.push(id);
    cut += l.watts;
  }
  if (!pick.length) return null;
  return {
    id: 'pd_emergency', role: 'commander',
    ...optText(tm('option.emergency'), tm('option.emergencyHint', { list: namesMsg(pick), w: cut, short: cut < need ? tm('option.short', { need: Math.ceil(need) }) : '' })), nodeIds: pick,
  };
}

/** Overheat: science may lower the measurement intensity (the same dial as the task). */
export function intensityOptions(n: FlightState, build: Build): CrisisOption[] {
  const tk = n.tasks;
  if (!tk || tk.mode === 'cautious') return [];
  const ih = instrumentHeat(build, n.mods);
  const modes = TASKS.science.modes[n.mission];
  const lower: MeasureMode[] = tk.mode === 'intensive' ? ['normal', 'cautious'] : ['cautious'];
  return lower.map((mode) => ({
    id: `oh_intensity_${mode}`, role: 'science' as RoleId,
    ...optText(tm('option.lower', { mode: modeMsg_(mode) }), tm('option.lowerHint', { heat: Math.round(ih * (tk.heat - modes[mode].heat)), pct: Math.round((1 - modes[mode].rate / tk.rate) * 100) })),
  }));
}

/** Apply a task-made crisis option (crises.ts calls it for ids it does not know). Returns true if handled. */
export function applyTaskOption(n: FlightState, o: CrisisOption, who: string | Msg, say: (s: string | Msg, msg?: Msg) => void): boolean {
  const tk = n.tasks;
  if (o.id === 'pd_emergency') {
    for (const id of o.nodeIds ?? []) if (!n.off.includes(id)) n.off.push(id);
    if (tk) tk.log.emergency.push(...(o.nodeIds ?? []));
    say(tm('option.emergencyDone', { who, list: namesMsg(o.nodeIds ?? []) }));
    return true;
  }
  if (o.id.startsWith('oh_intensity_') && tk) {
    const mode = o.id.slice('oh_intensity_'.length) as MeasureMode;
    const m = TASKS.science.modes[n.mission][mode];
    if (tk.mode === 'intensive') tk.log.overheatAfterIntensive = true;
    tk.mode = mode; tk.rate = m.rate; tk.heat = m.heat; tk.log.lowered = mode;
    say(tm('option.lowered', { who, mode: modeMsg_(mode) }));
    return true;
  }
  return false;
}

/** Engineer picks the node to isolate on the power schematic (Power Drop). */
export function isolateNode(f: FlightState, role: RoleId, stats: CraftStats, nodeId: string): { flight: FlightState; error?: string; errorMsg?: Msg } {
  if (role !== 'engineer') return { flight: f, ...fault('engineer') };
  const c = f.crisis;
  if (!c || c.kind !== 'power_drop') return { flight: f, ...fault('noCrisis') };
  const def = COMPONENT_BY_ID[nodeId];
  const line = stats.consumptionByLoad.find((l) => l.id === nodeId);
  if (!def || !line || def.priority <= 1 || f.off.includes(nodeId) || f.broken.includes(nodeId)) return { flight: f, ...fault('node') };
  const n = structuredClone(f);
  const opt: CrisisOption = { id: 'pd_isolate', role: 'engineer', ...optText(tm('option.isolate', { name: nameMsg(nodeId) }), tm('option.isolateHint', { w: line.watts, name: nameMsg(nodeId) })), nodeIds: [nodeId] };
  const i = n.crisis!.options.findIndex((o) => o.id === 'pd_isolate');
  if (i >= 0) n.crisis!.options[i] = opt; else n.crisis!.options.push(opt);
  if (n.tasks) n.tasks.log.isolated.push(nodeId);
  return chooseOption(n, 'engineer', 'pd_isolate');
}

/** Engineer schematic in Power Drop: what can be isolated and on which line it hangs. */
export function isolateCandidates(f: FlightState, build: Build): { id: string; watts: number; line: Line; on: boolean }[] {
  const stats = computeStats(build, MISSIONS[f.mission], f.mods);
  return stats.consumptionByLoad
    .filter((l) => l.id !== 'frame' && (COMPONENT_BY_ID[l.id]?.priority ?? 1) > 1 && !f.broken.includes(l.id))
    .map((l) => ({ id: l.id, watts: l.watts, line: f.tasks?.lines?.[l.id] ?? 'main', on: !f.off.includes(l.id) }));
}

// ── Report ──

export interface TaskReportEntry { role: RoleId; grade: Grade; score: number; skipped: boolean; effects: TaskNote[] }

/** Each task's grade and what it did in this flight (structured; the report screen words it). */
export function taskReport(f: FlightState): TaskReportEntry[] {
  const tk = f.tasks;
  if (!tk) return [];
  const L = tk.log;
  const eff = (role: RoleId): TaskNote[] => {
    switch (role) {
      case 'commander': return [
        ...(tk.goals ? [{ id: 'main-goals', n: { goals: tk.goals.slice(0, 2).join(',') } }] : []),
        ...(L.emergency.length ? [{ id: 'emergency', n: { nodes: L.emergency.join(',') } }] : []),
        ...(!tk.sacrifice && L.harshHit ? [{ id: 'slower', n: { sec: TASKS.commander.skipDeadline } }] : []),
      ];
      case 'engineer': return [
        ...(tk.lines ? [{ id: 'secondary', n: { nodes: Object.keys(tk.lines).filter((id) => tk.lines![id] === 'secondary').join(',') } }] : []),
        ...(tk.harsh.why && L.harshHit ? [{ id: 'harsh', n: { sec: L.harshHit, hull: tk.harsh.hull } }] : []),
        ...(L.isolated.length ? [{ id: 'isolated', n: { nodes: L.isolated.join(',') } }] : []),
      ];
      case 'science': return [
        { id: 'quality', n: { pct: Math.round(tk.calibAvg * 100) } },
        { id: 'mode', n: { mode: L.lowered ? `${L.lowered}` : tk.mode, data: Math.round(L.modeData) } },
      ];
      case 'comms': return [
        { id: 'bandwidth', n: { pct: Math.round(bandwidthFactor(tk.aimBase) * 100), lost: Math.round(L.aimLost) } },
        ...(L.aimDrops ? [{ id: 'reaim', n: { drops: L.aimDrops, reaims: L.reaims } }] : []),
        ...(L.evicted > 0.5 ? [{ id: 'evicted', n: { units: Math.round(L.evicted) } }] : []),
      ];
    }
  };
  return TASK_ROLES.map((role) => ({ role, grade: tk.grades[role], score: Math.round(tk.scores[role] * 100), skipped: tk.skipped.includes(role), effects: eff(role) }));
}

/** Cause chains for the report: what the tasks changed in this flight (only where it mattered). */
export function taskChains(f: FlightState): CauseChain[] {
  const tk = f.tasks;
  if (!tk) return [];
  const L = tk.log;
  const out: CauseChain[] = [];
  const names = namesMsg;

  if (L.aimLost > 1 && (tk.aimBase < 0.95 || (L.aimDrops > L.reaims))) {
    const pct = Math.round(bandwidthFactor(tk.aimBase) * 100);
    out.push({
      key: 'task:comms-aim', causeIds: ['task:comms', 'antenna_high_gain', 'antenna_standard'],
      ...chainText(
        tc('aimWhat', { pct, lost: Math.round(L.aimLost) }),
        join([tk.skipped.includes('comms') ? tc('aimWhySkip') : tc('aimWhy', { pct }), L.aimDrops > L.reaims ? tc('aimWhyBlackout') : ''], ''),
        tc('aimCould')),
      impact: Math.min(12, 2 + L.aimLost / 4),
    });
  }
  if (L.evicted > 0.5 && tk.queue) {
    const kept = f.targets.find((t) => t.id === tk.queue![0])?.name ?? tk.queue[0];
    out.push({ key: 'task:comms-queue', causeIds: ['task:comms', 'data_storage'], ...chainText(tc('queueWhat', { n: Math.round(L.evicted), kept }), tc('queueWhy'), tc('queueCould')), impact: 1 });
  }
  if (tk.calibAvg < 0.97) {
    const bad = Object.entries(tk.calib).filter(([, q]) => q < 0.95).map(([id, q]) => tc('calibItem', { name: nameMsg(id), pct: Math.round(q * 100) }));
    out.push({
      key: 'task:science-calib', causeIds: ['task:science', ...Object.keys(tk.calib)],
      ...chainText(
        tc('calibWhat', { pct: Math.round(tk.calibAvg * 100) }),
        tk.skipped.includes('science') ? tc('calibWhySkip') : tc('calibWhy', { list: join(bad, ', ') }),
        tc('calibCould')),
      impact: (1 - tk.calibAvg) * 24,
    });
  }
  const hot = f.history.find((h) => h.kind === 'overheat');
  if ((tk.mode === 'intensive' || L.overheatAfterIntensive) && hot) {
    out.push({ key: 'task:science-mode', causeIds: ['task:science', 'overheat'], ...chainText(tc('modeWhatHot'), tc('modeWhy', { heat: Math.round((TASKS.science.modes[f.mission].intensive.heat - 1) * 10) / 10 }), tc('modeCould')), impact: 3 });
  } else if (tk.mode === 'cautious' && L.modeData < -1) {
    out.push({ key: 'task:science-mode', causeIds: ['task:science'], ...chainText(tc('modeWhatCautious', { n: Math.round(-L.modeData) }), tc('modeWhyCautious'), tc('modeCould')), impact: Math.min(5, -L.modeData / 10) });
  }
  if (L.harshHit) {
    const h = tk.harsh;
    out.push({
      key: 'task:engineer-harsh', causeIds: [h.why ? 'task:engineer' : 'task:commander', 'power_bus'],
      ...chainText(
        tc('harshWhat', { sec: L.harshHit, hull: hullMsg(h.hull) }),
        h.why === 'overload' ? tc('harshWhyOverload', { line: lineMsg(h.line ?? 'main'), load: h.load ?? 0, cap: h.cap ?? 0 }) : h.why === 'skip' ? tc('harshWhySkip') : tc('harshWhyCommander'),
        tc('harshCould')),
      impact: 3 + h.hull / 2,
    });
  }
  // Systems the mission needs, shed because they sat on the secondary line / early in the sacrifice order.
  const shed = [...new Set(f.causes.filter((c) => c.kind === 'shed' && (c.ref === 'battery-empty' || c.ref === 'bus-trip')).map((c) => c.causeIds[c.ref === 'bus-trip' ? 2 : 0]))];
  const keepCtx: TaskCtx = { mission: f.mission, build: {}, seed: 0, attempt: 0 };
  const vital = shed.filter((id) => (KEEP_VALUE[f.mission][id] ?? 0) >= TASKS.engineer.mustMainKeep || (COMPONENT_BY_ID[id]?.priority ?? 9) <= TASKS.engineer.mustMainPriority);
  const onSecondary = vital.filter((id) => tk.lines?.[id] === 'secondary');
  if (onSecondary.length) out.push({ key: 'task:engineer-crit', causeIds: ['task:engineer', ...onSecondary], ...chainText(tc('critWhat', { list: names(onSecondary) }), tc('critWhy'), tc('critCould')), impact: 4 + onSecondary.length * 3 });
  const byOrder = vital.filter((id) => !onSecondary.includes(id) && tk.sacrifice && tk.sacrifice.indexOf(id) >= 0 && tk.sacrifice.indexOf(id) < 2);
  if (byOrder.length) out.push({ key: 'task:commander-order', causeIds: ['task:commander', ...byOrder], ...chainText(tc('orderWhat', { list: names(byOrder) }), tc('orderWhy'), tc('orderCould')), impact: 3 + byOrder.length * 2 });
  if (L.emergency.length) {
    const sacrificedVital = L.emergency.filter((id) => keepValue(keepCtx, id, tk.goals ?? []) >= TASKS.engineer.mustMainKeep);
    out.push({ key: 'task:commander-emergency', causeIds: ['task:commander', ...L.emergency], ...chainText(tc('emergencyWhat', { list: names(L.emergency) }), tc('orderWhy'), tc(sacrificedVital.length ? 'orderCould' : 'emergencyCould')), impact: sacrificedVital.length ? 4 : 0.5 });
  }
  return out.map((c) => ({ ...c, impact: Math.round(c.impact * 10) / 10 }));
}

/** Goal and measurement-mode names (engine side; the task screen shows the same). */
export const goalName = (id: string): string => { const g = goalMsg(id); return typeof g === 'string' ? g : ru(g); };
export const modeName = (mode: MeasureMode): string => ru(modeMsg_(mode));
/** Goal name as a message (`task.goal.<id>`); an unknown id stays a plain string. */
export const goalMsg = (id: string): Msg | string => (GOAL_IDS.has(id) ? tm(`goal.${id}`) : id);
/** Measurement mode name as a message (`task.mode.<mode>`). */
export const modeMsg = modeMsg_;
