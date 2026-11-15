// Decision 0013 §2–4 in the engine: module ownership and requests, the commander's budget split,
// Team Trust tiers (recovery, crisis bonus, second key, agency audit), 2–3 players with several roles each.
import { describe, expect, it } from 'vitest';
import { createRoom, reduce, type Action, type RoomState } from '../room';
import { readiness } from '../readiness';
import { MISSIONS } from '../data/missions';
import { TITAN } from '../data/titan';
import { prepCosts } from '../economy';
import { panelFor } from '../panels';
import {
  budgetShares, changeReasons, criticalWarnings, freeRoles, moduleBudget, ownsDepartment, rolePlan, rolesOf, trustEffects, trustTier, TRUST,
} from '../rules';
import type { Build, RoleId } from '../types';

const apply = (s: RoomState, ...acts: Action[]) => acts.reduce((st, a) => {
  const r = reduce(st, a, 1000);
  if (r.error) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}, s);
const err = (s: RoomState, a: Action) => reduce(s, a, 1000).error;
const P = (s: RoomState, id: string) => s.players.find((p) => p.id === id)!;

const TYPICAL: Build = {
  rtg: 2, battery_hc: 1, power_bus: 2, pdu: 1, rotor_system: 1, flight_computer: 1, imu: 1, atmo_sensor: 1, wide_camera: 1,
  transceiver: 1, antenna_high_gain: 1, thermal_insulation: 1, data_storage: 1,
};
/** No warnings at all (flight.test GOOD): a clean flight. */
const GOOD: Build = {
  rtg: 2, battery_hc: 1, power_bus: 2, pdu: 1, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1,
  thermal_radiator: 1, thermal_insulation: 1, atmo_sensor: 1, wide_camera: 1, temp_sensor: 1, spectrometer: 1, data_storage: 1, landing_system: 1,
};
/** Bus overload: a critical warning the commander may accept (ТЗ §3.1). */
const OVER: Build = { ...TYPICAL, power_bus: 1, battery_hc: 2 };

/** A lobby of `ids.length` players; player i picks roles[i]; everyone READY. Host = 'h'. */
function lobby(picks: [string, RoleId][]): RoomState {
  let s = createRoom('ABCDEF', { id: picks[0][0], name: picks[0][0].toUpperCase() }, 7);
  for (const [id] of picks.slice(1)) s = apply(s, { type: 'join', playerId: id, name: id.toUpperCase() });
  for (const [id, role] of picks) s = apply(s, { type: 'pickRole', playerId: id, role }, { type: 'setReady', playerId: id, ready: true });
  return s;
}
const FOUR: [string, RoleId][] = [['h', 'commander'], ['e', 'engineer'], ['s', 'science'], ['c', 'comms']];
const inBuild = (s: RoomState) => apply(s, { type: 'goStage', playerId: s.hostId, stage: 'build' });
function install(s: RoomState, by: string, build: Build) {
  for (const [id, n] of Object.entries(build)) for (let i = 0; i < n; i++) s = apply(s, { type: 'addComponent', playerId: by, id });
  return s;
}

describe('0013 §2 module ownership', () => {
  it('department owners: engineer power/propulsion/structure/recovery, science, comms + navigation; the commander anything', () => {
    expect(ownsDepartment(['engineer'], 'power')).toBe(true);
    expect(ownsDepartment(['engineer'], 'recovery')).toBe(true);
    expect(ownsDepartment(['engineer'], 'science')).toBe(false);
    expect(ownsDepartment(['comms'], 'navigation')).toBe(true);
    expect(ownsDepartment(['science'], 'science')).toBe(true);
    expect(ownsDepartment(['commander'], 'propulsion')).toBe(true);
    expect(ownsDepartment(['engineer', 'science'], 'science')).toBe(true);
  });

  it('own department goes in at once; a foreign one becomes a pending request, the build is untouched', () => {
    let s = inBuild(lobby(FOUR));
    s = apply(s, { type: 'addComponent', playerId: 'e', id: 'rtg' });
    expect(s.build.rtg).toBe(1);
    expect(s.requests).toEqual([]);
    s = apply(s, { type: 'addComponent', playerId: 'e', id: 'atmo_sensor' });
    expect(s.build.atmo_sensor ?? 0).toBe(0);
    const [rq] = s.requests!;
    expect(rq).toMatchObject({ kind: 'add', componentId: 'atmo_sensor', owner: 'science', by: 'e', byRole: 'engineer', reasons: ['foreign'], status: 'pending' });
    expect(err(s, { type: 'addComponent', playerId: 'e', id: 'atmo_sensor' })).toMatch(/уже ждёт/);
    // Only the commander decides; nobody can send the build to review while a request waits.
    expect(err(s, { type: 'resolveRequest', playerId: 's', requestId: rq.id, approve: true })).toMatch(/командир/);
    expect(err(s, { type: 'submitReview', playerId: 'e' })).toMatch(/запросы/);
  });

  it('commander approve installs it (credited to the requester); veto keeps the reason; both are in the report decisions', () => {
    let s = install(inBuild(lobby(FOUR)), 'h', TYPICAL);
    s = apply(s, { type: 'addComponent', playerId: 'e', id: 'temp_sensor' }, { type: 'addComponent', playerId: 's', id: 'heater' });
    const [a, b] = s.requests!;
    s = apply(s, { type: 'resolveRequest', playerId: 'h', requestId: a.id, approve: true });
    expect(s.build.temp_sensor).toBe(1);
    expect(s.requests![0].status).toBe('approved');
    expect(s.log.at(-2)).toMatchObject({ kind: 'build', by: 'e', role: 'engineer', text: 'E: +1 temp_sensor' });
    s = apply(s, { type: 'resolveRequest', playerId: 'h', requestId: b.id, approve: false, reason: 'Тепла хватает, бережём энергию.' });
    expect(s.build.heater ?? 0).toBe(0);
    expect(s.requests![1]).toMatchObject({ status: 'vetoed', note: 'Тепла хватает, бережём энергию.', resolvedBy: 'h' });
    expect(s.decisionLog.map((d) => d.kind)).toEqual(['request-approve', 'request-veto']);
    expect(err(s, { type: 'resolveRequest', playerId: 'h', requestId: b.id, approve: true })).toMatch(/уже решён/);

    // Fly it: the report's decisions include the requests and the veto, the roles get credit.
    s = apply(s, { type: 'submitReview', playerId: 'e' }, { type: 'approve', playerId: 'h' }, { type: 'launchDone', playerId: 'h' });
    let guard = 0;
    while (s.stage === 'flight' && guard++ < 2000) {
      const c = s.flight!.crisis;
      if (c) for (const [id, role] of FOUR) { const o = c.options.find((x) => x.role === role); if (o && !c.chosen[role]) s = apply(s, { type: 'crisisChoice', playerId: id, optionId: o.id }); }
      if (s.stage === 'flight') s = apply(s, { type: 'tick', playerId: 'h' });
    }
    const r = s.report!;
    expect(r.decisions.map((d) => d.kind)).toEqual(expect.arrayContaining(['request-approve', 'request-veto']));
    expect(r.roles.find((x) => x.role === 'engineer')!.did.join(' ')).toMatch(/Запрос командиру: поставить Temperature Sensor — одобрен/);
    expect(r.roles.find((x) => x.role === 'science')!.did.join(' ')).toMatch(/вето/);
    expect(r.roles.find((x) => x.role === 'commander')!.did.join(' ')).toMatch(/Одобрил\(а\) запрос/);
    const e = r.players!.find((p) => p.id === 'e')!;
    expect(e.requests).toEqual({ sent: 1, approved: 1, vetoed: 0 });
    expect(r.players!.find((p) => p.id === 'h')!.built).toBeGreaterThan(5);
  });

  it('removing a foreign module is a request too; the requester can withdraw it', () => {
    let s = install(inBuild(lobby(FOUR)), 'h', TYPICAL);
    s = apply(s, { type: 'removeComponent', playerId: 'c', id: 'rtg' });
    expect(s.build.rtg).toBe(2);
    const rq = s.requests![0];
    expect(rq).toMatchObject({ kind: 'remove', owner: 'engineer', reasons: ['foreign'] });
    expect(err(s, { type: 'cancelRequest', playerId: 's', requestId: rq.id })).toMatch(/отправил/);
    s = apply(s, { type: 'cancelRequest', playerId: 'c', requestId: rq.id });
    expect(s.requests![0].status).toBe('cancelled');
    s = apply(s, { type: 'removeComponent', playerId: 'e', id: 'rtg' }); // own department: at once
    expect(s.build.rtg).toBe(1);
  });

  it('single-player demo: everything is immediate', () => {
    let s = createRoom('ABCDEF', { id: 'h', name: 'H' }, 1, true);
    s = apply(s, { type: 'pickRole', playerId: 'h', role: 'engineer' }, { type: 'setReady', playerId: 'h', ready: true }, { type: 'goStage', playerId: 'h', stage: 'build' });
    s = apply(s, { type: 'addComponent', playerId: 'h', id: 'atmo_sensor' }, { type: 'addComponent', playerId: 'h', id: 'antenna_high_gain' });
    expect(s.build).toMatchObject({ atmo_sensor: 1, antenna_high_gain: 1 });
    expect(s.requests).toEqual([]);
  });

  it('a player holding several roles owns all their departments', () => {
    let s = inBuild(lobby([['h', 'commander'], ['e', 'engineer']]));
    expect(rolesOf(P(s, 'e'))).toEqual(['engineer', 'comms']); // balanced default at the start (see §4)
    s = apply(s, { type: 'addComponent', playerId: 'e', id: 'transceiver' }, { type: 'addComponent', playerId: 'e', id: 'imu' });
    expect(s.build).toMatchObject({ transceiver: 1, imu: 1 });
    expect(s.requests).toEqual([]);
  });

  it('pending requests lapse when the host leaves the constructor', () => {
    let s = inBuild(lobby(FOUR));
    s = apply(s, { type: 'addComponent', playerId: 'e', id: 'atmo_sensor' }, { type: 'goStage', playerId: 'h', stage: 'lobby' });
    expect(s.requests![0].status).toBe('cancelled');
  });
});

describe('0013 §2 budget split', () => {
  it('the default fits the starter craft; only the commander sets it, in the build, as 5 % steps summing to 100', () => {
    const s = inBuild(lobby(FOUR));
    const lines = budgetShares(s);
    expect(lines.reduce((a, l) => a + l.pct, 0)).toBe(100);
    expect(lines.find((l) => l.owner === 'engineer')!.share).toBe(Math.round(moduleBudget('titan') * 0.65));
    expect(err(s, { type: 'setBudgetSplit', playerId: 'e', split: { engineer: 50, science: 25, comms: 25 } })).toMatch(/командир/);
    expect(err(s, { type: 'setBudgetSplit', playerId: 'h', split: { engineer: 50, science: 25, comms: 20 } })).toMatch(/100/);
    expect(err(s, { type: 'setBudgetSplit', playerId: 'h', split: { engineer: 52, science: 28, comms: 20 } })).toMatch(/шагом/);
    expect(err(lobby(FOUR), { type: 'setBudgetSplit', playerId: 'h', split: { engineer: 50, science: 25, comms: 25 } })).toMatch(/конструкторе/);
    const t = apply(s, { type: 'setBudgetSplit', playerId: 'h', split: { engineer: 50, science: 25, comms: 25 } });
    expect(t.budgetSplit).toEqual({ split: { engineer: 50, science: 25, comms: 25 }, set: true, by: 'h' });
    expect(t.log.at(-1)!.kind).toBe('decision');
  });

  it('going over the department share is a request (own department too); the commander installs over it at once', () => {
    let s = apply(inBuild(lobby(FOUR)), { type: 'setBudgetSplit', playerId: 'h', split: { engineer: 70, science: 20, comms: 10 } }); // comms: 34 M$
    s = apply(s, { type: 'addComponent', playerId: 'c', id: 'transceiver' }); // 15 ≤ 34
    expect(s.build.transceiver).toBe(1);
    s = apply(s, { type: 'addComponent', playerId: 'c', id: 'antenna_high_gain' }); // 15 + 30 = 45 > 34
    expect(s.build.antenna_high_gain ?? 0).toBe(0);
    expect(s.requests![0]).toMatchObject({ reasons: ['over-share'], overBy: 11, owner: 'comms' });
    // A foreign module over its share: both reasons.
    expect(changeReasons(s, ['engineer'], 'add', 'antenna_high_gain').reasons).toEqual(['foreign', 'over-share']);
    s = apply(s, { type: 'addComponent', playerId: 'h', id: 'antenna_high_gain' });
    expect(s.build.antenna_high_gain).toBe(1);
    expect(budgetShares(s).find((l) => l.owner === 'comms')!.left).toBe(-11);
  });
});

describe('0013 §3 Team Trust', () => {
  it('tiers: ≥80 cohesive (+5 s crises), 50–79 steady, <50 second key, <25 agency audit', () => {
    expect([100, 80, 79, 50, 49, 25, 24, 0].map(trustTier)).toEqual(['cohesive', 'cohesive', 'steady', 'steady', 'watch', 'watch', 'audit', 'audit']);
    expect(trustEffects(80)).toMatchObject({ crisisBonus: 5, secondKey: false, audit: false });
    expect(trustEffects(79).crisisBonus).toBe(0);
    expect(trustEffects(49)).toMatchObject({ secondKey: true, audit: false });
    expect(trustEffects(24)).toMatchObject({ secondKey: true, audit: true });
  });

  /** Demo room flown with `build` from Team Trust `trust` (the commander accepts every warning). */
  function flyDemo(build: Build, trust: number) {
    let s = createRoom('ABCDEF', { id: 'h', name: 'H' }, 7, true);
    s = apply(s, { type: 'pickRole', playerId: 'h', role: 'commander' }, { type: 'setReady', playerId: 'h', ready: true }, { type: 'goStage', playerId: 'h', stage: 'build' });
    s = { ...install(s, 'h', build), teamTrust: trust };
    s = apply(s, { type: 'submitReview', playerId: 'h' }, { type: 'approve', playerId: 'h' }, { type: 'launchDone', playerId: 'h' });
    const crisisTimers: number[] = [];
    while (s.stage === 'flight') {
      const c = s.flight!.crisis;
      if (c && !crisisTimers.includes(c.startedTick)) crisisTimers.push(c.startedTick, c.deadlineTick - c.startedTick);
      s = apply(s, { type: 'tick', playerId: 'h' });
    }
    return { s, crisisTimers };
  }

  it('+10 for a clean flight (capped at 100), −15 kept for an accepted warning that came true; reasons are recorded', () => {
    const clean = flyDemo(GOOD, 70).s;
    expect(clean.report!.trust).toEqual([expect.objectContaining({ delta: 10, issueId: 'recovery' })]);
    expect(clean.teamTrust).toBe(80);
    expect(clean.trustHistory!.at(-1)).toMatchObject({ delta: 10, from: 70, to: 80 });
    expect(clean.report!.trustTier!.tier).toBe('cohesive');
    expect(flyDemo(GOOD, 95).s.teamTrust).toBe(100);
    const risky = flyDemo(OVER, 100).s;
    expect(risky.report!.trust.some((t) => t.delta === -TITAN.trustPenalty && t.issueId === 'bus-overload')).toBe(true);
    expect(risky.report!.trust.some((t) => t.issueId === 'recovery')).toBe(false);
    expect(risky.teamTrust).toBe(100 - TITAN.trustPenalty * risky.report!.trust.length);
  });

  it('≥ 80: crisis timers are 5 s longer; below 80 they are the base length', () => {
    const hi = flyDemo(OVER, 80).crisisTimers;
    const lo = flyDemo(OVER, 79).crisisTimers;
    expect(hi.length).toBeGreaterThan(0);
    expect(hi[1]).toBe(lo[1] + TRUST.crisisBonus);
    expect(lo[1]).toBe(TITAN.crisis.deadline);
    const panel = panelFor('commander', flyDemo(OVER, 80).s.flight!, OVER);
    expect(panel.command!.trust).toMatchObject({ value: 80, tier: 'cohesive', crisisBonus: 5 });
  });

  it('< 25: the next preparation has a mandatory diagnostic; short of MC the free basic repair covers it (no soft-lock)', () => {
    const { s } = flyDemo(OVER, 24);
    expect(s.teamTrust).toBeLessThan(TRUST.audit);
    expect(s.agency.audit).toBe(true);
    const p = prepCosts(s.agency, false);
    expect(p.items.find((i) => i.id === 'audit')?.cost).toBe(TRUST.auditCost);
    expect(s.report!.mc.prep!.items.some((i) => i.id === 'audit')).toBe(true);
    const poor = prepCosts({ ...s.agency, credits: 0 }, false);
    expect(poor.fallback).toBe('free_basic_repair');
    expect(poor.charge).toBe(0);
    const next = apply(s, { type: 'confirmPrep', playerId: 'h', insurance: false });
    expect(next.agency.audit).toBe(false);
    expect(next.agency.credits).toBeGreaterThanOrEqual(0);
  });
});

describe('0013 §3 second key («Под наблюдением»)', () => {
  function review(picks: [string, RoleId][], trust: number) {
    let s = inBuild(lobby(picks));
    s = install(s, 'h', OVER);
    s = { ...s, teamTrust: trust };
    expect(criticalWarnings(readiness(s.build, MISSIONS.titan).warnings).map((i) => i.id)).toContain('bus-overload');
    return apply(s, { type: 'submitReview', playerId: 'h' });
  }

  it('trust ≥ 50: the commander approves the risk alone', () => {
    expect(apply(review(FOUR, 50), { type: 'approve', playerId: 'h' }).stage).toBe('launch');
  });

  it('trust < 50: approve waits for the owner of that department; the key launches it and is recorded', () => {
    let s = apply(review(FOUR, 40), { type: 'approve', playerId: 'h' });
    expect(s.stage).toBe('review');
    expect(s.pendingKey).toMatchObject({ need: ['e'], any: false, owners: ['engineer'], keys: [] });
    expect(err(s, { type: 'secondKey', playerId: 's', give: true })).toMatch(/владелец/);
    expect(err(s, { type: 'goStage', playerId: 'h', stage: 'launch' })).toMatch(/не утвердил/);
    s = apply(s, { type: 'secondKey', playerId: 'e', give: true });
    expect(s.stage).toBe('launch');
    expect(s.pendingKey).toBeNull();
    expect(s.decisionLog.at(-1)).toMatchObject({ kind: 'approve-against-warning', keys: ['e'] });
  });

  it('the owner may refuse with a reason: nothing is approved, the refusal is a decision', () => {
    let s = apply(review(FOUR, 40), { type: 'approve', playerId: 'h' });
    s = apply(s, { type: 'secondKey', playerId: 'e', give: false, reason: 'Шина сгорит в шторм.' });
    expect(s.stage).toBe('review');
    expect(s.pendingKey).toBeNull();
    expect(s.decisionLog.at(-1)).toMatchObject({ kind: 'key-denied', by: 'e', text: 'Шина сгорит в шторм.' });
    expect(err(s, { type: 'goStage', playerId: 'h', stage: 'launch' })).toMatch(/не утвердил/);
  });

  it('two players, the commander also holds the owner role: any other player turns the key', () => {
    const picks: [string, RoleId][] = [['h', 'commander'], ['b', 'science']];
    let s = inBuild(lobby(picks));
    expect(rolesOf(P(s, 'h'))).toEqual(['commander', 'engineer']);
    s = { ...install(s, 'h', OVER), teamTrust: 30 };
    s = apply(s, { type: 'submitReview', playerId: 'h' }, { type: 'approve', playerId: 'h' });
    expect(s.pendingKey).toMatchObject({ need: ['b'], any: true });
    s = apply(s, { type: 'secondKey', playerId: 'b', give: true });
    expect(s.stage).toBe('launch');
  });
});

describe('0013 §4 two or three players', () => {
  it('the host starts with 2, 3 or 4 ready players; 1 needs the demo', () => {
    const one = lobby([['h', 'commander']]);
    expect(err(one, { type: 'goStage', playerId: 'h', stage: 'briefing' })).toMatch(/2 игрока/);
    for (const picks of [FOUR.slice(0, 2), FOUR.slice(0, 3), FOUR]) {
      const s = apply(lobby(picks), { type: 'goStage', playerId: 'h', stage: 'briefing' });
      expect(s.stage).toBe('briefing');
      expect(freeRoles(s.players)).toEqual([]); // every role has an owner
      expect(s.players.flatMap(rolesOf).sort()).toEqual(['commander', 'comms', 'engineer', 'science']);
    }
  });

  it('balanced default: free roles go to the players with the fewest roles (earliest first)', () => {
    const two = lobby([['h', 'science'], ['b', 'comms']]);
    expect(rolePlan(two.players)).toEqual([{ role: 'commander', playerId: 'h' }, { role: 'engineer', playerId: 'b' }]);
    const three = lobby([['h', 'commander'], ['b', 'engineer'], ['c', 'science']]);
    expect(rolePlan(three.players)).toEqual([{ role: 'comms', playerId: 'h' }]);
    const started = apply(three, { type: 'goStage', playerId: 'h', stage: 'briefing' });
    expect(rolesOf(P(started, 'h'))).toEqual(['commander', 'comms']);
    expect(P(started, 'h').role).toBe('commander'); // the own pick stays first
  });

  it('the host assigns free roles in the lobby (the player confirms READY again); a single role is not taken away', () => {
    let s = lobby([['h', 'commander'], ['b', 'engineer'], ['c', 'science']]);
    expect(err(s, { type: 'assignRole', playerId: 'b', target: 'c', role: 'comms', give: true })).toMatch(/хост/);
    s = apply(s, { type: 'assignRole', playerId: 'h', target: 'c', role: 'comms', give: true });
    expect(rolesOf(P(s, 'c'))).toEqual(['science', 'comms']);
    expect(P(s, 'c').ready).toBe(false);
    expect(err(s, { type: 'assignRole', playerId: 'h', target: 'b', role: 'commander', give: true })).toMatch(/занята/);
    expect(err(s, { type: 'assignRole', playerId: 'h', target: 'b', role: 'engineer', give: false })).toMatch(/сам/);
    // The host may move an extra role from a two-role player to another one.
    s = apply(s, { type: 'assignRole', playerId: 'h', target: 'b', role: 'comms', give: true });
    expect(rolesOf(P(s, 'b'))).toEqual(['engineer', 'comms']);
    expect(rolesOf(P(s, 'c'))).toEqual(['science']);
    // A player drops his own extra role.
    s = apply(s, { type: 'assignRole', playerId: 'b', target: 'b', role: 'comms', give: false });
    expect(rolesOf(P(s, 'b'))).toEqual(['engineer']);
    s = apply(s, { type: 'setReady', playerId: 'b', ready: true }, { type: 'setReady', playerId: 'c', ready: true }, { type: 'goStage', playerId: 'h', stage: 'briefing' });
    expect(err(s, { type: 'assignRole', playerId: 'h', target: 'b', role: 'comms', give: false })).toMatch(/в лобби/);
  });

  it('a newcomer takes the extra role of a player holding two — but not a single role', () => {
    let s = lobby([['h', 'commander'], ['b', 'engineer']]);
    s = apply(s, { type: 'assignRole', playerId: 'h', target: 'b', role: 'science', give: true }, { type: 'assignRole', playerId: 'h', target: 'h', role: 'comms', give: true });
    s = apply(s, { type: 'join', playerId: 'n', name: 'N' });
    expect(err(s, { type: 'pickRole', playerId: 'n', role: 'engineer' })).toBeUndefined(); // b holds two → may give one
    s = apply(s, { type: 'pickRole', playerId: 'n', role: 'science' });
    expect(rolesOf(P(s, 'n'))).toEqual(['science']);
    expect(rolesOf(P(s, 'b'))).toEqual(['engineer']);
    expect(P(s, 'b').ready).toBe(false);
    expect(err(s, { type: 'pickRole', playerId: 'n', role: 'engineer' })).toMatch(/занята/); // b has one role now
  });

  it('a two-role player: both roles answer the crisis, radio and commands of both roles, both panels', () => {
    let s = inBuild(lobby([['h', 'commander'], ['e', 'engineer'], ['s', 'science']]));
    expect(rolesOf(P(s, 'h'))).toEqual(['commander', 'comms']);
    s = install(s, 'h', OVER);
    s = apply(s, { type: 'submitReview', playerId: 'h' }, { type: 'approve', playerId: 'h' }, { type: 'launchDone', playerId: 'h' });
    s = apply(s, { type: 'radio', playerId: 'h', phrase: 'com_antenna' });
    expect(s.log.at(-1)).toMatchObject({ kind: 'radio', by: 'h', role: 'comms' });
    expect(err(s, { type: 'radio', playerId: 'h', phrase: 'eng_aux' })).toMatch(/другой роли/);
    while (s.flight!.crisis?.kind !== 'power_drop') s = apply(s, { type: 'tick', playerId: 'h' });
    const c = s.flight!.crisis!;
    // h answers for the commander (and comms, if it has options); e for the engineer.
    for (const [id, role] of [['h', 'commander'], ['h', 'comms'], ['e', 'engineer'], ['s', 'science']] as [string, RoleId][]) {
      const o = c.options.find((x) => x.role === role);
      if (o) s = apply(s, { type: 'crisisChoice', playerId: id, optionId: o.id });
    }
    expect(s.flight!.crisis).toBeNull();
    expect(panelFor('comms', s.flight!, s.build).comms).toBeDefined();
    expect(panelFor('commander', s.flight!, s.build).command).toBeDefined();
    expect(err(s, { type: 'command', playerId: 'h', cmd: 'antenna_search' })).not.toMatch(/другой роли/);
  });

  it('the crisis waits for every role of a present two-role player', () => {
    let s = inBuild(lobby([['h', 'commander'], ['e', 'engineer']])); // e: engineer + comms
    s = install(s, 'h', OVER);
    s = apply(s, { type: 'submitReview', playerId: 'h' }, { type: 'approve', playerId: 'h' }, { type: 'launchDone', playerId: 'h' });
    while (s.flight!.crisis?.kind !== 'power_drop') s = apply(s, { type: 'tick', playerId: 'h' });
    const c = s.flight!.crisis!;
    expect(rolesOf(P(s, 'h'))).toEqual(['commander', 'science']);
    const pick = (role: RoleId) => c.options.find((o) => o.role === role)!.id;
    // Power Drop has options for all four roles: each player answers for both of his.
    s = apply(s, { type: 'crisisChoice', playerId: 'h', optionId: pick('commander') }, { type: 'crisisChoice', playerId: 'e', optionId: pick('engineer') }, { type: 'crisisChoice', playerId: 'h', optionId: pick('science') });
    expect(s.flight!.crisis).not.toBeNull(); // still waiting for e as comms
    s = apply(s, { type: 'crisisChoice', playerId: 'e', optionId: pick('comms') });
    expect(s.flight!.crisis).toBeNull();
  });

  it('reconnect keeps every role; an old state without role lists still works', () => {
    let s = inBuild(lobby([['h', 'commander'], ['e', 'engineer']]));
    s = apply(s, { type: 'presence', playerId: 'h', target: 'e', online: false });
    s = apply(s, { type: 'join', playerId: 'e', name: 'E' });
    expect(rolesOf(P(s, 'e'))).toEqual(['engineer', 'comms']);
    expect(P(s, 'e').online).toBe(true);
    s = apply(s, { type: 'addComponent', playerId: 'e', id: 'transceiver' });
    expect(s.build.transceiver).toBe(1);
    // A state saved before 0013 (no roles / requests fields) is normalised by the reducer.
    const old = structuredClone(lobby(FOUR)) as RoomState;
    for (const p of old.players) delete p.roles;
    delete old.requests;
    const r = apply(old, { type: 'goStage', playerId: 'h', stage: 'build' }, { type: 'addComponent', playerId: 'e', id: 'atmo_sensor' });
    expect(r.requests).toHaveLength(1);
    expect(rolesOf(r.players[1])).toEqual(['engineer']);
  });
});
