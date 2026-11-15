// M2 multiplayer rules in the engine: lobby (4 slots, unique roles, READY, host start), demo mode,
// role permissions, presence / Reconnecting, reconnect with the same playerId, host migration.
// The store/transports only move these actions around (docs/04 Tech/Multiplayer.md).
import { describe, expect, it } from 'vitest';
import { createRoom, electHost, reduce, type Action, type RoomState } from '../room';
import type { Build, RoleId } from '../types';

const apply = (s: RoomState, ...acts: Action[]) => acts.reduce((st, a) => {
  const r = reduce(st, a, 1000);
  if (r.error) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}, s);
const err = (s: RoomState, a: Action) => reduce(s, a, 1000).error;

const CREW: [string, RoleId][] = [['h', 'commander'], ['e', 'engineer'], ['s', 'science'], ['c', 'comms']];
const BUILD: Build = {
  rtg: 2, battery_hc: 2, power_bus: 1, pdu: 1, rotor_system: 1, flight_computer: 1, imu: 1, atmo_sensor: 1, wide_camera: 1,
  transceiver: 1, antenna_high_gain: 1, thermal_insulation: 1, data_storage: 1,
};

/** Four separate players in one room, each with a unique role, all READY. */
function fullLobby(): RoomState {
  let s = createRoom('ABCDEF', { id: 'h', name: 'Аля' }, 7);
  for (const [id] of CREW.slice(1)) s = apply(s, { type: 'join', playerId: id, name: id.toUpperCase() });
  for (const [id, role] of CREW) s = apply(s, { type: 'pickRole', playerId: id, role }, { type: 'setReady', playerId: id, ready: true });
  return s;
}
function flying(): RoomState {
  let s = apply(fullLobby(), { type: 'goStage', playerId: 'h', stage: 'build' });
  // 0013 §2: the commander installs any department at once (the engineer would send requests for science / comms).
  for (const [id, n] of Object.entries(BUILD)) for (let i = 0; i < n; i++) s = apply(s, { type: 'addComponent', playerId: 'h', id });
  return apply(s, { type: 'submitReview', playerId: 'e' }, { type: 'approve', playerId: 'h' }, { type: 'launchDone', playerId: 'h' });
}

describe('lobby', () => {
  it('4 slots: a fifth player is refused, the state is untouched', () => {
    const s = fullLobby();
    const r = reduce(s, { type: 'join', playerId: 'x', name: 'X' });
    expect(r.error).toMatch(/уже 4 игрока/);
    expect(r.state).toBe(s);
  });
  it('a role cannot be taken twice; freeing it lets another player take it', () => {
    let s = createRoom('ABCDEF', { id: 'h', name: 'H' }, 1);
    s = apply(s, { type: 'join', playerId: 'b', name: 'B' }, { type: 'pickRole', playerId: 'h', role: 'science' });
    expect(err(s, { type: 'pickRole', playerId: 'b', role: 'science' })).toMatch(/занята/);
    s = apply(s, { type: 'pickRole', playerId: 'h', role: null }, { type: 'pickRole', playerId: 'b', role: 'science' });
    expect(s.players.find((p) => p.id === 'b')!.role).toBe('science');
  });
  it('changing role clears READY; READY needs a role', () => {
    let s = fullLobby();
    expect(err(createRoom('ABCDEF', { id: 'h', name: 'H' }, 1), { type: 'setReady', playerId: 'h', ready: true })).toMatch(/роль/);
    s = apply(s, { type: 'pickRole', playerId: 's', role: null });
    expect(s.players.find((p) => p.id === 's')!.ready).toBe(false);
  });
  it('the host starts only with 4 READY online players; only the host picks mission / starts', () => {
    const s = fullLobby();
    expect(err(s, { type: 'goStage', playerId: 'e', stage: 'briefing' })).toMatch(/хост/);
    expect(err(s, { type: 'selectMission', playerId: 'e', mission: 'titan' })).toMatch(/хост/);
    const notReady = apply(s, { type: 'setReady', playerId: 'c', ready: false });
    expect(err(notReady, { type: 'goStage', playerId: 'h', stage: 'briefing' })).toMatch(/готовы/);
    const away = apply(s, { type: 'presence', playerId: 'h', target: 'c', online: false });
    expect(err(away, { type: 'goStage', playerId: 'h', stage: 'briefing' })).toMatch(/в сети/);
    expect(apply(s, { type: 'goStage', playerId: 'h', stage: 'briefing' }).stage).toBe('briefing');
  });
  it('strangers cannot act in the room', () => {
    expect(err(fullLobby(), { type: 'addComponent', playerId: 'zz', id: 'rtg' })).toMatch(/не в этой комнате/);
  });
  it('nobody new can join after the start, but a known player can come back', () => {
    let s = createRoom('ABCDEF', { id: 'h', name: 'H' }, 1, true);
    s = apply(s, { type: 'join', playerId: 'e', name: 'E' }, { type: 'pickRole', playerId: 'h', role: 'commander' }, { type: 'setReady', playerId: 'h', ready: true },
      { type: 'pickRole', playerId: 'e', role: 'engineer' }, { type: 'setReady', playerId: 'e', ready: true }, { type: 'goStage', playerId: 'h', stage: 'build' },
      { type: 'presence', playerId: 'h', target: 'e', online: false });
    expect(err(s, { type: 'join', playerId: 'x', name: 'X' })).toMatch(/началась/);
    expect(apply(s, { type: 'join', playerId: 'e', name: 'E' }).players).toHaveLength(2);
  });
});

describe('demo mode', () => {
  it('is a host toggle in the lobby only; lets fewer than 4 start', () => {
    let s = createRoom('ABCDEF', { id: 'h', name: 'H' }, 1);
    s = apply(s, { type: 'join', playerId: 'b', name: 'B' });
    expect(err(s, { type: 'setDemo', playerId: 'b', demo: true })).toMatch(/хост/);
    s = apply(s, { type: 'setDemo', playerId: 'h', demo: true });
    s = apply(s, { type: 'pickRole', playerId: 'h', role: 'commander' }, { type: 'setReady', playerId: 'h', ready: true },
      { type: 'pickRole', playerId: 'b', role: 'engineer' }, { type: 'setReady', playerId: 'b', ready: true },
      { type: 'goStage', playerId: 'h', stage: 'build' });
    expect(s.stage).toBe('build');
    expect(err(s, { type: 'setDemo', playerId: 'h', demo: false })).toMatch(/лобби/);
  });
  it('only demo lets a player switch roles after the lobby (still never a held role)', () => {
    const full = apply(fullLobby(), { type: 'goStage', playerId: 'h', stage: 'build' });
    expect(err(full, { type: 'pickRole', playerId: 'e', role: null })).toMatch(/только в лобби/);
    let d = createRoom('ABCDEF', { id: 'h', name: 'H' }, 1, true);
    d = apply(d, { type: 'join', playerId: 'b', name: 'B' }, { type: 'pickRole', playerId: 'b', role: 'engineer' }, { type: 'setReady', playerId: 'b', ready: true },
      { type: 'pickRole', playerId: 'h', role: 'commander' }, { type: 'setReady', playerId: 'h', ready: true }, { type: 'goStage', playerId: 'h', stage: 'build' });
    d = apply(d, { type: 'pickRole', playerId: 'h', role: 'science' });
    expect(d.players[0].role).toBe('science');
    expect(err(d, { type: 'pickRole', playerId: 'h', role: 'engineer' })).toMatch(/занята/);
  });
});

describe('role permissions', () => {
  it('commander approves / vetoes; others get a clear error and the state stays', () => {
    let s = apply(fullLobby(), { type: 'goStage', playerId: 'h', stage: 'build' });
    // 0013 §2: the commander installs any department at once (the engineer would send requests for science / comms).
    for (const [id, n] of Object.entries(BUILD)) for (let i = 0; i < n; i++) s = apply(s, { type: 'addComponent', playerId: 'h', id });
    s = apply(s, { type: 'submitReview', playerId: 's' });
    for (const id of ['e', 's', 'c']) {
      const r = reduce(s, { type: 'approve', playerId: id });
      expect(r.error).toMatch(/только командир/);
      expect(r.state).toBe(s);
      expect(err(s, { type: 'veto', playerId: id, text: 'нет' })).toMatch(/командира/);
    }
    expect(apply(s, { type: 'veto', playerId: 'h', text: 'Мало батарей' }).stage).toBe('build');
    expect(apply(s, { type: 'approve', playerId: 'h' }).stage).toBe('launch');
  });
  it('host-only: launch end, ticks, presence, dropping a slot', () => {
    const s = flying();
    expect(err(s, { type: 'tick', playerId: 'e' })).toMatch(/хост/);
    expect(err(s, { type: 'presence', playerId: 'e', target: 'c', online: false })).toMatch(/хост/);
    expect(err(fullLobby(), { type: 'dropPlayer', playerId: 'e', target: 'c' })).toMatch(/хост/);
  });
  it('only the science officer picks the measurement mode', () => {
    const s = flying();
    const wp = s.flight!.waypoints.at(-1)!.id;
    for (const id of ['h', 'e', 'c']) {
      const r = reduce(s, { type: 'scienceMode', playerId: id, waypoint: wp, mode: 'precise' });
      expect(r.error).toMatch(/научный специалист/);
      expect(r.state).toBe(s);
    }
    expect(apply(s, { type: 'scienceMode', playerId: 's', waypoint: wp, mode: 'precise' }).flight!.waypoints.at(-1)!.mode).toBe('precise');
  });
  it('a crisis option belongs to its role', () => {
    let s = flying();
    while (s.stage === 'flight' && !s.flight!.crisis) s = apply(s, { type: 'tick', playerId: 'h' });
    const c = s.flight!.crisis!;
    expect(c).toBeTruthy();
    const commanderOpt = c.options.find((o) => o.role === 'commander')!;
    expect(err(s, { type: 'crisisChoice', playerId: 'e', optionId: commanderOpt.id })).toMatch(/другой роли/);
  });
  it('mission unlock is the commander\'s or the host\'s call', () => {
    expect(err(fullLobby(), { type: 'unlockMission', playerId: 'e', mission: 'asteroid' })).toMatch(/командир или хост/);
  });
});

describe('presence and reconnect', () => {
  it('offline → Reconnecting timestamp; coming back with the same playerId keeps role and build', () => {
    let s = apply(fullLobby(), { type: 'goStage', playerId: 'h', stage: 'build' }, { type: 'addComponent', playerId: 'e', id: 'rtg' });
    s = apply(s, { type: 'presence', playerId: 'h', target: 'e', online: false });
    const e = s.players.find((p) => p.id === 'e')!;
    expect(e.online).toBe(false);
    expect(e.offlineAt).toBe(1000);
    expect(e.role).toBe('engineer');
    s = apply(s, { type: 'join', playerId: 'e', name: 'E' });
    const back = s.players.find((p) => p.id === 'e')!;
    expect(back).toMatchObject({ online: true, offlineAt: null, role: 'engineer', joinOrder: 1 });
    expect(s.build.rtg).toBe(1);
    expect(s.log.some((l) => /снова в комнате/.test(l.text))).toBe(true);
  });
  it('repeated presence is a no-op (no version bump, nothing to broadcast)', () => {
    const s = fullLobby();
    expect(reduce(s, { type: 'presence', playerId: 'h', target: 'e', online: true }).state).toBe(s);
  });
  it('in the lobby a player who did not come back loses the slot (host drops it); in game the slot is kept', () => {
    let s = apply(fullLobby(), { type: 'presence', playerId: 'h', target: 'c', online: false });
    expect(s.players.find((p) => p.id === 'c')!.ready).toBe(false);
    expect(err(fullLobby(), { type: 'dropPlayer', playerId: 'h', target: 'c' })).toMatch(/в сети/);
    s = apply(s, { type: 'dropPlayer', playerId: 'h', target: 'c' });
    expect(s.players.map((p) => p.id)).toEqual(['h', 'e', 's']);
    const g = apply(flying(), { type: 'presence', playerId: 'h', target: 'c', online: false });
    expect(err(g, { type: 'dropPlayer', playerId: 'h', target: 'c' })).toMatch(/сохраняется/);
  });
  it('a crisis waits only for present roles: when a player drops out, the others\' choices close it', () => {
    let s = flying();
    while (s.stage === 'flight' && !s.flight!.crisis) s = apply(s, { type: 'tick', playerId: 'h' });
    const c = s.flight!.crisis!;
    const roles = [...new Set(c.options.map((o) => o.role))];
    const absent = CREW.find(([, r]) => r === roles.at(-1))!;
    for (const [id, role] of CREW) {
      if (id === absent[0]) continue;
      const o = c.options.find((x) => x.role === role);
      if (o) s = apply(s, { type: 'crisisChoice', playerId: id, optionId: o.id });
    }
    expect(s.flight!.crisis).not.toBeNull(); // still waiting for the last role
    s = apply(s, { type: 'presence', playerId: 'h', target: absent[0], online: false });
    expect(s.flight!.crisis).toBeNull();
    expect(s.flight!.history.at(-1)!.by).toBe('team');
  });
});

describe('host migration', () => {
  it('electHost: the current host while online, else the online player with the lowest joinOrder', () => {
    const s = fullLobby();
    expect(electHost(s, new Set(['h', 'e', 's', 'c']))).toBe('h');
    expect(electHost(s, new Set(['s', 'c', 'e']))).toBe('e');
    expect(electHost(s, new Set(['c', 's']))).toBe('s');
    expect(electHost(s, new Set())).toBeNull();
  });
  it('claimHost moves the host on the last broadcast state; the flight goes on from there', () => {
    let s = flying();
    for (let i = 0; i < 5; i++) s = apply(s, { type: 'tick', playerId: 'h' });
    const tick = s.flight!.tick;
    s = apply(s, { type: 'claimHost', playerId: 'e' });
    expect(s.hostId).toBe('e');
    expect(s.players.find((p) => p.id === 'h')!.online).toBe(false);
    expect(err(s, { type: 'tick', playerId: 'h' })).toMatch(/хост/); // the old host can't tick any more
    s = apply(s, { type: 'tick', playerId: 'e' });
    expect(s.flight!.tick).toBe(tick + 1);
    // The old host comes back as an ordinary player with its role.
    s = apply(s, { type: 'join', playerId: 'h', name: 'Аля' });
    expect(s.hostId).toBe('e');
    expect(s.players.find((p) => p.id === 'h')).toMatchObject({ online: true, role: 'commander' });
  });
  it('the host leaving the lobby hands the room to the next player', () => {
    const s = apply(fullLobby(), { type: 'leave', playerId: 'h' });
    expect(s.hostId).toBe('e');
    expect(s.players).toHaveLength(3);
  });
});
