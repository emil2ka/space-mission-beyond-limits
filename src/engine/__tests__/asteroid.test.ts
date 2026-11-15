// M3 part A: Asteroid Sample Return flight — length, determinism, crises from their causes (and not without them),
// per-role options, Autonomy Planner / Safe Protocol on the deadline, capsule stages, panels, report, Rotor System.
import { describe, expect, it } from 'vitest';
import { canAdd, computeStats } from '../stats';
import { readiness } from '../readiness';
import { MISSIONS } from '../data/missions';
import { ASTEROID, SITE_DEFS } from '../data/asteroid';
import { debrisPlan, jamPlan, jamRisk } from '../asteroid';
import { startFlight, stepFlight, type FlightState } from '../flight';
import { panelFor } from '../panels';
import { rolesWithOptions } from '../crises';
import { TRUST } from '../data/rules';
import type { AutonomyRule } from '../autonomy';
import type { Build, RoleId } from '../types';
import {
  AST_BAD, AST_GOOD, AST_ION, H, apply, as, astTeam, both, err, fly, install, launch, pick, roomInBuild, run,
} from './m3helpers';

const asteroid = MISSIONS.asteroid;
const NO_SHIELD: Build = { ...AST_GOOD, micrometeoroid_shield: 0 };
/** A seed where the stream misses a shielded craft, and one where it still hits. */
const seedMiss = [...Array(60).keys()].map((i) => i + 1).find((seed) => !debrisPlan(seed, AST_GOOD).hits)!;
const seedHit = [...Array(60).keys()].map((i) => i + 1).find((seed) => debrisPlan(seed, AST_GOOD).hits)!;

describe('asteroid flight shape', () => {
  it.each([['chemical', AST_GOOD], ['ion', AST_ION], ['bad', AST_BAD]])('%s build flies 9–12 minutes, phases in order, crises one at a time', (_, build) => {
    let maxActive = 0;
    const phases: number[] = [];
    const s = run('asteroid', build, { policy: astTeam(), onTick: (f) => { maxActive = Math.max(maxActive, f.crisis ? 1 : 0); phases.push(f.phaseIndex); } });
    const f = s.flight!;
    expect(s.stage).toBe('report');
    expect(f.tick).toBeGreaterThanOrEqual(530);
    expect(f.tick).toBeLessThanOrEqual(720);
    expect(maxActive).toBeLessThanOrEqual(1);
    for (let i = 1; i < phases.length; i++) expect(phases[i]).toBeGreaterThanOrEqual(phases[i - 1]);
    for (let i = 1; i < f.history.length; i++) expect(f.history[i].startedTick).toBeGreaterThan(f.history[i - 1].endedTick);
    for (const h of f.history) expect(h.causeIds.length).toBeGreaterThan(0);
  });

  it('ion drive: longer cruise, much less fuel; chemical: faster, hungrier', () => {
    const chem = run('asteroid', AST_GOOD, { seed: seedMiss, policy: astTeam() }).flight!;
    const ion = run('asteroid', AST_ION, { seed: seedMiss, policy: astTeam() }).flight!;
    const cruiseEnd = (f: FlightState) => f.causes.find((c) => c.text === 'Фаза: Сближение.')!.tick;
    expect(cruiseEnd(ion)).toBeGreaterThan(cruiseEnd(chem));
    expect(ion.asteroid!.fuelUsed.cruise).toBeLessThan(chem.asteroid!.fuelUsed.cruise / 3);
    expect(ion.asteroid!.drive).toBe('ion');
  });

  it('capsule goes stowed → separated → entry → chute → landed → found, capsuleProgress stays 0..1', () => {
    const seen: string[] = [];
    run('asteroid', AST_GOOD, {
      policy: astTeam(), onTick: (f) => {
        const a = f.asteroid!;
        if (seen.at(-1) !== a.capsule) seen.push(a.capsule);
        expect(a.capsuleProgress).toBeGreaterThanOrEqual(0);
        expect(a.capsuleProgress).toBeLessThanOrEqual(1);
        expect(a.approach).toBeGreaterThanOrEqual(0);
        expect(a.approach).toBeLessThanOrEqual(1);
      },
    });
    expect(seen).toEqual(['stowed', 'separated', 'entry', 'chute', 'landed', 'found']);
  });

  it('deterministic: same seed → same flight and report', () => {
    const a = run('asteroid', AST_BAD, { seed: 42, policy: astTeam('boulder') });
    const b = run('asteroid', AST_BAD, { seed: 42, policy: astTeam('boulder') });
    expect(a.flight).toEqual(b.flight);
    expect(a.report).toEqual(b.report);
    expect(new Set([1, 2, 3, 4, 5, 6].map((seed) => debrisPlan(seed, NO_SHIELD).at)).size).toBeGreaterThan(1);
  });
});

describe('Rotor System on the asteroid (TZ test B)', () => {
  it('cannot be installed, is a launch blocker, and never moves the craft', () => {
    const r = canAdd({}, 'rotor_system', asteroid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/вакуум/);
    const build: Build = { ...AST_GOOD, chem_thrusters: 0, rotor_system: 1 };
    expect(readiness(build, asteroid).blockers.map((b) => b.id)).toEqual(expect.arrayContaining(['incompat:rotor_system', 'req:chem_main_engine|chem_thrusters']));
    // Even forced into a flight, the rotor does not count as propulsion: no approach, no sample.
    let f = startFlight('asteroid', build);
    for (let i = 0; i < 1000 && !f.done; i++) f = stepFlight(f, build, 7);
    expect(f.asteroid!.approach).toBe(0);
    expect(f.asteroid!.approachFailed).toBe(true);
    expect(f.asteroid!.sample.collected).toBe(false);
    expect(f.power.demand).toBeLessThan(70 + 20); // rotor never drew its 70 W on top
  });
});

describe('Debris Alert', () => {
  it('without Micrometeoroid Shield it always comes on approach, with it only on some seeds — and never otherwise', () => {
    for (const seed of [1, 2, 3, 4, 5]) expect(debrisPlan(seed, NO_SHIELD).hits).toBe(true);
    const share = [...Array(100).keys()].filter((i) => debrisPlan(i + 1, AST_GOOD).hits).length / 100;
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.5);
    const hit = run('asteroid', NO_SHIELD, { seed: seedMiss, policy: astTeam() }).flight!;
    expect(hit.history.filter((h) => h.kind === 'debris_alert').length).toBe(1);
    expect(hit.history.find((h) => h.kind === 'debris_alert')!.causeIds).toContain('micrometeoroid_shield');
    const calm = run('asteroid', AST_GOOD, { seed: seedMiss, policy: astTeam() }).flight!;
    expect(calm.crisesSeen).not.toContain('debris_alert');
    expect(calm.causes.some((c) => c.ref === 'crisis:debris_alert')).toBe(false);
  });

  it('options per role; without Radar / Navigation Camera it is seen late (shorter timer)', () => {
    let r = launch(install(roomInBuild('asteroid', seedHit), NO_SHIELD));
    while (r.flight!.crisis?.kind !== 'debris_alert') r = apply(r, { type: 'tick', playerId: H });
    const c = r.flight!.crisis!;
    expect(rolesWithOptions(c)).toEqual(expect.arrayContaining(['commander', 'engineer']));
    expect(c.options.map((o) => o.id)).toEqual(expect.arrayContaining(['da_evade', 'da_continue', 'da_brace']));
    // 0013 §3: Team Trust 100 («Слаженная команда») adds TRUST.crisisBonus seconds to every crisis timer.
    expect(c.deadlineTick - c.startedTick).toBe(ASTEROID.crisis.deadline + TRUST.crisisBonus);
    expect(r.flight!.asteroid!.debris).toBe(true);
    let blind = launch(install(roomInBuild('asteroid', seedHit), { ...NO_SHIELD, nav_camera: 0 }));
    while (blind.flight!.crisis?.kind !== 'debris_alert') blind = apply(blind, { type: 'tick', playerId: H });
    expect(blind.flight!.crisis!.deadlineTick - blind.flight!.crisis!.startedTick).toBe(ASTEROID.debris.lateDeadline + TRUST.crisisBonus);
    expect(blind.flight!.crisis!.variant).toBe('late');
  });

  it('evade costs fuel and no hull; continue without a shield hurts the Heat Shield → the sample overheats → report chain', () => {
    const evade = run('asteroid', NO_SHIELD, { seed: seedHit, policy: astTeam() }).flight!;
    const e = evade.history.find((h) => h.kind === 'debris_alert')!;
    expect(e.chosen.commander).toBe('da_evade');
    expect(evade.asteroid!.fuelUsed.evade).toBeCloseTo(ASTEROID.debris.evadeFuel, 0);
    expect(evade.asteroid!.debrisHull).toBe(0);
    expect(e.resolved).toBe(true);

    // The commander chooses to push on; the site is picked as usual.
    const team = run('asteroid', NO_SHIELD, {
      seed: seedHit,
      policy: both((s) => (s.flight!.asteroid!.site ? [] : astTeam()(s)), pick(['da_continue', 'aj_restart'])),
    });
    const f = team.flight!;
    const h = f.history.find((x) => x.kind === 'debris_alert')!;
    expect(h.chosen.commander).toBe('da_continue');
    expect(f.broken).toContain('heat_shield');
    expect(f.asteroid!.heated).toBe(true);
    expect(f.hull).toBeLessThan(100);
    const r = team.report!;
    expect(r.chains.map((c) => c.key)).toEqual(expect.arrayContaining(['debris_alert', 'heat-shield']));
    expect(r.asteroid!.perfect.sealed).toBe(false);
    expect(r.outcome).not.toBe('perfect');
    expect(r.damaged).toContain('heat_shield');
  });

  it('no answer: rule «Debris Detected → Уклониться» fires on the deadline; without rules Safe Protocol holds still', () => {
    const rules: AutonomyRule[] = [{ id: 'r-evade', when: [{ kind: 'debris_detected' }], then: 'evade' }];
    const auto = run('asteroid', NO_SHIELD, { seed: seedHit, rules }).flight!;
    const a = auto.history.find((h) => h.kind === 'debris_alert')!;
    expect(a.by).toBe('autonomy');
    expect(a.ruleIds).toEqual(['r-evade']);
    expect(auto.asteroid!.debrisHull).toBe(0);
    expect(auto.rulesFired.some((r) => r.ruleId === 'r-evade' && r.where === 'crisis')).toBe(true);
    const safe = run('asteroid', NO_SHIELD, { seed: seedHit }).flight!;
    const b = safe.history.find((h) => h.kind === 'debris_alert')!;
    expect(b.by).toBe('safe');
    expect(safe.asteroid!.debrisHull).toBe(Math.round(ASTEROID.debris.hull.none * 0.5));
  });
});

describe('Sampling Arm Jam', () => {
  it('risk comes from the site and Vibration Dampers (seed only picks the moment)', () => {
    expect(jamRisk(AST_GOOD, 'regolith')).toBeLessThanOrEqual(0);
    expect(jamRisk(AST_BAD, 'boulder')).toBeGreaterThanOrEqual(1);
    expect(jamRisk(AST_BAD, 'regolith')).toBeGreaterThan(jamRisk(AST_GOOD, 'regolith'));
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(jamPlan(seed, AST_BAD, 'boulder').hits).toBe(true);
      expect(jamPlan(seed, AST_GOOD, 'regolith').hits).toBe(false);
    }
  });

  it('triggers from its cause (boulder, no dampers) and not without it (regolith with dampers)', () => {
    for (const seed of [3, 9]) {
      const jam = run('asteroid', AST_BAD, { seed, policy: astTeam('boulder') }).flight!;
      expect(jam.crisesSeen).toContain('arm_jam');
      expect(jam.history.find((h) => h.kind === 'arm_jam')!.causeIds).toEqual(expect.arrayContaining(['vibration_dampers', 'site:boulder']));
      const calm = run('asteroid', AST_GOOD, { seed, policy: astTeam('regolith') }).flight!;
      expect(calm.crisesSeen).not.toContain('arm_jam');
      expect(calm.asteroid!.sample.collected).toBe(true);
    }
  });

  it('every role gets an option; restart + inspect continues at full speed and the sample is taken', () => {
    const build = { ...AST_GOOD, vibration_dampers: 0 };
    let r = launch(install(roomInBuild('asteroid', seedMiss), build));
    while (r.flight!.crisis?.kind !== 'arm_jam' && r.stage === 'flight') {
      const f = r.flight!;
      if (!f.asteroid!.site && f.phaseIndex >= 1) r = apply(apply(r, { type: 'pickRole', playerId: H, role: 'science' }), { type: 'chooseSite', playerId: H, site: 'boulder' });
      r = apply(r, { type: 'tick', playerId: H });
    }
    const c = r.flight!.crisis!;
    expect(c.kind).toBe('arm_jam');
    expect(rolesWithOptions(c).sort()).toEqual((['commander', 'comms', 'engineer', 'science'] as RoleId[]).sort());
    expect(r.flight!.asteroid!.sampling).toBe('jam');
    r = apply(as(r, 'engineer'), { type: 'crisisChoice', playerId: H, optionId: 'aj_restart' });
    r = apply(as(r, 'science'), { type: 'crisisChoice', playerId: H, optionId: 'aj_inspect' });
    r = apply(as(r, 'comms'), { type: 'crisisChoice', playerId: H, optionId: 'aj_save' });
    r = apply(as(r, 'commander'), { type: 'crisisChoice', playerId: H, optionId: 'aj_retry' });
    expect(r.flight!.crisis).toBeNull(); // all roles answered → closed at once
    const h = r.flight!.history.at(-1)!;
    expect(h.by).toBe('team');
    expect(r.flight!.downlinkFirst).toBe('composition');
    r = fly(r);
    expect(r.flight!.asteroid!.attempts).toBe(2);
    expect(r.flight!.asteroid!.sample.collected).toBe(true);
  });

  it('no answer: Safe Protocol parks the arm and restarts it at half speed (or a rule takes what is there)', () => {
    const safe = run('asteroid', AST_BAD, { seed: 3, policy: (s) => (s.flight!.crisis ? [] : astTeam('boulder')(s)) }).flight!;
    const h = safe.history.find((x) => x.kind === 'arm_jam')!;
    expect(h.by).toBe('safe');
    expect(h.resolved).toBe(false);
    expect(safe.asteroid!.rateFactor).toBe(ASTEROID.jam.safeRate);
    const keep: AutonomyRule[] = [{ id: 'r-keep', when: [{ kind: 'hull_below', value: 99 }], then: 'stop_risky_maneuvers' }];
    const auto = run('asteroid', { ...AST_BAD, sample_sealer: 0 }, { seed: 3, rules: keep, policy: (s) => (s.flight!.crisis ? [] : astTeam('boulder')(s)) }).flight!;
    const ah = auto.history.find((x) => x.kind === 'arm_jam')!;
    expect(ah.by).toBe('autonomy');
    expect(ah.ruleIds).toEqual(['r-keep']);
  });

  it('«Sample Secured → Перейти к подготовке возврата» ends sampling early and is logged as a fired rule', () => {
    const rules: AutonomyRule[] = [{ id: 'r-prep', when: [{ kind: 'sample_secured' }], then: 'prepare_return' }];
    const fast = run('asteroid', AST_GOOD, { seed: seedMiss, rules, policy: astTeam('regolith') }).flight!;
    const slow = run('asteroid', AST_GOOD, { seed: seedMiss, policy: astTeam('regolith') }).flight!;
    const stowAt = (f: FlightState) => f.causes.find((c) => c.text === 'Фаза: Упаковка.')!.tick;
    expect(stowAt(fast)).toBeLessThan(stowAt(slow));
    expect(fast.rulesFired.some((r) => r.ruleId === 'r-prep' && r.where === 'flight')).toBe(true);
    expect(fast.tick).toBeLessThan(slow.tick);
  });
});

describe('Power Drop / Overheat on the asteroid follow the shared rules', () => {
  it('too little generation for the Ion Engine → Power Drop in cruise, the ion engine is shed, the drive falls back to chemical', () => {
    const weak: Build = { ...AST_ION, solar_array: 2, propellant_tank: 2 };
    const f = run('asteroid', weak, { seed: seedMiss }).flight!;
    expect(f.crisesSeen).toContain('power_drop');
    expect(f.causes.some((c) => c.ref === 'ion-lost')).toBe(true);
    expect(f.asteroid!.drive).toBe('chem');
  });
  it('a hot build (RTG, no radiator) overheats; a cool one does not', () => {
    const hot: Build = { ...AST_GOOD, solar_array: 0, rtg: 2, micrometeoroid_shield: 0, vibration_dampers: 0, sample_sealer: 0, recovery_beacon: 0, data_buffer: 0 };
    expect(computeStats(hot, asteroid).thermalState).toMatch(/hot|overheat/);
    const f = run('asteroid', hot, { seed: seedMiss, policy: astTeam() }).flight!;
    expect(f.crisesSeen).toContain('overheat');
    const cool = run('asteroid', AST_GOOD, { seed: seedMiss, policy: astTeam() }).flight!;
    expect(cool.crisesSeen).not.toContain('overheat');
  });
});

describe('fuel', () => {
  it('one tank on chemistry + a dodge is not enough for the return burn → off-target landing → no beacon → capsule lost', () => {
    const one: Build = { ...NO_SHIELD, propellant_tank: 1, recovery_beacon: 0 };
    const s = run('asteroid', one, { seed: seedHit, policy: astTeam() });
    const a = s.flight!.asteroid!;
    expect(a.fuelShort).toBeGreaterThan(0);
    expect(a.offTarget).toBe(true);
    expect(a.capsule).toBe('lost');
    const keys = s.report!.chains.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['fuel', 'capsule-lost']));
    expect(['partial', 'failed']).toContain(s.report!.outcome);
  });
});

describe('site choice (science officer only)', () => {
  it('only science, only on approach / site phase; otherwise the computer picks regolith', () => {
    let s = launch(install(roomInBuild('asteroid'), AST_GOOD));
    expect(err(as(s, 'science'), { type: 'chooseSite', playerId: H, site: 'crack' })).toMatch(/сближении/);
    while (s.flight!.phaseIndex < 1) s = apply(s, { type: 'tick', playerId: H });
    expect(err(as(s, 'engineer'), { type: 'chooseSite', playerId: H, site: 'crack' })).toMatch(/научный/);
    s = apply(as(s, 'science'), { type: 'chooseSite', playerId: H, site: 'crack' });
    expect(s.flight!.asteroid!.site).toBe('crack');
    expect(s.flight!.asteroid!.siteBy).toBe('science');
    expect(s.flight!.commands.at(-1)!.label).toMatch(/трещин/);
    const auto = run('asteroid', AST_GOOD, { seed: seedMiss }).flight!;
    expect(auto.asteroid!.site).toBe('regolith');
    expect(auto.asteroid!.siteBy).toBe('auto');
  });
  it('the crack gives the most composition data, regolith the least', () => {
    const comp = (site: 'regolith' | 'crack') => run('asteroid', AST_GOOD, { seed: seedMiss, policy: astTeam(site) }).flight!.targets.find((t) => t.id === 'composition')!;
    const c = comp('crack');
    const r = comp('regolith');
    expect(c.collected).toBeGreaterThan(r.collected);
    expect(c.quality).toBeGreaterThan(r.quality);
  });
});

describe('asteroid panels: each role sees its part', () => {
  it('engineer fuel/engines/shield · science site/arm/sample · comms composition + capsule · commander status/hull/timer', () => {
    let s = launch(install(roomInBuild('asteroid', seedHit), NO_SHIELD));
    while (s.flight!.crisis?.kind !== 'debris_alert') s = apply(s, { type: 'tick', playerId: H });
    const f = s.flight!;
    const eng = panelFor('engineer', f, s.build);
    expect(eng.asteroid!.fuel!.max).toBe(200);
    expect(eng.asteroid!.engines!.map((e) => e.id)).toContain('chem_thrusters');
    expect(eng.asteroid!.protection!.micrometeoroidShield).toBe(false);
    expect(eng.items.map((i) => i.id)).toEqual(expect.arrayContaining(['fuel', 'shield', 'battery', 'heat']));
    const sci = panelFor('science', f, s.build);
    expect(sci.asteroid!.site!.options.map((o) => o.id)).toEqual(SITE_DEFS.map((d) => d.id));
    expect(sci.asteroid!.site!.canChoose).toBe(true);
    expect(sci.asteroid!.arm!.state).toBe('idle');
    expect(sci.asteroid!.fuel).toBeUndefined();
    const com = panelFor('comms', f, s.build);
    expect(com.asteroid!.composition!.required).toBe(45);
    expect(com.asteroid!.site).toBeUndefined();
    const cmd = panelFor('commander', f, s.build);
    expect(cmd.command!.timerSeconds).toBeGreaterThan(0);
    expect(cmd.crisis!.text).toMatch(/уклониться/);
    expect(cmd.crisis!.nodeIds).toEqual([]);
    expect(cmd.asteroid!.capsule!.stage).toBe('stowed');
    expect(cmd.items.map((i) => i.id)).toEqual(expect.arrayContaining(['hull', 'status', 'goal', 'fuel']));
  });
});

describe('asteroid report', () => {
  it('a good build flown by a careful team → Perfect: sealed sample + capsule found + composition delivered', () => {
    const s = run('asteroid', AST_GOOD, { seed: seedMiss, policy: astTeam('crack') });
    const r = s.report!;
    expect(r.outcome).toBe('perfect');
    expect(r.asteroid!.perfect).toEqual({ sealed: true, capsuleFound: true, composition: true });
    expect(r.breakdown.reduce((x, b) => x + b.weight, 0)).toBe(100);
    expect(r.breakdown.map((b) => b.key)).toEqual(['main', 'data', 'craft', 'comms', 'sample', 'return', 'resources']);
    expect(r.breakdown.find((b) => b.key === 'sample')!.weight).toBe(10);
    expect(r.breakdown.find((b) => b.key === 'return')!.weight).toBe(5);
    expect(r.mc.earned).toBe(120 + 10 * r.delivered.length);
    expect(r.roles.find((x) => x.role === 'science')!.did.join(' ')).toMatch(/место отбора/);
  });
  it('good build even with debris and a jam answered well → Success or Perfect', () => {
    const r = run('asteroid', { ...AST_GOOD, vibration_dampers: 0 }, { seed: seedHit, policy: astTeam('crack') }).report!;
    expect(['perfect', 'success']).toContain(r.outcome);
  });
  it('without a sealer the best is Success (Perfect needs a sealed sample)', () => {
    const r = run('asteroid', { ...AST_GOOD, sample_sealer: 0, hires_camera: 1 }, { seed: seedMiss, policy: astTeam('crack') }).report!;
    expect(r.outcome).not.toBe('perfect');
    expect(r.chains.map((c) => c.key)).toContain('not-sealed');
  });
  it('a bad build fails with clear chains (what → why → what to do), no blame', () => {
    const s = run('asteroid', AST_BAD, { seed: 3 });
    const r = s.report!;
    expect(['failed', 'partial']).toContain(r.outcome);
    const main = r.chains.slice(0, 3);
    expect(main.length).toBe(3);
    for (const c of main) {
      expect(c.what.length).toBeGreaterThan(10);
      expect(c.why.length).toBeGreaterThan(10);
      expect(c.couldDo.length).toBeGreaterThan(10);
      expect(c.causeIds.length).toBeGreaterThan(0);
      expect(`${c.what} ${c.why} ${c.couldDo}`).not.toMatch(/виноват|ошибка игрок|undefined|NaN/);
    }
    expect(r.chains.map((c) => c.key)).toEqual(expect.arrayContaining(['debris_alert', 'capsule-lost']));
    expect(r.mc.earned).toBeGreaterThanOrEqual(20);
  });
  it('no sample on Earth → at best Partial («данные есть, образец потерян»)', () => {
    const r = run('asteroid', { ...AST_GOOD, recovery_beacon: 0, propellant_tank: 1, micrometeoroid_shield: 0 }, { seed: seedHit, policy: astTeam('crack') }).report!;
    expect(r.asteroid!.home).toBe(false);
    expect(['partial', 'failed']).toContain(r.outcome);
  });
});
