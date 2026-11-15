import { describe, expect, it } from 'vitest';
import { createRoom, reduce, type RoomState } from '../room';
import { evaluateRules, findConflicts, ruleProblem, type AutonomyRule } from '../autonomy';
import { startFlight, stepFlight } from '../flight';

const apply = (s: RoomState, ...acts: Parameters<typeof reduce>[1][]) => acts.reduce((st, a) => {
  const r = reduce(st, a);
  if (r.error) throw new Error(r.error);
  return r.state;
}, s);

describe('room', () => {
  it('a role cannot be taken twice', () => {
    let s = createRoom('ABCDEF', { id: 'h', name: 'Host' }, 1);
    s = apply(s, { type: 'join', playerId: 'b', name: 'B' }, { type: 'pickRole', playerId: 'h', role: 'commander' });
    expect(reduce(s, { type: 'pickRole', playerId: 'b', role: 'commander' }).error).toMatch(/занята/);
  });
  it('needs 2 ready players unless demo (0013 §4: 2–4 players)', () => {
    let s = createRoom('ABCDEF', { id: 'h', name: 'Host' }, 1);
    s = apply(s, { type: 'pickRole', playerId: 'h', role: 'commander' }, { type: 'setReady', playerId: 'h', ready: true });
    expect(reduce(s, { type: 'goStage', playerId: 'h', stage: 'briefing' }).error).toMatch(/2 игрока/);
    const d = createRoom('ABCDEF', { id: 'h', name: 'Host' }, 1, true);
    const d2 = apply(d, { type: 'pickRole', playerId: 'h', role: 'commander' }, { type: 'setReady', playerId: 'h', ready: true }, { type: 'goStage', playerId: 'h', stage: 'briefing' });
    expect(d2.stage).toBe('briefing');
  });
  it('approving against a critical warning is recorded', () => {
    let s = createRoom('ABCDEF', { id: 'h', name: 'Host' }, 1, true);
    s = apply(s, { type: 'pickRole', playerId: 'h', role: 'commander' }, { type: 'approve', playerId: 'h' });
    expect(s.decisions[0].kind).toBe('approve-against-warning');
    s = apply(s, { type: 'addComponent', playerId: 'h', id: 'rtg' });
    expect(s.decisions).toEqual([]); // change invalidates approval
  });
  it('mission unlock needs credits and never goes negative', () => {
    const s = createRoom('ABCDEF', { id: 'h', name: 'Host' }, 1);
    expect(reduce(s, { type: 'unlockMission', playerId: 'h', mission: 'asteroid' }).error).toMatch(/Не хватает 150 MC/);
  });
});

describe('autonomy', () => {
  const rules: AutonomyRule[] = [
    { id: 'r1', when: [{ kind: 'signal_lost' }, { kind: 'battery_below', value: 25 }], then: 'shed_secondary' },
    { id: 'r2', when: [{ kind: 'signal_lost' }], then: 'keep_collecting_store' },
  ];
  const t = { signal: 'lost' as const, batteryPct: 10, thermal: 'nominal' as const, hullPct: 100, bufferPct: 0, sampleSecured: false, debris: false };
  it('fires matching rules in order, limited by flight computer slots', () => {
    const build = { battery_hc: 1, data_storage: 1 };
    expect(evaluateRules(rules, t, build, 3).map((f) => f.ruleId)).toEqual(['r1', 'r2']);
    expect(evaluateRules(rules, t, build, 1).map((f) => f.ruleId)).toEqual(['r1']);
  });
  it('explains missing equipment and finds conflicts', () => {
    expect(ruleProblem(rules[1], {})).toMatch(/требует/);
    expect(findConflicts(rules)).toEqual([['r1', 'r2']]);
  });
});

describe('flight skeleton', () => {
  it('runs a Titan flight to the end deterministically', () => {
    const build = { rtg: 2, battery_hc: 2, power_bus: 2, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_high_gain: 1, atmo_sensor: 1, wide_camera: 1 };
    let f = startFlight('titan', build);
    let g = startFlight('titan', build);
    for (let i = 0; i < 1000 && !f.done; i++) { f = stepFlight(f, build, 42); g = stepFlight(g, build, 42); }
    expect(f.done).toBe(true);
    expect(f.dataSent).toBeGreaterThan(0);
    expect(f).toEqual(g);
  });
  it('a weak power build sheds instruments and logs the cause', () => {
    const build = { rtg: 1, battery_hc: 1, power_bus: 2, rotor_system: 1, spectrometer: 1, hires_camera: 1, transceiver: 1, antenna_standard: 1 };
    let f = startFlight('titan', build);
    for (let i = 0; i < 200; i++) f = stepFlight(f, build, 1);
    expect(f.causes.some((c) => c.kind === 'shed')).toBe(true);
  });
});
