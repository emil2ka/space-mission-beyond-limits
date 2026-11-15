// M2: Autonomy Planner rules (save + fire in flight), Tactical Radio delay in a blackout, ground commands with the
// signal delay, and TZ acceptance test D (blackout asymmetry) point by point.
import { describe, expect, it } from 'vitest';
import { createRoom, reduce, type Action, type RoomState } from '../room';
import { panelFor } from '../panels';
import { radioDelay, RADIO_PHRASES, signalStates } from '../blackout';
import { ruleText, testRules, validateRules, type AutonomyRule } from '../autonomy';
import { TITAN } from '../data/titan';
import type { FlightState } from '../flight';
import type { Build, RoleId } from '../types';

const H = 'h';
const apply = (s: RoomState, a: Action): RoomState => {
  const r = reduce(s, a);
  if (r.error) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
};
const as = (s: RoomState, role: RoleId) => (s.players[0].role === role ? s : apply(s, { type: 'pickRole', playerId: H, role }));

function roomInBuild(seed = 7): RoomState {
  let s = createRoom('ABCDEF', { id: H, name: 'Host' }, seed, true);
  s = apply(s, { type: 'pickRole', playerId: H, role: 'engineer' });
  s = apply(s, { type: 'setReady', playerId: H, ready: true });
  s = apply(s, { type: 'goStage', playerId: H, stage: 'briefing' });
  return apply(s, { type: 'goStage', playerId: H, stage: 'build' });
}
function install(s: RoomState, build: Build): RoomState {
  for (const [id, n] of Object.entries(build)) for (let i = 0; i < n; i++) s = apply(s, { type: 'addComponent', playerId: H, id });
  return s;
}
function launch(s: RoomState): RoomState {
  s = apply(s, { type: 'submitReview', playerId: H });
  s = apply(as(s, 'commander'), { type: 'approve', playerId: H });
  return apply(s, { type: 'launchDone', playerId: H });
}
const tick = (s: RoomState) => apply(s, { type: 'tick', playerId: H });
function until(s: RoomState, cond: (f: FlightState) => boolean, max = 2000): RoomState {
  for (let i = 0; i < max && s.stage === 'flight' && !cond(s.flight!); i++) s = tick(s);
  return s;
}

const TYPICAL: Build = {
  rtg: 2, battery_hc: 1, power_bus: 2, pdu: 1, rotor_system: 1, flight_computer: 1, imu: 1, atmo_sensor: 1, wide_camera: 1,
  transceiver: 1, antenna_high_gain: 1, thermal_insulation: 1, data_storage: 1,
};
const KEEP: AutonomyRule = { id: 'r-keep', when: [{ kind: 'signal_lost' }], then: 'keep_collecting_store' };
const entryLost = (f: FlightState) => f.signal === 'lost' && f.blackouts.some((b) => b.reason === 'entry' && b.to === -1);

describe('Autonomy Planner — saving rules', () => {
  it('engineer / commander save; others cannot; capacity = Flight Computer; blocks needing a missing module are refused', () => {
    let s = install(roomInBuild(), TYPICAL);
    expect(apply(s, { type: 'setRules', playerId: H, rules: [KEEP] }).rules).toEqual([KEEP]);
    expect(reduce(as(s, 'science'), { type: 'setRules', playerId: H, rules: [KEEP] }).error).toMatch(/инженер или командир/);
    const four = [1, 2, 3, 4].map((i) => ({ ...KEEP, id: `r${i}` }));
    expect(reduce(s, { type: 'setRules', playerId: H, rules: four }).error).toMatch(/4 из 3/);
    const hot: AutonomyRule = { id: 'r-hot', when: [{ kind: 'temp_critical' }], then: 'safe_mode_hot_instrument' };
    expect(reduce(s, { type: 'setRules', playerId: H, rules: [hot] }).error).toMatch(/Temperature Sensor/);
    s = apply(s, { type: 'removeComponent', playerId: H, id: 'flight_computer' });
    expect(reduce(s, { type: 'setRules', playerId: H, rules: [KEEP] }).error).toMatch(/Safe Protocol/);
  });
  it('rules are locked once the build is on review', () => {
    const s = apply(install(roomInBuild(), TYPICAL), { type: 'submitReview', playerId: H });
    expect(reduce(s, { type: 'setRules', playerId: H, rules: [KEEP] }).error).toMatch(/до проверки/);
  });
  it('rule text and the pre-launch test (3 scenarios)', () => {
    const low: AutonomyRule = { id: 'r-low', when: [{ kind: 'signal_lost' }, { kind: 'battery_below', value: 25 }], then: 'shed_secondary' };
    expect(ruleText(low)).toBe('ЕСЛИ Signal = LOST И Battery < 25% → ТО Отключить второстепенные приборы');
    expect(validateRules([low], TYPICAL, 3)).toBeNull();
    const t = testRules([low], TYPICAL, 3);
    expect(t.map((x) => x.id)).toEqual(['lost-low', 'overheat', 'debris']);
    expect(t[0].fired.map((x) => x.ruleId)).toEqual(['r-low']);
    expect(t[1].safe).toBe(true);
  });
});

describe('Autonomy Planner — rules fire in flight', () => {
  it('entry blackout: «Signal = LOST → keep collecting» fires, is logged as «Сработало правило …» and lands in the report', () => {
    let s = launch(apply(install(roomInBuild(), TYPICAL), { type: 'setRules', playerId: H, rules: [KEEP] }));
    s = until(s, entryLost);
    const before = s.flight!.targets.reduce((a, t) => a + t.collected, 0);
    s = tick(tick(tick(s)));
    const f = s.flight!;
    expect(f.signal).toBe('lost');
    expect(f.targets.reduce((a, t) => a + t.collected, 0)).toBeGreaterThan(before); // science goes on into memory
    expect(f.rulesFired[0]).toMatchObject({ ruleId: 'r-keep', where: 'blackout' });
    expect(f.causes.some((c) => c.ref === 'rule:r-keep' && /^Сработало правило 1 «ЕСЛИ Signal = LOST → ТО Продолжить сбор/.test(c.text))).toBe(true);
    s = until(s, () => false);
    expect(s.report!.autonomy.fired.find((x) => x.ruleId === 'r-keep')).toMatchObject({ where: expect.arrayContaining(['потеря связи']) });
  });
  it('without rules the same blackout runs Safe Protocol: science paused, nothing «fired»', () => {
    let s = until(launch(install(roomInBuild(), TYPICAL)), entryLost);
    const before = s.flight!.targets.reduce((a, t) => a + t.collected, 0);
    s = tick(tick(tick(s)));
    expect(s.flight!.targets.reduce((a, t) => a + t.collected, 0)).toBe(before);
    expect(s.flight!.rulesFired).toEqual([]);
    expect(s.flight!.blackouts.at(-1)!.by).toBe('safe');
  });
});

describe('Tactical Radio', () => {
  const flying = () => until(launch(install(roomInBuild(), TYPICAL)), (f) => f.tick >= 5);
  it('a phrase goes to the shared log at once with a link; only your role\'s phrases', () => {
    let s = as(flying(), 'engineer');
    s = apply(s, { type: 'radio', playerId: H, phrase: 'eng_aux' });
    const m = s.flight!.radio.at(-1)!;
    expect(m).toMatchObject({ delivered: true, deliverTick: s.flight!.tick, text: 'ENGINEER: SHUT DOWN AUXILIARY LINE' });
    expect(s.flight!.causes.at(-1)).toMatchObject({ kind: 'radio' });
    expect(reduce(s, { type: 'radio', playerId: H, phrase: 'cmd_hull' }).error).toMatch(/другой роли/);
    expect(RADIO_PHRASES.filter((p) => p.role === 'comms')).toHaveLength(2);
  });
  it('in a blackout normal phrases wait blackoutDelay ticks, emergency ones pass at once', () => {
    let s = as(until(launch(install(roomInBuild(), TYPICAL)), entryLost), 'comms');
    const t0 = s.flight!.tick;
    s = apply(s, { type: 'radio', playerId: H, phrase: 'com_antenna' }); // normal
    s = apply(as(s, 'commander'), { type: 'radio', playerId: H, phrase: 'cmd_hull' }); // emergency
    const [normal, sos] = s.flight!.radio.slice(-2);
    expect(normal).toMatchObject({ delivered: false, deliverTick: t0 + TITAN.radio.blackoutDelay, heldBy: 'blackout' });
    expect(sos).toMatchObject({ delivered: true, emergency: true });
    for (let i = 0; i < TITAN.radio.blackoutDelay; i++) s = tick(s);
    const back = s.flight!.radio.find((m) => m.id === normal.id)!;
    expect(back.delivered).toBe(true);
    expect(s.flight!.causes.some((c) => c.ref === `radio:${normal.id}` && /задержкой 10 с/.test(c.text))).toBe(true);
  });
  it('channel off (no link on board): emergency phrases wait too', () => {
    const f = { signal: 'lost' } as FlightState;
    const sos = RADIO_PHRASES.find((p) => p.emergency)!;
    expect(radioDelay(f, sos, { bandwidth: 0 })).toEqual({ delay: TITAN.radio.blackoutDelay, heldBy: 'channel-off' });
    expect(radioDelay(f, sos, { bandwidth: 4 })).toEqual({ delay: 0 });
  });
});

describe('Ground → craft commands: sent → arrived → confirmed', () => {
  it('a command sent in a blackout waits for the link, then takes delayTicks each way and applies on arrival', () => {
    let s = as(until(launch(install(roomInBuild(), TYPICAL)), entryLost), 'science');
    s = apply(s, { type: 'command', playerId: H, cmd: 'downlink_first', arg: 'atmo_profile' });
    let c = s.flight!.commands.at(-1)!;
    expect(c).toMatchObject({ arriveTick: -1, applied: false });
    s = until(s, (f) => f.signal !== 'lost');
    const back = s.flight!.tick;
    s = until(s, (f) => f.commands.at(-1)!.acked);
    c = s.flight!.commands.at(-1)!;
    expect(c.arriveTick).toBe(back + s.flight!.delayTicks);
    expect(c.ackTick).toBe(c.arriveTick + s.flight!.delayTicks);
    expect(s.flight!.downlinkFirst).toBe('atmo_profile');
  });
  it('commander hold arrives after the delay; comms DSN search shortens a storm blackout but not the entry one', () => {
    let s = as(until(launch(install(roomInBuild(), TYPICAL)), (f) => f.tick >= 5), 'commander');
    s = apply(s, { type: 'command', playerId: H, cmd: 'hold' });
    const sent = s.flight!.tick;
    s = until(s, (f) => f.commands.at(-1)!.applied);
    expect(s.flight!.tick).toBe(sent + s.flight!.delayTicks);
    expect(s.flight!.holdUntil).toBe(s.flight!.tick + TITAN.commands.holdTicks);

    s = as(until(s, entryLost), 'comms');
    expect(reduce(s, { type: 'command', playerId: H, cmd: 'antenna_search' }).error).toMatch(/Плазма/);
    s = until(s, (f) => f.signal === 'lost' && f.blackouts.some((b) => b.reason === 'escalation' && b.to === -1));
    const left = s.flight!.lostUntil - s.flight!.tick;
    s = apply(s, { type: 'command', playerId: H, cmd: 'antenna_search' });
    expect(s.flight!.lostUntil - s.flight!.tick).toBe(left - TITAN.commands.searchGain);
    expect(reduce(s, { type: 'command', playerId: H, cmd: 'antenna_search' }).error).toMatch(/уже идёт/);
  });
});

describe('TZ test D — blackout, point by point', () => {
  it('1) signal lost → 2) roles see different data → 3) radio → 4) comms queue + antenna → 5) engineer diagnostics → 6) commander timer + hull', () => {
    // 1) Loss of signal (entry blackout).
    let s = launch(apply(install(roomInBuild(), TYPICAL), { type: 'setRules', playerId: H, rules: [KEEP] }));
    s = tick(tick(until(s, entryLost)));
    const f = s.flight!;
    expect(signalStates(f).find((x) => x.id === 'lost')!.active).toBe(true);
    expect(signalStates(f).find((x) => x.id === 'delay')!.active).toBe(false);
    const p = Object.fromEntries((['commander', 'engineer', 'science', 'comms'] as RoleId[]).map((r) => [r, panelFor(r, f, s.build)]));
    // 2) Different data per role.
    expect(p.engineer.power && !p.engineer.comms && !p.engineer.science).toBe(true);
    expect(p.science.science && !p.science.power).toBeTruthy();
    expect(p.comms.comms && !p.comms.power).toBeTruthy();
    expect(p.commander.command && !p.commander.power && !p.commander.comms).toBeTruthy();
    expect(new Set(Object.values(p).map((x) => x.items.map((i) => i.id).join())).size).toBe(4);
    // Every role has a concrete action and two radio phrases.
    for (const x of Object.values(p)) { expect(x.actions.length).toBeGreaterThan(0); expect(x.radio.phrases).toHaveLength(2); }
    // 3) Tactical messages are shown (the emergency one passes the blackout).
    s = apply(as(s, 'comms'), { type: 'radio', playerId: H, phrase: 'com_lost' });
    expect(s.flight!.causes.at(-1)).toMatchObject({ kind: 'radio', text: expect.stringContaining('COMMS: SIGNAL LOST') });
    // 4) Comms: NO SIGNAL, noise, antenna direction, packet queue, free memory.
    expect(p.comms.items.find((i) => i.id === 'signal')!.value).toBe('NO SIGNAL');
    expect(p.comms.comms!.noise).toBe(1);
    expect(p.comms.comms!.direction!.text).toMatch(/сложена/);
    expect(p.comms.comms!.packets).toBeGreaterThan(0);
    expect(p.comms.comms!.queue.length).toBeGreaterThan(0);
    expect(p.comms.comms!.memoryFree).toBeGreaterThan(0);
    // 5) Engineer: red lights / overheating / power lines / diagnostics.
    expect(p.engineer.power!.lines.length).toBeGreaterThan(3);
    expect(p.engineer.diagnostics!.length).toBeGreaterThan(0);
    // Science: accumulated data, what is not leaving.
    expect(p.science.alerts.join(' ')).toMatch(/не уходят/);
    // 6) Commander: timer and hull, no technical causes.
    expect(p.commander.command!.blackoutTimer).toEqual({ elapsed: expect.any(Number), expectedLeft: expect.any(Number) });
    expect(p.commander.command!.blackoutTimer!.expectedLeft).toBeLessThanOrEqual(TITAN.entryBlackoutTicks);
    expect(p.commander.command!.hull).toBe(f.hull);
    expect(p.commander.hidden).toContain('crisis-causes');
  });
});
