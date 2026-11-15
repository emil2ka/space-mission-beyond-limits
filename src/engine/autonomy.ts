// AUTONOMY PLANNER: "IF [condition] AND [condition] -> THEN [action]" (ТЗ §8).
import { COMPONENT_BY_ID } from './data/components';
import type { Build } from './types';
import { m, ru, type Msg } from './msg';

export type ConditionKind =
  | 'signal_lost' | 'battery_below' | 'temp_critical' | 'temp_freezing'
  | 'hull_below' | 'buffer_above' | 'sample_secured' | 'debris_detected';

export type ActionKind =
  | 'shed_secondary' | 'safe_mode_hot_instrument' | 'keep_collecting_store'
  | 'stop_risky_maneuvers' | 'prepare_return' | 'point_antenna_earth' | 'evade';

export interface Condition { kind: ConditionKind; value?: number }
export interface AutonomyRule { id: string; when: Condition[]; then: ActionKind }

export interface Telemetry {
  signal: 'ok' | 'delay' | 'interference' | 'lost';
  batteryPct: number;
  thermal: 'freezing' | 'cold' | 'nominal' | 'hot' | 'overheat';
  hullPct: number;
  bufferPct: number;
  sampleSecured: boolean;
  debris: boolean;
}

export const CONDITIONS: Record<ConditionKind, { label: string; needs?: string[]; hasValue?: boolean }> = {
  signal_lost: { label: 'Signal = LOST' },
  battery_below: { label: 'Battery < X%', needs: ['battery_hc', 'battery_backup'], hasValue: true },
  temp_critical: { label: 'Temperature > Critical', needs: ['temp_sensor'] },
  temp_freezing: { label: 'Temperature < Freezing', needs: ['temp_sensor'] },
  hull_below: { label: 'Hull Integrity < X%', hasValue: true },
  buffer_above: { label: 'Data Buffer > X%', needs: ['data_buffer', 'data_storage'], hasValue: true },
  sample_secured: { label: 'Sample Secured = TRUE', needs: ['sample_container'] },
  debris_detected: { label: 'Debris Detected', needs: ['radar_altimeter', 'nav_camera'] },
};

/** Action label: Russian `label` + `i18n.label` (key `auto.action.<id>`). */
const act = (id: ActionKind, needs?: string[]) => {
  const msg = m(`auto.action.${id}`);
  return { label: ru(msg), ...(needs ? { needs } : {}), i18n: { label: msg } };
};

export const ACTIONS: Record<ActionKind, { label: string; needs?: string[]; i18n?: { label: Msg } }> = {
  shed_secondary: act('shed_secondary'),
  safe_mode_hot_instrument: act('safe_mode_hot_instrument'),
  keep_collecting_store: act('keep_collecting_store', ['data_storage', 'data_buffer']),
  stop_risky_maneuvers: act('stop_risky_maneuvers'),
  prepare_return: act('prepare_return', ['return_capsule']),
  point_antenna_earth: act('point_antenna_earth', ['antenna_high_gain', 'antenna_omni']),
  evade: act('evade', ['chem_thrusters', 'chem_main_engine']),
};

const hasAny = (build: Build, ids?: string[]) => !ids || ids.some((id) => (build[id] ?? 0) > 0);
/** Fold a list with a two-part template (`{a} или {b}`), so the joining word is translated too. */
const fold = (parts: (Msg | string)[], key: string): Msg | string => parts.reduce((a, b) => m(key, { a, b }));
/** «Battery_hc или Battery_backup» as a message. */
const partNames = (ids: string[]) => fold(ids.map((id) => COMPONENT_BY_ID[id]?.name ?? id), 'auto.or');

/** At most this many conditions per rule (ТЗ: «ЕСЛИ [условие] И [доп. условие]»). */
export const MAX_CONDITIONS = 2;
/** Default thresholds for blocks with a value. */
export const DEFAULT_VALUE: Partial<Record<ConditionKind, number>> = { battery_below: 25, hull_below: 40, buffer_above: 90 };

/** Why a condition / action block is greyed out for this build (null = available). */
export function blockProblem(needs: string[] | undefined, build: Build): string | null {
  const msg = blockProblemMsg(needs, build);
  return msg && ru(msg);
}
export function blockProblemMsg(needs: string[] | undefined, build: Build): Msg | null {
  return hasAny(build, needs) ? null : m('auto.needModule', { parts: partNames(needs!) });
}

/** Why a rule can't be used with this build (null = usable). */
export function ruleProblem(rule: AutonomyRule, build: Build): string | null {
  const msg = ruleProblemMsg(rule, build);
  return msg && ru(msg);
}
export function ruleProblemMsg(rule: AutonomyRule, build: Build): Msg | null {
  for (const c of rule.when) {
    const def = CONDITIONS[c.kind];
    if (!hasAny(build, def.needs)) return m('auto.condNeeds', { label: def.label, parts: partNames(def.needs!) });
  }
  const a = ACTIONS[rule.then];
  if (!hasAny(build, a.needs)) return m('auto.actionNeeds', { label: a.i18n?.label ?? a.label, parts: partNames(a.needs!) });
  return null;
}

/** «Battery < 25%» — the block label with its threshold filled in. */
export function conditionText(c: Condition): string {
  const def = CONDITIONS[c.kind];
  return def.hasValue ? def.label.replace('X', String(c.value ?? DEFAULT_VALUE[c.kind] ?? '?')) : def.label;
}

/** «ЕСЛИ Signal = LOST И Battery < 25% → ТО Отключить второстепенные приборы». */
export function ruleText(rule: AutonomyRule): string {
  return ru(ruleTextMsg(rule));
}
export function ruleTextMsg(rule: AutonomyRule): Msg {
  const a = ACTIONS[rule.then];
  return m('auto.ruleText', { when: rule.when.length ? fold(rule.when.map(conditionText), 'auto.and') : '', then: a.i18n?.label ?? a.label });
}

/** «правило 2 (ЕСЛИ … → ТО …)» — how logs and the report name a rule. */
export function ruleName(rules: AutonomyRule[], ruleId: string): string {
  return ru(ruleNameMsg(rules, ruleId));
}
export function ruleNameMsg(rules: AutonomyRule[], ruleId: string): Msg {
  const i = rules.findIndex((r) => r.id === ruleId);
  return i < 0 ? m('auto.ruleById', { id: ruleId }) : m('auto.ruleName', { n: i + 1, text: ruleTextMsg(rules[i]) });
}

/** Why this rule list can't be saved (null = ok). Flight Computer capacity = number of rules. */
export function validateRules(rules: AutonomyRule[], build: Build, ruleSlots: number): string | null {
  const msg = validateRulesMsg(rules, build, ruleSlots);
  return msg && ru(msg);
}
export function validateRulesMsg(rules: AutonomyRule[], build: Build, ruleSlots: number): Msg | null {
  if (rules.length > ruleSlots) {
    return ruleSlots === 0
      ? m('auto.err.noFc')
      : m('auto.err.tooMany', { n: rules.length, max: ruleSlots });
  }
  const ids = new Set<string>();
  for (const [i, r] of rules.entries()) {
    const n = i + 1;
    if (!r.id || ids.has(r.id)) return m('auto.err.id', { n });
    ids.add(r.id);
    if (!r.when.length) return m('auto.err.noCond', { n });
    if (r.when.length > MAX_CONDITIONS) return m('auto.err.maxCond', { n, max: MAX_CONDITIONS });
    if (!(r.then in ACTIONS) || r.when.some((c) => !(c.kind in CONDITIONS))) return m('auto.err.unknown', { n });
    if (new Set(r.when.map((c) => c.kind)).size < r.when.length) return m('auto.err.dup', { n });
    for (const c of r.when) {
      if (CONDITIONS[c.kind].hasValue && (typeof c.value !== 'number' || c.value < 1 || c.value > 99)) return m('auto.err.threshold', { n, label: CONDITIONS[c.kind].label });
    }
    const p = ruleProblemMsg(r, build);
    if (p) return m('auto.err.problem', { n, p });
  }
  return null;
}

/** Rules beyond flight computer capacity are ignored. */
export function activeRules(rules: AutonomyRule[], ruleSlots: number): AutonomyRule[] {
  return rules.slice(0, ruleSlots);
}

const CONTRADICTS: [ActionKind, ActionKind][] = [
  ['shed_secondary', 'keep_collecting_store'],
  ['stop_risky_maneuvers', 'evade'],
];

/** Pairs of rules that can fire together with contradicting actions. */
export function findConflicts(rules: AutonomyRule[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < rules.length; i++)
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i].then, b = rules[j].then;
      if (CONTRADICTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) out.push([rules[i].id, rules[j].id]);
    }
  return out;
}

export function conditionHolds(c: Condition, t: Telemetry): boolean {
  switch (c.kind) {
    case 'signal_lost': return t.signal === 'lost';
    case 'battery_below': return t.batteryPct < (c.value ?? 25);
    case 'temp_critical': return t.thermal === 'overheat';
    case 'temp_freezing': return t.thermal === 'freezing';
    case 'hull_below': return t.hullPct < (c.value ?? 40);
    case 'buffer_above': return t.bufferPct > (c.value ?? 90);
    case 'sample_secured': return t.sampleSecured;
    case 'debris_detected': return t.debris;
  }
}

/** Evaluate rules in priority order (top first). Each action type fires at most once. */
export function evaluateRules(rules: AutonomyRule[], t: Telemetry, build: Build, ruleSlots: number): { ruleId: string; action: ActionKind }[] {
  const fired: { ruleId: string; action: ActionKind }[] = [];
  const seen = new Set<ActionKind>();
  for (const r of activeRules(rules, ruleSlots)) {
    if (ruleProblem(r, build)) continue;
    if (seen.has(r.then)) continue;
    if (r.when.every((c) => conditionHolds(c, t))) {
      fired.push({ ruleId: r.id, action: r.then });
      seen.add(r.then);
    }
  }
  return fired;
}

/** Pre-launch «Тест» (Autonomy Planner.md): three scenarios, which rules would fire in each. */
export const TEST_SCENARIOS: { id: string; name: string; t: Telemetry; i18n?: { name: Msg } }[] = [
  { id: 'lost-low', name: ru(m('auto.test.lost-low')), i18n: { name: m('auto.test.lost-low') }, t: { signal: 'lost', batteryPct: 18, thermal: 'nominal', hullPct: 90, bufferPct: 60, sampleSecured: false, debris: false } },
  { id: 'overheat', name: ru(m('auto.test.overheat')), i18n: { name: m('auto.test.overheat') }, t: { signal: 'delay', batteryPct: 70, thermal: 'overheat', hullPct: 85, bufferPct: 40, sampleSecured: false, debris: false } },
  { id: 'debris', name: ru(m('auto.test.debris')), i18n: { name: m('auto.test.debris') }, t: { signal: 'interference', batteryPct: 60, thermal: 'nominal', hullPct: 35, bufferPct: 95, sampleSecured: false, debris: true } },
];

export function testRules(rules: AutonomyRule[], build: Build, ruleSlots: number): { id: string; name: string; fired: { ruleId: string; action: ActionKind }[]; safe: boolean; i18n?: { name: Msg } }[] {
  return TEST_SCENARIOS.map((sc) => {
    const fired = evaluateRules(rules, sc.t, build, ruleSlots);
    return { id: sc.id, name: sc.name, fired, safe: fired.length === 0, ...(sc.i18n ? { i18n: sc.i18n } : {}) };
  });
}

/** Safe Protocol used when no rules are configured or nothing fired in a crisis. */
export const SAFE_PROTOCOL: ActionKind[] = ['shed_secondary', 'stop_risky_maneuvers'];
