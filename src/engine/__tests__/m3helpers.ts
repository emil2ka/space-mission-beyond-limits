// Shared helpers for the M3 tests (asteroid + economy): demo room driven through the reducer.
import { createRoom, reduce, type Action, type RoomState } from '../room';
import { exportAgency, newAgency, type Agency } from '../economy';
import type { AutonomyRule } from '../autonomy';
import type { FlightState } from '../flight';
import type { Build, MissionId, RoleId } from '../types';

export const H = 'h';

export const apply = (s: RoomState, a: Action): RoomState => {
  const r = reduce(s, a);
  if (r.error) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
};
export const err = (s: RoomState, a: Action) => reduce(s, a).error;
export const as = (s: RoomState, role: RoleId) => (s.players[0].role === role ? s : apply(s, { type: 'pickRole', playerId: H, role }));

/** Demo room (one player switching roles) in the build stage of `mission`, with an agency loaded in the lobby. */
export function roomInBuild(mission: MissionId, seed = 7, agency: Partial<Agency> = {}): RoomState {
  let s = createRoom('ABCDEF', { id: H, name: 'Host' }, seed, true);
  const ag = { ...newAgency(), unlocked: ['titan', 'asteroid'] as MissionId[], ...agency };
  s = apply(s, { type: 'loadAgency', playerId: H, agency: exportAgency(ag) });
  s = apply(s, { type: 'pickRole', playerId: H, role: 'commander' });
  s = apply(s, { type: 'setReady', playerId: H, ready: true });
  if (mission !== 'titan') s = apply(s, { type: 'selectMission', playerId: H, mission });
  s = apply(s, { type: 'goStage', playerId: H, stage: 'briefing' });
  return apply(s, { type: 'goStage', playerId: H, stage: 'build' });
}

export function install(s: RoomState, build: Build): RoomState {
  for (const [id, n] of Object.entries(build)) for (let i = 0; i < n; i++) s = apply(s, { type: 'addComponent', playerId: H, id });
  return s;
}

export function launch(s: RoomState): RoomState {
  s = apply(s, { type: 'submitReview', playerId: H });
  s = apply(as(s, 'commander'), { type: 'approve', playerId: H });
  return apply(s, { type: 'launchDone', playerId: H });
}

export type Policy = (s: RoomState) => Action[];

export function fly(s: RoomState, policy?: Policy, onTick?: (f: FlightState) => void): RoomState {
  let guard = 0;
  while (s.stage === 'flight' && guard++ < 2000) {
    if (policy) for (const a of policy(s)) { const r = reduce(s, a); if (!r.error) s = r.state; }
    if (s.stage !== 'flight') break;
    s = apply(s, { type: 'tick', playerId: H });
    if (s.flight) onTick?.(s.flight);
  }
  return s;
}

export function run(mission: MissionId, build: Build, opts: { seed?: number; rules?: AutonomyRule[]; policy?: Policy; onTick?: (f: FlightState) => void; agency?: Partial<Agency> } = {}) {
  let s = install(roomInBuild(mission, opts.seed ?? 7, opts.agency), build);
  if (opts.rules) s = apply(as(s, 'engineer'), { type: 'setRules', playerId: H, rules: opts.rules });
  s = launch(s);
  return fly(s, opts.policy, opts.onTick);
}

/** Pick an option of each role from a preference list (first match wins). */
export function pick(prefer: string[]): Policy {
  return (s) => {
    const c = s.flight!.crisis;
    if (!c) return [];
    const out: Action[] = [];
    for (const role of ['commander', 'engineer', 'science', 'comms'] as RoleId[]) {
      if (c.chosen[role]) continue;
      const o = prefer.map((id) => c.options.find((x) => x.id === id && x.role === role)).find(Boolean);
      if (o) out.push({ type: 'pickRole', playerId: H, role }, { type: 'crisisChoice', playerId: H, optionId: o.id });
    }
    return out;
  };
}

export const both = (...ps: Policy[]): Policy => (s) => ps.flatMap((p) => p(s));

// ── Reference builds ──

/** Titan builds from flight.test.ts. */
export const TITAN_GOOD: Build = {
  rtg: 2, battery_hc: 1, power_bus: 2, pdu: 1, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1,
  thermal_radiator: 1, thermal_insulation: 1, atmo_sensor: 1, wide_camera: 1, temp_sensor: 1, spectrometer: 1, data_storage: 1, landing_system: 1,
};
export const TITAN_BAD: Build = {
  rtg: 1, battery_hc: 1, power_bus: 1, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1, spectrometer: 1, hires_camera: 1, atmo_sensor: 1,
};
export const titanTeam: Policy = (s) => {
  const f = s.flight!;
  const wp = f.waypoints[f.waypointIndex];
  const out: Action[] = [];
  if (wp && wp.mode === null) out.push({ type: 'pickRole', playerId: H, role: 'science' }, { type: 'scienceMode', playerId: H, waypoint: wp.id, mode: 'precise' });
  return [...out, ...pick(['sd_point', 'sd_retune', 'pd_shed_hungry', 'pd_isolate', 'oh_land_cool', 'fr_heater_max', 'fr_route_heat', 'fr_sleep', 'sd_continue'])(s)];
};

/** Asteroid: chemical drive, 4 solar panels, shield, dampers, sealer, beacon — within budget/slots/mass. */
export const AST_GOOD: Build = {
  solar_array: 4, battery_hc: 1, power_bus: 1, chem_thrusters: 1, propellant_tank: 2, nav_camera: 1, flight_computer: 1,
  robotic_arm: 1, sample_container: 1, sample_sealer: 1, spectrometer: 1, data_buffer: 1, transceiver: 1, antenna_standard: 1,
  return_capsule: 1, heat_shield: 1, parachute: 1, recovery_beacon: 1, micrometeoroid_shield: 1, vibration_dampers: 1,
};
/** Same craft on an Ion Engine (one tank is enough); the budget leaves out the shield and dampers. */
export const AST_ION: Build = { ...AST_GOOD, propellant_tank: 1, ion_engine: 1, micrometeoroid_shield: 0, vibration_dampers: 0 };
/** Cheap and risky: one tank, no shield / dampers / sealer / beacon / nav camera. */
export const AST_BAD: Build = {
  solar_array: 4, battery_hc: 1, power_bus: 1, chem_thrusters: 1, propellant_tank: 1, flight_computer: 1,
  robotic_arm: 1, sample_container: 1, spectrometer: 1, wide_camera: 1, transceiver: 1, antenna_standard: 1,
  return_capsule: 1, heat_shield: 1, parachute: 1,
};

/** Science picks `site` as soon as it can; sensible crisis answers. */
export const astTeam = (site: 'regolith' | 'boulder' | 'crack' = 'crack'): Policy => both(
  (s) => {
    const f = s.flight!;
    if (f.asteroid && !f.asteroid.site && f.phaseIndex >= 1 && f.phaseIndex <= 2) return [{ type: 'pickRole', playerId: H, role: 'science' }, { type: 'chooseSite', playerId: H, site }];
    return [];
  },
  pick(['da_evade', 'da_brace', 'da_repoint', 'aj_restart', 'aj_inspect', 'aj_save', 'pd_shed_hungry', 'pd_isolate', 'oh_land_cool']),
);
