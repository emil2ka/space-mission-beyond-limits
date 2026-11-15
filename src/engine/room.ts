// Room state + reducer. Runs on the host (decision 0004). Pure and deterministic.
import { CODE_ALPHABET, MAX_PLAYERS } from './constants';
import { MISSIONS } from './data/missions';
import { addComponent, canAdd, computeStats, removeComponent } from './stats';
import { validateRulesMsg, type AutonomyRule } from './autonomy';
import { PHRASE_BY_ID, sendCommand, sendRadio, type CommandKind } from './blackout';
import { setScienceMode, startFlight, stepFlight, type FlightState, type ScienceMode, type WaypointId } from './flight';
import { chooseOption, resolveCrisis, rolesWithOptions } from './crises';
import { readiness } from './readiness';
import { buildReport, type MissionReport } from './report';
import { chooseSite } from './asteroid';
import { applyPrep, buyUpgrade, importAgency, newAgency, recordFlight, unlockMission, type Agency } from './economy';
import { STARTER_BUILD } from './data/economy';
import type { AsteroidSiteId } from './data/asteroid';
import type { Build, Department, Issue, MissionId, RoleId, UpgradeId } from './types';
import { ROLE_COMMANDS } from './blackout';
import {
  budgetPlanOf, changeReasons, criticalWarnings, holderOf, keyHolders, keysComplete, normalizeRoles, pendingRequests, rolePlan, rolesOf, setRoles,
  trustEffects, validateSplitMsg, ROLE_SEQ, type BudgetPlan, type BudgetSplit, type BuildRequest, type PendingKey, type TrustChange,
} from './rules';
import { COMPONENT_BY_ID } from './data/components';
import { flightTasks, isolateNode, reaimAntenna, submitTask, taskCtx, taskRolesOf, tasksReady, type AnyAnswer, type TasksState } from './tasks';
import { join, m, ru, type Msg } from './msg';

export type Stage = 'lobby' | 'briefing' | 'build' | 'tasks' | 'review' | 'launch' | 'flight' | 'report';

export interface Player {
  id: string;
  name: string;
  /** The player's own role (= roles[0]); kept for M1/M2 screens. */
  role: RoleId | null;
  /** Every role the player holds (2–3 players: free roles are handed out, 0013 §4). Missing in old states. */
  roles?: RoleId[];
  ready: boolean;
  online: boolean;
  joinOrder: number;
  /** When the player went offline (ms). The UI shows «Reconnecting» for RECONNECT_MS after it. */
  offlineAt?: number | null;
}

/** Others see «Reconnecting» this long; in the lobby the slot is freed after it. */
export const RECONNECT_MS = 30_000;
/** Host silent this long → the online player with the lowest joinOrder takes over. */
export const HOST_TIMEOUT_MS = 10_000;

/** Who should be host now: the current host if online, else the online player with the lowest joinOrder. */
export function electHost(s: Pick<RoomState, 'hostId' | 'players'>, online: ReadonlySet<string>): string | null {
  if (online.has(s.hostId)) return s.hostId;
  return [...s.players].filter((p) => online.has(p.id)).sort((x, y) => x.joinOrder - y.joinOrder)[0]?.id ?? null;
}

/** Roles that must answer the open crisis: roles held by online players (every role in demo). */
function crisisRolesNeeded(s: RoomState): RoleId[] {
  const c = s.flight?.crisis;
  if (!c) return [];
  const held = new Set(s.players.filter((p) => p.online).flatMap(rolesOf));
  return rolesWithOptions(c).filter((role) => s.demo || held.has(role));
}

/** Close the crisis once every present role has chosen (also re-checked when someone drops out). */
function maybeResolveCrisis(s: RoomState) {
  const c = s.flight?.crisis;
  if (!c) return;
  const needed = crisisRolesNeeded(s);
  if (needed.length && needed.every((role) => c.chosen[role])) resolveCrisis(s.flight!, s.build, statsOf(s), s.rules);
}

/** Craft stats with the agency's upgrades (what the flight uses). */
export function statsOf(s: Pick<RoomState, 'build' | 'mission' | 'agency'>) {
  return computeStats(s.build, MISSIONS[s.mission], s.agency);
}

export interface LogEntry {
  at: number; // ms timestamp or tick
  kind: 'system' | 'build' | 'decision' | 'radio' | 'crisis' | 'warning';
  by?: string; // player id
  /** Role the player acted as (a player may hold several, 0013 §4). */
  role?: RoleId;
  text: string;
  /** The same line as a message for the UI language (`text` stays Russian). Missing for language-neutral lines (`+1 id`). */
  i18n?: { text: Msg };
}

export interface Decision {
  /** request-* = the commander on a build request (0013 §2); key-denied = an owner refused the second key (§3). */
  kind: 'approve' | 'veto' | 'approve-against-warning' | 'request-approve' | 'request-veto' | 'key-denied';
  issueIds: string[];
  by: string;
  text: string;
  /** Engine-made text as a message (a commander's own veto text has none). */
  i18n?: { text: Msg };
  /** request-*: the request. */
  requestId?: string;
  /** approve-against-warning under «Под наблюдением»: players who turned the second key. */
  keys?: string[];
}

export interface RoomState {
  version: number;
  code: string;
  hostId: string;
  seed: number;
  /** Local demo mode: fewer than 4 players allowed, clearly labelled in the UI. */
  demo: boolean;
  stage: Stage;
  players: Player[];
  mission: MissionId;
  build: Build;
  rules: AutonomyRule[];
  decisions: Decision[];
  teamTrust: number;
  /** Mirror of agency.credits (kept for M1/M2 screens; read-only — the agency is the source of truth). */
  credits: number;
  /** Mirror of agency.unlocked (read-only). */
  unlocked: MissionId[];
  /** M3: the team's meta-progress across attempts (MC, unlocks, upgrades, damage, history). */
  agency: Agency;
  log: LogEntry[];
  flight: FlightState | null;
  /** Every commander decision of this attempt (decisions[] is reset when the build changes; this is not). */
  decisionLog: Decision[];
  /** Filled when the flight ends. */
  report: MissionReport | null;
  /** 0013 §2: build requests of this attempt (pending ones wait for the commander). Missing in old states. */
  requests?: BuildRequest[];
  /** 0013 §2: the commander's budget split across departments (null = the mission default). */
  budgetSplit?: BudgetPlan | null;
  /** 0013 §3: an approval against critical warnings waiting for the owners' second key. */
  pendingKey?: PendingKey | null;
  /** 0013 §3: every Team Trust change with its reason (last ones, across attempts). */
  trustHistory?: TrustChange[];
  /** Index in `log` where this attempt started (per-player contribution counts only this attempt). */
  attemptLogFrom?: number;
  /** Individual Tasks (screen 10, src/engine/tasks.ts): each role's result. Missing until the team opens the task screen. */
  tasks?: TasksState | null;
}

export type Action =
  | { type: 'join'; playerId: string; name: string }
  | { type: 'leave'; playerId: string }
  /** Host only: the transport saw `target` come online / go offline. */
  | { type: 'presence'; playerId: string; target: string; online: boolean }
  /** Host only: free the lobby slot of a player who stayed offline for RECONNECT_MS. */
  | { type: 'dropPlayer'; playerId: string; target: string }
  /** The host went silent for HOST_TIMEOUT_MS: the elected player (electHost) takes over on its last state. */
  | { type: 'claimHost'; playerId: string }
  /** Host, lobby only: demo mode (fewer than 4 players, one player may switch roles). */
  | { type: 'setDemo'; playerId: string; demo: boolean }
  /** Lobby: my role (replaces mine; a role of someone holding two can be taken from him). Outside the lobby: demo only. */
  | { type: 'pickRole'; playerId: string; role: RoleId | null }
  /** Lobby, 0013 §4: the host gives a free role to a player (or takes an extra one back); a player may drop his own extra role. */
  | { type: 'assignRole'; playerId: string; target: string; role: RoleId; give: boolean }
  /** Commander, build: split the module budget across departments (%, steps of 5, sum 100). */
  | { type: 'setBudgetSplit'; playerId: string; split: BudgetSplit }
  /** Commander: approve or veto (with a reason) a build request. */
  | { type: 'resolveRequest'; playerId: string; requestId: string; approve: boolean; reason?: string }
  /** The requester (or the commander) withdraws a pending request. */
  | { type: 'cancelRequest'; playerId: string; requestId: string }
  /** «Под наблюдением»: an owner turns (or refuses, with a reason) the second key of a pending approval. */
  | { type: 'secondKey'; playerId: string; give: boolean; reason?: string }
  | { type: 'setReady'; playerId: string; ready: boolean }
  | { type: 'selectMission'; playerId: string; mission: MissionId }
  | { type: 'unlockMission'; playerId: string; mission: MissionId }
  | { type: 'goStage'; playerId: string; stage: Stage }
  | { type: 'addComponent'; playerId: string; id: string }
  | { type: 'removeComponent'; playerId: string; id: string }
  | { type: 'setRules'; playerId: string; rules: AutonomyRule[] }
  /** build → review (anyone). */
  | { type: 'submitReview'; playerId: string }
  /** Commander. In review: blockers forbid it; warnings are recorded as approve-against-warning; review → launch. */
  | { type: 'approve'; playerId: string }
  /** Commander. In review: back to build with a reason. */
  | { type: 'veto'; playerId: string; text: string }
  /** Host client, when the launch animation ends: launch → flight. */
  | { type: 'launchDone'; playerId: string }
  | { type: 'crisisChoice'; playerId: string; optionId: string }
  | { type: 'scienceMode'; playerId: string; waypoint: WaypointId; mode: ScienceMode }
  /** Asteroid, science officer: sampling site (approach or site phase). */
  | { type: 'chooseSite'; playerId: string; site: AsteroidSiteId }
  /** Commander or host, outside the flight: buy an agency upgrade (extra_slot takes a department, default science). */
  | { type: 'buyUpgrade'; playerId: string; id: UpgradeId; slot?: Department }
  /** Commander or host, after a flight: pay the preparation shown by prepCosts (or get the free basic repair), then go on. */
  | { type: 'confirmPrep'; playerId: string; insurance: boolean; next?: 'build' | 'lobby' }
  /** Host, lobby: restore the agency saved by exportAgency (B: localStorage of the host). */
  | { type: 'loadAgency'; playerId: string; agency: unknown }
  /** Tactical Radio: a quick phrase id of the player's role (blackout.ts RADIO_PHRASES). */
  | { type: 'radio'; playerId: string; phrase: string }
  /** Ground → craft command of the player's role (blackout.ts ROLE_COMMANDS), delayed by the signal. */
  | { type: 'command'; playerId: string; cmd: CommandKind; arg?: string }
  /** Host-only: advance the flight by one tick. */
  | { type: 'tick'; playerId: string }
  /** Individual Tasks: build → tasks (anyone, like «На проверку»). */
  | { type: 'openTasks'; playerId: string }
  /** Individual Tasks: submit a role's task (answer) or skip it (answer null → «слабо»). Host may skip for an offline player. */
  | { type: 'submitTask'; playerId: string; role: RoleId; answer: AnyAnswer | null }
  /** In flight, Power Drop: the engineer picks the node to isolate on the schematic. */
  | { type: 'isolateNode'; playerId: string; node: string }
  /** In flight, after a blackout: comms re-aims the antenna on the radar. */
  | { type: 'reaimAntenna'; playerId: string; x: number; y: number };

export type ReduceResult = { state: RoomState; error?: string; errorMsg?: Msg };

export function makeCode(rand: () => number): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

export function createRoom(code: string, host: { id: string; name: string }, seed: number, demo = false, now = 0): RoomState {
  return {
    version: 0, code, hostId: host.id, seed, demo, stage: 'lobby',
    players: [{ id: host.id, name: host.name, role: null, roles: [], ready: false, online: true, joinOrder: 0 }],
    mission: 'titan', build: {}, rules: [], decisions: [], teamTrust: 100, credits: 0, unlocked: ['titan'], agency: newAgency(),
    log: [entry(now, 'system', m('room.created', { code }))],
    flight: null, decisionLog: [], report: null,
    requests: [], budgetSplit: null, pendingKey: null, trustHistory: [], attemptLogFrom: 0,
  };
}

/** A log line: plain text (language-neutral) or a message (Russian `text` + `i18n.text`). */
type LogText = string | Msg;
type LogFn = (kind: LogEntry['kind'], text: LogText, role?: RoleId) => void;
function entry(at: number, kind: LogEntry['kind'], text: LogText, extra: { by?: string; role?: RoleId } = {}, ruText?: string): LogEntry {
  const e: LogEntry = { at, kind, ...(extra.by !== undefined ? { by: extra.by } : {}), ...(extra.role ? { role: extra.role } : {}), text: ruText ?? (typeof text === 'string' ? text : ru(text)) };
  if (typeof text !== 'string') e.i18n = { text };
  return e;
}
/** Text + message of a string-or-message param. */
const ruOf = (x: Msg | string) => (typeof x === 'string' ? x : ru(x));
/** Message another module may attach to its object (`o.i18n[field]`), if any. */
const i18nOf = (o: unknown, field: string): Msg | undefined => (o as { i18n?: Record<string, Msg | undefined> } | null | undefined)?.i18n?.[field];
/** Error of a module result: its message (`errorMsg`) when it has one, else the Russian text. */
const errOf = (r: { error?: string }): Msg | string => (r as { errorMsg?: Msg }).errorMsg ?? r.error!;
const roleMsg = (r: RoleId) => m(`role.${r}`);
const whatMsg = (kind: 'add' | 'remove', id: string) => m(kind === 'add' ? 'room.whatAdd' : 'room.whatRemove', { name: compName(id) });

/** Stages where the build can't change. */
const LOCKED: Stage[] = ['review', 'launch', 'flight', 'report'];

function beginFlight(s: RoomState) {
  s.flight = startFlight(s.mission, s.build, { teamTrust: s.teamTrust, mods: s.agency, tasks: flightTasks(s.tasks, taskCtx(s)) });
  s.report = null;
}

/** Pay the preparation (or the free basic repair → starter craft). Returns an error text or null. */
function doPrep(s: RoomState, insurance: boolean, log: LogFn): Msg | string | null {
  const r = applyPrep(s.agency, insurance);
  if (r.error) return errOf(r);
  s.agency = r.agency;
  if (r.basicRepair) {
    s.build = structuredClone(STARTER_BUILD[s.mission]);
    s.decisions = [];
    log('system', m('room.basicRepair'));
  } else log('system', m('room.prep', { n: r.charged, ins: insurance ? m('room.prepInsured') : '', balance: s.agency.credits }));
  return null;
}

/** M1/M2 screens read room.credits / room.unlocked: keep them equal to the agency. */
function syncAgency(s: RoomState) {
  s.credits = s.agency.credits;
  s.unlocked = [...s.agency.unlocked];
}

const fail = (state: RoomState, error: Msg | string): ReduceResult => (typeof error === 'string' ? { state, error } : { state, error: ru(error), errorMsg: error });

const compName = (id: string) => COMPONENT_BY_ID[id]?.name ?? id;
/** Fewest players for a real (non-demo) team game (0013 §4: 2, 3 or 4). */
export const MIN_PLAYERS = 2;
const playerName = (s: RoomState, id: string) => s.players.find((p) => p.id === id)?.name ?? '?';

/** The build is leaving the constructor: pending requests and a pending second key lapse (logged). */
function lapsePending(s: RoomState, now: number, why: Msg) {
  for (const r of s.requests ?? []) {
    if (r.status !== 'pending') continue;
    r.status = 'cancelled'; r.note = ru(why); r.i18n = { note: why }; r.resolvedAt = now;
  }
  s.pendingKey = null;
}

/** Leaving the report starts a new attempt: its decisions and requests must not leak into the next report / Team Trust. */
function newAttempt(s: RoomState) {
  s.decisionLog = []; s.decisions = [];
  s.requests = []; s.pendingKey = null;
  s.attemptLogFrom = s.log.length;
}

/**
 * Record the commander's approval (0013 §3: with the second keys, if any). Review → launch.
 * `accepted` = warnings accepted (empty = clean approval).
 */
function commitApproval(s: RoomState, by: string, stage: 'build' | 'review', accepted: { ids: string[]; text: string; msg?: Msg }, keys: string[] | undefined,
  log: LogFn) {
  const d: Decision = accepted.ids.length
    ? { kind: 'approve-against-warning', issueIds: accepted.ids, by, text: accepted.text, ...(keys?.length ? { keys } : {}), ...(accepted.msg ? { i18n: { text: accepted.msg } } : {}) }
    : { kind: 'approve', issueIds: [], by, text: ru(m('room.dec.approved')), i18n: { text: m('room.dec.approved') } };
  s.decisions.push(d);
  s.decisionLog.push(d);
  s.pendingKey = null;
  const withKeys = keys?.length ? m('room.withKeys', { names: keys.map((id) => playerName(s, id)).join(', ') }) : '';
  const text = d.i18n?.text ?? d.text;
  if (d.kind === 'approve') log('decision', m('room.approved'));
  else if (stage === 'review') log('decision', m('room.approvedRisk', { text, keys: withKeys }));
  else log('decision', m('room.approvedAgainst', { text, keys: withKeys }));
  if (stage === 'review') s.stage = 'launch';
}

export function reduce(state: RoomState, a: Action, now = 0): ReduceResult {
  const s: RoomState = structuredClone(state);
  // States saved before M3 have no agency: build it from the old fields.
  if (!s.agency) s.agency = { ...newAgency(), credits: Math.max(0, s.credits ?? 0), unlocked: [...new Set<MissionId>(['titan', ...(s.unlocked ?? [])])] };
  // States saved before 0013 have no roles lists / requests.
  normalizeRoles(s);
  s.requests ??= [];
  const me = s.players.find((p) => p.id === a.playerId);
  const isHost = a.playerId === s.hostId;
  /** Every role this player holds (0013 §4: owner rights of all of them). */
  const mine = rolesOf(me);
  const has = (r: RoleId) => mine.includes(r);
  const log: LogFn = (kind, text, role) => { s.log.push(entry(now, kind, text, { by: a.playerId, role })); };
  /** A line another module worded: keep its Russian text, attach its message if it has one. */
  const logRaw = (kind: LogEntry['kind'], text: string, msg: Msg | undefined, role?: RoleId) => { s.log.push(entry(now, kind, msg ?? text, { by: a.playerId, role }, text)); };
  const done = (): ReduceResult => { syncAgency(s); return { state: { ...s, version: state.version + 1 } }; };
  /** Nothing changed: same object back, no version bump, nothing to broadcast. */
  const same = (): ReduceResult => ({ state });

  // Only members act (join is how you become one). The error leaves the state untouched.
  if (!me && a.type !== 'join') return fail(state, m('room.err.notMember'));

  switch (a.type) {
    case 'join': {
      const name = a.name?.trim().slice(0, 20) || 'Игрок';
      if (me) {
        const back = !me.online;
        me.online = true; me.offlineAt = null; me.name = name;
        if (back) log('system', m('room.back', { name: me.name }));
        return done();
      }
      if (s.players.length >= MAX_PLAYERS) return fail(state, m('room.err.full'));
      if (s.stage !== 'lobby') return fail(state, m('room.err.started'));
      const joinOrder = Math.max(-1, ...s.players.map((p) => p.joinOrder)) + 1;
      s.players.push({ id: a.playerId, name, role: null, roles: [], ready: false, online: true, joinOrder, offlineAt: null });
      log('system', m('room.joined', { name }));
      return done();
    }
    case 'leave': {
      if (s.stage === 'lobby') s.players = s.players.filter((p) => p.id !== a.playerId);
      else { me!.online = false; me!.offlineAt = now; me!.ready = false; }
      if (isHost) {
        const online = new Set(s.players.filter((p) => p.online && p.id !== a.playerId).map((p) => p.id));
        s.hostId = electHost({ hostId: '', players: s.players }, online) ?? s.hostId;
      }
      log('system', m('room.left', { name: me!.name }));
      maybeResolveCrisis(s);
      return done();
    }
    case 'presence': {
      if (!isHost) return fail(state, m('room.err.presenceHost'));
      const p = s.players.find((x) => x.id === a.target);
      if (!p) return fail(state, m('room.err.noPlayer'));
      if (p.online === a.online) return same();
      p.online = a.online;
      p.offlineAt = a.online ? null : now;
      if (!a.online && s.stage === 'lobby') p.ready = false;
      log('system', m(a.online ? 'room.online' : 'room.offline', { name: p.name }));
      if (!a.online) maybeResolveCrisis(s);
      return done();
    }
    case 'dropPlayer': {
      if (!isHost) return fail(state, m('room.err.dropHost'));
      const p = s.players.find((x) => x.id === a.target);
      if (!p) return same();
      if (s.stage !== 'lobby') return fail(state, m('room.err.dropInGame'));
      if (p.online) return fail(state, m('room.err.playerOnline'));
      s.players = s.players.filter((x) => x.id !== a.target);
      log('system', m('room.dropped', { name: p.name }));
      return done();
    }
    case 'claimHost': {
      if (isHost) return same();
      const old = s.players.find((p) => p.id === s.hostId);
      if (old) { old.online = false; old.offlineAt ??= now; if (s.stage === 'lobby') old.ready = false; }
      s.hostId = a.playerId;
      me!.online = true; me!.offlineAt = null;
      log('system', m('room.newHost', { name: me!.name }));
      maybeResolveCrisis(s);
      return done();
    }
    case 'setDemo': {
      if (!isHost) return fail(state, m('room.err.demoHost'));
      if (s.stage !== 'lobby') return fail(state, m('room.err.demoLobby'));
      if (s.demo === a.demo) return same();
      s.demo = a.demo;
      log('system', m(a.demo ? 'room.demoOn' : 'room.demoOff'));
      return done();
    }
    case 'pickRole': {
      // Outside the lobby a role is fixed. Only demo mode lets one player switch roles (ТЗ §2).
      if (s.stage !== 'lobby' && !s.demo) return fail(state, m('room.err.roleLobby'));
      const holder = a.role ? holderOf(s.players, a.role) : undefined;
      // 0013 §4: a newcomer may take the extra role of a player holding two (lobby only); a single role stays his.
      if (holder && holder.id !== me!.id && (s.stage !== 'lobby' || rolesOf(holder).length < 2)) return fail(state, m('room.err.roleTaken'));
      if (a.role ? mine.length === 1 && mine[0] === a.role : mine.length === 0) return same();
      if (holder && holder.id !== me!.id) {
        setRoles(holder, rolesOf(holder).filter((r) => r !== a.role));
        holder.ready = false;
        log('system', m('room.roleTakenFrom', { name: me!.name, role: roleMsg(a.role!), holder: holder.name }));
      }
      setRoles(me!, a.role ? [a.role] : []);
      if (s.stage === 'lobby') me!.ready = false;
      return done();
    }
    case 'assignRole': {
      if (s.stage !== 'lobby') return fail(state, m('room.err.rolesLobby'));
      const t = s.players.find((p) => p.id === a.target);
      if (!t) return fail(state, m('room.err.noPlayer'));
      if (!ROLE_SEQ.includes(a.role)) return fail(state, m('room.err.noRole'));
      const self = t.id === me!.id;
      // The host hands roles out; a player may only drop his own extra role or take a free one for himself.
      if (!isHost && !self) return fail(state, m('room.err.rolesHost'));
      const tRoles = rolesOf(t);
      if (a.give) {
        if (tRoles.includes(a.role)) return same();
        const holder = holderOf(s.players, a.role);
        if (holder && (!isHost || rolesOf(holder).length < 2)) return fail(state, m('room.err.roleBusy', { name: holder.name }));
        if (holder) { setRoles(holder, rolesOf(holder).filter((r) => r !== a.role)); holder.ready = false; }
        setRoles(t, [...tRoles, a.role]);
        log('system', holder ? m('room.roleGiven', { name: t.name, role: roleMsg(a.role), holder: holder.name }) : m('room.roleExtra', { name: t.name, role: roleMsg(a.role) }));
      } else {
        if (!tRoles.includes(a.role)) return same();
        if (!self && tRoles.length < 2) return fail(state, m('room.err.onlyRole'));
        setRoles(t, tRoles.filter((r) => r !== a.role));
        log('system', m('room.roleFree', { name: t.name, role: roleMsg(a.role) }));
      }
      t.ready = false; // a new set of duties: the player confirms READY again
      return done();
    }
    case 'setReady': {
      if (s.stage !== 'lobby') return fail(state, m('room.err.readyLobby'));
      if (a.ready && !me!.role) return fail(state, m('room.err.pickRole'));
      me!.ready = a.ready;
      return done();
    }
    case 'selectMission': {
      if (!isHost) return fail(state, m('room.err.missionHost'));
      if (!s.agency.unlocked.includes(a.mission)) return fail(state, m('room.err.missionLocked'));
      if (s.mission !== a.mission) { s.mission = a.mission; s.build = {}; }
      return done();
    }
    case 'unlockMission': {
      if (!isHost && !has('commander')) return fail(state, m('room.err.unlockWho'));
      if (s.stage === 'flight' || s.stage === 'launch') return fail(state, m('room.err.noSpendInFlight'));
      const r = unlockMission(s.agency, a.mission);
      if (r.error) return fail(state, errOf(r));
      s.agency = r.agency;
      log('system', m('room.unlocked', { mission: MISSIONS[a.mission].name, cost: MISSIONS[a.mission].unlockCost, balance: s.agency.credits }));
      return done();
    }
    case 'buyUpgrade': {
      if (!isHost && !has('commander')) return fail(state, m('room.err.upgradeWho'));
      if (['review', 'launch', 'flight'].includes(s.stage)) return fail(state, m('room.err.upgradeWhen'));
      const r = buyUpgrade(s.agency, a.id, a.slot);
      if (r.error) return fail(state, errOf(r));
      s.agency = r.agency;
      s.decisions = []; // stats changed → the configuration needs approval again
      log('system', m('room.upgradeBought', { id: a.id, balance: s.agency.credits }));
      return done();
    }
    case 'confirmPrep': {
      if (!isHost && !has('commander')) return fail(state, m('room.err.prepWho'));
      if (!s.agency.pendingPrep) return fail(state, m('room.err.prepNotNeeded'));
      const err = doPrep(s, !!a.insurance, log);
      if (err) return fail(state, err);
      if (s.stage === 'report') { newAttempt(s); s.stage = a.next ?? 'build'; }
      return done();
    }
    case 'loadAgency': {
      if (!isHost) return fail(state, m('room.err.agencyHost'));
      if (s.stage !== 'lobby') return fail(state, m('room.err.agencyLobby'));
      const ag = importAgency(a.agency);
      if (!ag) return fail(state, m('room.err.notAgency'));
      s.agency = ag;
      if (!s.agency.unlocked.includes(s.mission)) { s.mission = 'titan'; s.build = {}; }
      log('system', m('room.agencyLoaded', { mc: ag.credits, missions: ag.unlocked.length, upgrades: ag.upgrades.length }));
      return done();
    }
    case 'chooseSite': {
      if (s.stage !== 'flight' || !s.flight) return fail(state, m('room.err.noFlight'));
      if (!has('science')) return fail(state, m('room.err.siteWho'));
      const r = chooseSite(s.flight, a.site);
      if (r.error) return fail(state, errOf(r));
      s.flight = r.flight;
      return done();
    }
    case 'goStage': {
      if (!isHost) return fail(state, m('room.err.stageHost'));
      if (s.stage === 'lobby' && a.stage !== 'lobby') {
        // 0013 §4: a team of 2, 3 or 4; one player = the labelled demo.
        if (s.players.length < MIN_PLAYERS && !s.demo) return fail(state, m('room.err.minPlayers', { n: MIN_PLAYERS }));
        if (!s.players.every((p) => p.online)) return fail(state, m('room.err.notOnline'));
        if (!s.players.every((p) => p.ready)) return fail(state, m('room.err.notReady'));
        // Free roles go to the players with the fewest roles (the default the lobby showed; the host may have set his own).
        if (!s.demo) for (const { role, playerId } of rolePlan(s.players)) {
          const p = s.players.find((x) => x.id === playerId)!;
          setRoles(p, [...rolesOf(p), role]);
          log('system', m('room.roleDefault', { name: p.name, role: roleMsg(role) }));
        }
        s.attemptLogFrom = s.log.length;
      }
      // The build leaves the constructor (not to the review): pending requests lapse.
      if ((s.stage === 'build' || s.stage === 'tasks') && !['build', 'tasks', 'review'].includes(a.stage)) lapsePending(s, now, m('room.note.lapsed'));
      if (a.stage === 'launch' && !s.decisions.some((d) => d.kind !== 'veto')) return fail(state, m('room.err.notApproved'));
      // Leaving the report starts a new attempt: its decisions must not leak into the next report / Team Trust.
      // «Ещё раз» / «В штаб» go through the preparation: the report showed its cost (mc.upkeep); without insurance here.
      if (s.stage === 'report' && a.stage !== 'report') {
        if (s.agency.pendingPrep) { const err = doPrep(s, false, log); if (err) return fail(state, err); }
        newAttempt(s);
      }
      s.stage = a.stage;
      if (a.stage === 'flight') beginFlight(s);
      return done();
    }
    case 'addComponent':
    case 'removeComponent': {
      if (LOCKED.includes(s.stage)) return fail(state, m('room.err.buildLocked'));
      const kind = a.type === 'addComponent' ? 'add' : 'remove';
      if (kind === 'add') {
        const check = canAdd(s.build, a.id, MISSIONS[s.mission], s.agency);
        if (!check.ok) return fail(state, check.i18n?.reason ?? check.reason);
      } else if (!(s.build[a.id] > 0)) return fail(state, m('room.err.notInstalled'));
      // 0013 §2: own department within its share → at once; a foreign department / over the share → a request to the commander.
      const { reasons, owner, overBy } = changeReasons(s, mine, kind, a.id);
      const asRole = owner && has(owner) ? owner : mine[0];
      if (reasons.length) {
        if (pendingRequests(s).some((r) => r.by === a.playerId && r.kind === kind && r.componentId === a.id)) return fail(state, m('room.err.requestWaiting'));
        const req: BuildRequest = {
          id: `rq${state.version + 1}`, kind, componentId: a.id, department: COMPONENT_BY_ID[a.id].department, owner: owner!,
          by: a.playerId, byRole: asRole ?? null, reasons, overBy, status: 'pending', at: now,
        };
        s.requests!.push(req);
        log('build', m('room.request', { name: me!.name, what: whatMsg(kind, a.id), reasons: join(reasons.map((r) => (r === 'foreign' ? m('room.reason.foreign', { role: roleMsg(owner!) }) : m('room.reason.over', { n: overBy }))), ', ') }), asRole);
        return done();
      }
      s.build = kind === 'add' ? addComponent(s.build, a.id) : removeComponent(s.build, a.id);
      s.decisions = []; // configuration changed → needs approval again
      s.pendingKey = null;
      log('build', `${me?.name ?? '?'}: ${kind === 'add' ? '+1' : '−1'} ${a.id}`, asRole);
      return done();
    }
    case 'setBudgetSplit': {
      if (!has('commander')) return fail(state, m('room.err.splitWho'));
      if (s.stage !== 'build') return fail(state, m('room.err.splitWhere'));
      const err = validateSplitMsg(a.split);
      if (err) return fail(state, err);
      const split: BudgetSplit = { engineer: a.split.engineer, science: a.split.science, comms: a.split.comms };
      const cur = budgetPlanOf(s);
      if (cur.set && cur.split.engineer === split.engineer && cur.split.science === split.science && cur.split.comms === split.comms) return same();
      s.budgetSplit = { split, set: true, by: a.playerId };
      log('decision', m('room.split', { e: split.engineer, s: split.science, c: split.comms }), 'commander');
      return done();
    }
    case 'resolveRequest': {
      if (!has('commander')) return fail(state, m('room.err.requestsWho'));
      if (LOCKED.includes(s.stage)) return fail(state, m('room.err.buildLocked'));
      const req = s.requests!.find((r) => r.id === a.requestId);
      if (!req || req.status !== 'pending') return fail(state, m('room.err.requestDone'));
      const who = playerName(s, req.by);
      const what = whatMsg(req.kind, req.componentId);
      if (a.approve) {
        if (req.kind === 'add') {
          const check = canAdd(s.build, req.componentId, MISSIONS[s.mission], s.agency);
          if (!check.ok) return fail(state, m('room.err.cantAdd', { reason: check.i18n?.reason ?? check.reason }));
          s.build = addComponent(s.build, req.componentId);
        } else {
          if (!(s.build[req.componentId] > 0)) return fail(state, m('room.err.alreadyRemoved'));
          s.build = removeComponent(s.build, req.componentId);
        }
        s.decisions = []; s.pendingKey = null;
        req.status = 'approved';
        // The module is credited to the requester (report: who built what).
        s.log.push({ at: now, kind: 'build', by: req.by, ...(req.byRole ? { role: req.byRole } : {}), text: `${who}: ${req.kind === 'add' ? '+1' : '−1'} ${req.componentId}` });
        log('decision', m('room.requestApproved', { who, what }), 'commander');
      } else {
        req.status = 'vetoed';
        const own = a.reason?.trim().slice(0, 200);
        if (own) req.note = own; else { req.note = ru(m('room.note.noReason')); req.i18n = { note: m('room.note.noReason') }; }
        log('decision', m('room.requestVetoed', { who, what, note: req.i18n?.note ?? req.note }), 'commander');
      }
      req.resolvedBy = a.playerId; req.resolvedAt = now;
      const dText = a.approve ? m('room.dec.request', { who, what }) : m('room.dec.requestVeto', { who, what, note: req.i18n?.note ?? req.note ?? '' });
      s.decisionLog.push({ kind: a.approve ? 'request-approve' : 'request-veto', issueIds: [], by: a.playerId, requestId: req.id, text: ru(dText), i18n: { text: dText } });
      return done();
    }
    case 'cancelRequest': {
      const req = s.requests!.find((r) => r.id === a.requestId);
      if (!req || req.status !== 'pending') return fail(state, m('room.err.requestDone'));
      if (req.by !== a.playerId && !has('commander')) return fail(state, m('room.err.cancelWho'));
      const note = m(req.by === a.playerId ? 'room.note.withdrawn' : 'room.note.byCommander');
      req.status = 'cancelled'; req.note = ru(note); req.i18n = { note }; req.resolvedBy = a.playerId; req.resolvedAt = now;
      log('build', m('room.requestCancelled', { name: me!.name, what: whatMsg(req.kind, req.componentId) }));
      return done();
    }
    case 'secondKey': {
      const k = s.pendingKey;
      if (!k) return fail(state, m('room.err.noKey'));
      if (!k.need.includes(a.playerId)) return fail(state, m('room.err.keyWho'));
      if (k.keys.includes(a.playerId)) return same();
      if (!a.give) {
        const own = a.reason?.trim().slice(0, 200);
        const text: Msg | string = own || m('room.note.tooRisky');
        s.decisionLog.push({ kind: 'key-denied', issueIds: k.issueIds, by: a.playerId, text: ruOf(text), ...(typeof text === 'string' ? {} : { i18n: { text } }) });
        s.pendingKey = null;
        log('decision', m('room.keyDenied', { name: me!.name, text }), mine.find((r) => (k.owners as RoleId[]).includes(r)) ?? mine[0]);
        return done();
      }
      k.keys.push(a.playerId);
      log('decision', m('room.keyTurned', { name: me!.name }), mine.find((r) => (k.owners as RoleId[]).includes(r)) ?? mine[0]);
      if (keysComplete(k)) commitApproval(s, k.by, k.stage, { ids: k.issueIds, text: k.text, msg: k.i18n?.text }, [...k.keys], (kind, text) => { s.log.push(entry(now, kind, text, { by: k.by, role: 'commander' })); });
      return done();
    }
    case 'setRules': {
      // Autonomy Planner (Core Loop step 7): engineer or commander, while the build can still change.
      if (!has('engineer') && !has('commander')) return fail(state, m('room.err.rulesWho'));
      if (LOCKED.includes(s.stage)) return fail(state, m('room.err.rulesWhen'));
      const err = validateRulesMsg(a.rules, s.build, statsOf(s).ruleSlots);
      if (err) return fail(state, err);
      s.rules = structuredClone(a.rules);
      log('build', m('room.rulesSaved', { name: me!.name, n: a.rules.length }));
      return done();
    }
    case 'submitReview': {
      if (s.stage !== 'build' && s.stage !== 'tasks') return fail(state, m('room.err.reviewFrom'));
      if (s.stage === 'tasks') { const t = tasksReady(s.tasks, taskCtx(s)); if (!t.ready) return fail(state, m('task.error.notReady', { n: t.waiting.length })); }
      if (!me) return fail(state, m('room.err.noPlayer'));
      const waiting = pendingRequests(s).length;
      if (waiting) return fail(state, m('room.err.requestsFirst', { n: waiting }));
      s.stage = 'review';
      s.decisions = [];
      s.pendingKey = null;
      const r = readiness(s.build, MISSIONS[s.mission], s.agency);
      log('system', m('room.review', { name: me.name, b: r.blockers.length, w: r.warnings.length }));
      return done();
    }
    case 'approve': {
      if (!has('commander')) return fail(state, m('room.err.approveWho'));
      if (['launch', 'flight', 'report'].includes(s.stage)) return fail(state, m('room.err.nothingToApprove'));
      const stage = s.stage === 'review' ? 'review' : 'build';
      let accepted: Issue[];
      if (stage === 'review') {
        const r = readiness(s.build, MISSIONS[s.mission], s.agency);
        if (!r.ok) return fail(state, m('room.err.cantLaunch', { list: join(r.blockers.map((b) => b.i18n?.text ?? b.text), ' ') }));
        accepted = r.warnings;
      } else accepted = statsOf(s).issues.filter((i) => i.severity === 'critical');
      const ids = accepted.map((i) => i.id);
      const text = accepted.map((i) => i.text).join(' ');
      const textMsg = join(accepted.map((i) => i.i18n?.text ?? i.text), ' ');
      // 0013 §3, «Под наблюдением» (Team Trust < 50): accepting a critical warning needs the owner's second key.
      const critical = criticalWarnings(accepted);
      if (critical.length && !s.demo && trustEffects(s.teamTrust).secondKey) {
        if (s.pendingKey) return fail(state, m('room.err.keyWaiting'));
        const holders = keyHolders(s, critical, a.playerId);
        if (holders) {
          s.pendingKey = { issueIds: ids, text, i18n: { text: textMsg }, by: a.playerId, stage, need: holders.need, any: holders.any, owners: holders.owners, keys: [], at: now };
          const names = holders.need.map((id) => playerName(s, id));
          log('decision', m('room.keyNeeded', { trust: s.teamTrust, names: holders.any && names.length ? names.slice(1).reduce<Msg | string>((x, y) => m('auto.or', { a: x, b: y }), names[0]) : names.join(', ') }), 'commander');
          return done();
        }
      }
      commitApproval(s, a.playerId, stage, { ids, text, msg: textMsg }, undefined, (kind, t) => log(kind, t, 'commander'));
      return done();
    }
    case 'veto': {
      if (!has('commander')) return fail(state, m('room.err.vetoWho'));
      if (['launch', 'flight', 'report'].includes(s.stage)) return fail(state, m('room.err.nothingToVeto'));
      const own = a.text?.trim();
      const text: Msg | string = own || m('room.note.rework');
      const issues = s.stage === 'review' ? readiness(s.build, MISSIONS[s.mission], s.agency) : null;
      const d: Decision = { kind: 'veto', issueIds: issues ? [...issues.blockers, ...issues.warnings].map((i) => i.id) : [], by: a.playerId, text: ruOf(text), ...(typeof text === 'string' ? {} : { i18n: { text } }) };
      s.decisions.push(d);
      s.decisionLog.push(d);
      s.pendingKey = null;
      log('decision', m('room.veto', { text }), 'commander');
      if (s.stage === 'review') s.stage = 'build';
      return done();
    }
    case 'launchDone': {
      if (!isHost) return fail(state, m('room.err.launchHost'));
      if (s.stage !== 'launch') return fail(state, m('room.err.noLaunch'));
      s.stage = 'flight';
      beginFlight(s);
      log('system', m('room.launched'));
      return done();
    }
    case 'openTasks': {
      if (s.stage !== 'build') return fail(state, m('room.err.tasksFrom'));
      const waiting = pendingRequests(s).length;
      if (waiting) return fail(state, m('room.err.requestsFirst', { n: waiting }));
      s.stage = 'tasks';
      s.tasks ??= { results: {} };
      log('system', m('room.tasksOpened', { name: me!.name }));
      return done();
    }
    case 'submitTask': {
      if (s.stage !== 'tasks') return fail(state, m('task.error.stage'));
      const r = submitTask(s, a.playerId, a.role, a.answer);
      if (r.error) return fail(state, errOf(r));
      s.tasks = r.tasks!;
      log('system', r.result!.skipped ? m('room.taskSkipped', { role: roleMsg(a.role) }) : m('room.taskDone', { role: roleMsg(a.role), grade: m(`room.grade.${r.result!.grade}`) }), a.role);
      return done();
    }
    case 'isolateNode': case 'reaimAntenna': {
      if (s.stage !== 'flight' || !s.flight) return fail(state, m('room.err.noFlight'));
      const role = a.type === 'isolateNode' ? 'engineer' : 'comms';
      if (!taskRolesOf(s, a.playerId).includes(role)) return fail(state, m(a.type === 'isolateNode' ? 'task.error.engineer' : 'task.error.comms'));
      const r = a.type === 'isolateNode' ? isolateNode(s.flight, role, statsOf(s), a.node) : reaimAntenna(s.flight, role, { x: a.x, y: a.y });
      if (r.error) return fail(state, errOf(r));
      s.flight = r.flight;
      if (a.type === 'isolateNode') maybeResolveCrisis(s);
      return done();
    }
    case 'crisisChoice': {
      if (s.stage !== 'flight' || !s.flight) return fail(state, m('room.err.noFlight'));
      if (!me?.role) return fail(state, m('room.err.pickRole'));
      // A player with several roles answers for each of them (0013 §4): act as the option's role if he holds it.
      const optRole = s.flight.crisis?.options.find((o) => o.id === a.optionId)?.role;
      const asRole = optRole && has(optRole) ? optRole : me.role;
      const r = chooseOption(s.flight, asRole, a.optionId);
      if (r.error) return fail(state, errOf(r));
      s.flight = r.flight;
      const opt = s.flight.crisis!.options.find((o) => o.id === a.optionId);
      log('crisis', m('room.crisisChoice', { name: me.name, label: i18nOf(opt, 'label') ?? opt?.label ?? a.optionId }), asRole);
      maybeResolveCrisis(s);
      return done();
    }
    case 'scienceMode': {
      if (s.stage !== 'flight' || !s.flight) return fail(state, m('room.err.noFlight'));
      if (!has('science')) return fail(state, m('room.err.modeWho'));
      const r = setScienceMode(s.flight, a.waypoint, a.mode);
      if (r.error) return fail(state, errOf(r));
      s.flight = r.flight;
      return done();
    }
    case 'tick': {
      if (!isHost) return fail(state, m('room.err.tickHost'));
      if (s.stage !== 'flight' || !s.flight) return fail(state, m('room.err.noFlight'));
      s.flight = stepFlight(s.flight, s.build, s.seed, s.rules);
      if (s.flight.done) {
        s.stage = 'report';
        s.report = buildReport(s);
        // The replay now lives in the report: drop the recorder so the room state is not sent twice (M5 replay).
        delete s.flight.replay;
        // 0013 §3: every Team Trust change keeps its reason (commander panel, lobby / HQ, report).
        const attempt = s.agency.history.length + 1;
        let from = s.teamTrust;
        const changes = s.report.trust.map((t) => { const to = Math.max(0, Math.min(100, from + t.delta)); const c = { ...t, attempt, from, to }; from = to; return c; });
        s.trustHistory = [...(s.trustHistory ?? []), ...changes].slice(-12);
        s.teamTrust = s.report.teamTrust;
        s.agency = recordFlight(s.agency, { mission: s.mission, outcome: s.report.outcome, earned: s.report.mc.earned, broken: s.report.damaged, hull: s.flight.hull, audit: trustEffects(s.teamTrust).audit });
        log('system', m('room.missionDone', { outcome: s.report.outcome, score: s.report.score, mc: s.report.mc.earned }));
      }
      return done();
    }
    case 'radio': {
      const p = PHRASE_BY_ID[a.phrase];
      if (!p) return fail(state, m('room.err.noPhrase'));
      if (!has(p.role)) return fail(state, m('room.err.phraseRole'));
      if (s.stage === 'flight' && s.flight) {
        const r = sendRadio(s.flight, p.role, p.id, a.playerId, statsOf(s));
        if (r.error) return fail(state, errOf(r));
        s.flight = r.flight;
      }
      logRaw('radio', p.text, i18nOf(p, 'text'), p.role);
      return done();
    }
    case 'command': {
      if (s.stage !== 'flight' || !s.flight) return fail(state, m('room.err.noFlight'));
      if (!me!.role) return fail(state, m('room.err.pickRole'));
      const cmdRole = mine.find((role) => ROLE_COMMANDS[role].some((c) => c.kind === a.cmd)) ?? me!.role;
      const r = sendCommand(s.flight, cmdRole, a.cmd, a.arg, s.build, statsOf(s));
      if (r.error) return fail(state, errOf(r));
      s.flight = r.flight;
      return done();
    }
  }
}

