// Crises (ТЗ §10, decision 0006): every trigger comes from the build/state, with seeded noise only for the storm.
// One crisis at a time; per-role options; on the deadline without choices — Autonomy Planner rule, otherwise Safe Protocol.
import { THERMAL } from './constants';
import { MISSIONS } from './data/missions';
import { CRISIS_FX, MAIN_GOAL_TARGETS, TITAN } from './data/titan';
import { ASTEROID, SITE_BY_ID } from './data/asteroid';
import { debrisPlan, keepWhatWeHave, toolName, toolRate } from './asteroid';
import { evaluateRules, ruleName, SAFE_PROTOCOL, type ActionKind, type AutonomyRule } from './autonomy';
import { noteRulesFired, trackCommand } from './blackout';
import type { Load } from './energy';
import type { ActiveCrisis, CauseEvent, CrisisKind, CrisisOption, CrisisRecord, FlightState } from './flight';
import {
  ANTENNAS, CAMERAS, LINK_LOADS, heatFor, isInstrument, loadsFor, nameOf, peakFor, pickShed, sumWatts, telemetry,
} from './sim';
import { COMPONENT_BY_ID } from './data/components';
import { applyTaskOption, emergencyOption, GOALS, intensityOptions } from './tasks';
import type { Build, CraftStats, RoleId } from './types';
import { join, m, ru, type Msg } from './msg';

export const ROLE_ORDER: RoleId[] = ['commander', 'engineer', 'science', 'comms'];

export const CRISIS_TITLES: Record<CrisisKind, string> = {
  power_drop: 'POWER DROP',
  signal_distortion: 'SIGNAL DISTORTION',
  freeze: 'FREEZE',
  overheat: 'OVERHEAT',
  debris_alert: 'DEBRIS ALERT',
  arm_jam: 'SAMPLING ARM JAM',
};

/** Asteroid-only crises (planned by the build + seed); the rest are the shared Titan rules. */
const ASTEROID_KINDS: CrisisKind[] = ['debris_alert', 'arm_jam'];

/** Shared crises (Power Drop / Overheat / Freeze / Signal Distortion) seen so far. */
export function genericSlotsUsed(n: FlightState): number {
  return n.crisesSeen.filter((k) => !ASTEROID_KINDS.includes(k)).length;
}

/** May a shared crisis start now? Titan: 3 per flight; asteroid: 2 besides Debris / Arm Jam. Both with a cooldown. */
export function genericCrisisAllowed(n: FlightState): boolean {
  const cfg = n.asteroid ? ASTEROID.crisis : TITAN.crisis;
  const used = n.asteroid ? genericSlotsUsed(n) : n.crisesSeen.length;
  const max = n.asteroid ? ASTEROID.crisis.maxGeneric : TITAN.crisis.max;
  return n.tick >= cfg.earliestTick && used < max && n.tick >= n.lastCrisisEnd + cfg.cooldown;
}

export interface CrisisSnapshot {
  loads: Load[];
  /** Bus load before any shedding this tick. */
  busLoad: number;
  stormOn: boolean;
  phaseId: string;
}

/** Option with Russian label/hint rendered from the same messages the UI renders in the player's language. */
const opt = (id: string, role: RoleId, label: Msg, hint: Msg, nodeIds?: string[]): CrisisOption => ({ id, role, label: ru(label), hint: ru(hint), ...(nodeIds ? { nodeIds } : {}), i18n: { label, hint } });
const names = (ids: string[]) => ids.map(nameOf).join(', ');
/** Cause-event text + its message. */
const ev = (msg: Msg) => ({ text: ru(msg), i18n: { text: msg } });
/** Short role name as a message («Инженер»). */
const whoMsg = (r: RoleId) => m(`roleShort.${r}`);
/** «a и b и c» (target names are data strings, translated by the UI). */
const andList = (items: string[]): Msg | string => items.reduce<Msg | string>((acc, x) => (acc ? m('crisis.and2', { a: acc, b: x }) : x), '');
/** Effect sink: a message (Russian text rendered from it), or a plain string with an optional message (other modules). */
export type Say = (s: string | Msg, msg?: Msg) => void;
const watts = (loads: Load[], ids: string[]) => loads.filter((l) => ids.includes(l.id)).reduce((s, l) => s + l.watts, 0);

/** The two targets with the most progress — what «keep the main goal» protects. */
export function mainTargets(f: FlightState) {
  // Individual Tasks: the commander's goal ranking decides what «the main goal» is.
  const goals = f.tasks?.goals;
  if (goals) {
    const rank = (id: string) => { const i = goals.findIndex((g) => GOALS[f.mission].find((d) => d.id === g)?.targets.includes(id as never)); return i < 0 ? 99 : i; };
    return [...f.targets].filter((t) => t.possible).sort((a, b) => rank(a.id) - rank(b.id)).slice(0, MAIN_GOAL_TARGETS);
  }
  return [...f.targets]
    .filter((t) => t.possible)
    .sort((a, b) => (b.sent + b.stored) / b.required - (a.sent + a.stored) / a.required || a.required - b.required)
    .slice(0, MAIN_GOAL_TARGETS);
}

export function detectCrisis(n: FlightState, build: Build, stats: CraftStats, snap: CrisisSnapshot): ActiveCrisis | null {
  const seen = (k: CrisisKind) => n.crisesSeen.includes(k);
  const active = snap.loads.filter((l) => !n.off.includes(l.id));
  const base = { startedTick: n.tick, deadlineTick: n.tick + (n.asteroid ? ASTEROID.crisis.deadline : TITAN.crisis.deadline), chosen: {} };
  const has = (id: string) => (build[id] ?? 0) > 0;
  const ast = !!n.asteroid;
  const topLoads = [...active].filter((l) => l.id !== 'frame').sort((a, b) => b.watts - a.watts);

  if (!seen('power_drop')) {
    const busOver = stats.busLimit > 0 && snap.busLoad > stats.busLimit;
    const net0 = stats.generation - snap.busLoad;
    const pct = stats.capacityWh > 0 ? (n.stored / stats.capacityWh) * 100 : 0;
    const low = net0 < 0 && (stats.capacityWh > 0 ? pct < TITAN.crisis.batteryPct : snap.phaseId !== 'cruise');
    if (busOver || low) {
      const variant = busOver ? 'bus' : 'battery';
      const need = busOver ? snap.busLoad - stats.busLimit : -net0;
      const top = topLoads.slice(0, 3).map((l) => l.id);
      const text = busOver
        ? m('crisis.pd.textBus', { load: snap.busLoad, limit: stats.busLimit })
        : m('crisis.pd.textBattery', { pct: Math.round(pct), load: snap.busLoad, gen: stats.generation });
      return {
        ...base, id: `power_drop-${n.tick}`, kind: 'power_drop', variant, title: CRISIS_TITLES.power_drop,
        text: ru(text), i18n: { text },
        nodeIds: busOver ? ['power_bus', ...top.slice(0, 1)] : [...top.slice(0, 2), ...(has('battery_hc') ? ['battery_hc'] : [])],
        causeIds: busOver ? ['power_bus', 'bus-overload', ...top] : ['deficit', ast ? (has('rtg') ? 'rtg' : 'solar_array') : 'rtg', ...top],
        options: powerOptions(n, active, need, variant),
      };
    }
  }

  const critical = n.hotTicks >= TITAN.crisis.thermalTicks;
  if (!seen('overheat') && (critical || n.warmTicks >= TITAN.crisis.warmTicks)) {
    const hot = hottest(active, n);
    const hotHeat = hot ? (COMPONENT_BY_ID[hot]?.heat ?? 0) * (build[hot] ?? 1) : 0;
    const text = join([
      critical ? m('crisis.oh.textCritical', { heat: n.heat }) : m('crisis.oh.textWarm', { ticks: n.warmTicks, heat: n.heat }),
      has('rtg') ? m('crisis.oh.textRtg', { count: build.rtg, heat: build.rtg * (COMPONENT_BY_ID.rtg?.heat ?? 0) }) : null,
      has('thermal_radiator') ? null : m('crisis.oh.textNoRadiator'),
    ]);
    return {
      ...base, id: `overheat-${n.tick}`, kind: 'overheat', variant: critical ? 'critical' : 'warm', title: CRISIS_TITLES.overheat,
      text: ru(text), i18n: { text },
      nodeIds: [...(has('rtg') ? ['rtg'] : []), ...(hot ? [hot] : [])],
      causeIds: ['overheat', 'hot', 'rtg', 'thermal_radiator', ...(has('thermal_insulation') ? ['thermal_insulation'] : []), ...(hot ? [hot] : [])],
      options: [
        ...(hot ? [opt('oh_shutdown_hot', 'engineer', m('crisis.oh.shutdownHot', { name: nameOf(hot) }), m('crisis.oh.shutdownHotHint', { heat: hotHeat, name: nameOf(hot) }), [hot])] : []),
        ast
          ? opt('oh_land_cool', 'engineer', m('crisis.oh.turnRadiator'), m('crisis.oh.turnRadiatorHint', { ticks: CRISIS_FX.coolTicks }))
          : opt('oh_land_cool', 'engineer', m('crisis.oh.landCool'), m('crisis.oh.landCoolHint', { ticks: CRISIS_FX.coolTicks })),
        opt('oh_pause', 'science', m('crisis.pauseLabel'), m('crisis.oh.pauseHint', { ticks: CRISIS_FX.pauseTicks })),
        ...intensityOptions(n, build), // Individual Tasks: the measurement-mode dial
        ...(!n.ecoLink ? [opt('oh_eco_link', 'comms', m('crisis.oh.ecoLink'), m('crisis.oh.ecoLinkHint'))] : []),
      ],
    };
  }

  if (!seen('freeze') && n.coldTicks >= TITAN.crisis.thermalTicks) {
    const sens = ['hires_camera', 'wide_camera', 'spectrometer', 'atmo_sensor'].find((id) => has(id) && !n.off.includes(id) && !n.broken.includes(id));
    const heaterOff = has('heater') && n.off.includes('heater');
    const eng = has('heater')
      ? heaterOff
        ? opt('fr_heater_on', 'engineer', m('crisis.fr.heaterOn'), m('crisis.fr.heaterOnHint'), ['heater'])
        : opt('fr_heater_max', 'engineer', m('crisis.fr.heaterMax'), m('crisis.fr.heaterMaxHint', { heat: CRISIS_FX.heaterBoost, watts: CRISIS_FX.heaterBoostWatts }), ['heater'])
      : opt('fr_route_heat', 'engineer', m('crisis.fr.routeHeat'), m('crisis.fr.routeHeatHint', { heat: CRISIS_FX.routeHeat, pct: Math.round((1 - CRISIS_FX.routeHeatSpeed) * 100) }), ['rtg']);
    const text = m('crisis.fr.text', { heat: n.heat, ins: has('thermal_insulation') ? null : m('crisis.fr.textNoInsulation') });
    return {
      ...base, id: `freeze-${n.tick}`, kind: 'freeze', title: CRISIS_TITLES.freeze,
      text: ru(text), i18n: { text },
      nodeIds: [...(sens ? [sens] : []), ...(has('heater') ? ['heater'] : [])],
      causeIds: ['freeze', 'cold', 'thermal_insulation', 'heater', ...(has('thermal_radiator') ? ['thermal_radiator'] : [])],
      options: [
        eng,
        opt('fr_sleep', 'science', m('crisis.fr.sleep'), m('crisis.fr.sleepHint', { ticks: CRISIS_FX.sleepTicks })),
        opt('fr_continue', 'science', m('crisis.fr.continue'), m('crisis.fr.continueHint', { sens: sens ? m('crisis.fr.continueHintSens', { name: nameOf(sens) }) : null }), sens ? [sens] : undefined),
      ],
    };
  }

  if (!seen('signal_distortion') && snap.stormOn && n.storm && n.storm.until - n.tick > 10) {
    const ants = ANTENNAS.filter(has);
    const cams = CAMERAS.filter(has);
    const text = n.storm.amp ? m('crisis.sd.textAmp') : m('crisis.sd.text', { pct: Math.round(n.storm.loss * 100) });
    return {
      ...base, id: `signal_distortion-${n.tick}`, kind: 'signal_distortion', title: CRISIS_TITLES.signal_distortion,
      text: ru(text), i18n: { text },
      nodeIds: ants,
      causeIds: ['signal_amp', ...ants],
      options: [
        opt('sd_retune', 'comms', m('crisis.sd.retune'), m('crisis.sd.retuneHint', { ticks: CRISIS_FX.retuneLost }), ants),
        ...(has('antenna_high_gain') ? [opt('sd_point', 'comms', m('crisis.sd.point'), m('crisis.sd.pointHint', { watts: CRISIS_FX.pointWatts }), ['antenna_high_gain'])] : []),
        opt('sd_hold_tx', 'comms', m('crisis.sd.holdTx'), m('crisis.sd.holdTxHint', { free: Math.round(n.memoryCap - n.dataOnboard) })),
        opt('sd_continue', 'science', m('crisis.sd.continue'), m('crisis.sd.continueHint')),
        ...(cams.length ? [opt('sd_pause_cams', 'science', m('crisis.sd.pauseCams'), m('crisis.sd.pauseCamsHint'), cams)] : []),
        opt('sd_stabilize', 'engineer', m('crisis.sd.stabilize'), m('crisis.sd.stabilizeHint', { watts: CRISIS_FX.stabilizeWatts }), has('transceiver') ? ['transceiver'] : undefined),
      ],
    };
  }
  return null;
}

function hottest(active: Load[], n: FlightState): string | undefined {
  const cand = active
    .map((l) => COMPONENT_BY_ID[l.id])
    .filter((d) => d && isInstrument(d) && !n.broken.includes(d.id))
    .sort((a, b) => b.heat - a.heat);
  return cand[0]?.id;
}

function powerOptions(n: FlightState, active: Load[], need: number, variant: 'bus' | 'battery'): CrisisOption[] {
  const out: CrisisOption[] = [];
  const instr = active.filter((l) => COMPONENT_BY_ID[l.id] && isInstrument(COMPONENT_BY_ID[l.id])).sort((a, b) => b.watts - a.watts);
  const isolate = active.filter((l) => l.priority >= 3).sort((a, b) => b.watts - a.watts)[0];

  // Commander: which goals to keep (ТЗ §10).
  const main = mainTargets(n);
  const mainIds = new Set(main.flatMap((t) => t.need));
  const sideInstr = instr.filter((l) => !mainIds.has(l.id)).map((l) => l.id);
  out.push(opt('pd_keep_main', 'commander', m('crisis.pd.keepMain', { goals: main.length ? andList(main.map((t) => t.name)) : '—' }),
    sideInstr.length ? m('crisis.pd.keepMainHint', { names: names(sideInstr), watts: watts(active, sideInstr) }) : m('crisis.pd.keepMainHintAll'), sideInstr));
  const emergency = emergencyOption(n, active, need); // Individual Tasks: the agreed sacrifice order
  if (emergency) out.push(emergency);
  out.push(opt('pd_keep_all', 'commander', m('crisis.pd.keepAll'), m(variant === 'bus' ? 'crisis.pd.keepAllHintBus' : 'crisis.pd.keepAllHintBattery')));

  // Engineer: the exact node.
  const short = (w: number) => (w < need ? m('crisis.pd.short', { need: Math.ceil(need) }) : null);
  if (isolate) out.push(opt('pd_isolate', 'engineer', m('crisis.pd.isolate', { name: nameOf(isolate.id) }), m('crisis.pd.isolateHint', { watts: isolate.watts, name: nameOf(isolate.id), short: short(isolate.watts) }), [isolate.id]));
  if (variant === 'battery') out.push(opt('pd_cycle', 'engineer', m('crisis.pd.cycle'), m('crisis.pd.cycleHint', { ticks: CRISIS_FX.cycleTicks, what: m(n.asteroid ? 'crisis.pd.cycleManeuvers' : 'crisis.pd.cycleRotors') })));

  // Science: the hungriest instruments.
  const shed: string[] = [];
  let cut = 0;
  for (const l of instr) { if (cut >= need) break; shed.push(l.id); cut += l.watts; }
  if (shed.length) out.push(opt('pd_shed_hungry', 'science', m('crisis.pd.shedHungry'), m('crisis.pd.shedHungryHint', { list: shed.map((id) => `${nameOf(id)} ${watts(active, [id])} W`).join(', '), short: short(cut) }), shed));
  if (variant === 'battery' && instr.length) out.push(opt('pd_pause', 'science', m('crisis.pauseLabel'), m('crisis.pd.pauseHint', { ticks: CRISIS_FX.pauseTicks, watts: watts(active, instr.map((l) => l.id)) })));

  // Comms: how much data we can still send, and a cheaper link.
  const link = active.filter((l) => LINK_LOADS.includes(l.id));
  if (link.length && !n.ecoLink) out.push(opt('pd_eco_link', 'comms', m('crisis.pd.ecoLink'), m('crisis.pd.ecoLinkHint', { watts: Math.round(watts(active, link.map((l) => l.id)) / 2), data: Math.round(n.dataOnboard), short: short(watts(active, link.map((l) => l.id)) / 2) })));
  return out;
}

/** Roles that have at least one option in this crisis. */
export function rolesWithOptions(c: ActiveCrisis): RoleId[] {
  return ROLE_ORDER.filter((r) => c.options.some((o) => o.role === r));
}

/** Player of `role` picks an option (can change it until the crisis is resolved). */
export function chooseOption(f: FlightState, role: RoleId, optionId: string): { flight: FlightState; error?: string; errorMsg?: Msg } {
  const fail = (k: string) => { const errorMsg = m(k); return { flight: f, error: ru(errorMsg), errorMsg }; };
  const c = f.crisis;
  if (!c) return fail('crisis.err.none');
  const o = c.options.find((x) => x.id === optionId);
  if (!o) return fail('crisis.err.noOption');
  if (o.role !== role) return fail('crisis.err.otherRole');
  const n = structuredClone(f);
  n.crisis!.chosen[role] = optionId;
  trackCommand(n, { role, kind: 'crisis', label: o.label, shown: true, ...(o.i18n?.label ? { i18n: { label: o.i18n.label } } : {}) });
  n.causes.push({ tick: n.tick, kind: 'crisis', ref: `choice:${optionId}`, causeIds: [`opt:${optionId}`], ...ev(m('crisis.choice', { who: whoMsg(role), label: o.i18n?.label ?? o.label })) });
  return { flight: n };
}

const RELEVANT: Record<CrisisKind, ActionKind[]> = {
  power_drop: ['shed_secondary', 'stop_risky_maneuvers'],
  overheat: ['safe_mode_hot_instrument', 'shed_secondary', 'stop_risky_maneuvers'],
  freeze: ['shed_secondary', 'stop_risky_maneuvers'],
  signal_distortion: ['keep_collecting_store', 'point_antenna_earth', 'shed_secondary', 'stop_risky_maneuvers'],
  debris_alert: ['evade', 'stop_risky_maneuvers', 'shed_secondary'],
  arm_jam: ['prepare_return', 'stop_risky_maneuvers', 'shed_secondary'],
};

interface Flags {
  protectScience: boolean;
  comms: boolean;
  /** Debris: how the craft met the stream. */
  debris?: 'evade' | 'hold' | 'continue';
  brace?: boolean;
  repoint?: boolean;
  /** Arm Jam: somebody worked on the drive. */
  arm?: boolean;
  inspect?: boolean;
}

/** Close the active crisis: apply choices (or autonomy / Safe Protocol), check the root cause, log consequences. */
export function resolveCrisis(n: FlightState, build: Build, stats: CraftStats, rules: AutonomyRule[]): void {
  const c = n.crisis;
  if (!c) return;
  const t = n.tick;
  const mission = MISSIONS[n.mission];
  const effects: string[] = [];
  const fx: Msg[] = [];
  const say: Say = (s, msg) => {
    if (typeof s === 'string') { effects.push(s); fx.push(msg ?? join([s])); } else { effects.push(ru(s)); fx.push(s); }
  };
  const flags: Flags = { protectScience: false, comms: false };
  const log = (e: Omit<CauseEvent, 'tick'>) => n.causes.push({ tick: t, ...e });
  let by: CrisisRecord['by'] = 'team';
  let ruleIds: string[] = [];
  const chosen = ROLE_ORDER.map((r) => c.chosen[r]).filter((x): x is string => !!x).map((id) => c.options.find((o) => o.id === id)!).filter(Boolean);

  if (chosen.length) {
    for (const o of chosen) applyOption(n, o, say, flags);
  } else if (c.kind === 'signal_distortion') {
    const fired = evaluateRules(rules, telemetry(n, stats, 'lost'), build, stats.ruleSlots).filter((r) => RELEVANT.signal_distortion.includes(r.action));
    by = fired.length ? 'autonomy' : 'safe';
    ruleIds = fired.map((r) => r.ruleId);
    noteRulesFired(n, rules, fired, 'crisis', m('crisis.ctx.noAnswer', { title: c.title }));
    n.lostUntil = t + TITAN.storm.escalationLost;
    say(m('crisis.sd.noAnswer', {
      ticks: TITAN.storm.escalationLost,
      tail: by === 'autonomy' ? m('crisis.sd.noAnswerRules', { rules: ruleIds.map((id) => ruleName(rules, id)).join('; ') }) : m('crisis.sd.noAnswerSafe'),
    }));
  } else {
    const fired = evaluateRules(rules, telemetry(n, stats), build, stats.ruleSlots).filter((r) => RELEVANT[c.kind].includes(r.action));
    by = fired.length ? 'autonomy' : 'safe';
    ruleIds = fired.map((r) => r.ruleId);
    noteRulesFired(n, rules, fired, 'crisis', m('crisis.ctx.timeout', { title: c.title }));
    const actions = fired.length ? fired.map((r) => r.action) : SAFE_PROTOCOL;
    say(by === 'autonomy' ? m('crisis.timeoutRules', { rules: ruleIds.map((id) => ruleName(rules, id)).join('; ') }) : m('crisis.timeoutSafe'));
    for (const a of actions) applyAuto(n, build, stats, c, a, say, flags);
  }

  // Root cause fixed for good?
  let resolved = true;
  const peakLoads = loadsFor(n, build, mission, stats, peakFor(n));
  const peak = sumWatts(peakLoads, n.off);
  const hasPdu = (build.pdu ?? 0) > 0 && !n.off.includes('pdu');
  const numbers: Record<string, number> = { heat: n.heat, busLimit: stats.busLimit, generation: stats.generation, peak };

  if (c.kind === 'power_drop' && c.variant === 'bus') {
    if (peak > stats.busLimit) {
      resolved = false;
      const ids = pickShed(peakLoads, n.off, peak - stats.busLimit, hasPdu);
      for (const id of ids) {
        n.off.push(id);
        log({ kind: 'shed', ref: 'bus-trip', causeIds: ['power_bus', 'bus-overload', id], ...ev(m('crisis.busTripLog', { name: nameOf(id) })) });
      }
      say(ids.length ? m('crisis.busStillOver', { names: names(ids), noPdu: hasPdu ? null : m('crisis.busNoPdu') }) : m('crisis.busStillOverPlain'));
    } else say(m('crisis.busOk'));
  }
  if (c.kind === 'power_drop' && c.variant === 'battery') {
    const net = stats.generation - peak;
    numbers.net = net;
    if (net < 0) { resolved = false; say(m('crisis.deficitLeft', { watts: -net })); }
    else say(m('crisis.deficitFixed'));
  }
  if (c.kind === 'overheat') {
    const heat = heatFor(n, build, mission, peakFor(n), n.off);
    numbers.heatAfter = heat;
    if (heat >= THERMAL.overheat) {
      resolved = false;
      n.hull = Math.max(0, n.hull - CRISIS_FX.overheatHull);
      const hot = hottest(peakLoads.filter((l) => !n.off.includes(l.id)), n);
      if (hot) { n.off.push(hot); n.broken.push(hot); }
      say(m('crisis.overheatLeft', { hull: CRISIS_FX.overheatHull, hot: hot ? m('crisis.overheatBroke', { name: nameOf(hot) }) : null }));
      log({ kind: 'thermal', ref: 'overheat-damage', causeIds: [...c.causeIds, ...(hot ? [hot] : [])], ...ev(m('crisis.overheatLog', { hot: hot ? m('crisis.failedPart', { name: nameOf(hot) }) : null })) });
    } else say(m(heat >= THERMAL.hot ? 'crisis.overheatStillHot' : 'crisis.overheatFixed'));
    n.warmTicks = 0;
  }
  if (c.kind === 'freeze') {
    const heat = heatFor(n, build, mission, peakFor(n), n.off) ;
    numbers.heatAfter = heat;
    if (heat <= THERMAL.freezing) {
      resolved = false;
      if (!flags.protectScience) {
        const sens = ['hires_camera', 'wide_camera', 'spectrometer', 'atmo_sensor'].find((id) => (build[id] ?? 0) > 0 && !n.off.includes(id) && !n.broken.includes(id));
        if (sens) { n.off.push(sens); n.broken.push(sens); }
        say(m('crisis.freezeLeft', { sens: sens ? m('crisis.freezeBroke', { name: nameOf(sens) }) : null }));
        log({ kind: 'thermal', ref: 'freeze-damage', causeIds: [...c.causeIds, ...(sens ? [sens] : [])], ...ev(m('crisis.freezeLog', { sens: sens ? m('crisis.failedPart', { name: nameOf(sens) }) : null })) });
      } else say(m('crisis.freezeSlept'));
    } else say(m('crisis.freezeFixed'));
  }
  if (c.kind === 'signal_distortion') {
    resolved = flags.comms || ruleIds.length > 0;
    if (!flags.comms && chosen.length) say(m('crisis.sd.nobodyRetuned'));
  }
  if (c.kind === 'debris_alert') resolved = resolveDebris(n, build, stats, flags, say, numbers, log);
  if (c.kind === 'arm_jam') resolved = resolveJam(n, build, flags, say, numbers, log);

  n.history.push({
    id: c.id, kind: c.kind, variant: c.variant, title: c.title, startedTick: c.startedTick, endedTick: t,
    causeIds: c.causeIds, nodeIds: c.nodeIds, chosen: { ...c.chosen },
    chosenLabels: Object.fromEntries(chosen.map((o) => [o.role, o.label])), by, ruleIds, resolved, effects, numbers,
    i18n: {
      effects: fx,
      chosenLabels: Object.fromEntries(chosen.filter((o) => o.i18n?.label).map((o) => [o.role, o.i18n!.label!])),
    },
  });
  log({ kind: 'crisis', ref: `end:${c.kind}`, causeIds: [...c.causeIds, ...chosen.map((o) => `opt:${o.id}`), ...ruleIds], ...ev(m('crisis.endLog', { title: c.title, fx: join(fx, ' ') })) });
  n.crisis = null;
  n.lastCrisisEnd = t;
}

function applyOption(n: FlightState, o: CrisisOption, say: Say, flags: Flags) {
  const t = n.tick;
  const off = (ids: string[]) => { for (const id of ids) if (!n.off.includes(id)) n.off.push(id); };
  const who = whoMsg(o.role);
  switch (o.id) {
    case 'pd_isolate': case 'pd_shed_hungry': case 'pd_keep_main': case 'oh_shutdown_hot':
      off(o.nodeIds ?? []);
      if (o.nodeIds?.length) say(m('crisis.fx.off', { who, names: names(o.nodeIds) }));
      if (o.id === 'oh_shutdown_hot') flags.protectScience = true;
      break;
    case 'pd_cycle':
      n.holdUntil = Math.max(n.holdUntil, t + CRISIS_FX.cycleTicks);
      n.sciencePausedUntil = Math.max(n.sciencePausedUntil, t + CRISIS_FX.cycleTicks);
      say(m('crisis.fx.cycle', { who, ticks: CRISIS_FX.cycleTicks }));
      break;
    case 'pd_pause': case 'oh_pause':
      n.sciencePausedUntil = Math.max(n.sciencePausedUntil, t + CRISIS_FX.pauseTicks);
      say(m('crisis.fx.pause', { who, ticks: CRISIS_FX.pauseTicks }));
      break;
    case 'pd_keep_all':
      n.hull = Math.max(0, n.hull - CRISIS_FX.keepAllHull);
      say(m('crisis.fx.keepAll', { who, hull: CRISIS_FX.keepAllHull }));
      break;
    case 'pd_eco_link': case 'oh_eco_link':
      n.ecoLink = true;
      say(m('crisis.fx.ecoLink', { who }));
      break;
    case 'oh_land_cool':
      n.holdUntil = Math.max(n.holdUntil, t + CRISIS_FX.coolTicks);
      n.heatAdj -= CRISIS_FX.ventHeat;
      say(m('crisis.fx.landCool', { who }));
      break;
    case 'fr_heater_max':
      n.heatAdj += CRISIS_FX.heaterBoost;
      n.extraLoad += CRISIS_FX.heaterBoostWatts;
      say(m('crisis.fx.heaterMax', { who }));
      break;
    case 'fr_heater_on':
      n.off = n.off.filter((id) => id !== 'heater');
      say(m('crisis.fx.heaterOn', { who }));
      break;
    case 'fr_route_heat':
      n.heatAdj += CRISIS_FX.routeHeat;
      n.speedFactor *= CRISIS_FX.routeHeatSpeed;
      say(m('crisis.fx.routeHeat', { who }));
      break;
    case 'fr_sleep':
      n.sciencePausedUntil = Math.max(n.sciencePausedUntil, t + CRISIS_FX.sleepTicks);
      flags.protectScience = true;
      say(m('crisis.fx.sleep', { who }));
      break;
    case 'fr_continue': case 'sd_continue':
      say(m('crisis.fx.continue', { who }));
      break;
    case 'sd_retune':
      n.lostUntil = Math.max(n.lostUntil, t + CRISIS_FX.retuneLost);
      if (n.storm) { n.storm.factor = Math.max(n.storm.factor, 0.7); n.storm.loss = Math.min(n.storm.loss, 0.1); }
      flags.comms = true;
      say(m('crisis.fx.retune', { who }));
      break;
    case 'sd_point':
      if (n.storm) { n.storm.factor = Math.max(n.storm.factor, 0.9); n.storm.loss = Math.min(n.storm.loss, 0.05); }
      n.extraLoad += CRISIS_FX.pointWatts;
      flags.comms = true;
      say(m('crisis.fx.point', { who }));
      break;
    case 'sd_hold_tx':
      if (n.storm) { n.storm.factor = 0; n.storm.loss = 0; }
      flags.comms = true;
      say(m('crisis.fx.holdTx', { who }));
      break;
    case 'sd_pause_cams':
      n.camsPausedUntil = Math.max(n.camsPausedUntil, n.storm?.until ?? t + CRISIS_FX.pauseTicks);
      say(m('crisis.fx.pauseCams', { who }));
      break;
    case 'sd_stabilize':
      if (n.storm) n.storm.loss = Math.max(0, n.storm.loss - 0.1);
      n.extraLoad += CRISIS_FX.stabilizeWatts;
      say(m('crisis.fx.stabilize', { who }));
      break;

    // ── Debris Alert ──
    case 'da_evade': flags.debris = 'evade'; break;
    case 'da_continue': flags.debris = 'continue'; break;
    case 'da_brace': flags.brace = true; say(m('crisis.fx.brace', { who, side: m(o.nodeIds?.includes('micrometeoroid_shield') ? 'crisis.fx.braceShield' : 'crisis.fx.braceHull') })); break;
    case 'da_repoint': flags.repoint = true; say(m('crisis.fx.repoint', { who })); break;

    // ── Sampling Arm Jam ──
    case 'aj_restart': case 'aj_isolate': case 'aj_retry': case 'aj_keep': case 'aj_switch':
      flags.arm = true; break;
    case 'aj_inspect': flags.inspect = true; say(m('crisis.fx.inspect', { who })); break;
    case 'aj_save':
      n.downlinkFirst = 'composition';
      say(m('crisis.fx.save', { who }));
      break;
    default:
      applyTaskOption(n, o, ru(who), say); // pd_emergency, oh_intensity_* (src/engine/tasks.ts)
  }
}

const works = (n: FlightState, build: Build, id: string) => (build[id] ?? 0) > 0 && !n.off.includes(id) && !n.broken.includes(id);

/** Debris Alert: evade (fuel), hold (Safe Protocol) or continue (damage depends on the Micrometeoroid Shield and bracing). */
function resolveDebris(n: FlightState, build: Build, stats: CraftStats, flags: Flags, say: Say, numbers: Record<string, number>, log: (e: Omit<CauseEvent, 'tick'>) => void): boolean {
  const a = n.asteroid!;
  const D = ASTEROID.debris;
  const t = n.tick;
  const shield = (build.micrometeoroid_shield ?? 0) > 0;
  const mode = flags.debris ?? 'continue';
  a.debrisDone = true;
  a.debris = false;
  numbers.fuelBefore = Math.round(a.fuel);
  let hull = 0;
  let modules: string[] = [];
  if (mode === 'evade') {
    const k = 1 + Math.max(0, (stats.mass - stats.massLimit) / stats.massLimit) * ASTEROID.overweightFuel;
    const need = D.evadeFuel * k;
    const take = Math.min(a.fuel, need);
    a.fuel = Math.round((a.fuel - take) * 1000) / 1000;
    a.fuelUsed.evade += take;
    n.holdUntil = Math.max(n.holdUntil, t + D.evadeHold);
    if (take < need * 0.99) {
      hull = Math.round((shield ? D.hull.shield : D.hull.none) * 0.5);
      say(m('crisis.da.evadePartial', { fuel: Math.round(take) }));
    } else say(m('crisis.da.evaded', { fuel: Math.round(take), ticks: D.evadeHold }));
    const pointing = works(n, build, 'star_tracker') || works(n, build, 'reaction_wheels');
    if (!pointing && !flags.repoint) {
      n.lostUntil = Math.max(n.lostUntil, t + D.misalignLost);
      say(m('crisis.da.misaligned', { ticks: D.misalignLost }));
      log({ kind: 'signal', ref: 'antenna-misaligned', causeIds: ['star_tracker', 'reaction_wheels'], ...ev(m('crisis.da.misalignedLog')) });
    }
  } else {
    hull = shield ? D.hull.shield : D.hull.none;
    if (mode === 'hold') hull = Math.round(hull * 0.5);
    if (flags.brace && shield) hull = Math.round(hull / 3);
    if (flags.brace && !shield) hull += D.braceHull;
    if (!shield && !flags.brace) {
      modules = ['heat_shield', ...(mode === 'continue' ? ['robotic_arm'] : [])];
    }
  }
  if (n.mods?.upgrades.includes('light_alloys')) hull = Math.round(hull * D.lightAlloyHull);
  if (hull > 0) {
    n.hull = Math.max(0, n.hull - hull);
    a.debrisHull = hull;
    say(m('crisis.da.hits', { hull, shield: shield ? m('crisis.da.hitsShield') : null }));
  }
  for (const id of modules) {
    if (id === 'robotic_arm') { if ((build.robotic_arm ?? 0) > 0) { a.armDamaged = true; say(m('crisis.da.armBent')); } continue; }
    if (!n.broken.includes(id)) n.broken.push(id);
    say(m('crisis.da.broke', { name: nameOf(id) }));
  }
  if (modules.length || hull > 0) log({ kind: 'crisis', ref: 'debris-damage', causeIds: ['micrometeoroid_shield', ...modules], ...ev(m('crisis.da.damageLog', { hull, mods: modules.length ? m('crisis.da.damageLogMods', { names: names(modules.filter((id) => id !== 'robotic_arm' || a.armDamaged)) }) : null })) });
  numbers.hullLoss = hull;
  numbers.fuelAfter = Math.round(a.fuel);
  return mode === 'evade' ? hull === 0 : hull <= 5 && modules.length === 0;
}

/** Sampling Arm Jam: apply what the team chose for the drive (or the rule / Safe Protocol already did it). */
function resolveJam(n: FlightState, build: Build, flags: Flags, say: Say, numbers: Record<string, number>, log: (e: Omit<CauseEvent, 'tick'>) => void): boolean {
  const a = n.asteroid!;
  const J = ASTEROID.jam;
  const t = n.tick;
  const c = n.crisis!;
  const picked = new Set(Object.values(c.chosen));
  const cause = (e: Omit<CauseEvent, 'tick'>) => log(e);
  a.jamPending = false;
  a.jamDone = true;
  numbers.progress = Math.round(a.samplingProgress * 100);
  if (MISSIONS.asteroid.phases[n.phaseIndex]?.id !== 'sampling' || a.sample.collected || a.sampling === 'failed') {
    say(m('crisis.aj.late'));
    return a.sample.collected;
  }
  if (picked.has('aj_keep')) {
    keepWhatWeHave(n, ASTEROID.sampling.keepNow, cause);
    say(m('crisis.aj.keepDone', { mass: a.sample.mass }));
  } else if (picked.has('aj_retry')) {
    a.samplingProgress = 0;
    a.attempts++;
    a.sampling = 'reach';
    a.resumeAt = t + J.retryTicks;
    if (picked.has('aj_isolate')) { if (!n.off.includes('robotic_arm')) n.off.push('robotic_arm'); }
    else if (picked.has('aj_switch')) { if (!n.off.includes('robotic_arm')) n.off.push('robotic_arm'); }
    a.rateFactor = picked.has('aj_restart') || picked.has('aj_inspect') ? 1 : 0.8;
    say(m('crisis.aj.retryDone', { ticks: J.retryTicks }));
  } else if (picked.has('aj_isolate') || picked.has('aj_switch')) {
    if (!n.off.includes('robotic_arm')) n.off.push('robotic_arm');
    const drill = works(n, build, 'drill');
    if (drill) {
      a.tool = 'drill';
      a.sampling = 'grab';
      a.resumeAt = t + 2;
      say(m('crisis.aj.drillGoes', { who: whoMsg(picked.has('aj_switch') ? 'science' : 'engineer') }));
    } else {
      const kept = keepWhatWeHave(n, ASTEROID.sampling.keepNow, cause);
      say(kept ? m('crisis.aj.isolatedKept', { mass: a.sample.mass }) : m('crisis.aj.isolatedEmpty'));
    }
  } else if (picked.has('aj_restart')) {
    a.sampling = 'grab';
    a.resumeAt = t + J.restartTicks;
    a.rateFactor = flags.inspect ? 1 : 0.8;
    say(m('crisis.aj.restarted', { ticks: J.restartTicks, tail: m(flags.inspect ? 'crisis.aj.restartedInspect' : 'crisis.aj.restartedCareful') }));
  } else if (!flags.arm) {
    say(m('crisis.aj.nobody'));
  }
  numbers.rate = Math.round(toolRate(a.tool, a.site ?? 'regolith') * a.rateFactor * 1000) / 1000;
  const going = a.sampling === 'grab' || a.sampling === 'reach';
  return a.sample.collected || (going && a.rateFactor >= 1);
}

/** Debris Alert (approach) and Sampling Arm Jam (sampling): planned by the build + seed, they wait for a free crisis slot. */
export function detectAsteroidCrisis(n: FlightState, build: Build, _stats: CraftStats, phaseId: string, pt: number, seed: number): ActiveCrisis | null {
  const a = n.asteroid;
  if (!a) return null;
  const has = (id: string) => (build[id] ?? 0) > 0;
  const t = n.tick;
  if (phaseId === 'approach' && !a.debrisDone && !a.debrisPending) {
    const plan = debrisPlan(seed, build);
    if (plan.hits && pt >= plan.at) a.debrisPending = true;
  }
  if (a.debrisPending && phaseId === 'approach') {
    a.debrisPending = false;
    const shield = has('micrometeoroid_shield');
    const seen = ASTEROID.approach.navIds.some((id) => works(n, build, id));
    const D = ASTEROID.debris;
    const pointing = works(n, build, 'star_tracker') || works(n, build, 'reaction_wheels');
    const chem = works(n, build, 'chem_main_engine') || works(n, build, 'chem_thrusters');
    const dmg = shield ? D.hull.shield : D.hull.none;
    a.debris = true;
    const options: CrisisOption[] = [
      ...(chem ? [opt('da_evade', 'commander', m('crisis.da.evade'), m('crisis.da.evadeHint', { fuel: D.evadeFuel, now: Math.round(a.fuel), hold: D.evadeHold, low: a.fuel < D.evadeFuel ? m('crisis.da.evadeHintLow') : null, ant: pointing ? null : m('crisis.da.evadeHintAntenna', { s: D.misalignLost }) }), ['chem_thrusters', 'chem_main_engine'].filter(has))] : []),
      opt('da_continue', 'commander', m('crisis.da.continue'), m('crisis.da.continueHint', { dmg, tail: m(shield ? 'crisis.da.continueHintShield' : 'crisis.da.continueHintNoShield') })),
      opt('da_brace', 'engineer', m(shield ? 'crisis.da.braceShield' : 'crisis.da.braceHull'), shield ? m('crisis.da.braceShieldHint') : m('crisis.da.braceHullHint', { hull: D.braceHull }), shield ? ['micrometeoroid_shield'] : ['heat_shield', 'return_capsule']),
      ...(!pointing && chem ? [opt('da_repoint', 'comms', m('crisis.da.repoint'), m('crisis.da.repointHint'), ANTENNAS.filter(has))] : []),
    ];
    const text = m('crisis.da.text', { shield: m(shield ? 'crisis.da.textShield' : 'crisis.da.textNoShield'), late: seen ? null : m('crisis.da.textLate') });
    return {
      id: `debris_alert-${t}`, kind: 'debris_alert', title: CRISIS_TITLES.debris_alert, startedTick: t, chosen: {},
      deadlineTick: t + (seen ? ASTEROID.crisis.deadline : D.lateDeadline), variant: seen ? undefined : 'late',
      text: ru(text), i18n: { text },
      nodeIds: shield ? ['micrometeoroid_shield'] : ['heat_shield', 'return_capsule'].filter(has),
      causeIds: ['micrometeoroid_shield', 'debris', ...(seen ? [] : ['radar_altimeter', 'nav_camera'])],
      options,
    };
  }
  if (a.jamPending && phaseId === 'sampling' && !n.crisesSeen.includes('arm_jam')) {
    const site = SITE_BY_ID[a.site!];
    const tool = a.tool;
    const toolIds = tool === 'drill' ? ['drill'] : tool === 'both' ? ['robotic_arm', 'drill'] : ['robotic_arm'];
    const pct = Math.round(a.samplingProgress * 100);
    const name = toolName(tool);
    const dampers = has('vibration_dampers');
    const drillAlt = tool === 'arm' && works(n, build, 'drill') ? false : tool === 'both';
    const left = Math.max(0, MISSIONS.asteroid.phases[n.phaseIndex].ticks - n.phaseTick);
    const camera = ['hires_camera', 'wide_camera', 'nav_camera'].find((id) => works(n, build, id));
    const keepMass = Math.round(site.mass * a.samplingProgress);
    const options: CrisisOption[] = [
      opt('aj_restart', 'engineer', m('crisis.aj.restart'), m('crisis.aj.restartHint', { s: ASTEROID.jam.restartTicks, careful: camera ? null : m('crisis.aj.restartHintCareful') }), toolIds),
      opt('aj_isolate', 'engineer', m('crisis.aj.isolate', { name: tool === 'drill' ? 'Drill' : 'Robotic Arm' }), drillAlt || (tool === 'arm' && has('drill')) ? m('crisis.aj.isolateHintDrill') : m('crisis.aj.isolateHintStop', { mass: keepMass }), toolIds),
      opt('aj_retry', 'commander', m('crisis.aj.retry'), m('crisis.aj.retryHint', { s: ASTEROID.jam.retryTicks, left })),
      ...(a.samplingProgress >= ASTEROID.sampling.keepNow ? [opt('aj_keep', 'commander', m('crisis.aj.keep'), m('crisis.aj.keepHint', { mass: keepMass, full: site.mass }))] : []),
      ...((tool === 'arm' && works(n, build, 'drill')) ? [opt('aj_switch', 'science', m('crisis.aj.switch'), m('crisis.aj.switchHint', { site: site.name, drill: Math.round(site.drillRate * 1000) / 10, arm: Math.round(site.armRate * 1000) / 10 }), ['drill'])] : []),
      ...(camera ? [opt('aj_inspect', 'science', m('crisis.aj.inspect'), m('crisis.aj.inspectHint', { name: nameOf(camera) }), [camera])] : []),
      opt('aj_save', 'comms', m('crisis.aj.save'), m('crisis.aj.saveHint')),
    ];
    a.jamPending = false;
    const text = m('crisis.aj.text', {
      tool: m(name === 'Рука' ? 'crisis.aj.textArm' : 'crisis.aj.textDrill'), site: site.name, pct,
      damp: dampers ? null : m('crisis.aj.textNoDampers'), bent: a.armDamaged ? m('crisis.aj.textBent') : null,
    });
    return {
      id: `arm_jam-${t}`, kind: 'arm_jam', title: CRISIS_TITLES.arm_jam, startedTick: t, chosen: {},
      deadlineTick: t + ASTEROID.crisis.deadline,
      text: ru(text), i18n: { text },
      nodeIds: toolIds,
      causeIds: ['vibration_dampers', `site:${a.site}`, ...toolIds, ...(a.armDamaged ? ['debris', 'micrometeoroid_shield'] : [])],
      options,
    };
  }
  return null;
}

function applyAuto(n: FlightState, build: Build, stats: CraftStats, c: ActiveCrisis, a: ActionKind, say: Say, flags: Flags) {
  const t = n.tick;
  const mission = MISSIONS[n.mission];
  switch (a) {
    case 'shed_secondary': {
      if (c.kind === 'power_drop') {
        const loads = loadsFor(n, build, mission, stats, peakFor(n));
        const peak = sumWatts(loads, n.off);
        const need = c.variant === 'bus' ? peak - stats.busLimit : peak - stats.generation;
        const ids = pickShed(loads, n.off, Math.max(need, 1), true, (l) => !!COMPONENT_BY_ID[l.id] && isInstrument(COMPONENT_BY_ID[l.id]));
        for (const id of ids) n.off.push(id);
        if (ids.length) say(m('crisis.auto.shed', { names: names(ids) }));
      } else {
        n.sciencePausedUntil = Math.max(n.sciencePausedUntil, t + CRISIS_FX.sleepTicks);
        flags.protectScience = true;
        say(m('crisis.auto.scienceOff', { ticks: CRISIS_FX.sleepTicks }));
      }
      break;
    }
    case 'safe_mode_hot_instrument': {
      const hot = hottest(loadsFor(n, build, mission, stats, peakFor(n)).filter((l) => !n.off.includes(l.id)), n);
      if (hot) { n.off.push(hot); say(m('crisis.auto.hotOff', { name: nameOf(hot) })); }
      n.sciencePausedUntil = Math.max(n.sciencePausedUntil, t + CRISIS_FX.pauseTicks);
      flags.protectScience = true;
      break;
    }
    case 'stop_risky_maneuvers':
      if (c.kind === 'debris_alert') { flags.debris = flags.debris ?? 'hold'; say(m('crisis.auto.debrisHold')); break; }
      if (c.kind === 'arm_jam') {
        const a = n.asteroid!;
        a.resumeAt = Math.max(a.resumeAt, t + ASTEROID.jam.safeHold);
        a.rateFactor = Math.min(a.rateFactor, ASTEROID.jam.safeRate);
        a.sampling = 'grab';
        flags.arm = true;
        say(m('crisis.auto.armHold', { ticks: ASTEROID.jam.safeHold }));
        break;
      }
      n.holdUntil = Math.max(n.holdUntil, t + CRISIS_FX.holdTicks);
      say(m('crisis.auto.hold', { ticks: CRISIS_FX.holdTicks }));
      break;
    case 'evade':
      if (c.kind === 'debris_alert') { flags.debris = 'evade'; say(m('crisis.auto.evade')); }
      break;
    case 'prepare_return':
      if (c.kind === 'arm_jam') {
        flags.arm = true;
        const kept = keepWhatWeHave(n, ASTEROID.sampling.keepNow, (e) => n.causes.push({ tick: t, ...e }));
        say(m(kept ? 'crisis.auto.prepKept' : 'crisis.auto.prepEmpty'));
      }
      break;
    default:
      break;
  }
}
