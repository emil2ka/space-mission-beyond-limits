// Shared flight helpers: which systems are active, loads, heat, telemetry. Pure.
import { THERMAL } from './constants';
import { COMPONENT_BY_ID } from './data/components';
import { TITAN } from './data/titan';
import type { Load } from './energy';
import { installed } from './stats';
import type { Telemetry } from './autonomy';
import type { FlightState } from './flight';
import { loadRank, taskHeat } from './tasks';
import type { Build, ComponentDef, CraftStats, MissionDef } from './types';
import { m, ru, type Msg } from './msg';

/** Science instruments: switched on only while the craft does science (entry + survey). */
export const isInstrument = (def: ComponentDef) => def.department === 'science' && !!def.consumption && def.id !== 'data_storage';
export const CAMERAS = ['hires_camera', 'wide_camera'];
/** Radio loads halved by the «economy link» option. */
export const LINK_LOADS = ['antenna_standard', 'antenna_high_gain', 'antenna_omni', 'signal_amp', 'deep_space_link', 'transceiver'];
export const ANTENNAS = ['antenna_standard', 'antenna_high_gain', 'antenna_omni'];

/** Name of a power line: a module name (English) or the frame / emergency line (Russian, see nameMsg). */
export const nameOf = (id: string): string => { const n = nameMsg(id); return typeof n === 'string' ? n : ru(n); };
/** nameOf as a message param: the frame / emergency lines are messages (`sim.frame` / `sim.extra`), modules stay plain names. */
export const nameMsg = (id: string): Msg | string => (id === 'frame' ? m('sim.frame') : id === 'extra' ? m('sim.extra') : COMPONENT_BY_ID[id]?.name ?? id);

/** What is switched on this tick. */
export interface Activity {
  rotor: boolean;
  science: boolean;
  cameras: boolean;
  /** Cruise: the craft is in space, heat loss is lower. */
  cruise: boolean;
  /** Asteroid: which mission-specific systems draw power this tick (undefined on Titan). */
  ast?: { chem: boolean; ion: boolean; arm: boolean; drill: boolean; sealer: boolean; beacon: boolean };
}

/** Asteroid systems switched by phase (Titan treats arm/drill/sealer as instruments and the rest as always on). */
const AST_SWITCH: Record<string, keyof NonNullable<Activity['ast']>> = {
  chem_main_engine: 'chem', chem_thrusters: 'chem', ion_engine: 'ion', robotic_arm: 'arm', drill: 'drill', sample_sealer: 'sealer', recovery_beacon: 'beacon',
};

/** Overweight share over the launcher limit (0 if within). */
export function overRatio(stats: CraftStats): number {
  return stats.mass > stats.massLimit ? (stats.mass - stats.massLimit) / stats.massLimit : 0;
}

export function rotorDrawFactor(stats: CraftStats) {
  return 1 + overRatio(stats) * TITAN.overweight.drawPerRatio;
}

export function overweightSpeed(stats: CraftStats) {
  return Math.max(TITAN.overweight.minSpeed, 1 - overRatio(stats) * TITAN.overweight.speedPerRatio);
}

/** Is this part switched on with this activity? Parts without consumption are always «on». */
export function isOn(def: ComponentDef, act: Activity): boolean {
  if (!def.consumption) return true;
  if (act.ast && AST_SWITCH[def.id]) return act.ast[AST_SWITCH[def.id]];
  if (def.id === 'rotor_system') return act.rotor;
  if (isInstrument(def)) return act.science && (act.cameras || !CAMERAS.includes(def.id));
  return true;
}

/** Loads that draw power with this activity (ignores `off` — stepEnergy filters it). */
export function loadsFor(f: FlightState, build: Build, mission: MissionDef, stats: CraftStats, act: Activity): Load[] {
  const loads: Load[] = [{ id: 'frame', watts: mission.baseLoad, priority: 1 }];
  const pdu = (build.pdu ?? 0) > 0 && !f.off.includes('pdu');
  for (const { def, count } of installed(build, f.mods)) {
    if (!def.consumption || !isOn(def, act)) continue;
    let watts = def.consumption * count;
    if (def.id === 'rotor_system') watts = Math.round(watts * rotorDrawFactor(stats));
    else if (f.ecoLink && LINK_LOADS.includes(def.id)) watts = watts / 2;
    const rank = loadRank(f.tasks, def.id, pdu);
    loads.push({ id: def.id, watts, priority: def.priority, ...(rank !== undefined ? { rank } : {}) });
  }
  if (f.extraLoad > 0) loads.push({ id: 'extra', watts: f.extraLoad, priority: 1 });
  return loads;
}

export const sumWatts = (loads: Load[], off: string[]) => loads.filter((l) => !off.includes(l.id)).reduce((s, l) => s + l.watts, 0);

/** Heat balance this tick: heat of working parts − environment loss through insulation. */
export function heatFor(f: FlightState, build: Build, mission: MissionDef, act: Activity, off: string[]): number {
  let heat = 0;
  let pass = 1;
  for (const { def, count } of installed(build, f.mods)) {
    if (def.insulation) pass *= Math.pow(1 - def.insulation, count);
    if (off.includes(def.id)) continue;
    if (!isOn(def, act)) continue; // switched-off parts don't heat
    let h = def.heat * count;
    if (f.ecoLink && LINK_LOADS.includes(def.id)) h /= 2;
    if (f.tasks && isInstrument(def)) h *= taskHeat(f.tasks); // measurement mode (Individual Tasks)
    heat += h;
  }
  const env = mission.envHeatLoss * (act.cruise ? TITAN.cruiseHeatLossFactor : 1) * pass;
  return Math.round(heat + f.heatAdj - env);
}

export function thermalOf(heat: number): FlightState['thermal'] {
  return heat <= THERMAL.freezing ? 'freezing'
    : heat <= THERMAL.cold ? 'cold'
    : heat >= THERMAL.overheat ? 'overheat'
    : heat >= THERMAL.hot ? 'hot'
    : 'nominal';
}

/** Everything on: used to judge whether a crisis is fixed for good (not just paused). */
export const PEAK: Activity = { rotor: true, science: true, cameras: true, cruise: false };
/** Asteroid peak: sampling at the surface — engines holding position, instruments, arm and drill. */
export const PEAK_ASTEROID: Activity = { rotor: false, science: true, cameras: true, cruise: false, ast: { chem: true, ion: false, arm: true, drill: true, sealer: false, beacon: false } };
export const peakFor = (f: Pick<FlightState, 'mission'>) => (f.mission === 'asteroid' ? PEAK_ASTEROID : PEAK);

export function memoryCap(stats: CraftStats) {
  return TITAN.builtInMemory + stats.storage;
}

export function memoryUsed(f: FlightState) {
  return f.targets.reduce((s, t) => s + t.stored, 0);
}

export function telemetry(f: FlightState, stats: CraftStats, signal: Telemetry['signal'] = f.signal): Telemetry {
  const cap = memoryCap(stats);
  return {
    signal,
    batteryPct: stats.capacityWh > 0 ? (f.stored / stats.capacityWh) * 100 : 0,
    thermal: f.thermal,
    hullPct: f.hull,
    bufferPct: cap > 0 ? (memoryUsed(f) / cap) * 100 : 100,
    sampleSecured: !!f.asteroid?.sample.collected,
    debris: !!f.asteroid?.debris,
  };
}

/** Pick loads to switch off until `need` watts are cut. With a PDU — by priority (5 first); without — biggest first. */
export function pickShed(loads: Load[], off: string[], need: number, hasPdu: boolean, filter: (l: Load) => boolean = () => true): string[] {
  const out: string[] = [];
  if (need <= 0) return out;
  const cand = loads
    .filter((l) => l.priority > 1 && !off.includes(l.id) && filter(l))
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || (hasPdu ? b.priority - a.priority || b.watts - a.watts : b.watts - a.watts));
  let cut = 0;
  for (const l of cand) {
    if (cut >= need) break;
    out.push(l.id);
    cut += l.watts;
  }
  return out;
}
