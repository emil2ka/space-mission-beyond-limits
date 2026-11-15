// Mission Report (ТЗ §12, docs/03 Design/Mission Report.md).
// Tone: what happened → why → what you could have done. No blame, no formulas.
import { TICK_HOURS } from './constants';
import { COMPONENT_BY_ID } from './data/components';
import { MISSIONS } from './data/missions';
import { MAIN_GOAL_TARGETS, OUTCOME_THRESHOLDS, REWARDS, SCORE_WEIGHTS, TITAN } from './data/titan';
import { ASTEROID, ASTEROID_SCORE_WEIGHTS, COMPOSITION_TARGET, SITE_BY_ID, type AsteroidSiteId, type CapsuleStage } from './data/asteroid';
import { jamRisk } from './asteroid';
import { missionReward, newAgency, prepCosts, recordFlight, type PrepCosts } from './economy';
import type { FlightState, ScienceTarget } from './flight';
import { readiness } from './readiness';
import { crisisImpact, pickReplay, type Replay } from './replay';
import type { Decision, RoomState } from './room';
import { playerContributions, rolesOf, trustEffects, TRUST, type PlayerContribution, type TrustEffects } from './rules';
import { ANTENNAS, nameOf } from './sim';
import { taskChains, taskReport, type TaskReportEntry } from './tasks';
import { computeStats, installed } from './stats';
import type { Build, CraftStats, MissionId, RoleId } from './types';
import { join, m, ru, type Msg } from './msg';

export interface CauseChain {
  what: string;
  why: string;
  couldDo: string;
  /** Same texts as messages (UI renders them in the player's language). Missing in old reports. */
  i18n?: { what?: Msg; why?: Msg; couldDo?: Msg };
  causeIds: string[];
  /** Machine key of the chain (e.g. 'power_drop', 'overweight'). */
  key: string;
  /** Rough points this cost the team (sorting only). */
  impact: number;
}

export type Outcome = 'perfect' | 'success' | 'partial' | 'failed';

export interface MissionReport {
  outcome: Outcome;
  score: number;
  breakdown: { key: string; label: string; weight: number; got: number }[];
  /** Main ≤ 3 first, then the rest («Подробнее»). */
  chains: CauseChain[];
  decisions: Decision[];
  teamTrust: number;
  /** Why Team Trust changed: −15 per knowingly accepted warning that came true, +10 for a clean flight (0013 §3). */
  trust: { delta: number; reason: string; issueId: string; i18n?: { reason: Msg } }[];
  /** 0013 §3: Team Trust tier after this flight and what it does next time. Missing in old reports. */
  trustTier?: TrustEffects;
  /** 0013 §4: what each player did (a player may hold several roles). Missing in old reports. */
  players?: PlayerContribution[];
  roles: { role: RoleId; did: string[]; i18n?: { did: Msg[] } }[];
  /** earned = reward; upkeep = what the next preparation takes (0 with the free basic repair); balance after the reward; prep = its items. */
  mc: { earned: number; upkeep: number; total: number; balance?: number; prep?: PrepCosts };
  highlights: { tick: number; kind: 'launch' | 'crisis' | 'final'; text: string; i18n?: { text: Msg } }[];
  /** Delivered science targets (ids). */
  delivered: string[];
  /** Flight length in ticks. */
  ticks: number;
  /** Autonomy Planner: configured rules and which of them fired («сработало правило …»). */
  autonomy: { configured: number; slots: number; fired: { ruleId: string; text: string; times: number; firstTick: number; where: string[]; i18n?: { where: Msg[] } }[]; safeProtocol: number };
  /** Modules that need repair (go to agency.damaged). */
  damaged: string[];
  /** Asteroid only: the sample return in numbers. */
  asteroid?: {
    site: AsteroidSiteId | null; siteBy: 'science' | 'auto' | null;
    sample: { collected: boolean; sealed: boolean; mass: number; heated: boolean };
    capsule: CapsuleStage; home: boolean;
    fuel: { left: number; max: number; used: number };
    compositionDelivered: boolean;
    /** Perfect needs all three (Asteroid Sample Return.md). */
    perfect: { sealed: boolean; capsuleFound: boolean; composition: boolean };
  };
  /** 3D replay snapshots: launch → main crisis → final (src/engine/replay.ts). Missing in old reports. */
  replay?: Replay;
  /** Individual Tasks: each role's grade and what it changed in this flight. Missing when the task screen was not used. */
  tasks?: TaskReportEntry[];
}

/** Score weights of a mission (Mission Report.md). */
export const scoreWeightsFor = (mission: MissionId) => (mission === 'asteroid' ? ASTEROID_SCORE_WEIGHTS : SCORE_WEIGHTS);

export const OUTCOME_NAMES: Record<Outcome, string> = {
  perfect: 'Perfect Success', success: 'Success', partial: 'Partial Success', failed: 'Failed Mission',
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const fr = (t: ScienceTarget) => Math.min(1, t.sent / t.required);
const names = (ids: string[]) => ids.map(nameOf).join(', ');
/** «name», «name» — data names (targets, waypoints) stay separate string params so the UI can translate each. */
const quoted = (list: string[]) => join(list.map((s) => m('rep.q', { s })), ', ');
/** A chain from three messages: Russian text rendered from the same messages. */
const chainOf = (c: Omit<CauseChain, 'what' | 'why' | 'couldDo' | 'i18n'> & { what: Msg; why: Msg; couldDo: Msg }): CauseChain => ({
  key: c.key, causeIds: c.causeIds, what: ru(c.what), why: ru(c.why), couldDo: ru(c.couldDo), impact: c.impact,
  i18n: { what: c.what, why: c.why, couldDo: c.couldDo },
});

export function buildReport(room: RoomState): MissionReport {
  const f = room.flight;
  const mission = MISSIONS[room.mission];
  const stats = computeStats(room.build, mission, f?.mods ?? room.agency);
  const decisions = room.decisionLog?.length ? room.decisionLog : room.decisions;
  if (!f) {
    return {
      outcome: 'failed', score: 0, breakdown: scoreWeightsFor(room.mission).map((w) => ({ ...w, got: 0 })), chains: [], decisions,
      teamTrust: room.teamTrust, trust: [], roles: [], mc: { earned: REWARDS.failed, upkeep: 0, total: REWARDS.failed }, highlights: [], delivered: [], ticks: 0,
      autonomy: { configured: room.rules.length, slots: stats.ruleSlots, fired: [], safeProtocol: 0 }, damaged: [],
    };
  }

  // ── Score ──
  const targets = f.targets;
  const sorted = [...targets].sort((a, b) => fr(b) - fr(a));
  const main = sorted.slice(0, MAIN_GOAL_TARGETS);
  const extra = sorted.slice(MAIN_GOAL_TARGETS);
  const n = Math.max(1, targets.length);
  const volume = targets.reduce((s, t) => s + Math.min(1, t.collected / t.required), 0) / n;
  const quality = targets.reduce((s, t) => s + Math.min(1, t.collected / t.required) * t.quality, 0) / n;
  const collected = targets.reduce((s, t) => s + t.collected, 0);
  const sent = targets.reduce((s, t) => s + t.sent, 0);
  const possible = targets.filter((t) => t.possible);
  const expected = Math.max(1, (possible.length ? possible : targets).reduce((s, t) => s + t.required, 0));
  const costShare = stats.cost / stats.budget;
  const budgetPart = costShare <= 0.85 ? 1 : Math.max(0, 1 - ((costShare - 0.85) / 0.15) * 0.5);
  const a = f.asteroid;
  const comp = targets.find((t) => t.id === COMPOSITION_TARGET);
  const home = !!a && a.sample.collected && a.capsule === 'found';
  const got: Record<string, number> = a ? {
    // Asteroid: the sample on Earth and its composition data are the main goal.
    main: 35 * ((home ? 0.6 : 0) + 0.4 * (comp ? fr(comp) : 0)),
    data: 20 * (0.5 * volume + 0.5 * quality),
    craft: 10 * (f.hull / 100) * Math.max(0, 1 - 0.2 * f.broken.length),
    comms: collected > 0 ? 15 * Math.min(1, sent / collected) * Math.min(1, collected / expected) : 0,
    sample: home ? 10 * (a.sample.sealed ? 1 : 0.5) * Math.min(1, a.sample.mass / ASTEROID.fullSample) * (a.heated ? 0.5 : 1) : 0,
    return: 5 * (a.capsule === 'found' ? 1 : a.capsule === 'lost' ? 0.3 : 0),
    resources: 5 * (0.5 * budgetPart + 0.5 * (a.fuelMax ? Math.min(1, a.fuel / a.fuelMax / ASTEROID.fuelReserve) : 0)),
  } : {
    main: main.length ? (main.reduce((s, t) => s + fr(t), 0) / MAIN_GOAL_TARGETS) * 35 : 0,
    data: 20 * (0.5 * volume + 0.5 * quality),
    craft: 10 * (f.hull / 100) * Math.max(0, 1 - 0.2 * f.broken.length),
    // Share of collected data that reached Earth, scaled by how much there was to send:
    // a craft that collected almost nothing must not get full comms points.
    comms: collected > 0 ? 15 * Math.min(1, sent / collected) * Math.min(1, collected / expected) : 0,
    extra: extra.length ? 10 * Math.min(1, extra.reduce((s, t) => s + fr(t), 0) / extra.length) : 0,
    route: f.waypoints.length ? 5 * (f.waypoints.filter((w) => w.reached).length / f.waypoints.length) : 0,
    resources: 5 * budgetPart,
  };
  const breakdown = scoreWeightsFor(room.mission).map((w) => ({ key: w.key, label: w.label, weight: w.weight, got: r1(Math.min(w.weight, got[w.key] ?? 0)) }));
  const score = Math.round(breakdown.reduce((s, b) => s + b.got, 0));
  let outcome: Outcome = score >= OUTCOME_THRESHOLDS.perfect ? 'perfect' : score >= OUTCOME_THRESHOLDS.success ? 'success' : score >= OUTCOME_THRESHOLDS.partial ? 'partial' : 'failed';
  const delivered = targets.filter((t) => t.sent >= t.required).map((t) => t.id);
  const compDelivered = !!comp && comp.sent >= comp.required;
  if (a) {
    // Perfect = sealed sample + capsule found + composition delivered; no sample on Earth = at best Partial («данные есть, образец потерян»).
    if (outcome === 'perfect' && !(a.sample.sealed && home && compDelivered && !a.heated)) outcome = 'success';
    if (!home && (outcome === 'perfect' || outcome === 'success')) outcome = 'partial';
  }

  // ── Team Trust: only knowingly accepted warnings whose risk came true (ТЗ §3.1) ──
  const lastApproval = [...decisions].reverse().find((d) => d.kind === 'approve' || d.kind === 'approve-against-warning');
  const accepted = lastApproval?.kind === 'approve-against-warning' ? lastApproval.issueIds : [];
  const happened = new Set(f.causes.filter((c) => ['crisis', 'shed', 'mass', 'thermal'].includes(c.kind) && c.ref !== 'link-back').flatMap((c) => c.causeIds));
  const ready = readiness(room.build, mission);
  const issueText = (id: string) => [...ready.warnings, ...ready.blockers, ...stats.issues].find((i) => i.id === id)?.text ?? id;
  const trust: MissionReport['trust'] = accepted.filter((id) => happened.has(id)).map((id) => {
    const reason = m('rep.trust.penalty', { issue: issueText(id) });
    return { delta: -TITAN.trustPenalty, issueId: id, reason: ru(reason), i18n: { reason } };
  });
  // 0013 §3: a flight where no accepted warning came true earns trust back (up to 100).
  if (!trust.length && f.trustAtStart < TRUST.max) {
    const delta = Math.min(TRUST.recovery, TRUST.max - f.trustAtStart);
    const reason = m('rep.trust.recovery', { rec: TRUST.recovery, max: TRUST.max });
    trust.push({ delta, issueId: 'recovery', reason: ru(reason), i18n: { reason } });
  }
  const teamTrust = Math.max(0, Math.min(100, f.trustAtStart + trust.reduce((s, x) => s + x.delta, 0)));

  // ── Chains ──
  const chains = [...buildChains(f, room.build, stats, accepted), ...taskChains(f)].sort((x, y) => y.impact - x.impact);
  const tasks = taskReport(f);

  // ── Roles ──
  const roles = roleContributions(room, f, decisions);

  // ── MC: reward now, the preparation of the next attempt shown in advance (economy.ts) ──
  const earned = missionReward(outcome, delivered.length);
  const damaged = [...new Set([...f.broken, ...(a?.armDamaged ? ['robotic_arm'] : [])])];
  const after = recordFlight(room.agency ?? { ...newAgency(), credits: room.credits ?? 0 }, { mission: room.mission, outcome, earned, broken: damaged, hull: f.hull, audit: trustEffects(teamTrust).audit });
  const prep = prepCosts(after, false);
  const mc = { earned, upkeep: prep.charge, total: earned - prep.charge, balance: after.credits, prep };

  // ── Highlights for the 3D replay ──
  const main3 = [...f.history].sort((a, b) => crisisImpact(b) - crisisImpact(a));
  const highlights: MissionReport['highlights'] = [
    { tick: 0, kind: 'launch', text: ru(m('rep.hl.launch')), i18n: { text: m('rep.hl.launch') } },
    ...f.history.map((h) => {
      const text = m('rep.hl.crisis', { title: h.title, main: h === main3[0] ? m('rep.hl.main') : '' });
      return { tick: h.startedTick, kind: 'crisis' as const, text: ru(text), i18n: { text } };
    }),
    { tick: f.tick, kind: 'final', text: OUTCOME_NAMES[outcome] },
  ];

  const autonomy = autonomySummary(room, stats.ruleSlots);
  const asteroid: MissionReport['asteroid'] = a ? {
    site: a.site, siteBy: a.siteBy, sample: { ...a.sample, heated: a.heated }, capsule: a.capsule, home,
    fuel: { left: Math.round(a.fuel), max: a.fuelMax, used: Math.round(Object.values(a.fuelUsed).reduce((x, y) => x + y, 0)) },
    compositionDelivered: compDelivered,
    perfect: { sealed: a.sample.sealed && !a.heated, capsuleFound: a.capsule === 'found', composition: compDelivered },
  } : undefined;
  const replay = pickReplay(f);
  const trustTier = trustEffects(teamTrust);
  const players = playerContributions({ ...room, log: room.log.slice(room.attemptLogFrom ?? 0) });
  return { outcome, score, breakdown, chains, decisions, teamTrust, trust, trustTier, players, roles, mc, highlights, delivered, ticks: f.tick, autonomy, damaged, ...(asteroid ? { asteroid } : {}), ...(replay ? { replay } : {}), ...(tasks.length ? { tasks } : {}) };
}

function phaseAt(f: FlightState, tick: number): string {
  const phases = MISSIONS[f.mission].phases;
  const changes = f.causes.filter((c) => c.kind === 'phase' && c.tick <= tick && c.ref !== 'final');
  return changes.length ? changes[changes.length - 1].text.replace(/^Фаза: /, '').replace(/\.$/, '') : phases[0].name;
}

function buildChains(f: FlightState, build: Build, stats: CraftStats, accepted: string[]): CauseChain[] {
  const out: CauseChain[] = [];
  const has = (id: string) => (build[id] ?? 0) > 0;
  const acc = (id: string) => accept(accepted, id);
  const shed = (ref: string) => [...new Set(f.causes.filter((c) => c.ref === ref).map((c) => c.causeIds[ref === 'bus-trip' ? 2 : 0]))];
  const rtg = build.rtg ?? 0;
  const ast = !!f.asteroid;
  const srcList = stats.generationBySource.map((l) => `${l.name} ×${l.count}`);
  const sources: Msg | string = srcList.length ? srcList.slice(1).reduce<Msg | string>((a, b) => m('rep.and', { a, b }), srcList[0]) : m('common.nothing');
  const moreGen = ast ? m('rep.moreGen.ast') : m('rep.moreGen');

  for (const h of f.history) {
    const when = phaseAt(f, h.startedTick);
    const team = h.by === 'team';
    const handled = team && h.resolved ? m('rep.handled') : '';
    const auto = h.by === 'autonomy' ? m('rep.auto.rules') : h.by === 'safe' ? m('rep.auto.safe') : '';
    if (h.kind === 'power_drop' && h.variant === 'bus') {
      const tripped = shed('bus-trip');
      out.push(chainOf({
        key: 'power_drop', causeIds: [...h.causeIds, ...tripped],
        what: m('rep.bus.what', { when, tripped: tripped.length ? m('rep.bus.tripped', { names: names(tripped) }) : '', handled, auto }),
        why: m('rep.bus.why', { loads: ast ? m('rep.loads.ast') : m('rep.loads.rotors'), peak: h.numbers.peak ?? '?', buses: build.power_bus ?? 0, limit: stats.busLimit, acc: acc('bus-overload') }),
        couldDo: m('rep.bus.could', { pdu: !has('pdu') && tripped.includes('rotor_system') ? m('rep.bus.pdu') : '' }),
        impact: crisisImpact(h) + tripped.length * 4 + (tripped.includes('rotor_system') ? 8 : 0),
      }));
    }
    if (h.kind === 'power_drop' && h.variant === 'battery') {
      const emptied = shed('battery-empty');
      const top = stats.consumptionByLoad.filter((l) => l.id !== 'frame').slice(0, 3);
      out.push(chainOf({
        key: 'power_drop', causeIds: [...h.causeIds, ...emptied],
        what: m('rep.bat.what', { when, emptied: emptied.length ? m('rep.bat.emptied', { names: names(emptied) }) : '', handled, auto }),
        why: m('rep.bat.why', { src: ast ? sources : `${rtg} RTG`, cons: stats.consumption, gen: stats.generation, acc: acc('deficit') }),
        couldDo: m('rep.bat.could', { more: moreGen, top: top.map((l) => `${l.name} ${l.watts} W`).join(', '), pdu: !has('pdu') && emptied.includes('rotor_system') ? m('rep.bat.pdu') : '' }),
        impact: crisisImpact(h) + emptied.length * 4 + (emptied.includes('rotor_system') ? 8 : 0),
      }));
    }
    if (h.kind === 'overheat') {
      out.push(chainOf({
        key: 'overheat', causeIds: h.causeIds,
        what: m('rep.heat.what', {
          when, body: h.variant === 'warm' ? m('rep.heat.warm') : m('rep.heat.hot'),
          dmg: h.resolved ? '' : m('rep.dash', { e: h.effects.find((e) => e.startsWith('Перегрев'))?.replace(/\.$/, '') ?? m('rep.heat.hull') }),
          handled, auto,
        }),
        why: m('rep.heat.why', {
          src: rtg ? m('rep.heat.src.rtg', { n: rtg }) : m('rep.heat.src.other'),
          sun: ast ? m('rep.heat.sun') : '', ins: has('thermal_insulation') ? m('rep.heat.ins') : '',
          rad: has('thermal_radiator') ? m('rep.heat.rad.few') : m('rep.heat.rad.none'),
          acc1: acc('overheat'), acc2: acc('hot'),
        }),
        couldDo: m('rep.heat.could', { rtg: rtg ? m('rep.heat.could.rtg') : '' }),
        impact: crisisImpact(h),
      }));
    }
    if (h.kind === 'freeze') {
      const dmg = h.effects.find((e) => e.includes('отказал'));
      out.push(chainOf({
        key: 'freeze', causeIds: h.causeIds,
        what: m('rep.cold.what', { when, dmg: dmg ? m('rep.dash', { e: dmg.replace(/^Холод остался — /, '').replace(/\.$/, '') }) : m('rep.cold.data'), handled, auto }),
        why: m('rep.cold.why', {
          env: ast ? m('rep.cold.env.ast') : m('rep.cold.env.titan'), loss: MISSIONS[f.mission].envHeatLoss,
          ins: has('thermal_insulation') ? '' : m('rep.cold.noIns'), rad: has('thermal_radiator') ? m('rep.cold.rad') : '',
          acc1: acc('freeze'), acc2: acc('cold'),
        }),
        couldDo: has('thermal_radiator') ? m('rep.cold.could.rad') : m('rep.cold.could'),
        impact: crisisImpact(h) + (dmg ? 4 : 0),
      }));
    }
    if (h.kind === 'signal_distortion') {
      const esc = f.blackouts.find((b) => b.reason === 'escalation');
      out.push(chainOf({
        key: 'signal_distortion', causeIds: h.causeIds,
        what: m('rep.sig.what', {
          state: esc ? m('rep.sig.gone', { n: Math.max(0, esc.to - esc.from) }) : m('rep.sig.noise'),
          lost: f.lostNoise > 0.5 ? m('rep.sig.lost', { n: Math.round(f.lostNoise) }) : '', handled, auto,
        }),
        why: has('signal_amp') ? m('rep.sig.why.amp') : m('rep.sig.why.noAmp'),
        couldDo: m('rep.sig.could', { hg: has('antenna_high_gain') ? '' : m('rep.sig.could.hg') }),
        impact: crisisImpact(h) + Math.min(6, f.lostNoise / 5),
      }));
    }
  }

  // Battery emptied without a Power Drop chain (crisis budget used up).
  if (!f.history.some((h) => h.kind === 'power_drop' && h.variant === 'battery')) {
    const emptied = shed('battery-empty');
    if (emptied.length) out.push(chainOf({
      key: 'battery-empty', causeIds: ['deficit', ...emptied],
      what: m('rep.empty.what', { names: names(emptied) }),
      why: m('rep.empty.why', { cons: stats.consumption, gen: stats.generation, acc: acc('deficit') }),
      couldDo: m('rep.empty.could', { more: moreGen }),
      impact: 6 + emptied.length * 4,
    }));
  }
  if (!f.history.some((h) => h.kind === 'power_drop' && h.variant === 'bus')) {
    const tripped = shed('bus-trip');
    if (tripped.length) out.push(chainOf({
      key: 'bus-trip', causeIds: ['power_bus', 'bus-overload', ...tripped],
      what: m('rep.trip.what', { names: names(tripped) }),
      why: m('rep.trip.why', { buses: build.power_bus ?? 0, limit: stats.busLimit, acc: acc('bus-overload') }),
      couldDo: m('rep.trip.could'),
      impact: 6 + tripped.length * 4,
    }));
  }

  // Overweight (ТЗ test C: the report links the overload to its consequences).
  const ow = f.causes.find((c) => c.ref === 'overweight');
  if (ow) {
    const over = stats.mass - stats.massLimit;
    const heavy = ow.causeIds.slice(1);
    out.push(chainOf({
      key: 'overweight', causeIds: ow.causeIds,
      what: m(ast ? 'rep.ow.what.ast' : 'rep.ow.what', { over }),
      why: m('rep.ow.why', { mass: stats.mass, limit: stats.massLimit, acc: acc('mass') }),
      couldDo: m('rep.ow.could', { heavy: heavy.length ? m('rep.ow.heavy', { names: names(heavy) }) : '' }),
      impact: ast ? 4 + f.asteroid!.fuelShort / 5 : 4 + (100 - f.hull) / 4,
    }));
  }

  if (f.asteroid) out.push(...asteroidChains(f, build, accepted));

  // Targets without instruments.
  const impossible = f.targets.filter((t) => !t.need.some(has));
  if (impossible.length) out.push(chainOf({
    key: 'no-instrument', causeIds: impossible.flatMap((t) => t.need),
    what: m('rep.noins.what', { list: quoted(impossible.map((t) => t.name)), tail: impossible.length > 1 ? m('rep.noins.many') : m('rep.noins.one') }),
    why: m('rep.noins.why', { list: impossible.map((t) => names(t.need)).join('; ') }),
    couldDo: m('rep.noins.could', { list: impossible.map((t) => nameOf(t.need[0])).join(', ') }),
    impact: impossible.length * 8,
  }));

  // Data that never reached Earth.
  const left = f.targets.reduce((s, t) => s + t.stored, 0);
  const collected = f.targets.reduce((s, t) => s + t.collected, 0);
  if (collected > 0 && left > collected * 0.1) {
    const ants = ANTENNAS.filter(has);
    out.push(chainOf({
      key: 'data-left', causeIds: [...ants, 'transceiver', 'antenna_high_gain'],
      what: m('rep.left.what', { n: Math.round(left) }),
      why: m('rep.left.why', { bw: r1(stats.bandwidth * TICK_HOURS), ants: names(ants) || m('rep.left.noAnt') }),
      couldDo: m('rep.left.could'),
      impact: 15 * (left / collected),
    }));
  }

  if (f.lostMemory > 1) out.push(chainOf({
    key: 'memory-full', causeIds: ['data_storage', 'data_buffer'],
    what: m('rep.mem.what', { n: Math.round(f.lostMemory) }),
    why: m('rep.mem.why', { cap: f.memoryCap }),
    couldDo: m('rep.mem.could'),
    impact: Math.min(10, (f.lostMemory / Math.max(1, collected + f.lostMemory)) * 20),
  }));

  const short = f.causes.find((c) => c.ref === 'route-short');
  if (short) {
    const missed = f.waypoints.filter((w) => !w.reached).map((w) => w.name);
    const why: Msg[] = [];
    if (short.causeIds.includes('rotor_system')) {
      const off = f.causes.find((c) => c.kind === 'shed' && (c.causeIds[0] === 'rotor_system' || c.causeIds[2] === 'rotor_system'));
      why.push(m(!has('rotor_system') ? 'rep.route.noRotor' : off?.ref === 'battery-empty' ? 'rep.route.rotorBattery' : off?.ref === 'bus-trip' ? 'rep.route.rotorBus' : 'rep.route.rotorOff'));
    }
    if (short.causeIds.includes('holds')) why.push(m('rep.route.holds', { n: f.stoppedTicks }));
    if (short.causeIds.includes('mass')) why.push(m('rep.route.mass'));
    if (short.causeIds.includes('slow')) why.push(m('rep.route.slow'));
    if (short.causeIds.includes('precise')) why.push(m('rep.route.precise'));
    out.push(chainOf({
      key: 'route-short', causeIds: short.causeIds,
      what: m('rep.route.what', { list: quoted(missed) }),
      why: why.length ? m('rep.dot', { s: join(why, '; ') }) : m('rep.route.why.time'),
      couldDo: m(short.causeIds.includes('rotor_system') ? 'rep.route.could.rotor' : 'rep.route.could'),
      impact: missed.length * 3 + 2,
    }));
  }

  const safe = f.blackouts.filter((b) => b.by === 'safe');
  if (safe.length) {
    const ticks = safe.reduce((s, b) => s + Math.max(0, (b.to === -1 ? f.tick : b.to) - b.from), 0);
    out.push(chainOf({
      key: 'blackout-safe', causeIds: ['safe-protocol', 'flight_computer'],
      what: m('rep.bsafe.what', { n: ticks }),
      why: m('rep.bsafe.why'),
      couldDo: m('rep.bsafe.could', { need: has('data_storage') || has('data_buffer') ? '' : m('rep.bsafe.need') }),
      impact: 2 + ticks / 10,
    }));
  }

  return out.sort((a, b) => b.impact - a.impact).map((c) => ({ ...c, causeIds: [...new Set(c.causeIds)], impact: r1(c.impact) }));
}

function roleContributions(room: RoomState, f: FlightState, decisions: Decision[]): MissionReport['roles'] {
  const roleOf = (pid?: string, role?: RoleId) => role ?? room.players.find((p) => p.id === pid)?.role ?? null;
  const out: MissionReport['roles'] = (['commander', 'engineer', 'science', 'comms'] as RoleId[]).map((role) => ({ role, did: [], i18n: { did: [] } }));
  const did = (role: RoleId, msg: Msg) => { const x = out.find((r) => r.role === role)!; x.did.push(ru(msg)); x.i18n!.did.push(msg); };

  // Build: modules installed per role.
  const added: Record<string, string[]> = {};
  for (const e of room.log) {
    if (e.kind !== 'build') continue;
    const mm = e.text.match(/\+1 (\S+)$/);
    const role = roleOf(e.by, e.role);
    if (mm && role) (added[role] ??= []).push(mm[1]);
  }
  for (const [role, ids] of Object.entries(added)) {
    const uniq = [...new Set(ids)].filter((id) => installed(room.build).some((x) => x.def.id === id));
    if (uniq.length) did(role as RoleId, m('rep.did.built', { list: uniq.slice(0, 5).map((id) => COMPONENT_BY_ID[id]?.name ?? id).join(', '), more: uniq.length > 5 ? m('rep.did.builtMore', { n: uniq.length - 5 }) : '' }));
  }

  for (const d of decisions) {
    if (d.kind === 'approve') did('commander', m('rep.did.approve'));
    if (d.kind === 'approve-against-warning') did('commander', m('rep.did.approveRisk', { n: d.issueIds.length }));
    if (d.kind === 'veto') did('commander', m('rep.did.veto', { text: d.text }));
    if (d.kind === 'request-approve') did('commander', m('rep.did.reqApprove', { text: d.text }));
    if (d.kind === 'request-veto') did('commander', m('rep.did.reqVeto', { text: d.text }));
    if (d.kind === 'key-denied') { const r = roleOf(d.by); if (r) did(r, m('rep.did.keyDenied', { text: d.text })); }
    for (const k of d.keys ?? []) { const r = room.players.find((p) => p.id === k); const own = rolesOf(r).find((x) => x !== 'commander'); if (own) did(own, m('rep.did.key')); }
  }
  // 0013 §2: requests to the commander, credited to the role the requester acted as.
  for (const q of room.requests ?? []) {
    if (q.status !== 'approved' && q.status !== 'vetoed') continue;
    const r = q.byRole ?? roleOf(q.by);
    if (r && r !== 'commander') did(r, m('rep.did.request', {
      act: q.kind === 'add' ? m('rep.did.req.add') : m('rep.did.req.remove'), name: COMPONENT_BY_ID[q.componentId]?.name ?? q.componentId,
      res: q.status === 'approved' ? m('rep.did.req.ok') : m('rep.did.req.veto', { note: q.note }),
    }));
  }

  for (const h of f.history) {
    for (const role of ['commander', 'engineer', 'science', 'comms'] as RoleId[]) {
      const label = h.i18n?.chosenLabels?.[role] ?? h.chosenLabels?.[role];
      if (label) did(role, m(h.resolved ? 'rep.did.crisis.ok' : 'rep.did.crisis', { title: h.title, label }));
    }
    if (h.by !== 'team') did('commander', m('rep.did.crisisAuto', { title: h.title, by: h.by === 'autonomy' ? m('rep.did.byRules') : 'Safe Protocol' }));
  }

  const precise = f.waypoints.filter((w) => w.mode === 'precise').map((w) => w.name);
  const fast = f.waypoints.filter((w) => w.mode === 'fast').map((w) => w.name);
  if (precise.length) did('science', m('rep.did.precise', { list: join(precise, ', ') }));
  if (fast.length) did('science', m('rep.did.fast', { list: join(fast, ', ') }));
  const delivered = f.targets.filter((t) => t.sent >= t.required);
  if (delivered.length) did('science', m('rep.did.delivered', { list: join(delivered.map((t) => t.name), ', ') }));
  const sent = f.targets.reduce((s, t) => s + t.sent, 0);
  const collected = f.targets.reduce((s, t) => s + t.collected, 0);
  if (collected > 0) did('comms', m('rep.did.sent', { sent: Math.round(sent), coll: Math.round(collected) }));
  if (f.asteroid) {
    const a = f.asteroid;
    if (a.site) did('science', m(a.siteBy === 'science' ? 'rep.did.siteSci' : 'rep.did.siteAuto', { site: SITE_BY_ID[a.site].name }));
    if (a.sample.collected) did('science', m('rep.did.sample', { mass: a.sample.mass, sealed: a.sample.sealed ? m('rep.did.sealed') : '' }));
    if (a.fuelMax) did('engineer', m('rep.did.fuel', { left: Math.round(a.fuel), max: a.fuelMax }));
    if (a.capsule === 'found') did('commander', m('rep.did.capsule'));
  }
  if (f.hull >= 90) did('engineer', m('rep.did.hull', { n: f.hull }));
  if (f.blackouts.some((b) => b.by === 'autonomy')) did('engineer', m('rep.did.autoRules'));
  return out;
}

function autonomySummary(room: RoomState, slots: number): MissionReport['autonomy'] {
  const f = room.flight!;
  const by = new Map<string, MissionReport['autonomy']['fired'][number]>();
  for (const r of f.rulesFired ?? []) {
    const cur = by.get(r.ruleId) ?? { ruleId: r.ruleId, text: r.text, times: 0, firstTick: r.tick, where: [], i18n: { where: [] } };
    cur.times++;
    const w = m(r.where === 'blackout' ? 'rep.where.blackout' : r.where === 'flight' ? 'rep.where.flight' : 'rep.where.crisis');
    if (!cur.where.includes(ru(w))) { cur.where.push(ru(w)); cur.i18n!.where.push(w); }
    by.set(r.ruleId, cur);
  }
  const safeProtocol = f.blackouts.filter((b) => b.by === 'safe').length + f.history.filter((h) => h.by === 'safe').length;
  return { configured: room.rules.length, slots, fired: [...by.values()], safeProtocol };
}

/** Asteroid cause chains: debris, jam, sample, sealing, capsule, fuel, site. Same tone as Titan. */
function asteroidChains(f: FlightState, build: Build, accepted: string[]): CauseChain[] {
  const a = f.asteroid!;
  const out: CauseChain[] = [];
  const has = (id: string) => (build[id] ?? 0) > 0;
  const hasCause = (ref: string) => f.causes.some((c) => c.ref === ref);
  const site = a.site ? SITE_BY_ID[a.site] : null;

  for (const h of f.history) {
    const team = h.by === 'team';
    const handled = team && h.resolved ? m('rep.handled') : '';
    const auto = h.by === 'autonomy' ? m('rep.auto.rules') : h.by === 'safe' ? m('rep.ast.auto.safe') : '';
    if (h.kind === 'debris_alert') {
      const hull = h.numbers.hullLoss ?? 0;
      const evaded = h.chosen.commander === 'da_evade' || h.effects.some((e) => e.includes('ушёл от обломков') || e.includes('увело'));
      const shieldHit = f.broken.includes('heat_shield');
      const late = h.variant === 'late';
      const shield = has('micrometeoroid_shield');
      out.push(chainOf({
        key: 'debris_alert', causeIds: [...h.causeIds, ...(shieldHit ? ['heat_shield'] : [])],
        what: m('rep.deb.what', {
          res: evaded ? m('rep.deb.evaded', { n: Math.round((h.numbers.fuelBefore ?? 0) - (h.numbers.fuelAfter ?? 0)) }) : m('rep.deb.hull', { n: hull }),
          shield: shieldHit ? m('rep.deb.shield') : '', arm: a.armDamaged ? m('rep.deb.arm') : '', handled, auto,
        }),
        why: join([m(shield ? 'rep.deb.why.shield' : 'rep.deb.why.noShield'), late && m('rep.deb.why.late')]),
        couldDo: join([!shield && m('rep.deb.could.shield'), late && m('rep.deb.could.late'), m('rep.deb.could.evade', { n: ASTEROID.debris.evadeFuel })], ' '),
        impact: (h.resolved ? 2 : 8) + hull / 3 + (shieldHit ? 6 : 0) + (a.armDamaged ? 3 : 0),
      }));
    }
    if (h.kind === 'arm_jam' && site) {
      const risk = Math.round(Math.max(0, Math.min(1, jamRisk(build, site.id, a.armDamaged))) * 100);
      const tool = h.nodeIds.includes('drill') && !h.nodeIds.includes('robotic_arm') ? m('rep.jam.drill') : m('rep.jam.arm');
      out.push(chainOf({
        key: 'arm_jam', causeIds: h.causeIds,
        what: m('rep.jam.what', { site: site.name, tool, eff: h.effects.length ? m('rep.sp', { s: h.effects[h.effects.length - 1] }) : '', handled, auto }),
        why: m('rep.jam.why', { site: site.name, risk, damp: has('vibration_dampers') ? '' : m('rep.jam.noDamp'), arm: a.armDamaged ? m('rep.jam.bent') : '' }),
        couldDo: join([!has('vibration_dampers') && m('rep.jam.could.damp'), site.id === 'boulder' && !has('drill') && m('rep.jam.could.drill'), m('rep.jam.could.soft')], ' '),
        impact: (h.resolved ? 2 : 6) + (a.sample.collected ? 0 : 6),
      }));
    }
  }

  if (!a.sample.collected) {
    const why: Msg[] = [];
    // The first reason starts the sentence: its key has a capitalised «.cap» variant.
    const reason = (k: string, p?: Record<string, number>) => why.push(m(why.length ? k : `${k}.cap`, p));
    if (a.approachFailed) {
      reason(f.causes.some((c) => c.ref === 'fuel-empty') ? 'rep.nos.fuel' : f.causes.some((c) => c.ref === 'approach-no-engine') ? 'rep.nos.noEngine' : 'rep.nos.late');
      if (!ASTEROID.approach.navIds.some(has)) reason('rep.nos.noNav');
    }
    if (f.history.some((h) => h.kind === 'arm_jam')) reason('rep.nos.jam');
    if (f.causes.some((c) => c.ref === 'tool-off')) reason('rep.nos.toolOff');
    if (f.stoppedTicks > 0) reason('rep.nos.stopped', { n: f.stoppedTicks });
    out.push(chainOf({
      key: 'no-sample', causeIds: ['robotic_arm', 'drill', ...(a.approachFailed ? ['approach-failed', 'propellant_tank'] : []), ...(a.site ? [`site:${a.site}`] : [])],
      what: m('rep.nos.what'),
      why: why.length ? m('rep.dot', { s: join(why, '; ') }) : m('rep.nos.why.time'),
      couldDo: m(a.approachFailed ? 'rep.nos.could.fuel' : 'rep.nos.could'),
      impact: 30,
    }));
  } else if (site && a.sample.mass < site.mass) {
    const jammed = f.history.some((h) => h.kind === 'arm_jam');
    out.push(chainOf({
      key: 'sample-small', causeIds: ['robotic_arm', `site:${site.id}`, ...(jammed ? ['arm_jam'] : [])],
      what: m('rep.small.what', { got: a.sample.mass, max: site.mass }),
      why: m(jammed ? 'rep.small.why.jam' : 'rep.small.why.time'),
      couldDo: m('rep.small.could'),
      impact: 3,
    }));
  }

  if (a.sample.collected && !a.sample.sealed) {
    const off = f.off.includes('sample_sealer');
    out.push(chainOf({
      key: 'not-sealed', causeIds: ['sample_sealer', ...(off ? ['deficit'] : [])],
      what: m('rep.seal.what'),
      why: m(!has('sample_sealer') ? 'rep.seal.why.none' : off ? 'rep.seal.why.off' : 'rep.seal.why.time'),
      couldDo: m(!has('sample_sealer') ? 'rep.seal.could.none' : 'rep.seal.could'),
      impact: 7,
    }));
  }
  if (a.heated) {
    out.push(chainOf({
      key: 'heat-shield', causeIds: ['heat_shield', 'micrometeoroid_shield', 'debris'],
      what: m('rep.hs.what'), why: m('rep.hs.why'), couldDo: m('rep.hs.could'),
      impact: 8,
    }));
  }
  if (a.capsule === 'lost') {
    out.push(chainOf({
      key: 'capsule-lost', causeIds: ['recovery_beacon', ...(a.offTarget ? ['fuel-short', 'propellant_tank'] : [])],
      what: m('rep.cap.what', { lost: a.sample.collected ? m('rep.cap.lost') : '' }),
      why: m('rep.cap.why', { where: m(a.offTarget ? 'rep.cap.off' : 'rep.cap.aside'), beacon: m(has('recovery_beacon') ? 'rep.cap.beaconOff' : 'rep.cap.noBeacon') }),
      couldDo: join([!has('recovery_beacon') && m('rep.cap.could.beacon'), a.offTarget && m('rep.cap.could.fuel')], ' '),
      impact: a.sample.collected ? 25 : 8,
    }));
  }
  const fuelEvents = f.causes.filter((c) => c.ref === 'fuel-short' || c.ref === 'fuel-empty');
  if (fuelEvents.length || a.fuelShort > 0.5) {
    const u = a.fuelUsed;
    const parts = [m('rep.fuel.cruise', { n: Math.round(u.cruise) }), m('rep.fuel.approach', { n: Math.round(u.approach) }), ...(u.evade ? [m('rep.fuel.evade', { n: Math.round(u.evade) })] : []), m('rep.fuel.station', { n: Math.round(u.station) }), m('rep.fuel.return', { n: Math.round(u.return) })];
    const ionLost = hasCause('ion-lost');
    out.push(chainOf({
      key: 'fuel', causeIds: ['propellant_tank', 'fuel', ...(has('ion_engine') ? ['ion_engine'] : []), ...(ionLost ? ['deficit'] : []), ...(f.causes.some((c) => c.ref === 'overweight') ? ['mass'] : [])],
      what: m('rep.fuel.what', { phase: m(a.approachFailed ? 'rep.fuel.onApproach' : 'rep.fuel.onReturn'), n: Math.round(a.fuelShort), off: a.offTarget ? m('rep.fuel.offTarget') : '' }),
      why: m('rep.fuel.why', { tanks: build.propellant_tank ?? 0, max: a.fuelMax, parts: join(parts, ', '), ion: !has('ion_engine') ? m('rep.fuel.chem') : ionLost ? m('rep.fuel.ionLost') : '', acc: accept(accepted, 'mass') }),
      couldDo: m('rep.fuel.could', { n: ASTEROID.fuelPerTank, ion: has('ion_engine') ? '' : m('rep.fuel.could.ion') }),
      impact: 6 + a.fuelShort / 4,
    }));
  } else if (hasCause('ion-lost')) {
    out.push(chainOf({
      key: 'ion-lost', causeIds: ['ion_engine', 'deficit'],
      what: m('rep.ion.what'), why: m('rep.ion.why'), couldDo: m('rep.ion.could'),
      impact: 3,
    }));
  }
  if (a.siteBy === 'auto') {
    out.push(chainOf({
      key: 'site-auto', causeIds: ['site'],
      what: m('rep.site.what'), why: m('rep.site.why'), couldDo: m('rep.site.could'),
      impact: 2,
    }));
  }
  const comp = f.targets.find((t) => t.id === COMPOSITION_TARGET);
  const offIns = comp ? comp.need.filter((id) => has(id) && (f.off.includes(id) || f.broken.includes(id))) : [];
  if (comp && comp.need.some(has) && comp.sent < comp.required) {
    const offBy = offIns.length ? f.history.find((h) => h.effects.some((e) => offIns.some((id) => e.includes(nameOf(id))))) : undefined;
    out.push(chainOf({
      key: 'composition', causeIds: [...comp.need.filter(has), ...ANTENNAS.filter(has), 'transceiver', ...(offIns.length ? ['deficit'] : [])],
      what: m('rep.comp.what', { sent: Math.round(comp.sent), req: comp.required }),
      why: offIns.length
        ? m('rep.comp.why.off', {
          names: names(offIns), verb: m(offIns.length > 1 ? 'rep.comp.offMany' : 'rep.comp.offOne'),
          during: offBy ? m('rep.comp.during', { title: offBy.title, by: offBy.by === 'team' ? m('rep.comp.byTeam') : offBy.by === 'autonomy' ? m('rep.comp.byRule') : 'Safe Protocol' }) : '',
        })
        : comp.collected < comp.required ? m('rep.comp.why.few') : m('rep.comp.why.left', { n: Math.round(comp.stored) }),
      couldDo: m(offIns.length ? 'rep.comp.could.off' : comp.collected < comp.required ? 'rep.comp.could.few' : 'rep.comp.could.left'),
      impact: offIns.length ? 12 : 6,
    }));
  }
  return out;
}

const accept = (accepted: string[], id: string): Msg | '' => (accepted.includes(id) ? m('rep.accept') : '');
