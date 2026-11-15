import { describe, expect, it } from 'vitest';
import { createRoom, startFlight, type RoomState } from '../../engine';
import { audibility, layersFor, snapshotOf, soundEvents, type AudioSnapshot } from '../events';

const base: AudioSnapshot = {
  code: 'ABCD', stage: 'flight', mission: 'titan', modules: 8, decisions: 1, lastDecision: 'approve',
  crisisId: null, crisisKind: null, lastCrisisResolved: null, radio: 0, radioEmergency: false,
  signal: 'ok', phase: 'survey', route: 'flying', storm: false, drive: null, capsule: null, sampling: null, sealed: false, outcome: null,
};
const s = (p: Partial<AudioSnapshot>): AudioSnapshot => ({ ...base, ...p });

describe('soundEvents', () => {
  it('stays silent on the first state, a room change or no change', () => {
    expect(soundEvents(null, s({ crisisId: 'c1' }))).toEqual([]);
    expect(soundEvents(s({}), s({ code: 'ZZZZ', crisisId: 'c1' }))).toEqual([]);
    expect(soundEvents(s({}), s({}))).toEqual([]);
  });

  it('buzzes once when a crisis starts, not on every tick of it', () => {
    expect(soundEvents(s({}), s({ crisisId: 'c1', crisisKind: 'power_drop' }))).toEqual(['crisis']);
    expect(soundEvents(s({ crisisId: 'c1' }), s({ crisisId: 'c1' }))).toEqual([]);
    expect(soundEvents(s({ crisisId: 'c1' }), s({ crisisId: 'c2' }))).toEqual(['crisis']);
  });

  it('crisis end: soft chime when solved, neutral tone otherwise', () => {
    expect(soundEvents(s({ crisisId: 'c1' }), s({ lastCrisisResolved: true }))).toEqual(['crisis-resolved']);
    expect(soundEvents(s({ crisisId: 'c1' }), s({ lastCrisisResolved: false }))).toEqual(['crisis-closed']);
  });

  it('radio: blip on delivery, double blip for an emergency phrase', () => {
    expect(soundEvents(s({}), s({ radio: 1 }))).toEqual(['radio']);
    expect(soundEvents(s({ radio: 1 }), s({ radio: 2, radioEmergency: true }))).toEqual(['radio-sos']);
  });

  it('signal lost / back', () => {
    expect(soundEvents(s({}), s({ signal: 'lost' }))).toEqual(['signal-lost']);
    expect(soundEvents(s({ signal: 'lost' }), s({ signal: 'delay' }))).toEqual(['signal-back']);
    expect(soundEvents(s({ signal: 'ok' }), s({ signal: 'interference' }))).toEqual([]);
  });

  it('constructor and review: install, remove, approve, veto', () => {
    const b = s({ stage: 'build', signal: null, phase: null, route: null });
    expect(soundEvents(b, { ...b, modules: 9 })).toEqual(['install']);
    expect(soundEvents(b, { ...b, modules: 7 })).toEqual(['remove']);
    const r = { ...b, stage: 'review' as const };
    expect(soundEvents(r, { ...r, decisions: 2, lastDecision: 'veto' })).toEqual(['veto']);
    expect(soundEvents(r, { ...r, stage: 'launch', decisions: 2, lastDecision: 'approve' })).toEqual(['approve', 'launch']);
  });

  it('asteroid: sampling, sealing and the capsule stages', () => {
    const a = s({ mission: 'asteroid', phase: 'sampling', sampling: 'reach', capsule: 'stowed' });
    expect(soundEvents(a, { ...a, sampling: 'grab' })).toEqual(['grab']);
    expect(soundEvents(a, { ...a, sampling: 'jam' })).toEqual(['jam']);
    expect(soundEvents(a, { ...a, sealed: true })).toEqual(['seal']);
    const r = { ...a, phase: 'return', sampling: 'stowed' as const };
    expect(soundEvents(r, { ...r, capsule: 'separated' })).toEqual(['capsule-sep']);
    expect(soundEvents({ ...r, capsule: 'entry' }, { ...r, capsule: 'chute' })).toEqual(['chute']);
    expect(soundEvents({ ...r, capsule: 'chute' }, { ...r, capsule: 'landed' })).toEqual(['touchdown']);
    expect(soundEvents({ ...r, capsule: 'landed' }, { ...r, capsule: 'found' })).toEqual(['beacon']);
    expect(soundEvents({ ...r, capsule: 'landed' }, { ...r, capsule: 'lost' })).toEqual([]);
  });

  it('report: one chord per outcome, picked by the outcome', () => {
    const f = s({});
    for (const o of ['perfect', 'success', 'partial', 'failed'] as const) {
      expect(soundEvents(f, s({ stage: 'report', signal: null, outcome: o }))).toEqual([`outcome-${o}`]);
    }
    expect(soundEvents(s({ stage: 'report', outcome: 'failed' }), s({ stage: 'report', outcome: 'failed' }))).toEqual([]);
  });
});

describe('layersFor', () => {
  it('HQ hum outside the flight, launch sequence during the launch', () => {
    expect(layersFor(null).ambience).toBe('hq');
    expect(layersFor(s({ stage: 'build' })).ambience).toBe('hq');
    expect(layersFor(s({ stage: 'launch' }))).toMatchObject({ ambience: 'earth', launch: true });
  });

  it('Titan: space in cruise, wind + rain on Titan, heavier rain in a storm, rotor only while flying', () => {
    expect(layersFor(s({ phase: 'cruise' })).ambience).toBe('space');
    expect(layersFor(s({ phase: 'entry' }))).toMatchObject({ ambience: 'titan', rotor: 0 });
    expect(layersFor(s({}))).toMatchObject({ ambience: 'titan', rotor: 1, rain: 0.35 });
    expect(layersFor(s({ storm: true })).rain).toBe(1);
    expect(layersFor(s({ route: 'landed' })).rotor).toBe(0);
  });

  it('signal noise: full when lost, half on interference', () => {
    expect(layersFor(s({ signal: 'lost' })).static).toBe(1);
    expect(layersFor(s({ signal: 'interference' })).static).toBe(0.5);
    expect(layersFor(s({ signal: 'delay' })).static).toBe(0);
  });

  it('Asteroid: drive hum in cruise, thrusters near the rock, re-entry rumble, Earth after landing', () => {
    const a = s({ mission: 'asteroid', drive: 'ion', capsule: 'stowed' });
    expect(layersFor({ ...a, phase: 'cruise' })).toMatchObject({ ambience: 'space', drive: 'ion', thrusters: false });
    expect(layersFor({ ...a, phase: 'approach' })).toMatchObject({ drive: null, thrusters: true });
    expect(layersFor({ ...a, phase: 'return', capsule: 'entry' })).toMatchObject({ reentry: 1, drive: null });
    expect(layersFor({ ...a, phase: 'return', capsule: 'found' }).ambience).toBe('earth');
  });
});

describe('audibility', () => {
  it('local mode: only the focused tab; online: any visible tab', () => {
    expect(audibility('local', false, true)).toEqual({ ambience: false, sfx: false });
    expect(audibility('local', true, true)).toEqual({ ambience: true, sfx: true });
    expect(audibility(null, false, true).ambience).toBe(false);
    expect(audibility('online', false, true)).toEqual({ ambience: true, sfx: true });
    expect(audibility('online', true, false).ambience).toBe(false);
  });
});

describe('snapshotOf', () => {
  it('reads a real room', () => {
    const room = createRoom('ABCD', { id: 'p1', name: 'A' }, 1, true, 0);
    expect(snapshotOf(room)).toMatchObject({ code: 'ABCD', stage: 'lobby', crisisId: null, signal: null, outcome: null });
    const flying: RoomState = { ...room, stage: 'flight', flight: startFlight('titan', room.build) };
    expect(snapshotOf(flying)).toMatchObject({ stage: 'flight', phase: 'cruise', signal: flying.flight!.signal, radio: 0 });
    expect(snapshotOf(null)).toBeNull();
  });
});
