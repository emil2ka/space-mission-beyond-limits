// Blackout layer (ТЗ §9.4, docs/03 Design/Crises and Blackout.md): Tactical Radio, the four signal states,
// ground → craft commands with the signal delay (sent → arrived → confirmed), and «rule fired» notes.
// Pure functions over FlightState; flight.ts calls stepComms() once per tick.
import { TITAN } from './data/titan';
import { ruleName, type AutonomyRule } from './autonomy';
import type { CauseEvent, FlightState, ScienceTargetId } from './flight';
import { nameOf } from './sim';
import { COMPONENT_BY_ID } from './data/components';
import type { Build, CraftStats, RoleId } from './types';
import { m, ru, type Msg } from './msg';

/** Cause-event text + its message. */
const ev = (msg: Msg) => ({ text: ru(msg), i18n: { text: msg } });
/** Action error with its message. */
const fail = (f: FlightState, k: string, p?: Parameters<typeof m>[1]) => { const errorMsg = m(k, p); return { flight: f, error: ru(errorMsg), errorMsg }; };

// ── Tactical Radio ──

export interface RadioPhrase {
  id: string;
  role: RoleId;
  text: string;
  /** Emergency phrases pass a blackout at once (if the channel is not off); normal ones wait. */
  emergency: boolean;
  /** text as a message. */
  i18n?: { text?: Msg };
}

const phrase = (id: string, role: RoleId, emergency: boolean): RadioPhrase => {
  const text = m(`radio.phrase.${id}`);
  return { id, role, text: ru(text), emergency, i18n: { text } };
};

/** Two quick phrases per role (Crises and Blackout.md → Tactical Radio). */
export const RADIO_PHRASES: RadioPhrase[] = [
  phrase('eng_bus', 'engineer', true),
  phrase('eng_aux', 'engineer', false),
  phrase('sci_buffer', 'science', true),
  phrase('sci_seal', 'science', false),
  phrase('com_lost', 'comms', true),
  phrase('com_antenna', 'comms', false),
  phrase('cmd_hull', 'commander', true),
  phrase('cmd_abort', 'commander', false),
];
export const PHRASE_BY_ID = Object.fromEntries(RADIO_PHRASES.map((p) => [p.id, p])) as Record<string, RadioPhrase>;

export interface RadioMsg {
  id: string;
  role: RoleId;
  by: string;
  phraseId: string;
  text: string;
  emergency: boolean;
  sentTick: number;
  deliverTick: number;
  delivered: boolean;
  /** Why it waits (shown to the sender). */
  heldBy?: 'blackout' | 'channel-off';
  /** text as a message. */
  i18n?: { text?: Msg };
}

/** The radio channel is off: nothing on board can talk to Earth at all (no antenna / transceiver). */
export const channelOff = (f: FlightState, stats: Pick<CraftStats, 'bandwidth'>) => f.signal === 'lost' && stats.bandwidth === 0;

/** Delay of a phrase sent now, ticks. */
export function radioDelay(f: FlightState, phrase: RadioPhrase, stats: Pick<CraftStats, 'bandwidth'>): { delay: number; heldBy?: RadioMsg['heldBy'] } {
  if (f.signal !== 'lost') return { delay: 0 };
  const off = channelOff(f, stats);
  if (phrase.emergency && !off) return { delay: 0 };
  return { delay: TITAN.radio.blackoutDelay, heldBy: off ? 'channel-off' : 'blackout' };
}

export function sendRadio(f: FlightState, role: RoleId, phraseId: string, by: string, stats: Pick<CraftStats, 'bandwidth'>): { flight: FlightState; error?: string; errorMsg?: Msg } {
  const p = PHRASE_BY_ID[phraseId];
  if (!p) return fail(f, 'radio.err.noPhrase');
  if (p.role !== role) return fail(f, 'radio.err.otherRole');
  const radio = f.radio ?? [];
  const last = [...radio].reverse().find((x) => x.role === role);
  if (last && f.tick - last.sentTick < TITAN.radio.cooldown) return fail(f, 'radio.err.cooldown');
  const n = structuredClone(f);
  n.radio = n.radio ?? [];
  const { delay, heldBy } = radioDelay(n, p, stats);
  const msg: RadioMsg = {
    id: `m${n.radio.length + 1}`, role, by, phraseId, text: p.text, emergency: p.emergency,
    sentTick: n.tick, deliverTick: n.tick + delay, delivered: delay === 0, ...(heldBy ? { heldBy } : {}),
    ...(p.i18n?.text ? { i18n: { text: p.i18n.text } } : {}),
  };
  n.radio.push(msg);
  if (msg.delivered) n.causes.push(radioCause(msg, n.tick));
  return { flight: n };
}

function radioCause(r: RadioMsg, tick: number): CauseEvent {
  const late = tick - r.sentTick;
  return { tick, kind: 'radio', ref: `radio:${r.id}`, causeIds: [], ...ev(m('radio.cause', { text: r.i18n?.text ?? r.text, late: late > 0 ? m('radio.causeLate', { late }) : null })) };
}

// ── Ground → craft commands with the signal delay ──

export type CommandKind = 'downlink_first' | 'shed_aux' | 'hold' | 'antenna_search' | 'crisis' | 'science_mode';

export interface CommandRecord {
  id: string;
  role: RoleId;
  kind: CommandKind;
  label: string;
  arg?: string;
  sentTick: number;
  /** Reaches the craft (−1 = waits for the link). */
  arriveTick: number;
  /** Confirmation back on Earth (−1 = not yet known). */
  ackTick: number;
  applied: boolean;
  acked: boolean;
  /** Ground-side action: no uplink, works at once. */
  ground?: boolean;
  /** Effect is already applied by the engine (crisis choice / science mode): the record only shows the delay. */
  shown?: boolean;
  /** label as a message. */
  i18n?: { label?: Msg };
}

export interface RoleCommand { kind: CommandKind; label: string; hint: string; i18n?: { label?: Msg; hint?: Msg } }
const roleCmd = (kind: CommandKind, p?: Parameters<typeof m>[1]): RoleCommand => {
  const label = m(`radio.cmd.${kind}`), hint = m(`radio.cmd.${kind}.hint`, p);
  return { kind, label: ru(label), hint: ru(hint), i18n: { label, hint } };
};

/** Concrete action of each role while the link is down (and outside it). */
export const ROLE_COMMANDS: Record<RoleId, RoleCommand[]> = {
  comms: [roleCmd('antenna_search')],
  engineer: [roleCmd('shed_aux')],
  science: [roleCmd('downlink_first')],
  commander: [roleCmd('hold', { s: TITAN.commands.holdTicks })],
};

/** Track a command for the «sent → arrived → confirmed» strip. Effects of `shown` records are applied by the caller. */
export function trackCommand(n: FlightState, c: Omit<CommandRecord, 'id' | 'sentTick' | 'arriveTick' | 'ackTick' | 'applied' | 'acked'>): CommandRecord {
  n.commands = n.commands ?? [];
  const lost = n.signal === 'lost';
  const d = n.delayTicks;
  const rec: CommandRecord = {
    id: `c${n.commands.length + 1}`, sentTick: n.tick, ...c,
    arriveTick: c.ground ? n.tick : lost ? -1 : n.tick + d,
    ackTick: c.ground ? n.tick : lost ? -1 : n.tick + 2 * d,
    applied: !!c.shown || !!c.ground, acked: !!c.ground,
  };
  n.commands.push(rec);
  return rec;
}

export function sendCommand(f: FlightState, role: RoleId, kind: CommandKind, arg: string | undefined, build: Build, stats: CraftStats): { flight: FlightState; error?: string; errorMsg?: Msg } {
  const def = ROLE_COMMANDS[role].find((c) => c.kind === kind);
  if (!def) return fail(f, 'radio.err.otherRoleCmd');
  const pending = (f.commands ?? []).filter((c) => c.role === role && !c.acked && !c.shown);
  if (pending.length >= TITAN.commands.maxPending) return fail(f, 'radio.err.pending');
  const defI18n = def.i18n?.label ? { i18n: { label: def.i18n.label } } : {};
  const n = structuredClone(f);
  const cause = (e: Omit<CauseEvent, 'tick'>) => n.causes.push({ tick: n.tick, ...e });
  if (kind === 'antenna_search') {
    if (n.signal !== 'lost') return fail(f, 'radio.err.signalOk');
    const b = n.blackouts.find((x) => x.to === -1);
    if (stats.bandwidth === 0) return fail(f, 'radio.err.noLink');
    if (b?.reason === 'entry') return fail(f, 'radio.err.plasma', { s: Math.max(0, TITAN.entryBlackoutTicks - n.phaseTick) });
    if (n.antennaSearchedAt === b?.from) return fail(f, 'radio.err.searching');
    if (n.lostUntil <= n.tick + 1) return fail(f, 'radio.err.almostBack');
    n.antennaSearchedAt = b?.from ?? n.tick;
    const left = n.lostUntil - n.tick;
    n.lostUntil = Math.max(n.tick + 2, n.lostUntil - TITAN.commands.searchGain);
    trackCommand(n, { role, kind, label: def.label, ground: true, ...defI18n });
    cause({ kind: 'command', ref: 'antenna-search', causeIds: [], ...ev(m('radio.searchLog', { before: left, after: n.lostUntil - n.tick })) });
    return { flight: n };
  }
  if (kind === 'downlink_first') {
    const tg = n.targets.find((t) => t.id === arg);
    if (!tg) return fail(f, 'radio.err.pickTarget');
    const label = m('radio.cmdTarget', { label: def.i18n?.label ?? def.label, name: tg.name });
    trackCommand(n, { role, kind, arg, label: ru(label), i18n: { label } });
  } else if (kind === 'shed_aux') {
    if (!auxLine(n, build)) return fail(f, 'radio.err.nothingToShed');
    trackCommand(n, { role, kind, label: def.label, ...defI18n });
  } else {
    trackCommand(n, { role, kind, label: def.label, ...defI18n });
  }
  const rec = n.commands.at(-1)!;
  cause({ kind: 'command', ref: `cmd:${rec.id}`, causeIds: [], ...ev(m('radio.cmdSent', {
    who: m(`roleShort.${role}`), label: rec.i18n?.label ?? rec.label,
    tail: rec.arriveTick < 0 ? m('radio.cmdSentQueued') : m('radio.cmdSentEta', { arrive: rec.arriveTick - n.tick, ack: rec.ackTick - n.tick }),
  })) });
  return { flight: n };
}

/** The least important working consumer (priority 5 first, then the biggest). */
function auxLine(n: FlightState, build: Build): string | null {
  const cand = Object.entries(build)
    .filter(([id, count]) => count > 0 && COMPONENT_BY_ID[id]?.consumption && (COMPONENT_BY_ID[id].priority ?? 1) >= 4 && !n.off.includes(id))
    .sort(([a], [b]) => COMPONENT_BY_ID[b].priority - COMPONENT_BY_ID[a].priority || COMPONENT_BY_ID[b].consumption! - COMPONENT_BY_ID[a].consumption!);
  return cand[0]?.[0] ?? null;
}

/** Once per tick: deliver delayed radio, move commands along the link, apply what arrived. */
export function stepComms(n: FlightState, build: Build, lost: boolean, cause: (e: Omit<CauseEvent, 'tick'>) => void): void {
  const t = n.tick;
  for (const r of n.radio ?? []) {
    if (!r.delivered && t >= r.deliverTick) { r.delivered = true; n.causes.push(radioCause(r, t)); }
  }
  for (const c of n.commands ?? []) {
    if (c.ground) continue;
    if (lost) {
      if (!c.applied && c.arriveTick > t) c.arriveTick = -1;
      if (!c.acked && c.ackTick > t) c.ackTick = -1;
      continue;
    }
    if (c.arriveTick === -1) { c.arriveTick = t + n.delayTicks; c.ackTick = -1; }
    if (!c.applied && t >= c.arriveTick) {
      c.applied = true;
      applyCommand(n, build, c, cause);
    }
    if (c.applied && c.ackTick === -1) c.ackTick = Math.max(t, c.arriveTick) + n.delayTicks;
    if (!c.acked && c.ackTick !== -1 && t >= c.ackTick) {
      c.acked = true;
      if (!c.shown) cause({ kind: 'command', ref: `ack:${c.id}`, causeIds: [], ...ev(m('radio.ackLog', { label: c.i18n?.label ?? c.label, s: t - c.sentTick })) });
    }
  }
}

function applyCommand(n: FlightState, build: Build, c: CommandRecord, cause: (e: Omit<CauseEvent, 'tick'>) => void) {
  if (c.shown) return;
  if (c.kind === 'downlink_first') {
    n.downlinkFirst = c.arg as ScienceTargetId;
    cause({ kind: 'command', ref: `arrive:${c.id}`, causeIds: [], ...ev(m('radio.arriveDownlink', { name: n.targets.find((x) => x.id === c.arg)?.name ?? c.arg })) });
  } else if (c.kind === 'shed_aux') {
    const id = auxLine(n, build);
    if (id) { n.off.push(id); cause({ kind: 'shed', ref: 'cmd-shed', causeIds: [id], ...ev(m('radio.arriveShed', { name: nameOf(id) })) }); }
    else cause({ kind: 'command', ref: `arrive:${c.id}`, causeIds: [], ...ev(m('radio.arriveShedNone')) });
  } else if (c.kind === 'hold') {
    n.holdUntil = Math.max(n.holdUntil, n.tick + TITAN.commands.holdTicks);
    cause({ kind: 'command', ref: `arrive:${c.id}`, causeIds: [], ...ev(m('radio.arriveHold', { s: TITAN.commands.holdTicks })) });
  }
}

// ── Four signal states (Signal Delay / Lost / Interference / Data Queue Full) ──

export type SignalStateId = 'delay' | 'lost' | 'interference' | 'queue';
export interface SignalState { id: SignalStateId; label: string; active: boolean; detail: string; /** detail as a message. */ i18n?: { detail?: Msg } }

export interface BlackoutInfo {
  reason: 'entry' | 'escalation' | 'no-link';
  reasonText: string;
  /** Seconds without a link so far. */
  elapsed: number;
  /** Seconds until the link is expected back (null = unknown / never). */
  expectedLeft: number | null;
  by: 'autonomy' | 'safe';
  /** reasonText as a message. */
  i18n?: { reasonText?: Msg };
}

export function blackoutInfo(f: FlightState): BlackoutInfo | null {
  if (f.signal !== 'lost') return null;
  const b = f.blackouts.find((x) => x.to === -1);
  const reason = b?.reason ?? 'no-link';
  const expectedLeft = reason === 'entry' ? Math.max(0, TITAN.entryBlackoutTicks - f.phaseTick) : reason === 'escalation' ? Math.max(0, f.lostUntil - f.tick) : null;
  const reasonText = m(reason === 'entry' ? 'radio.reason.entry' : reason === 'escalation' ? (f.asteroid ? 'radio.reason.maneuver' : 'radio.reason.storm') : 'radio.reason.noLink');
  return {
    reason,
    reasonText: ru(reasonText),
    i18n: { reasonText },
    elapsed: b ? f.tick - b.from : 0,
    expectedLeft,
    by: b?.by ?? 'safe',
  };
}

export function signalStates(f: FlightState): SignalState[] {
  const lost = f.signal === 'lost';
  const bi = blackoutInfo(f);
  const loss = f.storm && f.tick < f.storm.until ? f.storm.loss : 0;
  const free = Math.max(0, Math.round((f.memoryCap - f.dataOnboard) * 10) / 10);
  const st = (id: SignalStateId, label: string, active: boolean, detail: Msg): SignalState => ({ id, label, active, detail: ru(detail), i18n: { detail } });
  return [
    st('delay', 'SIGNAL DELAY', !lost && f.delayTicks > 0, m('radio.sig.delay', { d: f.delayTicks })),
    st('lost', 'SIGNAL LOST', lost, bi ? m('radio.sig.lost', { reason: bi.i18n?.reasonText ?? bi.reasonText, s: bi.elapsed, expect: bi.expectedLeft !== null ? m('radio.sig.lostExpect', { s: bi.expectedLeft }) : null }) : m('radio.sig.linkOk')),
    st('interference', 'INTERFERENCE', f.signal === 'interference', f.signal === 'interference' ? m('radio.sig.interference', { pct: Math.round(loss * 100) }) : m('radio.sig.noInterference')),
    st('queue', 'DATA QUEUE FULL', f.queueFull, f.queueFull ? m('radio.sig.queueFull') : m('radio.sig.queueFree', { free })),
  ];
}

// ── «Rule fired» notes for the log and the report ──

export interface RuleFired { ruleId: string; text: string; tick: number; where: 'blackout' | 'crisis' | 'flight'; action: string }

/** Log «Сработало правило N …» once per rule per blackout / crisis. */
export function noteRulesFired(n: FlightState, rules: AutonomyRule[], fired: { ruleId: string; action: string }[], where: RuleFired['where'], context: string | Msg): void {
  n.rulesFired = n.rulesFired ?? [];
  for (const r of fired) {
    const text = ruleName(rules, r.ruleId);
    n.rulesFired.push({ ruleId: r.ruleId, text, tick: n.tick, where, action: r.action });
    n.causes.push({ tick: n.tick, kind: 'autonomy', ref: `rule:${r.ruleId}`, causeIds: [r.ruleId], ...ev(m('radio.ruleFired', { rule: text, context })) });
  }
}
