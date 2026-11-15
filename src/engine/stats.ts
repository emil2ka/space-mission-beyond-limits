// Craft statistics: mass, budget, energy, heat, comms, slots and issues.
// Recomputed from scratch after every change (ТЗ §6).
import { DEPARTMENTS, THERMAL } from './constants';
import { COMPONENT_BY_ID } from './data/components';
import { DEFAULT_EXTRA_SLOT, UPGRADE_FX } from './data/economy';
import type { AddCheck, Build, ComponentDef, CraftStats, Department, Issue, MissionDef, Mods, PowerLine } from './types';
import { join, m, ru, type Msg } from './msg';

export const NO_MODS: Mods = { upgrades: [] };
const ANTENNA_IDS = ['antenna_standard', 'antenna_high_gain', 'antenna_omni'];
const BATTERY_IDS = ['battery_hc', 'battery_backup'];

/** A component as the agency's upgrades change it (same object when nothing applies). */
export function effective(def: ComponentDef, mods: Mods = NO_MODS): ComponentDef {
  const up = mods.upgrades;
  if (!up.length) return def;
  let d = def;
  const set = (patch: Partial<ComponentDef>) => { d = { ...d, ...patch }; };
  if (up.includes('better_antennas') && ANTENNA_IDS.includes(def.id)) {
    set({ bandwidth: round1((def.bandwidth ?? 0) * UPGRADE_FX.antennaBandwidth), consumption: Math.round((def.consumption ?? 0) * UPGRADE_FX.antennaPower) });
  }
  if (up.includes('better_batteries') && BATTERY_IDS.includes(def.id)) {
    set({ capacityWh: Math.round((def.capacityWh ?? 0) * UPGRADE_FX.batteryCapacity), mass: def.mass + UPGRADE_FX.batteryMass });
  }
  if (up.includes('pdu_v2') && def.id === 'pdu') set({ consumption: UPGRADE_FX.pduV2Watts });
  if (up.includes('fc_v2') && def.id === 'flight_computer') {
    set({ ruleSlots: UPGRADE_FX.fcRules, consumption: (def.consumption ?? 0) + UPGRADE_FX.fcWatts, heat: def.heat + UPGRADE_FX.fcHeat });
  }
  return d;
}

/** Frame mass and slots with the agency's upgrades. */
export function frameOf(mission: MissionDef, mods: Mods = NO_MODS): { mass: number; slots: Record<Department, number> } {
  const up = mods.upgrades;
  let mass = mission.frameMass;
  if (up.includes('light_alloys')) mass = Math.round(mass * UPGRADE_FX.lightAlloysMass);
  const slots = { ...mission.slots };
  if (up.includes('extra_slot')) {
    mass += UPGRADE_FX.extraSlotMass;
    const dept = mods.extraSlot ?? DEFAULT_EXTRA_SLOT;
    if (slots[dept] > 0) slots[dept] += 1;
  }
  return { mass, slots };
}

const emptySlots = (): Record<Department, number> =>
  Object.fromEntries(DEPARTMENTS.map((d) => [d.id, 0])) as Record<Department, number>;

/** Department name as a message (common `dept.<id>`; same Russian as DEPARTMENTS). */
const deptMsg = (d: Department) => m(`dept.${d}`);

/** An issue whose text is a message: Russian `text` + `i18n.text`. */
const issue = (i: Omit<Issue, 'text' | 'i18n'>, msg: Msg): Issue => ({ ...i, text: ru(msg), i18n: { text: msg } });

/** A failed AddCheck: Russian `reason` + a non-enumerable `i18n.reason` (keeps `{ ok, reason }` deep-equal). */
const refuse = (msg: Msg): AddCheck => {
  const r = { ok: false as const, reason: ru(msg) };
  Object.defineProperty(r, 'i18n', { value: { reason: msg }, enumerable: false });
  return r;
};

export function installed(build: Build, mods?: Mods): { def: ComponentDef; count: number }[] {
  return Object.entries(build)
    .filter(([, n]) => n > 0)
    .map(([id, count]) => ({ def: COMPONENT_BY_ID[id], count }))
    .filter((x) => x.def)
    .map((x) => (mods ? { def: effective(x.def, mods), count: x.count } : x));
}

/** Effective generation of one unit of a component in a mission environment. */
export function unitGeneration(def: ComponentDef, mission: MissionDef): number {
  if (!def.generation) return 0;
  return def.id === 'solar_array' ? def.generation * mission.solarFactor : def.generation;
}

export function computeStats(build: Build, mission: MissionDef, mods: Mods = NO_MODS): CraftStats {
  const list = installed(build, mods);
  const has = (id: string) => (build[id] ?? 0) > 0;
  const frame = frameOf(mission, mods);

  let mass = frame.mass;
  let cost = mission.frameCost;
  let capacityWh = 0;
  let heat = 0;
  let blocked = 1; // fraction of env heat loss that passes through
  let bandwidth = 0;
  let storage = 0;
  let ruleSlots = 0;
  let busLimit = 0;
  const slotsUsed = emptySlots();
  const generationBySource: PowerLine[] = [];
  const consumptionByLoad: PowerLine[] = [{ id: 'frame', name: ru(m('sim.frame')), count: 1, watts: mission.baseLoad, i18n: { name: m('sim.frame') } }];

  for (const { def, count } of list) {
    mass += def.mass * count;
    cost += def.cost * count;
    slotsUsed[def.department] += count;
    capacityWh += (def.capacityWh ?? 0) * count;
    heat += def.heat * count;
    if (def.insulation) blocked *= Math.pow(1 - def.insulation, count);
    storage += (def.storage ?? 0) * count;
    ruleSlots += (def.ruleSlots ?? 0) * count;
    busLimit += (def.busLimit ?? 0) * count;

    let bw = (def.bandwidth ?? 0) * count;
    if (def.id === 'deep_space_link' && !has('antenna_high_gain')) bw = 0;
    if (def.id === 'signal_amp' && !hasAntenna(build)) bw = 0;
    if (def.department === 'comms' && def.bandwidth && !has('transceiver')) bw = 0;
    bandwidth += bw;

    const g = unitGeneration(def, mission);
    if (g > 0) generationBySource.push({ id: def.id, name: def.name, count, watts: round1(g * count) });
    if (def.consumption) consumptionByLoad.push({ id: def.id, name: def.name, count, watts: def.consumption * count });
  }

  consumptionByLoad.sort((a, b) => b.watts - a.watts);
  const generation = round1(generationBySource.reduce((s, l) => s + l.watts, 0));
  const consumption = consumptionByLoad.reduce((s, l) => s + l.watts, 0);
  const netPower = round1(generation - consumption);
  const hoursOfReserve = netPower < 0 ? capacityWh / -netPower : Infinity;
  const heatBalance = Math.round(heat - mission.envHeatLoss * blocked);
  const thermalState =
    heatBalance <= THERMAL.freezing ? 'freezing'
    : heatBalance <= THERMAL.cold ? 'cold'
    : heatBalance >= THERMAL.overheat ? 'overheat'
    : heatBalance >= THERMAL.hot ? 'hot'
    : 'nominal';

  const stats: CraftStats = {
    mass, massLimit: mission.massLimit, cost, budget: mission.budget,
    generation, generationBySource, consumption, consumptionByLoad, netPower,
    capacityWh, hoursOfReserve, heatBalance, thermalState,
    bandwidth, storage, ruleSlots, busLimit,
    slotsUsed, slotsTotal: frame.slots,
    issues: [],
  };
  if (mods.upgrades.length) stats.upgrades = [...mods.upgrades];
  if (mods.upgrades.includes('pdu_v2') && has('pdu')) stats.smartShed = true;
  stats.issues = findIssues(build, mission, stats);
  return stats;
}

function hasAntenna(build: Build) {
  return ['antenna_standard', 'antenna_high_gain', 'antenna_omni'].some((id) => (build[id] ?? 0) > 0);
}

function findIssues(build: Build, mission: MissionDef, s: CraftStats): Issue[] {
  const issues: Issue[] = [];
  const add = (i: Issue) => issues.push(i);

  for (const r of mission.requirements) {
    if (!r.anyOf.some((id) => (build[id] ?? 0) > 0)) {
      add({ id: `req:${r.anyOf.join('|')}`, severity: 'critical', text: r.reason, componentIds: r.anyOf, roles: ['commander', 'engineer'] });
    }
  }

  if (s.mass > s.massLimit) {
    add(issue({ id: 'mass', severity: 'critical', componentIds: [], roles: ['commander', 'engineer'] }, m('issue.mass', { over: s.mass - s.massLimit, mass: s.mass, limit: s.massLimit })));
  } else if (s.mass > s.massLimit * 0.9) {
    add(issue({ id: 'mass-near', severity: 'warn', componentIds: [], roles: ['commander', 'engineer'] }, m('issue.massNear', { mass: s.mass, limit: s.massLimit })));
  }
  if (s.cost > s.budget) {
    add(issue({ id: 'budget', severity: 'critical', componentIds: [], roles: ['commander'] }, m('issue.budget', { over: s.cost - s.budget })));
  }

  if (s.generation <= 0 && s.consumption > 0) {
    add(issue({ id: 'no-gen', severity: 'critical', componentIds: ['rtg', 'solar_array'], roles: ['engineer', 'commander'] }, m('issue.noGen')));
  } else if (s.netPower < 0) {
    const top = join(s.consumptionByLoad.slice(0, 3).map((l) => m('issue.load', { name: l.i18n?.name ?? l.name, w: l.watts })), ', ');
    const src = s.generationBySource.length ? join(s.generationBySource.map((l) => m('issue.source', { name: l.i18n?.name ?? l.name, n: l.count, w: l.watts })), ', ') : m('common.none');
    const reserve = s.capacityWh > 0 ? m('issue.reserve', { time: fmtHoursMsg(s.hoursOfReserve) }) : m('issue.noReserve');
    add(issue({
      id: 'deficit', severity: 'warn',
      componentIds: s.consumptionByLoad.slice(0, 3).map((l) => l.id), roles: ['engineer', 'science'],
    }, m('issue.deficit', { w: -s.netPower, top, src, reserve })));
  }

  if ((build.solar_array ?? 0) > 0 && mission.solarFactor < 0.1) {
    add(issue({ id: 'solar-weak', severity: 'warn', componentIds: ['solar_array'], roles: ['engineer'] }, m('issue.solarWeak', { f: mission.solarFactor })));
  }

  if (s.busLimit > 0 && s.consumption > s.busLimit) {
    add(issue({ id: 'bus-overload', severity: 'critical', componentIds: ['power_bus'], roles: ['engineer'] }, m('issue.busOverload', { w: s.consumption, limit: s.busLimit })));
  }

  if (s.thermalState === 'freezing') add(issue({ id: 'freeze', severity: 'critical', componentIds: ['thermal_insulation', 'heater'], roles: ['engineer', 'science'] }, m('issue.freeze', { h: s.heatBalance })));
  if (s.thermalState === 'cold') add(issue({ id: 'cold', severity: 'warn', componentIds: ['thermal_insulation', 'heater'], roles: ['engineer', 'science'] }, m('issue.cold', { h: s.heatBalance })));
  if (s.thermalState === 'overheat') add(issue({ id: 'overheat', severity: 'critical', componentIds: ['thermal_radiator'], roles: ['engineer'] }, m('issue.overheat', { h: s.heatBalance })));
  if (s.thermalState === 'hot') add(issue({ id: 'hot', severity: 'warn', componentIds: ['thermal_radiator'], roles: ['engineer'] }, m('issue.hot', { h: s.heatBalance })));

  if ((build.deep_space_link ?? 0) > 0 && !(build.antenna_high_gain > 0)) {
    add(issue({ id: 'dsl-no-hga', severity: 'warn', componentIds: ['deep_space_link', 'antenna_high_gain'], roles: ['comms'] }, m('issue.dslNoHga')));
  }
  if (hasAntenna(build) && !(build.transceiver > 0)) {
    add(issue({ id: 'no-transceiver', severity: 'critical', componentIds: ['transceiver'], roles: ['comms'] }, m('issue.noTransceiver')));
  }

  for (const { def } of installed(build)) {
    const fit = def.fit[mission.id];
    if (fit.need === 'incompatible') add(issue({ id: `incompat:${def.id}`, severity: 'critical', componentIds: [def.id], roles: def.roles }, m('issue.incompat', { name: def.name, why: fit.why })));
    if (fit.need === 'useless') add(issue({ id: `useless:${def.id}`, severity: 'info', componentIds: [def.id], roles: ['commander'] }, m('issue.useless', { name: def.name, why: fit.why })));
  }
  return issues;
}

/** Can one more unit be installed? Budget, slots, instances, compatibility block. Mass only warns (commander may accept the risk, ТЗ test C). */
export function canAdd(build: Build, id: string, mission: MissionDef, mods: Mods = NO_MODS): AddCheck {
  const def = COMPONENT_BY_ID[id];
  if (!def) return refuse(m('add.unknown'));
  const fit = def.fit[mission.id];
  if (fit.need === 'incompatible') return { ok: false, reason: fit.why };
  const count = build[id] ?? 0;
  if (count >= def.maxInstances) return refuse(m('add.max', { n: def.maxInstances }));
  const total = frameOf(mission, mods).slots[def.department];
  const used = installed(build).filter((x) => x.def.department === def.department).reduce((s, x) => s + x.count, 0);
  if (total === 0) return refuse(m('add.noSlots', { dept: deptMsg(def.department) }));
  if (used >= total) return refuse(m('add.slotsFull', { dept: deptMsg(def.department), used, total }));
  const s = computeStats(build, mission, mods);
  if (s.cost + def.cost > s.budget) return refuse(m('add.budget', { need: def.cost, left: s.budget - s.cost }));
  return { ok: true };
}

export function addComponent(build: Build, id: string): Build {
  return { ...build, [id]: (build[id] ?? 0) + 1 };
}

export function removeComponent(build: Build, id: string): Build {
  const n = (build[id] ?? 0) - 1;
  const next = { ...build };
  if (n > 0) next[id] = n;
  else delete next[id];
  return next;
}

export function fmtHours(h: number): string {
  const msg = fmtHoursMsg(h);
  return typeof msg === 'string' ? msg : ru(msg);
}

/** fmtHours as a message (common `unit.min` / `unit.h`); '∞' stays a plain string. */
export function fmtHoursMsg(h: number): Msg | string {
  if (!isFinite(h)) return '∞';
  if (h < 1) return m('unit.min', { n: Math.round(h * 60) });
  return m('unit.h', { n: round1(h) });
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}
