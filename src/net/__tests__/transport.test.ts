import { describe, expect, it } from 'vitest';
import { createRoom, reduce, type RoomState } from '../../engine';
import { SAVE_EVERY, shouldSave } from '../transport';

const bump = (s: RoomState, n = 1): RoomState => ({ ...s, version: s.version + n });

describe('room persistence cadence', () => {
  it('saves the first state, every SAVE_EVERY versions and on player / stage / host changes', () => {
    const s0 = createRoom('ABCDEF', { id: 'h', name: 'H' }, 1);
    expect(shouldSave(null, s0)).toBe(true);
    expect(shouldSave(s0, bump(s0))).toBe(false);
    expect(shouldSave(s0, bump(s0, SAVE_EVERY))).toBe(true);
    const joined = reduce(s0, { type: 'join', playerId: 'b', name: 'B' }).state;
    expect(shouldSave(s0, joined)).toBe(true);
    const role = reduce(joined, { type: 'pickRole', playerId: 'b', role: 'comms' }).state;
    expect(shouldSave(joined, role)).toBe(true);
    expect(shouldSave(s0, { ...bump(s0), hostId: 'b' })).toBe(true);
    expect(shouldSave(s0, { ...bump(s0), stage: 'build' })).toBe(true);
  });
});
