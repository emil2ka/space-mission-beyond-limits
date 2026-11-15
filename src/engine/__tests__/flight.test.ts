// M1: Titan flight from build to report. TZ acceptance A and C through the full cycle,
// determinism, crisis triggers (cause ↔ no cause), autonomy on deadline, role panels, report.
import { describe, expect, it } from 'vitest';
import { createRoom, reduce, type Action, type RoomState } from '../room';
import { readiness } from '../readiness';
import { computeStats } from '../stats';
import { MISSIONS } from '../data/missions';
import { stormPlan, type CrisisKind, type FlightState } from '../flight';
import { panelFor } from '../panels';
import type { AutonomyRule } from '../autonomy';
import type { Build, RoleId } from '../types';

const titan = MISSIONS.titan;
const H = 'h';

const apply = (s: RoomState, a: Action): RoomState => {
  const r = reduce(s, a);
  if (r.error) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
};
const as = (s: RoomState, role: RoleId) => (s.players[0].role === role ? s : apply(s, { type: 'pickRole', playerId: H, role }));

/** Demo room (one player switching roles) in the build stage. */
function roomInBuild(seed = 7): RoomState {
  let s = createRoom('ABCDEF', { id: H, name: 'Host' }, seed, true);
  s = apply(s, { type: 'pickRole', playerId: H, role: 'commander' });
  s = apply(s, { type: 'setReady', playerId: H, ready: true });
  s = apply(s, { type: 'goStage', playerId: H, stage: 'briefing' });
  return apply(s, { type: 'goStage', playerId: H, stage: 'build' });
}

/** Install a build through the reducer (so canAdd rules apply). */
function install(s: RoomState, build: Build): RoomState {
  for (const [id, n] of Object.entries(build)) for (let i = 0; i < n; i++) s = apply(s, { type: 'addComponent', playerId: H, id });
  return s;
}

function launch(s: RoomState): RoomState {
  s = apply(s, { type: 'submitReview', playerId: H });
  s = apply(as(s, 'commander'), { type: 'approve', playerId: H });
  return apply(s, { type: 'launchDone', playerId: H });
}

type Policy = (s: RoomState) => Action[];
function fly(s: RoomState, policy?: Policy, onTick?: (f: FlightState) => void): RoomState {
  let guard = 0;
  while (s.stage === 'flight' && guard++ < 2000) {
    if (policy) for (const a of policy(s)) { const r = reduce(s, a); if (!r.error) s = r.state; }
    if (s.stage !== 'flight') break;
    s = apply(s, { type: 'tick', playerId: H });
    if (s.flight) onTick?.(s.flight);
  }
  return s;
}

function runBuild(build: Build, opts: { seed?: number; rules?: AutonomyRule[]; policy?: Policy; onTick?: (f: FlightState) => void } = {}) {
  let s = install(roomInBuild(opts.seed ?? 7), build);
  if (opts.rules) s = apply(s, { type: 'setRules', playerId: H, rules: opts.rules });
  s = launch(s);
  return fly(s, opts.policy, opts.onTick);
}

const kinds = (s: RoomState) => s.flight!.history.map((h) => h.kind);

/** A careful team: precise mode everywhere, sensible crisis answers. */
const goodTeam: Policy = (s) => {
  const f = s.flight!;
  const out: Action[] = [];
  const wp = f.waypoints[f.waypointIndex];
  if (wp && wp.mode === null) out.push({ type: 'pickRole', playerId: H, role: 'science' }, { type: 'scienceMode', playerId: H, waypoint: wp.id, mode: 'precise' });
  const c = f.crisis;
  if (c) {
    const prefer = ['sd_point', 'sd_retune', 'pd_shed_hungry', 'pd_isolate', 'oh_land_cool', 'fr_heater_max', 'fr_route_heat', 'fr_sleep', 'sd_continue'];
    for (const role of ['comms', 'engineer', 'science'] as RoleId[]) {
      if (c.chosen[role]) continue;
      const o = c.options.filter((x) => x.role === role).sort((a, b) => (prefer.indexOf(a.id) + 99) % 99 - (prefer.indexOf(b.id) + 99) % 99)[0];
      if (o && prefer.includes(o.id)) out.push({ type: 'pickRole', playerId: H, role }, { type: 'crisisChoice', playerId: H, optionId: o.id });
    }
  }
  return out;
};

// Reference builds (all within budget, slots and instance limits).
const GOOD: Build = {
  rtg: 2, battery_hc: 1, power_bus: 2, pdu: 1, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1,
  thermal_radiator: 1, thermal_insulation: 1, atmo_sensor: 1, wide_camera: 1, temp_sensor: 1, spectrometer: 1, data_storage: 1, landing_system: 1,
};
const TYPICAL: Build = {
  rtg: 2, battery_hc: 1, power_bus: 2, pdu: 1, rotor_system: 1, flight_computer: 1, imu: 1, atmo_sensor: 1, wide_camera: 1,
  transceiver: 1, antenna_high_gain: 1, thermal_insulation: 1, data_storage: 1,
};
/** TYPICAL with a cheap Standard Antenna instead of High-Gain (leaves budget for heavy parts). */
const LIGHT: Build = { ...TYPICAL, antenna_high_gain: 0, antenna_standard: 1 };
const BAD: Build = {
  rtg: 1, battery_hc: 1, power_bus: 1, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1, spectrometer: 1, hires_camera: 1, atmo_sensor: 1,
};

describe('readiness', () => {
  it('missing required systems block; accepted risks are warnings', () => {
    expect(readiness({}, titan).ok).toBe(false);
    expect(readiness({}, titan).blockers.some((b) => b.id.startsWith('req:rotor_system'))).toBe(true);
    const r = readiness(BAD, titan);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.id)).toEqual(expect.arrayContaining(['deficit', 'bus-overload']));
  });
  it('a little over the mass limit is a warning, far over is a blocker', () => {
    const near = { ...GOOD, reinforced_frame: 1, radiation_shield: 1, battery_hc: 2 };
    const st = computeStats(near, titan);
    expect(st.mass).toBeGreaterThan(titan.massLimit);
    expect(readiness(near, titan).warnings.some((w) => w.id === 'mass')).toBe(true);
    expect(readiness({ ...near, propellant_tank: 3 }, titan).blockers.some((b) => b.id === 'mass')).toBe(true);
  });
});

describe('room stages', () => {
  it('build → review → (veto) → build → review → approve → launch → flight → report', () => {
    let s = install(roomInBuild(), GOOD);
    s = apply(s, { type: 'submitReview', playerId: H });
    expect(s.stage).toBe('review');
    expect(reduce(s, { type: 'addComponent', playerId: H, id: 'imu' }).error).toMatch(/заблокирована/);
    s = apply(s, { type: 'veto', playerId: H, text: 'Проверить тепло' });
    expect(s.stage).toBe('build');
    expect(s.decisionLog.map((d) => d.kind)).toEqual(['veto']);
    s = apply(s, { type: 'submitReview', playerId: H });
    s = apply(s, { type: 'approve', playerId: H });
    expect(s.stage).toBe('launch');
    expect(s.decisionLog.map((d) => d.kind)).toEqual(['veto', 'approve']);
    expect(reduce(s, { type: 'tick', playerId: H }).error).toBeTruthy();
    s = apply(s, { type: 'launchDone', playerId: H });
    expect(s.stage).toBe('flight');
    expect(s.flight?.waypoints.map((w) => w.id)).toEqual(['dunes', 'lake', 'crater']);
    s = fly(s);
    expect(s.stage).toBe('report');
    expect(s.report).not.toBeNull();
  });
  it('approve in review is refused while blockers exist; only the commander approves; only the host ends the launch', () => {
    let s = install(roomInBuild(), { rtg: 1, power_bus: 1 });
    s = apply(s, { type: 'submitReview', playerId: H });
    expect(reduce(s, { type: 'approve', playerId: H }).error).toMatch(/Запуск невозможен/);
    s = apply(s, { type: 'pickRole', playerId: H, role: 'engineer' });
    expect(reduce(s, { type: 'approve', playerId: H }).error).toMatch(/командир/);
    let g = launch(install(roomInBuild(), GOOD));
    expect(g.stage).toBe('flight');
    g = apply(createRoom('ABCDEF', { id: H, name: 'Host' }, 1, true), { type: 'join', playerId: 'b', name: 'B' });
    expect(reduce({ ...g, stage: 'launch' }, { type: 'launchDone', playerId: 'b' }).error).toMatch(/хост/);
  });
});

describe('TZ test A — Titan energy, full cycle', () => {
  it('solar is useless, RTGs add generation, batteries only capacity; the deficit shows its sources and the report explains the drain', () => {
    let s = roomInBuild();
    s = install(s, { solar_array: 1 });
    const solar = computeStats(s.build, titan);
    expect(solar.generation).toBeLessThan(1);
    expect(solar.issues.some((i) => i.id === 'solar-weak')).toBe(true);
    s = install(s, { rtg: 1 });
    const one = computeStats(s.build, titan);
    s = install(s, { rtg: 1 });
    const two = computeStats(s.build, titan);
    expect(two.generation).toBeGreaterThan(one.generation);
    expect(two.mass).toBeGreaterThan(one.mass);
    expect(two.heatBalance).toBeGreaterThan(one.heatBalance);
    s = install(s, { battery_hc: 2 });
    const bat = computeStats(s.build, titan);
    expect(bat.capacityWh).toBe(two.capacityWh + 600);
    expect(bat.generation).toBe(two.generation);
    // The panel is useless — the engineer takes it out and needs a second bus for the instruments.
    s = apply(s, { type: 'removeComponent', playerId: H, id: 'solar_array' });
    s = install(s, {
      power_bus: 2, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1, heater: 1,
      spectrometer: 1, drill: 1, wide_camera: 1, atmo_sensor: 1,
    });
    const st = computeStats(s.build, titan);
    expect(st.consumption).toBeGreaterThan(bat.consumption);
    const deficit = st.issues.find((i) => i.id === 'deficit')!;
    expect(deficit.text).toMatch(/Дефицит энергии \d+ W/);
    expect(deficit.text).toContain('Rotor System 70 W');
    expect(deficit.text).toContain('RTG');

    s = fly(launch(s));
    const rep = s.report!;
    const energy = rep.chains.find((c) => c.key === 'power_drop' || c.key === 'battery-empty');
    expect(energy).toBeTruthy();
    expect(energy!.why).toMatch(/\d+ W против \d+ W|больше генерации/);
    expect(energy!.why).toMatch(/Батареи/);
    expect(energy!.couldDo).toMatch(/RTG/);
    expect(rep.chains.slice(0, 3)).toContainEqual(energy);
  });
});

describe('TZ test C — mass consequence chain, full cycle', () => {
  const base: Build = { ...LIGHT, propellant_tank: 1, radiation_shield: 1, landing_system: 1 };
  const heavy: Build = { ...base, reinforced_frame: 1 };
  it('over the limit → warning → commander approves with a record → the report links the overload to its consequences', () => {
    let s = install(roomInBuild(), base);
    const before = computeStats(s.build, titan);
    expect(before.mass).toBeLessThanOrEqual(titan.massLimit);
    s = install(s, { reinforced_frame: 1 });
    const after = computeStats(s.build, titan);
    expect(after.mass).toBe(before.mass + 30);
    expect(after.cost).toBe(before.cost + 20);
    expect(after.mass).toBeGreaterThan(titan.massLimit);
    s = apply(s, { type: 'submitReview', playerId: H });
    const r = readiness(s.build, titan);
    expect(r.ok).toBe(true);
    expect(r.warnings.find((w) => w.id === 'mass')?.text).toMatch(/Превышен лимит массы/);
    s = apply(s, { type: 'approve', playerId: H });
    const d = s.decisionLog.at(-1)!;
    expect(d.kind).toBe('approve-against-warning');
    expect(d.issueIds).toContain('mass');
    s = fly(apply(s, { type: 'launchDone', playerId: H }));
    const rep = s.report!;
    const chain = rep.chains.find((c) => c.key === 'overweight')!;
    expect(chain.causeIds).toContain('mass');
    expect(chain.what).toMatch(/тяжелее лимита на \d+ кг/);
    expect(chain.why).toMatch(/риск приняли/);
    expect(s.flight!.hull).toBeLessThan(100);
    expect(rep.trust.some((t) => t.issueId === 'mass')).toBe(true);
    expect(rep.teamTrust).toBeLessThan(100);
    expect(s.teamTrust).toBe(rep.teamTrust);
    expect(rep.decisions).toContainEqual(d);
  });
  it('veto instead: back to build, fix it, approve clean — no overload chain, no trust loss', () => {
    let s = install(roomInBuild(), heavy);
    s = apply(s, { type: 'submitReview', playerId: H });
    s = apply(s, { type: 'veto', playerId: H, text: 'Перегруз, уберите раму' });
    expect(s.stage).toBe('build');
    s = apply(s, { type: 'removeComponent', playerId: H, id: 'reinforced_frame' });
    s = fly(launch(s));
    expect(s.report!.chains.some((c) => c.key === 'overweight')).toBe(false);
    const [veto, ok] = s.report!.decisions;
    expect(veto.kind).toBe('veto');
    expect(ok.issueIds).not.toContain('mass');
    expect(s.report!.trust.some((t) => t.issueId === 'mass')).toBe(false);
  });
});

describe('determinism', () => {
  it('same seed → same flight and report; the seed only moves the storm', () => {
    const a = runBuild(TYPICAL, { seed: 123, policy: goodTeam });
    const b = runBuild(TYPICAL, { seed: 123, policy: goodTeam });
    expect(a.flight).toEqual(b.flight);
    expect(a.report).toEqual(b.report);
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((seed) => stormPlan(seed, TYPICAL).at));
    expect(seeds.size).toBeGreaterThan(1);
  });
});

describe('flight shape', () => {
  it.each([['good', GOOD], ['typical', TYPICAL], ['bad', BAD]])('%s build flies 8–12 minutes with ≤ 3 crises, one at a time', (_, build) => {
    let maxActive = 0;
    const s = runBuild(build, { onTick: (f) => { maxActive = Math.max(maxActive, f.crisis ? 1 : 0); } });
    const f = s.flight!;
    expect(f.tick).toBeGreaterThanOrEqual(480);
    expect(f.tick).toBeLessThanOrEqual(720);
    expect(f.history.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < f.history.length; i++) expect(f.history[i].startedTick).toBeGreaterThan(f.history[i - 1].endedTick);
    for (const h of f.history) {
      expect(h.causeIds.length).toBeGreaterThan(0);
      expect(h.endedTick - h.startedTick).toBeLessThanOrEqual(30);
      expect(f.causes.some((c) => c.ref === `crisis:${h.kind}` && c.causeIds.length > 0)).toBe(true);
    }
    expect(maxActive).toBeLessThanOrEqual(1);
  });
  it('a typical build sees 2–3 crises, a bad one 3', () => {
    expect(runBuild(TYPICAL).flight!.history.length).toBeGreaterThanOrEqual(2);
    expect(runBuild(BAD).flight!.history.length).toBe(3);
  });
  it('waypoints are visited in order with progress 0..1; precise mode gives surface chemistry, fast does not', () => {
    let lastIdx = 0;
    const precise = runBuild(GOOD, {
      policy: goodTeam,
      onTick: (f) => { expect(f.waypointProgress).toBeGreaterThanOrEqual(0); expect(f.waypointProgress).toBeLessThanOrEqual(1); expect(f.waypointIndex).toBeGreaterThanOrEqual(lastIdx); lastIdx = f.waypointIndex; },
    });
    expect(precise.flight!.waypoints.every((w) => w.reached)).toBe(true);
    expect(precise.flight!.targets.find((t) => t.id === 'surface_chem')!.collected).toBeGreaterThan(50);
    const fast = runBuild(GOOD, { policy: (s) => { const wp = s.flight!.waypoints[s.flight!.waypointIndex]; return wp && !wp.mode ? [{ type: 'pickRole', playerId: H, role: 'science' }, { type: 'scienceMode', playerId: H, waypoint: wp.id, mode: 'fast' }] : []; } });
    expect(fast.flight!.targets.find((t) => t.id === 'surface_chem')!.collected).toBe(0);
    expect(fast.flight!.tick).toBeLessThan(precise.flight!.tick);
  });
  it('only the science officer picks the mode, and not for a passed waypoint', () => {
    let s = launch(install(roomInBuild(), GOOD));
    expect(reduce(s, { type: 'scienceMode', playerId: H, waypoint: 'dunes', mode: 'precise' }).error).toMatch(/научный/);
    s = apply(s, { type: 'pickRole', playerId: H, role: 'science' });
    s = apply(s, { type: 'scienceMode', playerId: H, waypoint: 'crater', mode: 'precise' });
    expect(s.flight!.waypoints[2].mode).toBe('precise');
  });
});

describe('crises come from the build (decision 0006)', () => {
  const pd = (s: RoomState) => s.flight!.history.find((h) => h.kind === 'power_drop');
  it('Power Drop (bus): one overloaded Power Bus triggers it, a second bus does not', () => {
    const over: Build = { ...TYPICAL, power_bus: 1, battery_hc: 2 };
    expect(computeStats(over, titan).consumption).toBeGreaterThan(150);
    const a = runBuild(over);
    expect(pd(a)?.variant).toBe('bus');
    expect(pd(a)?.causeIds).toContain('bus-overload');
    expect(pd(runBuild(TYPICAL))).toBeUndefined();
  });
  it('Power Drop (battery): a deficit drains the battery below 20 %, enough RTG does not', () => {
    const hungry: Build = { rtg: 1, battery_hc: 2, power_bus: 2, pdu: 1, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1, thermal_insulation: 1, atmo_sensor: 1, wide_camera: 1 };
    const a = runBuild(hungry);
    expect(pd(a)?.variant).toBe('battery');
    expect(pd(a)?.causeIds).toContain('deficit');
    expect(pd(runBuild({ ...hungry, rtg: 2, battery_hc: 1 }))).toBeUndefined();
  });
  it('Signal Distortion: always without Signal Amplifier, rarely with it', () => {
    for (const seed of [1, 2, 3, 4, 5]) expect(kinds(runBuild(TYPICAL, { seed }))).toContain('signal_distortion');
    const withAmp = { ...TYPICAL, signal_amp: 1 };
    const hits = Array.from({ length: 40 }, (_, i) => stormPlan(i + 1, withAmp).hits).filter(Boolean).length;
    expect(hits).toBeLessThanOrEqual(14);
    const quiet = Array.from({ length: 40 }, (_, i) => i + 1).find((seed) => !stormPlan(seed, withAmp).hits)!;
    expect(kinds(runBuild(withAmp, { seed: quiet }))).not.toContain('signal_distortion');
  });
  it('Freeze: radiators on Titan without enough heat freeze the craft; without them it stays warm', () => {
    const cold: Build = { ...TYPICAL, thermal_insulation: 0, thermal_radiator: 2 };
    delete cold.thermal_insulation;
    expect(kinds(runBuild(cold))).toContain('freeze');
    expect(kinds(runBuild(TYPICAL))).not.toContain('freeze');
  });
  it('Overheat: three RTG under insulation overheat; with radiators they do not', () => {
    const hot: Build = { ...LIGHT, rtg: 3, battery_hc: 0 };
    const a = runBuild(hot);
    expect(a.flight!.history.find((h) => h.kind === 'overheat')?.variant).toBe('critical');
    const cool = { ...hot, pdu: 0, data_storage: 0, imu: 0, thermal_radiator: 2 };
    expect(computeStats(cool, titan).thermalState).not.toBe('overheat');
    expect(kinds(runBuild(cool))).not.toContain('overheat');
  });
  it('two RTG under insulation without a radiator: heat piles up → Overheat in the survey (Consequences example 1)', () => {
    const h = runBuild(TYPICAL).flight!.history.find((x) => x.kind === 'overheat');
    expect(h?.variant).toBe('warm');
    expect(kinds(runBuild({ ...TYPICAL, thermal_radiator: 1 }))).not.toContain('overheat');
  });
});

describe('crisis decisions', () => {
  const over: Build = { ...TYPICAL, power_bus: 1, battery_hc: 2 };
  function untilCrisis(build: Build, kind: CrisisKind, rules?: AutonomyRule[], seed = 7) {
    let s = install(roomInBuild(seed), build);
    if (rules) s = apply(s, { type: 'setRules', playerId: H, rules });
    s = launch(s);
    while (s.stage === 'flight' && s.flight!.crisis?.kind !== kind) s = apply(s, { type: 'tick', playerId: H });
    return s;
  }
  it('per-role options; a role cannot pick another role\'s option; choices apply and fix the root cause', () => {
    let s = untilCrisis(over, 'power_drop');
    const c = s.flight!.crisis!;
    expect(c.deadlineTick - c.startedTick).toBeGreaterThanOrEqual(15);
    expect(c.deadlineTick - c.startedTick).toBeLessThanOrEqual(30);
    expect(c.nodeIds).toContain('power_bus');
    expect(new Set(c.options.map((o) => o.role))).toEqual(new Set(['commander', 'engineer', 'science', 'comms']));
    const sci = c.options.find((o) => o.id === 'pd_shed_hungry')!;
    expect(sci.hint).toMatch(/В одиночку мало/); // instruments alone can't unload this bus — teamwork
    expect(reduce(as(s, 'engineer'), { type: 'crisisChoice', playerId: H, optionId: sci.id }).error).toMatch(/другой роли/);
    s = apply(as(s, 'science'), { type: 'crisisChoice', playerId: H, optionId: sci.id });
    s = apply(as(s, 'comms'), { type: 'crisisChoice', playerId: H, optionId: 'pd_eco_link' });
    while (s.flight!.crisis) s = apply(s, { type: 'tick', playerId: H });
    const h = s.flight!.history.at(-1)!;
    expect(h.by).toBe('team');
    expect(h.resolved).toBe(true);
    expect(s.flight!.off).toEqual(expect.arrayContaining(sci.nodeIds!));
    expect(s.flight!.causes.some((x) => x.ref === 'end:power_drop' && x.causeIds.includes(`opt:${sci.id}`))).toBe(true);
  });
  it('in a full room the crisis closes as soon as every present role with options has chosen', () => {
    let s = createRoom('ABCDEF', { id: H, name: 'Host' }, 7);
    for (const p of ['e', 's', 'c']) s = apply(s, { type: 'join', playerId: p, name: p });
    const roles: [string, RoleId][] = [[H, 'commander'], ['e', 'engineer'], ['s', 'science'], ['c', 'comms']];
    for (const [id, role] of roles) s = apply(apply(s, { type: 'pickRole', playerId: id, role }), { type: 'setReady', playerId: id, ready: true });
    s = apply(s, { type: 'goStage', playerId: H, stage: 'build' });
    // 0013 §2: the commander installs any department at once.
    for (const [id, n] of Object.entries(over)) for (let i = 0; i < n; i++) s = apply(s, { type: 'addComponent', playerId: H, id });
    s = apply(apply(apply(s, { type: 'submitReview', playerId: 'e' }), { type: 'approve', playerId: H }), { type: 'launchDone', playerId: H });
    while (s.flight!.crisis?.kind !== 'power_drop') s = apply(s, { type: 'tick', playerId: H });
    const c = s.flight!.crisis!;
    for (const [id, role] of roles) {
      const o = c.options.find((x) => x.role === role);
      if (o) s = apply(s, { type: 'crisisChoice', playerId: id, optionId: o.id });
    }
    expect(s.flight!.crisis).toBeNull();
    expect(s.flight!.history.at(-1)!.endedTick).toBeLessThan(c.deadlineTick);
  });
  it('deadline without a choice: a matching Autonomy Planner rule fires, otherwise Safe Protocol', () => {
    const hungry: Build = { rtg: 1, battery_hc: 2, power_bus: 2, pdu: 1, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1, thermal_insulation: 1, atmo_sensor: 1, wide_camera: 1 };
    const rule: AutonomyRule = { id: 'r-power', when: [{ kind: 'battery_below', value: 25 }], then: 'shed_secondary' };
    const withRule = runBuild(hungry, { rules: [rule] }).flight!.history.find((h) => h.kind === 'power_drop')!;
    expect(withRule.by).toBe('autonomy');
    expect(withRule.ruleIds).toEqual(['r-power']);
    const none = runBuild(hungry).flight!.history.find((h) => h.kind === 'power_drop')!;
    expect(none.by).toBe('safe');
  });
});

describe('TZ test D — blackout (engine part)', () => {
  it('unanswered Signal Distortion → signal lost; the configured rule runs, roles see different data', () => {
    const rules: AutonomyRule[] = [{ id: 'r-keep', when: [{ kind: 'signal_lost' }], then: 'keep_collecting_store' }];
    let s = install(roomInBuild(), TYPICAL);
    s = launch(apply(s, { type: 'setRules', playerId: H, rules }));
    let blackout: FlightState | null = null;
    while (s.stage === 'flight') {
      s = apply(s, { type: 'tick', playerId: H });
      const f = s.flight!;
      if (!blackout && f.signal === 'lost' && f.blackouts.some((b) => b.reason === 'escalation' && b.to === -1)) blackout = f;
    }
    expect(blackout).not.toBeNull();
    const esc = s.flight!.blackouts.find((b) => b.reason === 'escalation')!;
    expect(esc.by).toBe('autonomy');
    expect(esc.ruleIds).toEqual(['r-keep']);
    const build = s.build;
    const eng = panelFor('engineer', blackout!, build);
    const sci = panelFor('science', blackout!, build);
    const com = panelFor('comms', blackout!, build);
    const cmd = panelFor('commander', blackout!, build);
    expect([eng, sci, com, cmd].every((p) => p.blackout)).toBe(true);
    expect(com.items.find((i) => i.id === 'signal')!.value).toBe('NO SIGNAL');
    expect(com.comms!.antennas).toContain('antenna_high_gain');
    expect(com.comms!.queue).toBeDefined();
    expect(eng.power!.lines.length).toBeGreaterThan(3);
    expect(eng.items.some((i) => i.id === 'heat')).toBe(true);
    expect(sci.alerts.join(' ')).toMatch(/не уходят/);
    expect(cmd.command!.hull).toBe(blackout!.hull);
    expect(cmd.power).toBeUndefined();
    expect(eng.science).toBeUndefined();
  });
  it('commander gets the timer but not the technical causes during a crisis; options are per role', () => {
    let s = launch(install(roomInBuild(), { ...TYPICAL, power_bus: 1, battery_hc: 2 }));
    while (!s.flight!.crisis) s = apply(s, { type: 'tick', playerId: H });
    const f = s.flight!;
    const cmd = panelFor('commander', f, s.build);
    const eng = panelFor('engineer', f, s.build);
    expect(cmd.command!.timerSeconds).toBeGreaterThan(0);
    expect(cmd.crisis!.nodeIds).toEqual([]);
    expect(cmd.crisis!.text).not.toMatch(/W/);
    expect(eng.crisis!.nodeIds).toContain('power_bus');
    expect(cmd.crisis!.options.every((o) => o.role === 'commander')).toBe(true);
    expect(eng.crisis!.options.every((o) => o.role === 'engineer')).toBe(true);
  });
});

describe('report', () => {
  it('a good build flown by a careful team reaches Success or Perfect', () => {
    const s = runBuild(GOOD, { policy: goodTeam });
    const r = s.report!;
    expect(['perfect', 'success']).toContain(r.outcome);
    expect(r.delivered.length).toBeGreaterThanOrEqual(3);
    expect(r.breakdown.reduce((a, b) => a + b.weight, 0)).toBe(100);
    expect(r.teamTrust).toBe(100);
    expect(r.mc.earned).toBeGreaterThanOrEqual(90);
    expect(s.credits).toBe(r.mc.earned);
    expect(r.highlights[0].kind).toBe('launch');
    expect(r.highlights.at(-1)!.kind).toBe('final');
  });
  it('a bad build fails with clear cause chains (what → why → what to do), no blame', () => {
    const r = runBuild(BAD).report!;
    expect(['failed', 'partial']).toContain(r.outcome);
    const main = r.chains.slice(0, 3);
    expect(main.length).toBe(3);
    for (const c of main) {
      expect(c.what.length).toBeGreaterThan(10);
      expect(c.why.length).toBeGreaterThan(10);
      expect(c.couldDo.length).toBeGreaterThan(10);
      expect(c.causeIds.length).toBeGreaterThan(0);
      expect(`${c.what} ${c.why} ${c.couldDo}`).not.toMatch(/виноват|ошибка игрок|×\s*1\/6/);
    }
    expect(r.chains.some((c) => c.causeIds.includes('deficit') || c.causeIds.includes('bus-overload'))).toBe(true);
    // Comms points scale with how much data there was to send, not just the sent/collected ratio.
    const comms = r.breakdown.find((b) => b.key === 'comms')!;
    if (r.delivered.length === 0) expect(comms.got).toBeLessThan(comms.weight);
    expect(r.mc.earned).toBeGreaterThanOrEqual(20);
    expect(r.mc.total).toBeGreaterThanOrEqual(0);
    expect(r.highlights.filter((h) => h.kind === 'crisis').length).toBe(3);
  });
  it('«Ещё раз» starts a new attempt: decisions of the previous one do not leak into the next report', () => {
    let s = runBuild(BAD);
    expect(s.stage).toBe('report');
    s = apply(s, { type: 'goStage', playerId: H, stage: 'build' });
    expect(s.decisionLog).toEqual([]);
    s = fly(launch(s));
    expect(s.report!.decisions.length).toBe(1);
  });
  it('team trust drops only for accepted warnings whose risk came true', () => {
    const r = runBuild(BAD).report!;
    expect(r.trust.length).toBeGreaterThan(0);
    for (const t of r.trust) expect(['deficit', 'bus-overload', 'cold', 'freeze']).toContain(t.issueId);
    const clean = runBuild({ ...GOOD }).report!;
    expect(clean.trust).toEqual([]);
  });
  it('roles get credit for what they did', () => {
    const r = runBuild(GOOD, { policy: goodTeam }).report!;
    const sci = r.roles.find((x) => x.role === 'science')!;
    expect(sci.did.join(' ')).toMatch(/Точный режим/);
    expect(r.roles.find((x) => x.role === 'commander')!.did.join(' ')).toMatch(/Утвердил/);
  });
});
