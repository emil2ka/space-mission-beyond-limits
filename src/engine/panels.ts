// Role panels: what each role sees during the flight (ТЗ §9.4, «Crises and Blackout»).
// Managed asymmetry: everyone has useful information and an action; nobody sees everything.
import { TICK_HOURS, TICK_SECONDS, THERMAL } from './constants';
import { COMPONENT_BY_ID } from './data/components';
import { MISSIONS } from './data/missions';
import { TITAN } from './data/titan';
import { ASTEROID, COMPOSITION_TARGET, SITE_DEFS, type AsteroidSiteId, type CapsuleStage } from './data/asteroid';
import { jamRisk, toolRate, type AsteroidFlight } from './asteroid';
import type { CrisisOption, FlightState, ScienceMode, ScienceTargetId, WaypointId } from './flight';
import { ANTENNAS, nameMsg, overRatio } from './sim';
import { blackoutInfo, channelOff, RADIO_PHRASES, ROLE_COMMANDS, signalStates, type BlackoutInfo, type CommandKind, type CommandRecord, type RadioPhrase, type SignalState } from './blackout';
import { computeStats, installed } from './stats';
import type { Build, RoleId } from './types';
import { trustEffects, type TrustEffects } from './rules';
import { join, m, ru, type Msg, type Params } from './msg';

const pm = (k: string, p?: Params) => m(`panel.${k}`, p);
const txt = (x: Msg | string) => (typeof x === 'string' ? x : ru(x));
/** A panel row: Russian `label` / `value` + `i18n` (value only when it has words). */
function row(id: string, label: Msg, value: Msg | string, level: PanelItem['level'], nodeIds?: string[]): PanelItem {
  return { id, label: ru(label), value: txt(value), level, ...(nodeIds ? { nodeIds } : {}), i18n: { label, ...(typeof value === 'string' ? {} : { value }) } };
}
/** Alerts are kept twice: Russian `alerts` + aligned `i18n.alerts`. */
function pushAlert(panel: RolePanel, msg: Msg) {
  panel.alerts.push(ru(msg));
  (panel.i18n ??= { title: m(`role.${panel.role}`), alerts: [] }).alerts.push(msg);
}

export interface PanelItem {
  id: string;
  label: string;
  value: string;
  level: 'ok' | 'warn' | 'bad' | 'info';
  nodeIds?: string[];
  /** label (and value, when it has words) as messages. */
  i18n?: { label: Msg; value?: Msg };
}

export interface PanelCrisis {
  title: string;
  /** Commander gets the short version (not all technical causes). */
  text: string;
  secondsLeft: number;
  options: CrisisOption[];
  chosen: string | null;
  /** What other roles already picked. */
  others: { role: RoleId; label: string; i18n?: { label: Msg } }[];
  nodeIds: string[];
  /** text as a message (commander's short version, or the crisis text's message). */
  i18n?: { text?: Msg };
}

export interface RolePanel {
  role: RoleId;
  title: string;
  blackout: boolean;
  items: PanelItem[];
  alerts: string[];
  /** What this role cannot see right now (UI shows «нет данных»). */
  hidden: string[];
  /** title and alerts (aligned) as messages. */
  i18n?: { title: Msg; alerts: Msg[] };
  crisis: PanelCrisis | null;
  /** Engineer. */
  power?: {
    generation: number; demand: number; net: number; stored: number; capacity: number; busLoad: number; busLimit: number;
    lines: { id: string; name: string; watts: number; on: boolean; broken: boolean }[];
    heat: number; thermal: FlightState['thermal']; thresholds: typeof THERMAL;
  };
  /** Science officer. */
  science?: {
    targets: { id: ScienceTargetId; name: string; required: number; collected: number; sent: number; stored: number; quality: number; possible: boolean; instruments: string[] }[];
    memoryUsed: number; memoryCap: number; queueFull: boolean;
    /** Mode choice for the current/next waypoint (null when the route is over). */
    choice: { waypoint: WaypointId; name: string; mode: ScienceMode | null; atWaypoint: boolean } | null;
    instruments: { id: string; name: string; on: boolean }[];
  };
  /** Communications officer. */
  comms?: {
    signal: FlightState['signal']; delayTicks: number; noise: number; bandwidth: number;
    antennas: string[]; aligned: boolean;
    queue: { id: ScienceTargetId; name: string; stored: number }[];
    memoryFree: number; queueFull: boolean;
    /** Antenna pointing error, degrees (null = unknown in a blackout). */
    direction?: { deg: number | null; text: string; level: PanelItem['level']; i18n?: { text: Msg } };
    /** Packets waiting (1 packet = 1 data unit). */
    packets?: number;
  };
  /** Four signal states (everyone sees them; detail differs by role). */
  signals: SignalState[];
  /** Set while the link is down. */
  blackoutInfo: BlackoutInfo | null;
  /** Tactical Radio: this role's two phrases and whether they wait in a blackout. */
  radio: { phrases: (RadioPhrase & { delayed: boolean; delay: number })[]; pending: { id: string; text: string; deliverTick: number; i18n?: { text: Msg } }[]; channelOff: boolean };
  /** Concrete action of this role (ground → craft, with the signal delay). */
  actions: { kind: CommandKind; label: string; hint: string; disabled: string | null; args?: { id: string; label: string; i18n?: { label: Msg } }[]; i18n?: { label?: Msg; hint?: Msg; disabled?: Msg } }[];
  /** This role's commands on the way: sent → arrived → confirmed. */
  commands: (CommandRecord & { state: 'queued' | 'uplink' | 'downlink' | 'done' })[];
  /** Engineer: diagnostics lines. */
  diagnostics?: { id: string; text: string; level: PanelItem['level']; nodeIds?: string[]; i18n?: { text: Msg } }[];
  /** Commander. */
  command?: {
    phase: string; phaseIndex: number; phases: string[];
    hull: number; status: 'nominal' | 'warning' | 'critical';
    waypointsReached: number; waypointsTotal: number; delivered: number; targetsTotal: number;
    timerSeconds: number | null;
    /** Blackout clock: seconds without link and expected seconds left. */
    blackoutTimer: { elapsed: number; expectedLeft: number | null } | null;
    /** 0013 §3: Team Trust of this flight, its tier and effects (crisisBonus = what this flight really got). */
    trust?: TrustEffects & { value: number };
    /** phase as a message when the engine words it («Завершено»); phase names otherwise come from mission data. */
    i18n?: { phase?: Msg };
  };
  /** Asteroid only: what this role sees of the sample return (each role gets its own parts). */
  asteroid?: AsteroidPanel;
}

export interface AsteroidPanel {
  phaseId: string;
  /** Engineer + commander. */
  fuel?: { now: number; max: number; pct: number; drive: AsteroidFlight['drive']; used: number; forecast: number; enough: boolean };
  /** Engineer: engines and protection. */
  engines?: { id: string; name: string; on: boolean; broken: boolean }[];
  protection?: { micrometeoroidShield: boolean; heatShield: 'ok' | 'damaged' | 'missing'; armDamaged: boolean; hull: number };
  /** Science: site choice (with the jam risk for THIS build) and the arm. */
  site?: {
    current: AsteroidSiteId | null; by: AsteroidFlight['siteBy']; canChoose: boolean; why: string | null; i18n?: { why?: Msg };
    options: { id: AsteroidSiteId; name: string; text: string; jamRisk: number; science: number; rate: number }[];
  };
  arm?: { state: AsteroidFlight['sampling']; tool: AsteroidFlight['tool']; progress: number; jamRisk: number | null; attempts: number };
  /** Science + commander. */
  sample?: { collected: boolean; sealed: boolean; mass: number; sealProgress: number; heated: boolean };
  /** Comms (+ science): composition data — needed for Perfect. */
  composition?: { required: number; collected: number; stored: number; sent: number; delivered: boolean };
  /** Commander + comms: the capsule on its way home. */
  capsule?: { stage: CapsuleStage; progress: number; beacon: boolean; offTarget: boolean };
  /** 3D props in one place. */
  approach: number;
  debris: boolean;
}

/** Role titles / short names: common `role.*` / `roleShort.*` (same Russian). */
const roleTitle = (r: RoleId) => m(`role.${r}`);
const roleShort = (r: RoleId) => m(`roleShort.${r}`);

export function panelFor(role: RoleId, flight: FlightState, build: Build): RolePanel {
  const mission = MISSIONS[flight.mission];
  const stats = computeStats(build, mission, flight.mods);
  const blackout = flight.signal === 'lost';
  const has = (id: string) => (build[id] ?? 0) > 0;
  const items: PanelItem[] = [];
  const alerts: string[] = [];
  const alertMsgs: Msg[] = [];
  const alert = (msg: Msg) => { alerts.push(ru(msg)); alertMsgs.push(msg); };
  const hidden: string[] = [];
  const c = flight.crisis;
  const cmdText = c && role === 'commander' ? commanderText(c.kind) : null;

  const crisis: PanelCrisis | null = c ? {
    title: c.title,
    text: cmdText ? ru(cmdText) : c.text,
    secondsLeft: Math.max(0, (c.deadlineTick - flight.tick) * TICK_SECONDS),
    options: c.options.filter((o) => o.role === role),
    chosen: c.chosen[role] ?? null,
    others: (Object.entries(c.chosen) as [RoleId, string][]).filter(([r]) => r !== role).map(([r, id]) => {
      const o = c.options.find((x) => x.id === id);
      const msg = pm('chosen', { role: roleShort(r), label: o?.i18n?.label ?? o?.label ?? id });
      return { role: r, label: ru(msg), i18n: { label: msg } };
    }),
    nodeIds: role === 'commander' ? [] : c.nodeIds,
    ...(cmdText ? { i18n: { text: cmdText } } : c.i18n?.text ? { i18n: { text: c.i18n.text } } : {}),
  } : null;
  if (c) alert(pm('alert.crisis', { title: c.title }));

  const bi = blackoutInfo(flight);
  const off = channelOff(flight, stats);
  const radio: RolePanel['radio'] = {
    channelOff: off,
    phrases: RADIO_PHRASES.filter((p) => p.role === role).map((p) => {
      const delayed = blackout && (!p.emergency || off);
      return { ...p, delayed, delay: delayed ? TITAN.radio.blackoutDelay : 0 };
    }),
    pending: (flight.radio ?? []).filter((r) => !r.delivered).map((r) => ({ id: r.id, text: r.text, deliverTick: r.deliverTick, ...(r.i18n?.text ? { i18n: { text: r.i18n.text } } : {}) })),
  };
  const commands = (flight.commands ?? []).filter((c) => c.role === role && !c.ground).slice(-4).map((c) => ({
    ...c, state: (c.acked ? 'done' : c.applied ? 'downlink' : c.arriveTick === -1 ? 'queued' : 'uplink') as RolePanel['commands'][number]['state'],
  }));
  const panel: RolePanel = { role, title: ru(roleTitle(role)), blackout, items, alerts, hidden, i18n: { title: roleTitle(role), alerts: alertMsgs }, crisis, signals: signalStates(flight), blackoutInfo: bi, radio, actions: roleActions(role, flight, build, stats.bandwidth), commands };
  const pct = stats.capacityWh > 0 ? Math.round((flight.stored / stats.capacityWh) * 100) : 0;

  if (role === 'engineer') {
    const lines = installed(build, flight.mods).filter((x) => x.def.consumption).map((x) => ({
      id: x.def.id, name: x.def.name, watts: x.def.consumption! * x.count, on: !flight.off.includes(x.def.id), broken: flight.broken.includes(x.def.id),
    })).sort((a, b) => b.watts - a.watts);
    panel.power = {
      generation: flight.power.generation, demand: flight.power.demand, net: flight.power.net, stored: Math.round(flight.stored), capacity: stats.capacityWh,
      busLoad: flight.power.busLoad, busLimit: flight.power.busLimit, lines, heat: flight.heat, thermal: flight.thermal, thresholds: THERMAL,
    };
    items.push(
      row('net', pm('label.net'), `${flight.power.generation} − ${flight.power.demand} = ${flight.power.net} W`, flight.power.net < 0 ? 'bad' : 'ok'),
      row('battery', pm('label.battery'), `${Math.round(flight.stored)} / ${stats.capacityWh} Wh (${pct} %)`, pct < TITAN.crisis.batteryPct ? 'bad' : pct < 50 ? 'warn' : 'ok', ['battery_hc', 'battery_backup'].filter(has)),
      row('bus', pm('label.bus'), `${flight.power.busLoad} / ${flight.power.busLimit} W`, flight.power.busLoad > flight.power.busLimit ? 'bad' : flight.power.busLoad > flight.power.busLimit * 0.85 ? 'warn' : 'ok', ['power_bus']),
      row('heat', pm('label.heat'), pm('v.heat', { sign: flight.heat > 0 ? '+' : '', heat: flight.heat, state: thermalName(flight.thermal) }), flight.thermal === 'nominal' ? 'ok' : flight.thermal === 'freezing' || flight.thermal === 'overheat' ? 'bad' : 'warn'),
    );
    for (const id of flight.broken) alert(pm('alert.broken', { name: nameMsg(id) }));
    for (const id of flight.off.filter((x) => !flight.broken.includes(x))) { const n = nameMsg(id); items.push(row(`off:${id}`, pm('label.off'), n, 'warn', [id])); }
    if (blackout && !has('imu')) hidden.push('position');
    if ((!blackout || has('imu')) && !flight.asteroid) items.push(row('position', pm('label.position'), routeText(flight), flight.route === 'stopped' ? 'warn' : 'info'));
    hidden.push('signal-detail', 'data-queue');
    panel.diagnostics = diagnostics(flight, stats.capacityWh, pct, has);
  }

  if (role === 'science') {
    const cur = flight.waypoints[flight.waypointIndex];
    panel.science = {
      targets: flight.targets.map((t) => ({ id: t.id, name: t.name, required: t.required, collected: round1(t.collected), sent: round1(t.sent), stored: round1(t.stored), quality: Math.round(t.quality * 100) / 100, possible: t.possible, instruments: t.need.filter(has) })),
      memoryUsed: round1(flight.dataOnboard), memoryCap: flight.memoryCap, queueFull: flight.queueFull,
      choice: cur ? { waypoint: cur.id, name: cur.name, mode: cur.mode, atWaypoint: cur.reached } : null,
      instruments: installed(build).filter((x) => x.def.department === 'science' && x.def.consumption && x.def.id !== 'data_storage').map((x) => ({ id: x.def.id, name: x.def.name, on: !flight.off.includes(x.def.id) && flight.tick >= flight.sciencePausedUntil })),
    };
    const delivered = flight.targets.filter((t) => t.sent >= t.required).length;
    items.push(
      row('delivered', pm('label.delivered'), flight.asteroid ? `${delivered} / ${flight.targets.length}` : pm('v.deliveredNeed', { d: delivered, n: flight.targets.length, need: 2 }), delivered >= 2 ? 'ok' : 'info'),
      row('memory', pm('label.memory'), pm('v.units', { a: round1(flight.dataOnboard), b: flight.memoryCap }), flight.queueFull ? 'bad' : flight.dataOnboard > flight.memoryCap * 0.9 ? 'warn' : 'ok'),
    );
    if (blackout) {
      const stuck = flight.targets.filter((t) => t.stored > 0).map((t) => pm('nameNum', { name: t.name, n: round1(t.stored) }));
      alert(pm('alert.dataStuck', { tail: stuck.length ? pm('alert.dataStuckList', { list: join(stuck, ', ') }) : '.' }));
    }
    if (flight.downlinkFirst) items.push(row('first', pm('label.first'), flight.targets.find((t) => t.id === flight.downlinkFirst)?.name ?? '—', 'info'));
    if (flight.queueFull) alert(pm('alert.memoryFull'));
    hidden.push('power-lines', 'signal-detail');
    if (blackout) hidden.push('position');
  }

  if (role === 'comms') {
    const noise = blackout ? 1 : flight.storm && flight.tick < flight.storm.until ? flight.storm.loss : 0;
    const factor = (flight.ecoLink ? 0.5 : 1) * (flight.storm && flight.tick < flight.storm.until ? flight.storm.factor : 1);
    const bandwidth = blackout ? 0 : round1(stats.bandwidth * TICK_HOURS * factor);
    panel.comms = {
      signal: flight.signal, delayTicks: flight.delayTicks, noise, bandwidth,
      antennas: ANTENNAS.filter(has), aligned: !blackout && noise < 0.2,
      queue: [...flight.targets].filter((t) => t.stored > 0).sort((a, b) => b.stored - a.stored).map((t) => ({ id: t.id, name: t.name, stored: round1(t.stored) })),
      memoryFree: round1(Math.max(0, flight.memoryCap - flight.dataOnboard)), queueFull: flight.queueFull,
      packets: Math.ceil(flight.dataOnboard),
    };
    items.push(
      row('signal', pm('label.signal'), blackout ? pm('v.noSignal') : flight.signal === 'interference' ? pm('v.interference', { pct: Math.round(noise * 100) }) : pm('v.delay', { n: flight.delayTicks }), blackout ? 'bad' : flight.signal === 'interference' ? 'warn' : 'ok', ANTENNAS.filter(has)),
      row('rate', pm('label.rate'), pm('v.rate', { n: bandwidth }), bandwidth === 0 ? 'bad' : 'ok'),
      row('free', pm('label.free'), pm('v.unitsOne', { n: panel.comms.memoryFree }), flight.queueFull ? 'bad' : 'ok'),
    );
    if (blackout) alert(pm('alert.noSignal'));
    if (flight.queueFull) alert(pm('alert.queueFull'));
    hidden.push('power-lines', 'instrument-detail');
    const dir = antennaDirection(flight, panel.comms.antennas.length > 0);
    items.push(row('direction', pm('label.direction'), dir.i18n?.text ?? dir.text, dir.level));
    panel.comms.direction = dir;
    if (bi) items.push(row('lost-for', pm('label.lostFor'), pm('v.lostFor', { s: bi.elapsed, wait: bi.expectedLeft !== null ? pm('v.wait', { s: bi.expectedLeft }) : '' }), 'bad'));
  }

  if (flight.asteroid) asteroidPanel(panel, role, flight, build, stats);

  if (role === 'commander') {
    const delivered = flight.targets.filter((t) => t.sent >= t.required).length;
    const status = c || flight.hull < 40 ? 'critical' : flight.off.length || flight.thermal !== 'nominal' || blackout ? 'warning' : 'nominal';
    panel.command = {
      phase: mission.phases[flight.phaseIndex]?.name ?? ru(pm('phaseDone')), phaseIndex: flight.phaseIndex, phases: mission.phases.map((p) => p.name),
      hull: flight.hull, status,
      waypointsReached: flight.waypoints.filter((w) => w.reached).length, waypointsTotal: flight.waypoints.length,
      delivered, targetsTotal: flight.targets.length,
      timerSeconds: crisis ? crisis.secondsLeft : null,
      blackoutTimer: bi ? { elapsed: bi.elapsed, expectedLeft: bi.expectedLeft } : null,
      trust: { value: flight.trustAtStart, ...trustEffects(flight.trustAtStart), crisisBonus: flight.crisisBonus ?? 0 },
      ...(mission.phases[flight.phaseIndex] ? {} : { i18n: { phase: pm('phaseDone') } }),
    };
    items.push(
      row('hull', pm('label.hull'), `${flight.hull} %`, flight.hull < 40 ? 'bad' : flight.hull < 80 ? 'warn' : 'ok'),
      row('status', pm('label.status'), pm(`status.${status}`), status === 'nominal' ? 'ok' : status === 'warning' ? 'warn' : 'bad'),
      ...(flight.asteroid ? [] : [
        row('goal', pm('label.goal'), pm('v.goal', { d: delivered, n: 2 }), delivered >= 2 ? 'ok' : 'info'),
        row('position', pm('label.route'), routeText(flight), flight.route === 'stopped' ? 'warn' : 'info'),
      ]),
    );
    if (blackout) alert(pm('alert.selfDriving', { by: bi?.by === 'autonomy' ? pm('alert.byRules') : 'Safe Protocol' }));
    if (bi) items.push(row('lost-for', pm('label.lostFor'), pm('v.lostFor', { s: bi.elapsed, wait: bi.expectedLeft !== null ? pm('v.wait', { s: bi.expectedLeft }) : pm('v.unknownLeft') }), 'bad'));
    hidden.push('power-lines', 'signal-detail', 'crisis-causes');
  }
  return panel;
}

function roleActions(role: RoleId, f: FlightState, build: Build, bandwidth: number): RolePanel['actions'] {
  const pending = (f.commands ?? []).filter((c) => c.role === role && !c.acked && !c.shown).length;
  const busy = pending >= TITAN.commands.maxPending ? pm('act.busy') : null;
  return ROLE_COMMANDS[role].map((a) => {
    let disabled: Msg | null = busy;
    let args: { id: string; label: string; i18n?: { label: Msg } }[] | undefined;
    if (a.kind === 'antenna_search') {
      const b = f.blackouts.find((x) => x.to === -1);
      disabled = f.signal !== 'lost' ? pm('act.signalOk')
        : bandwidth === 0 ? pm('act.noLink')
        : b?.reason === 'entry' ? pm('act.entry')
        : f.antennaSearchedAt === b?.from ? pm('act.searching') : null;
    }
    if (a.kind === 'downlink_first') args = f.targets.filter((t) => t.possible || t.stored > 0).map((t) => { const label = pm('act.arg', { name: t.name, n: round1(t.stored) }); return { id: t.id, label: ru(label), i18n: { label } }; });
    if (a.kind === 'shed_aux' && !Object.entries(build).some(([id, n]) => n > 0 && !f.off.includes(id) && (auxPriority(id) >= 4))) disabled = pm('act.nothingToShed');
    const i18n = { ...(a.i18n ?? {}), ...(disabled ? { disabled } : {}) };
    return { ...a, disabled: disabled && ru(disabled), args, ...(Object.keys(i18n).length ? { i18n } : {}) };
  });
}

function auxPriority(id: string) {
  const def = COMPONENT_BY_ID[id];
  return def?.consumption ? def.priority ?? 1 : 0;
}

/** Engineer diagnostics: red lights, overheating, power lines, battery forecast. */
function diagnostics(f: FlightState, capacityWh: number, pct: number, has: (id: string) => boolean): NonNullable<RolePanel['diagnostics']> {
  const out: NonNullable<RolePanel['diagnostics']> = [];
  const d = (id: string, msg: Msg, level: PanelItem['level'], nodeIds?: string[]) => out.push({ id, text: ru(msg), level, ...(nodeIds ? { nodeIds } : {}), i18n: { text: msg } });
  for (const id of f.broken) d(`broken:${id}`, pm('diag.broken', { name: nameMsg(id) }), 'bad', [id]);
  if (f.thermal === 'overheat' || f.thermal === 'hot') d('hot', pm('diag.hot', { h: f.heat }), f.thermal === 'overheat' ? 'bad' : 'warn', ['thermal_radiator', 'rtg'].filter(has));
  if (f.thermal === 'freezing' || f.thermal === 'cold') d('cold', pm('diag.cold', { h: f.heat }), f.thermal === 'freezing' ? 'bad' : 'warn', ['heater', 'thermal_insulation'].filter(has));
  if (f.power.busLimit > 0 && f.power.busLoad > f.power.busLimit * 0.85) d('bus', pm('diag.bus', { pct: Math.round((f.power.busLoad / f.power.busLimit) * 100) }), f.power.busLoad > f.power.busLimit ? 'bad' : 'warn', ['power_bus']);
  if (f.power.net < 0 && capacityWh > 0) {
    const ticks = Math.floor(f.stored / (-f.power.net * TICK_HOURS));
    d('drain', pm('diag.drain', { pct, s: ticks }), pct < TITAN.crisis.batteryPct ? 'bad' : 'warn', ['battery_hc', 'battery_backup'].filter(has));
  }
  for (const id of f.off.filter((x) => !f.broken.includes(x))) d(`off:${id}`, pm('diag.off', { name: nameMsg(id) }), 'warn', [id]);
  if (!out.length) d('ok', pm('diag.ok'), 'ok');
  return out;
}

/** Antenna pointing as comms sees it. */
function antennaDirection(f: FlightState, hasAntenna: boolean): { deg: number | null; text: string; level: PanelItem['level']; i18n: { text: Msg } } {
  const dir = (deg: number | null, msg: Msg, level: PanelItem['level']) => ({ deg, text: ru(msg), level, i18n: { text: msg } });
  if (!hasAntenna) return dir(null, pm('dir.none'), 'bad');
  if (f.signal === 'lost') {
    const b = f.blackouts.find((x) => x.to === -1);
    if (b?.reason === 'entry') return dir(null, pm('dir.folded'), 'warn');
    return dir(null, pm('dir.noData'), 'bad');
  }
  if (f.signal === 'interference') {
    const loss = f.storm && f.tick < f.storm.until ? f.storm.loss : 0;
    const deg = Math.round(loss * 40);
    return dir(deg, pm('dir.storm', { deg }), deg > 8 ? 'warn' : 'ok');
  }
  return dir(0, pm('dir.aimed'), 'ok');
}

const CMD_KINDS = ['power_drop', 'signal_distortion', 'freeze', 'overheat', 'debris_alert', 'arm_jam'];
function commanderText(kind: string): Msg {
  return pm(`cmd.${CMD_KINDS.includes(kind) ? kind : 'default'}`);
}

function thermalName(t: FlightState['thermal']): Msg {
  return pm(`thermal.${t}`);
}

function routeText(f: FlightState): Msg | string {
  const wp = f.waypoints[f.waypointIndex];
  if (!wp) return f.waypoints.length ? pm('route.done') : '—';
  if (f.route === 'stopped') return pm('route.stopped', { wp: wp.name, pct: Math.round(f.waypointProgress * 100) });
  if (wp.reached) return pm('route.at', { wp: wp.name });
  return pm('route.flying', { wp: wp.name, pct: Math.round(f.waypointProgress * 100) });
}

const round1 = (x: number) => Math.round(x * 10) / 10;

const STAGE_NAME = (st: CapsuleStage) => pm(`stage.${st}`);
const SAMPLING_NAME = (st: AsteroidFlight['sampling']) => pm(`sampling.${st}`);

/** Fuel the rest of the flight needs at nominal rates (engineer forecast). */
export function fuelForecast(f: FlightState, build: Build, overweight: number): number {
  const a = f.asteroid!;
  const phases = MISSIONS.asteroid.phases.map((p) => p.id);
  const at = phases[f.phaseIndex] ?? 'return';
  const before = (id: string) => phases.indexOf(at) <= phases.indexOf(id);
  const ion = (build.ion_engine ?? 0) > 0 && !f.off.includes('ion_engine') && !f.broken.includes('ion_engine');
  const C = ASTEROID.cruise, A = ASTEROID.approach, R = ASTEROID.return;
  let need = 0;
  if (at === 'cruise') need += (1 - a.cruise) * (ion ? C.ionTicks * C.ionFuel : C.chemTicks * C.chemFuel);
  if (before('approach')) need += (1 - a.approach) * A.navTicks * A.fuel;
  if (before('sampling')) need += (MISSIONS.asteroid.phases[2].ticks + MISSIONS.asteroid.phases[3].ticks) * ASTEROID.samplingFuel;
  if (before('return') && !(at === 'return' && f.phaseTick > 0)) need += ion ? R.ionBurn + R.ionFuel * (R.separateAt - R.burnTicks) : R.chemBurn;
  return Math.round(need * (1 + overweight * ASTEROID.overweightFuel));
}

function asteroidPanel(panel: RolePanel, role: RoleId, f: FlightState, build: Build, stats: ReturnType<typeof computeStats>) {
  const a = f.asteroid!;
  const has = (id: string) => (build[id] ?? 0) > 0;
  const phaseId = MISSIONS.asteroid.phases[f.phaseIndex]?.id ?? 'done';
  const ap: AsteroidPanel = { phaseId, approach: a.approach, debris: a.debris };
  const items = panel.items;
  const forecast = fuelForecast(f, build, overRatio(stats));
  const used = Object.values(a.fuelUsed).reduce((x, y) => x + y, 0);
  const fuel = { now: Math.round(a.fuel), max: a.fuelMax, pct: a.fuelMax ? Math.round((a.fuel / a.fuelMax) * 100) : 0, drive: a.drive, used: Math.round(used), forecast, enough: a.fuel >= forecast };
  const comp = f.targets.find((t) => t.id === COMPOSITION_TARGET);
  const sample = { collected: a.sample.collected, sealed: a.sample.sealed, mass: a.sample.mass, sealProgress: Math.round(a.sealProgress * 100) / 100, heated: a.heated };
  const capsule = { stage: a.capsule, progress: Math.round(a.capsuleProgress * 100) / 100, beacon: has('recovery_beacon') && !f.off.includes('recovery_beacon'), offTarget: a.offTarget };
  const sampleText = a.sample.collected ? pm('v.sample', { mass: a.sample.mass, sealed: pm(a.sample.sealed ? 'sealed' : 'notSealed') }) : SAMPLING_NAME(a.sampling);

  if (role === 'engineer') {
    ap.fuel = fuel;
    ap.engines = ['chem_main_engine', 'chem_thrusters', 'ion_engine', 'reaction_wheels'].filter(has).map((id) => ({ id, name: txt(nameMsg(id)), on: !f.off.includes(id), broken: f.broken.includes(id) }));
    ap.protection = { micrometeoroidShield: has('micrometeoroid_shield'), heatShield: !has('heat_shield') ? 'missing' : f.broken.includes('heat_shield') ? 'damaged' : 'ok', armDamaged: a.armDamaged, hull: f.hull };
    items.push(
      row('fuel', pm('label.fuel'), pm('v.fuel', { now: fuel.now, max: fuel.max, pct: fuel.pct, need: forecast }), !fuel.enough ? 'bad' : fuel.now < forecast * 1.2 ? 'warn' : 'ok', ['propellant_tank']),
      row('drive', pm('label.drive'), pm(a.drive === 'ion' ? 'v.driveIon' : 'v.driveChem'), 'info', [a.drive === 'ion' ? 'ion_engine' : 'chem_thrusters']),
      row('shield', pm('label.shield'), pm('v.shield', { shield: pm(has('micrometeoroid_shield') ? 'v.shieldOn' : 'v.shieldOff'), heat: pm(`v.heatShield.${ap.protection.heatShield}`) }), ap.protection.heatShield === 'damaged' ? 'bad' : has('micrometeoroid_shield') ? 'ok' : 'warn', ['micrometeoroid_shield', 'heat_shield'].filter(has)),
    );
    if (!fuel.enough) pushAlert(panel, pm('alert.fuel', { now: fuel.now, need: forecast }));
  }
  if (role === 'science') {
    const canChoose = (phaseId === 'approach' || phaseId === 'site') && !a.approachFailed;
    const whyMsg = canChoose ? null : pm(phaseId === 'cruise' ? 'site.cruise' : a.approachFailed ? 'site.failed' : 'site.started');
    const tool = a.tool ?? ((build.robotic_arm ?? 0) > 0 && (build.drill ?? 0) > 0 ? 'both' : (build.robotic_arm ?? 0) > 0 ? 'arm' : 'drill');
    ap.site = {
      current: a.site, by: a.siteBy, canChoose,
      why: whyMsg && ru(whyMsg), ...(whyMsg ? { i18n: { why: whyMsg } } : {}),
      options: SITE_DEFS.map((d) => ({ id: d.id, name: d.name, text: d.text, jamRisk: Math.max(0, Math.min(1, jamRisk(build, d.id, a.armDamaged))), science: d.science, rate: Math.round(toolRate(tool, d.id) * 1000) / 1000 })),
    };
    ap.arm = { state: a.sampling, tool: a.tool, progress: Math.round(a.samplingProgress * 100) / 100, jamRisk: a.site ? Math.max(0, Math.min(1, jamRisk(build, a.site, a.armDamaged))) : null, attempts: a.attempts };
    ap.sample = sample;
    items.push(
      row('site', pm('label.site'), a.site ? pm('v.site', { name: SITE_DEFS.find((d) => d.id === a.site)!.name, auto: a.siteBy === 'auto' ? pm('v.siteAuto') : '' }) : canChoose ? pm('v.pickSite') : '—', a.site ? 'ok' : canChoose ? 'warn' : 'info'),
      row('arm', pm('label.arm'), pm('v.arm', { state: SAMPLING_NAME(a.sampling), pct: a.sampling === 'grab' || a.sampling === 'jam' ? ` · ${Math.round(a.samplingProgress * 100)} %` : '' }), a.sampling === 'jam' || a.sampling === 'failed' ? 'bad' : a.sampling === 'stowed' ? 'ok' : 'info', ['robotic_arm', 'drill'].filter(has)),
      row('sample', pm('label.sample'), sampleText, a.sample.sealed ? 'ok' : a.sample.collected ? 'warn' : 'info', ['sample_container', 'sample_sealer'].filter(has)),
    );
    if (canChoose && !a.site) pushAlert(panel, phaseId === 'site' ? pm('alert.pickSite', { s: Math.max(0, MISSIONS.asteroid.phases[2].ticks - f.phaseTick) }) : pm('alert.pickSiteEarly'));
    if (a.sample.collected && !a.sample.sealed && !has('sample_sealer')) pushAlert(panel, pm('alert.notSealed'));
  }
  if (role === 'comms' || role === 'science') {
    if (comp) ap.composition = { required: comp.required, collected: round1(comp.collected), stored: round1(comp.stored), sent: round1(comp.sent), delivered: comp.sent >= comp.required };
    if (role === 'comms' && comp) items.push(row('composition', pm('label.composition'), pm('v.unitsCheck', { a: round1(comp.sent), b: comp.required, check: comp.sent >= comp.required ? ' ✓' : '' }), comp.sent >= comp.required ? 'ok' : comp.possible ? 'info' : 'bad'));
  }
  if (role === 'commander' || role === 'comms') {
    ap.capsule = capsule;
    if (phaseId === 'return' || a.capsule !== 'stowed') items.push(row('capsule', pm('label.capsule'), pm('v.capsule', { stage: STAGE_NAME(a.capsule), beacon: capsule.beacon ? pm('v.beacon') : '' }), a.capsule === 'found' ? 'ok' : a.capsule === 'lost' ? 'bad' : 'info', ['return_capsule']));
  }
  if (role === 'commander') {
    ap.fuel = fuel;
    ap.sample = sample;
    items.push(
      row('goal', pm('label.goal'), pm('v.astGoal', { sample: sampleText, comp: pm(comp && comp.sent >= comp.required ? 'v.compDone' : 'v.compNotYet') }), a.sample.collected ? 'ok' : a.sampling === 'failed' ? 'bad' : 'info'),
      row('fuel', pm('label.fuel'), pm('v.fuelPct', { pct: fuel.pct, short: fuel.enough ? '' : pm('v.fuelShort') }), fuel.enough ? 'ok' : 'bad'),
    );
  }
  panel.asteroid = ap;
}
