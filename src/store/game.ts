// Client store. The host applies actions with the engine reducer and publishes state;
// other clients send actions and render whatever state arrives (decision 0004).
// Presence, reconnect and host migration: docs/04 Tech/Multiplayer.md.
import { create } from 'zustand';
import {
  createRoom, electHost, exportAgency, newAgency, HOST_TIMEOUT_MS, makeCode, MISSIONS, reduce, RECONNECT_MS, TICK_SECONDS,
  type Action, type Agency, type MissionId, type RoomState,
} from '../engine';
import { makeTransport, shouldSave, type NetMessage, type Transport } from '../net';
import { after, every, type TimerHandle } from '../net/clock';
import { claimPlayerId, saveName, savedName, savedRoom, saveRoom } from './identity';
import { t } from '../i18n';

/**
 * Dev builds only (`pnpm dev`): `?dev=1` in the URL opens every mission in a new room without spending MC,
 * so models of later missions can be checked in the constructor. `import.meta.env.DEV` is false in `pnpm build`.
 * `?dev=1&unlock=0` keeps the dev speed-up but plays the real economy (ТЗ test E: the asteroid is really locked).
 * A dev-unlocked room is a sandbox: its agency is neither loaded from nor saved to localStorage.
 */
const DEV_PARAMS = import.meta.env.DEV && typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const DEV_MODE = DEV_PARAMS?.get('dev') === '1';
const DEV_UNLOCK = DEV_MODE && DEV_PARAMS?.get('unlock') !== '0';
/**
 * Dev builds only: `?dev=1&speed=10` runs the flight clock N× faster so a whole Titan flight can be played in a minute.
 * While a crisis is open, the signal is lost or the asteroid site is being chosen the clock runs at normal speed, so those screens can still be played.
 * The constant folds to 1 in `pnpm build` (import.meta.env.DEV is false).
 */
export const DEV_SPEED = DEV_MODE ? Math.max(1, Math.min(50, Number(DEV_PARAMS?.get('speed')) || 1)) : 1;

/** How long a joining client waits for the room's state before giving up. */
const JOIN_WAIT_MS = 3000;
/** How long a (re)joining client listens for peers' latest state before deciding it is the host. */
const SYNC_WAIT_MS = 1200;
/** A fresh connection hasn't heard everyone yet: the host marks nobody offline during this grace. */
const PRESENCE_GRACE_MS = 4000;

/**
 * Agency (MC, unlocks, upgrades, damage, history) lives in the host's localStorage (Economy.md «Хранение»;
 * the Supabase `agency` table is P1). The host writes it whenever it changes and loads it into each new room it creates
 * (one save per browser = the team that played last here). A reloaded room keeps its own agency in the room save.
 */
const AGENCY_KEY = 'sm:agency';
export function savedAgency(): string | null {
  try { return localStorage.getItem(AGENCY_KEY); } catch { return null; }
}
function saveAgency(a: Agency, before: Agency | undefined) {
  const text = exportAgency(a);
  if (text === lastAgency || (before && exportAgency(before) === text)) return;
  lastAgency = text;
  try { localStorage.setItem(AGENCY_KEY, text); } catch { /* storage blocked */ }
}
/** Dev/tests: forget the saved agency (next room starts at 0 MC). */
export function clearSavedAgency() {
  lastAgency = '';
  try { localStorage.removeItem(AGENCY_KEY); } catch { /* storage blocked */ }
}
/** Last agency this tab wrote (the reducer clones the state every tick: compare the text, write only on change). */
let lastAgency = '';

/** Rooms saved before M3 have no agency: screens read room.agency, so fill it from the old mirrors (as the reducer does). */
function withAgency(r: RoomState): RoomState {
  if (r.agency) return r;
  return { ...r, agency: { ...newAgency(), credits: Math.max(0, r.credits ?? 0), unlocked: [...new Set<MissionId>(['titan', ...(r.unlocked ?? [])])] } };
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type MyAction = DistributiveOmit<Action, 'playerId'>;

interface GameStore {
  /** id is '' until this tab has claimed its player id (identity.ts). */
  me: { id: string; name: string };
  room: RoomState | null;
  transport: Transport | null;
  /** Everyone connected to the room channel right now (transport presence), me included. */
  online: string[];
  /** Non-host clients: since when the host has been missing from presence (ms), else null. */
  hostMissingSince: number | null;
  error: string | null;
  connecting: boolean;
  setName(name: string): void;
  create(opts?: { demo?: boolean }): Promise<void>;
  join(code: string): Promise<void>;
  leave(): void;
  dispatch(a: MyAction): void;
  clearError(): void;
}

let tickTimer: TimerHandle | null = null;
let watchdog: TimerHandle | null = null;
/** Last state the host persisted (shouldSave compares against it). */
let lastSaved: RoomState | null = null;
/** When this tab opened its room channel (presence grace). */
let openedAt = 0;

/** Newer = higher version; on a tie (two clients claimed host at once) the host with the lower joinOrder wins. */
function isNewer(a: RoomState, b: RoomState): boolean {
  if (a.version !== b.version) return a.version > b.version;
  if (a.hostId === b.hostId) return false;
  const order = (s: RoomState) => s.players.find((p) => p.id === s.hostId)?.joinOrder ?? 99;
  return order(a) < order(b);
}

export const useGame = create<GameStore>((set, get) => {
  const isHost = () => !!get().room && get().room!.hostId === get().me.id;

  /** Host: publish + persist a new state. */
  const publish = (next: RoomState) => {
    const { transport } = get();
    const prev = get().room;
    set({ room: next });
    transport?.send({ t: 'state', s: next });
    // Only a real change of this room's agency is written (MC earned / spent, unlock, upgrade, prep): a host that
    // merely (re)publishes — a new room, a reload, a host hand-over — must not overwrite another team's save.
    if (!DEV_UNLOCK && prev?.code === next.code && next.agency && prev.agency !== next.agency && next.hostId === get().me.id) saveAgency(next.agency, prev.agency);
    if (transport && shouldSave(lastSaved, next)) { transport.save(next); lastSaved = next; }
    syncTicker();
  };

  /** Host only: apply an action, publish and persist. */
  const hostApply = (a: Action) => {
    const { room, transport } = get();
    if (!room || !transport) return;
    const r = reduce(room, a, Date.now());
    if (r.error) {
      if (a.playerId === get().me.id) set({ error: r.error });
      else transport.send({ t: 'error', to: a.playerId, msg: r.error });
      return;
    }
    if (r.state === room) return; // no-op (e.g. presence unchanged)
    publish(r.state);
  };

  /** Host runs the flight clock (one `tick` per TICK_SECONDS; dev speed-up outside crises). Moves with the host. */
  const syncTicker = () => {
    const flying = isHost() && get().room?.stage === 'flight';
    if (flying && !tickTimer) {
      // Real time while the team has to act: a crisis, no signal, or the asteroid site choice (science role).
      const delay = () => {
        const f = get().room?.flight;
        const choosing = !!f?.asteroid && !f.asteroid.site && MISSIONS.asteroid.phases[f.phaseIndex]?.id === 'site';
        return (TICK_SECONDS * 1000) / (f?.crisis || f?.signal === 'lost' || choosing ? 1 : DEV_SPEED);
      };
      const step = () => {
        tickTimer = null;
        if (!(isHost() && get().room?.stage === 'flight')) return;
        tickTimer = after(delay(), step);
        hostApply({ type: 'tick', playerId: get().me.id });
      };
      tickTimer = after(delay(), step);
    }
    if (!flying && tickTimer) { tickTimer.clear(); tickTimer = null; }
  };

  /** Become host on my last known state (host migration, or the host coming back to an empty room). */
  const becomeHost = (base: RoomState) => {
    const me = get().me.id;
    let s = base;
    if (s.hostId !== me) {
      const r = reduce(s, { type: 'claimHost', playerId: me }, Date.now());
      if (r.error) { set({ error: r.error }); return; }
      s = r.state;
    }
    lastSaved = null;
    publish(s);
    set({ hostMissingSince: null });
    hostApply({ type: 'join', playerId: me, name: get().me.name });
    reconcilePresence();
    // The previous host may have died during the launch cutscene: finish the launch here.
    if (get().room?.stage === 'launch') after(1500, () => { if (isHost() && get().room?.stage === 'launch') hostApply({ type: 'launchDone', playerId: me }); });
  };

  /** Host: make room.players[].online follow transport presence; free lobby slots after RECONNECT_MS. */
  const reconcilePresence = () => {
    const { room, online, me } = get();
    if (!room || !isHost()) return;
    const set_ = new Set(online);
    const settled = Date.now() - openedAt >= PRESENCE_GRACE_MS;
    for (const p of room.players) {
      if (p.id === me.id) continue;
      if (!settled && p.online) continue; // not heard yet ≠ gone
      if (set_.has(p.id) !== p.online) hostApply({ type: 'presence', playerId: me.id, target: p.id, online: set_.has(p.id) });
    }
    const now = Date.now();
    for (const p of get().room?.players ?? []) {
      if (!p.online && get().room?.stage === 'lobby' && p.offlineAt && now - p.offlineAt >= RECONNECT_MS) {
        hostApply({ type: 'dropPlayer', playerId: me.id, target: p.id });
      }
    }
  };

  /** Every second: host reconciles presence; others watch for a silent host and elect a new one. */
  const watch = () => {
    const { room, online, me, hostMissingSince } = get();
    if (!room) return;
    if (isHost()) { reconcilePresence(); return; }
    const on = new Set(online);
    if (on.has(room.hostId)) { if (hostMissingSince !== null) set({ hostMissingSince: null }); return; }
    const since = hostMissingSince ?? Date.now();
    if (hostMissingSince === null) set({ hostMissingSince: since });
    if (Date.now() - since >= HOST_TIMEOUT_MS && room.players.some((p) => p.id === me.id) && electHost(room, on) === me.id) becomeHost(room);
  };

  const onPresence = (online: string[]) => {
    set({ online });
    watch();
  };

  const onMessage = (m: NetMessage) => {
    const { room, transport, me, online } = get();
    switch (m.t) {
      case 'hello':
        // The host answers. Clients answer when the host is absent, or when the asker IS the host
        // (it reloaded and its saved copy may be a few versions behind their last broadcast).
        if (room && m.from !== me.id && (isHost() || m.from === room.hostId || !online.includes(room.hostId))) transport?.send({ t: 'state', s: room });
        break;
      case 'action':
        if (isHost()) hostApply(m.a);
        break;
      case 'state':
        if (room && m.s.code !== room.code) break;
        if (!room || isNewer(m.s, room)) {
          set({ room: withAgency(m.s) });
          if (m.s.hostId !== me.id) lastSaved = null;
          syncTicker();
        }
        break;
      case 'error':
        if (m.to === me.id) set({ error: m.msg });
        break;
    }
  };

  const startWatch = () => { watchdog?.clear(); watchdog = every(1000, watch); };
  const stopAll = () => {
    watchdog?.clear(); watchdog = null;
    tickTimer?.clear(); tickTimer = null;
    lastSaved = null;
  };
  const fail = (msg: string) => {
    get().transport?.close();
    stopAll();
    set({ error: msg, connecting: false, transport: null, room: null, online: [], hostMissingSince: null });
  };

  const store: GameStore = {
    me: { id: '', name: '' },
    room: null,
    transport: null,
    online: [],
    hostMissingSince: null,
    error: null,
    connecting: false,

    setName(name) {
      const { me } = get();
      if (me.id) saveName(me.id, name);
      set({ me: { ...me, name } });
    },

    async create(opts) {
      const { me } = get();
      if (!me.id) return;
      const transport = makeTransport();
      const code = makeCode(Math.random);
      set({ connecting: true });
      try {
        openedAt = Date.now();
        await transport.open(code, me.id, { onMessage, onPresence });
        // Read the saved agency BEFORE the first publish (which would save the fresh room's 0 MC over it).
        const stored = DEV_UNLOCK ? null : savedAgency();
        let room = createRoom(code, { id: me.id, name: me.name.trim() || t('store.hostName') }, Math.floor(Math.random() * 1e9), !!opts?.demo, Date.now());
        if (DEV_UNLOCK) room = { ...room, unlocked: Object.keys(MISSIONS) as MissionId[], agency: { ...room.agency, unlocked: Object.keys(MISSIONS) as MissionId[] } };
        set({ transport, connecting: false, hostMissingSince: null });
        lastSaved = null;
        publish(room);
        // Carry the team's MC / unlocks / upgrades over from the last room this browser hosted.
        if (stored) hostApply({ type: 'loadAgency', playerId: me.id, agency: stored });
        saveRoom(me.id, code);
        startWatch();
      } catch (e) {
        fail(t('store.createFail', { err: (e as Error).message }));
      }
    },

    async join(rawCode) {
      const { me } = get();
      if (!me.id) return;
      const code = rawCode.trim().toUpperCase();
      const transport = makeTransport();
      set({ connecting: true, room: null, online: [], hostMissingSince: null });
      try {
        openedAt = Date.now();
        await transport.open(code, me.id, { onMessage, onPresence });
        set({ transport });
        // Who has the latest state? The saved copy, the host, or (host away) any client.
        const saved = await transport.load(code);
        transport.send({ t: 'hello', from: me.id });
        await new Promise((r) => setTimeout(r, SYNC_WAIT_MS));
        if (get().transport !== transport) return; // left meanwhile
        let best = get().room;
        if (saved && saved.code === code && (!best || isNewer(saved, best))) best = withAgency(saved);
        const iAmIn = !!best?.players.some((p) => p.id === me.id);
        const hostHere = !!best && get().online.includes(best.hostId) && best.hostId !== me.id;

        if (best && iAmIn && !hostHere && (best.hostId === me.id || get().online.length === 1)) {
          // I was the host (reload), or nobody else is here: carry on as host on the latest state.
          set({ room: best, connecting: false });
          becomeHost(best);
        } else {
          if (best && iAmIn) set({ room: best }); // a returning player sees the room at once
          transport.send({ t: 'action', a: { type: 'join', playerId: me.id, name: me.name.trim() || t('store.playerName') } });
          const t0 = Date.now();
          while (Date.now() - t0 < JOIN_WAIT_MS) {
            await new Promise((r) => setTimeout(r, 100));
            if (get().transport !== transport) return;
            if (get().error && !get().room?.players.some((p) => p.id === me.id)) { fail(get().error!); return; }
            const r = get().room;
            if (r?.players.some((p) => p.id === me.id && p.online)) break;
          }
          if (!get().room?.players.some((p) => p.id === me.id)) { fail(t('store.notFound', { code })); return; }
          set({ connecting: false });
        }
        saveRoom(me.id, code);
        startWatch();
      } catch (e) {
        fail(t('store.joinFail', { err: (e as Error).message }));
      }
    },

    leave() {
      const { transport, me, room } = get();
      if (room) get().dispatch({ type: 'leave' });
      transport?.close();
      stopAll();
      saveRoom(me.id, null);
      set({ room: null, transport: null, online: [], hostMissingSince: null, connecting: false });
    },

    dispatch(partial) {
      const a = { ...partial, playerId: get().me.id } as Action;
      if (isHost()) hostApply(a);
      else get().transport?.send({ t: 'action', a });
    },

    clearError() { set({ error: null }); },
  };

  // Claim this tab's player id, then go back into the room it was in (reload / returning player).
  if (typeof window !== 'undefined') {
    void claimPlayerId().then((id) => {
      set({ me: { id, name: savedName(id) } });
      const code = savedRoom(id);
      if (code) void get().join(code).then(() => { if (!get().room) saveRoom(id, null); });
    });
  }

  return store;
});

/** Convenience selectors. */
export const useMe = () => {
  const room = useGame((s) => s.room);
  const id = useGame((s) => s.me.id);
  return room?.players.find((p) => p.id === id) ?? null;
};

/** Dev builds only: the store on window for quick manual checks in the browser console. */
if (import.meta.env.DEV && typeof window !== 'undefined') Object.assign(window as object, { __sm: useGame, __smClearAgency: clearSavedAgency });

/**
 * Dev only: a hot update of the store (or of the engine under it) would start a second store in the same tab,
 * with its own channel and timers, while the old one still holds this tab's player-id lock. Reload instead:
 * the tab comes back with the same playerId and rejoins its room on its own.
 */
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
