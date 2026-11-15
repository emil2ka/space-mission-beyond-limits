// Asteroid Sample Return flight (M3 contract, part A). Called from stepFlight for mission 'asteroid'.
// Phases: cruise → approach → site → sampling → stow → return (capsule stages inside the return).
// Shared Titan mechanics (energy, heat, data, signal, autonomy, blackout, Power Drop / Overheat) stay in flight.ts.
import { ASTEROID, SITE_BY_ID, type AsteroidSiteId, type CapsuleStage } from './data/asteroid';
import { evaluateRules, type AutonomyRule } from './autonomy';
import { noteRulesFired, trackCommand } from './blackout';
import { rng } from './rng';
import { overRatio, telemetry, type Activity } from './sim';
import { installed } from './stats';
import type { CauseEvent, FlightState } from './flight';
import type { Build, CraftStats } from './types';
import { m, ru, type Msg } from './msg';

/** Cause-event text + its message. */
const ev = (msg: Msg) => ({ text: ru(msg), i18n: { text: msg } });

export type { AsteroidSiteId, CapsuleStage } from './data/asteroid';

export interface AsteroidFlight {
  // ── M3 contract ──
  fuel: number;
  fuelMax: number;
  /** 0..1 closing in on the asteroid (for 3D). */
  approach: number;
  site: AsteroidSiteId | null;
  sampling: 'idle' | 'reach' | 'grab' | 'jam' | 'stowed' | 'failed';
  sample: { collected: boolean; sealed: boolean; mass: number };
  capsule: CapsuleStage;
  /** 0..1 inside the current capsule stage (for 3D entry / parachute). */
  capsuleProgress: number;
  /** Debris Alert is on (for 3D). */
  debris: boolean;

  // ── extra (engine-owned, read-only for UI) ──
  /** Engine doing the transfer right now: Ion Engine if it works, otherwise chemical. */
  drive: 'ion' | 'chem';
  /** 0..1 along the current transfer (outbound cruise, then the way home). */
  cruise: number;
  /** 0..1 of the current sampling attempt. */
  samplingProgress: number;
  /** Tool in use. */
  tool: 'arm' | 'drill' | 'both' | null;
  /** 0..1 of sealing in the stow phase. */
  sealProgress: number;
  /** Who picked the site. */
  siteBy: 'science' | 'auto' | null;
  /** Fuel burned by purpose (report). */
  fuelUsed: { cruise: number; approach: number; station: number; evade: number; return: number };
  /** Fuel that was missing on burns. */
  fuelShort: number;
  /** The craft never got close enough: no sampling possible. */
  approachFailed: boolean;
  /** Capsule comes in off the planned point (short return burn). */
  offTarget: boolean;
  /** Heat Shield was damaged (debris) — the sample overheated on entry. */
  heated: boolean;
  /** The arm was hit by debris: jams far more likely. */
  armDamaged: boolean;
  /** Arm moves again from this tick (reach, restart, retry, Safe Protocol park). */
  resumeAt: number;
  /** Sampling speed multiplier after a careful restart. */
  rateFactor: number;
  /** A jam was reached and waits for its crisis (or a crisis is open). */
  jamPending: boolean;
  jamDone: boolean;
  /** Debris stream arrived and waits for its crisis. */
  debrisPending: boolean;
  debrisDone: boolean;
  /** Damage the debris did (report). */
  debrisHull: number;
  sampleTick: number;
  foundTick: number;
  /** Flight tick when each capsule stage began. */
  stageTicks: Partial<Record<CapsuleStage, number>>;
  /** «Sample Secured → prepare return» already fired. */
  prepFired: boolean;
  attempts: number;
}

const has = (build: Build, id: string) => (build[id] ?? 0) > 0;
const works = (n: FlightState, build: Build, id: string) => has(build, id) && !n.off.includes(id) && !n.broken.includes(id);

/** Burns get more expensive for an overweight craft. */
const fuelFactor = (stats: CraftStats) => 1 + overRatio(stats) * ASTEROID.overweightFuel;

export function initAsteroid(build: Build): AsteroidFlight {
  const fuelMax = (build.propellant_tank ?? 0) * ASTEROID.fuelPerTank;
  return {
    fuel: fuelMax, fuelMax, approach: 0, site: null, sampling: 'idle', sample: { collected: false, sealed: false, mass: 0 },
    capsule: 'stowed', capsuleProgress: 0, debris: false,
    drive: has(build, 'ion_engine') ? 'ion' : 'chem', cruise: 0, samplingProgress: 0, tool: null, sealProgress: 0, siteBy: null,
    fuelUsed: { cruise: 0, approach: 0, station: 0, evade: 0, return: 0 }, fuelShort: 0,
    approachFailed: false, offTarget: false, heated: false, armDamaged: false, resumeAt: 0, rateFactor: 1,
    jamPending: false, jamDone: false, debrisPending: false, debrisDone: false, debrisHull: 0,
    sampleTick: -1, foundTick: -1, stageTicks: {}, prepFired: false, attempts: 0,
  };
}

/** Seeded debris plan: approach tick it arrives at and whether it hits (always without Micrometeoroid Shield). */
export function debrisPlan(seed: number, build: Build): { at: number; hits: boolean } {
  const r = rng((seed ^ 0x2c1b3c6d) >>> 0);
  const [a, b] = ASTEROID.debris.window;
  const at = a + Math.floor(r() * (b - a));
  return { at, hits: !has(build, 'micrometeoroid_shield') || r() < ASTEROID.debris.chanceWithShield };
}

/** Jam risk 0..1+ from the build and the site (Vibration Dampers lower it, a bent arm raises it). */
export function jamRisk(build: Build, site: AsteroidSiteId, armDamaged = false): number {
  const d = ASTEROID.jam;
  const dampers = has(build, 'vibration_dampers');
  let risk = SITE_BY_ID[site].jamRisk + (dampers ? d.dampers : d.noDampers);
  if (!dampers && has(build, 'drill')) risk += d.drillNoDampers;
  if (armDamaged) risk += d.armDamaged;
  return Math.round(risk * 100) / 100;
}

/** Seeded jam plan: progress the jam hits at and whether it hits at all. */
export function jamPlan(seed: number, build: Build, site: AsteroidSiteId, armDamaged = false): { at: number; hits: boolean; risk: number } {
  const r = rng((seed ^ 0x1b873593) >>> 0);
  const [a, b] = ASTEROID.jam.at;
  const at = a + r() * (b - a);
  const risk = jamRisk(build, site, armDamaged);
  return { at, hits: r() < risk, risk };
}

/** Tool from what works now. */
function toolNow(n: FlightState, build: Build): AsteroidFlight['tool'] {
  const arm = works(n, build, 'robotic_arm');
  const drill = works(n, build, 'drill');
  return arm && drill ? 'both' : arm ? 'arm' : drill ? 'drill' : null;
}

export function toolRate(tool: AsteroidFlight['tool'], site: AsteroidSiteId): number {
  const s = SITE_BY_ID[site];
  if (tool === 'arm') return s.armRate;
  if (tool === 'drill') return s.drillRate;
  if (tool === 'both') return Math.max(s.armRate, s.drillRate) + Math.min(s.armRate, s.drillRate) * ASTEROID.sampling.drillAssist;
  return 0;
}

export const toolName = (tool: AsteroidFlight['tool']) => (tool === 'drill' ? 'Бур' : 'Рука');

export const SCIENCE_PHASES_ASTEROID = ['approach', 'site', 'sampling', 'stow'];

/** What draws power this tick on the asteroid. */
export function asteroidActivity(n: FlightState, build: Build, phaseId: string, pt: number, held: boolean, science: boolean, cameras: boolean): Activity {
  const a = n.asteroid!;
  const t = n.tick;
  const R = ASTEROID.return;
  const ionOk = has(build, 'ion_engine');
  const grabbing = phaseId === 'sampling' && !held && t >= a.resumeAt && (a.sampling === 'reach' || a.sampling === 'grab');
  return {
    rotor: false, science, cameras, cruise: false,
    ast: {
      chem: phaseId === 'approach' || phaseId === 'site' || phaseId === 'sampling' || (phaseId === 'cruise' && !ionOk) || (phaseId === 'return' && pt < R.burnTicks),
      ion: ionOk && (phaseId === 'cruise' || (phaseId === 'return' && pt >= R.burnTicks && pt < R.separateAt)),
      arm: grabbing && (a.tool === 'arm' || a.tool === 'both'),
      drill: grabbing && a.sampling === 'grab' && (a.tool === 'drill' || a.tool === 'both'),
      sealer: phaseId === 'stow' && a.sample.collected && !a.sample.sealed && !held,
      beacon: phaseId === 'return' && pt >= R.separateAt,
    },
  };
}

type Cause = (e: Omit<CauseEvent, 'tick'>) => void;

function burn(a: AsteroidFlight, amount: number, purpose: keyof AsteroidFlight['fuelUsed']): number {
  const take = Math.min(a.fuel, amount);
  a.fuel = Math.round((a.fuel - take) * 1000) / 1000;
  a.fuelUsed[purpose] = Math.round((a.fuelUsed[purpose] + take) * 1000) / 1000;
  return amount - take;
}

/** One asteroid tick: fuel, transfer, approach, sampling, sealing, capsule. `pt` = phase tick before this one. */
export function stepAsteroid(
  n: FlightState, build: Build, stats: CraftStats, phaseId: string, pt: number, held: boolean, rules: AutonomyRule[], cause: Cause,
): void {
  const a = n.asteroid!;
  const t = n.tick;
  const k = fuelFactor(stats);
  const ionWorks = works(n, build, 'ion_engine');
  const chemWorks = works(n, build, 'chem_main_engine') || works(n, build, 'chem_thrusters');

  if (t === 1 && overRatio(stats) > 0) {
    const over = stats.mass - stats.massLimit;
    cause({ kind: 'mass', ref: 'overweight', causeIds: ['mass', ...heaviest(build)], ...ev(m('ast.overweight', { over, pct: Math.round((k - 1) * 100) })) });
  }

  // ── Transfer (out and home) ──
  if (phaseId === 'cruise' || (phaseId === 'return' && pt >= ASTEROID.return.burnTicks && pt < ASTEROID.return.separateAt)) {
    const prev = a.drive;
    a.drive = ionWorks ? 'ion' : 'chem';
    if (prev === 'ion' && a.drive === 'chem' && has(build, 'ion_engine')) {
      cause({ kind: 'shed', ref: 'ion-lost', causeIds: ['ion_engine', ...(n.off.includes('ion_engine') ? ['deficit'] : [])], ...ev(m('ast.ionLost', { off: n.off.includes('ion_engine') ? m('ast.ionLostOff') : null })) });
    }
    if (phaseId === 'cruise') {
      const C = ASTEROID.cruise;
      let rate = 1 / C.ionTicks;
      if (a.drive === 'ion') burn(a, C.ionFuel * k, 'cruise');
      else if (chemWorks && a.fuel > 0) { burn(a, C.chemFuel * k, 'cruise'); rate = 1 / C.chemTicks; }
      a.cruise = Math.min(1, a.cruise + rate);
    } else {
      if (a.drive === 'ion') burn(a, ASTEROID.return.ionFuel * k, 'return');
      a.cruise = Math.min(1, (pt - ASTEROID.return.burnTicks + 1) / (ASTEROID.return.separateAt - ASTEROID.return.burnTicks));
    }
  }

  // ── Approach ──
  if (phaseId === 'approach') {
    const A = ASTEROID.approach;
    const nav = A.navIds.some((id) => works(n, build, id));
    if (held || t < n.holdUntil) burn(a, ASTEROID.samplingFuel * k, 'station');
    else if (!chemWorks) {
      if (!n.causes.some((c) => c.ref === 'approach-no-engine')) cause({ kind: 'route', ref: 'approach-no-engine', causeIds: ['chem_thrusters', 'chem_main_engine', 'deficit'], ...ev(m('ast.approachNoEngine')) });
    } else if (a.fuel <= 0) {
      if (!n.causes.some((c) => c.ref === 'fuel-empty')) cause({ kind: 'route', ref: 'fuel-empty', causeIds: ['propellant_tank', 'fuel'], ...ev(m('ast.fuelEmpty')) });
    } else {
      const short = burn(a, A.fuel * k, 'approach');
      if (short > 0) a.fuelShort += short;
      a.approach = Math.min(1, a.approach + 1 / (nav ? A.navTicks : A.blindTicks));
    }
  }
  if (phaseId === 'site' || phaseId === 'sampling') burn(a, ASTEROID.samplingFuel * k, 'station');

  // ── Sampling ──
  if (phaseId === 'sampling' && a.site) {
    if ((a.sampling === 'reach' || a.sampling === 'grab') && !held && t >= a.resumeAt) {
      const tool = toolNow(n, build);
      if (tool !== a.tool && tool) {
        if (a.tool) cause({ kind: 'science', ref: 'tool-switch', causeIds: [a.tool === 'drill' ? 'drill' : 'robotic_arm'], ...ev(m('ast.toolSwitch', { tool: m(tool === 'drill' ? 'ast.toolSwitchDrill' : tool === 'arm' ? 'ast.toolSwitchArm' : 'ast.toolSwitchBoth') })) });
        a.tool = tool;
      }
      if (!tool) {
        if (!n.causes.some((c) => c.ref === 'tool-off')) cause({ kind: 'shed', ref: 'tool-off', causeIds: ['robotic_arm', 'drill', ...(n.off.includes('robotic_arm') || n.off.includes('drill') ? ['deficit'] : [])], ...ev(m('ast.toolOff')) });
      } else if (a.sampling === 'reach') {
        a.sampling = 'grab';
      } else {
        const before = a.samplingProgress;
        a.samplingProgress = Math.min(1, a.samplingProgress + toolRate(tool, a.site) * a.rateFactor);
        if (!a.jamDone && !a.jamPending) {
          const plan = n.jamPlan;
          if (plan && plan.hits && before < plan.at && a.samplingProgress >= plan.at) {
            a.samplingProgress = plan.at;
            a.sampling = 'jam';
            a.jamPending = true;
          }
        }
        if (a.sampling === 'grab' && a.samplingProgress >= 1) collect(n, a, 1, cause);
      }
    }
    // «Sample Secured → prepare return»: rule moves straight to packing.
    if (a.sample.collected && !a.prepFired) {
      const fired = evaluateRules(rules, telemetry(n, stats), build, stats.ruleSlots).filter((r) => r.action === 'prepare_return');
      if (fired.length) {
        a.prepFired = true;
        noteRulesFired(n, rules, fired, 'flight', m('ast.ctx.prepare'));
      }
    }
  }

  // ── Stow: seal the sample ──
  if (phaseId === 'stow' && a.sample.collected && !a.sample.sealed) {
    if (works(n, build, 'sample_sealer') && !held) {
      a.sealProgress = Math.min(1, a.sealProgress + 1 / ASTEROID.stow.sealTicks);
      if (a.sealProgress >= 1) {
        a.sample.sealed = true;
        cause({ kind: 'science', ref: 'sealed', causeIds: ['sample_sealer'], ...ev(m('ast.sealed', { mass: a.sample.mass })) });
      }
    }
  }

  // ── Return: burn, then capsule stages ──
  if (phaseId === 'return') {
    const R = ASTEROID.return;
    if (pt === 0) {
      const need = (ionWorks ? R.ionBurn : R.chemBurn) * k;
      const short = chemWorks ? burn(a, need, 'return') : need;
      if (short > 0.01) {
        a.fuelShort += short;
        a.offTarget = true;
        cause({ kind: 'route', ref: 'fuel-short', causeIds: ['propellant_tank', 'fuel', ...(chemWorks ? [] : ['chem_thrusters', 'chem_main_engine'])], ...ev(m('ast.fuelShort', { fuel: Math.round(short) })) });
      } else cause({ kind: 'route', ref: 'return-burn', causeIds: [], ...ev(m('ast.returnBurn', { ion: ionWorks ? m('ast.returnBurnIon') : null, fuel: Math.round(a.fuel) })) });
    }
    const stage = (s: CapsuleStage, from: number, len: number) => {
      if (a.capsule !== s && !a.stageTicks[s]) {
        a.capsule = s;
        a.stageTicks[s] = t;
        onStage(n, build, s, cause);
      }
      a.capsuleProgress = len > 0 ? Math.min(1, (pt - from + 1) / len) : 1;
    };
    if (pt >= R.landAt) {
      const findAt = works(n, build, 'recovery_beacon') ? R.landAt + R.beaconFind : !a.offTarget ? R.landAt + R.searchFind : Infinity;
      if (a.capsule !== 'found' && a.capsule !== 'lost') stage('landed', R.landAt, 1);
      if (pt >= findAt && a.capsule === 'landed') {
        a.capsule = 'found';
        a.stageTicks.found = t;
        a.foundTick = t;
        a.capsuleProgress = 1;
        const beacon = works(n, build, 'recovery_beacon');
        cause({ kind: 'route', ref: 'capsule-found', causeIds: beacon ? ['recovery_beacon'] : [], ...ev(m(beacon ? 'ast.foundBeacon' : 'ast.foundVisual')) });
      }
    } else if (pt >= R.chuteAt) stage('chute', R.chuteAt, R.landAt - R.chuteAt);
    else if (pt >= R.entryAt) stage('entry', R.entryAt, R.chuteAt - R.entryAt);
    else if (pt >= R.separateAt) stage('separated', R.separateAt, R.entryAt - R.separateAt);
  }
  a.debris = !!n.crisis && n.crisis.kind === 'debris_alert';
}

function onStage(n: FlightState, build: Build, s: CapsuleStage, cause: Cause) {
  const a = n.asteroid!;
  if (s === 'separated') cause({ kind: 'phase', ref: 'capsule-separated', causeIds: [], ...ev(m('ast.separated', { inside: a.sample.collected ? m('ast.separatedSample', { mass: a.sample.mass, sealed: m(a.sample.sealed ? 'ast.separatedSealed' : 'ast.separatedUnsealed') }) : m('ast.separatedEmpty') })) });
  if (s === 'entry') {
    if (n.broken.includes('heat_shield')) {
      a.heated = a.sample.collected;
      cause({ kind: 'thermal', ref: 'heat-shield-damaged', causeIds: ['heat_shield', 'debris', 'micrometeoroid_shield'], ...ev(m('ast.entryDamaged', { sample: a.sample.collected ? m('ast.entryDamagedSample') : null })) });
    } else cause({ kind: 'phase', ref: 'capsule-entry', causeIds: ['heat_shield'], ...ev(m('ast.entry', { off: a.offTarget ? m('ast.entryOffTarget') : null })) });
  }
  if (s === 'chute') cause({ kind: 'phase', ref: 'capsule-chute', causeIds: ['parachute'], ...ev(m('ast.chute')) });
  if (s === 'landed') cause({ kind: 'phase', ref: 'capsule-landed', causeIds: [], ...ev(m('ast.landed', { where: m(a.offTarget ? 'ast.landedFar' : 'ast.landedOn'), beacon: has(build, 'recovery_beacon') ? null : m('ast.landedNoBeacon') })) });
}

function collect(n: FlightState, a: AsteroidFlight, share: number, cause: Cause) {
  const site = SITE_BY_ID[a.site!];
  a.sample.collected = true;
  a.sample.mass = Math.round(site.mass * share);
  a.sampling = 'stowed';
  a.sampleTick = n.tick;
  cause({ kind: 'science', ref: share >= 1 ? 'sample-collected' : 'sample-partial', causeIds: a.tool === 'drill' ? ['drill'] : ['robotic_arm'], ...ev(share >= 1 ? m('ast.collected', { mass: a.sample.mass, site: site.name }) : m('ast.partial', { mass: a.sample.mass, full: site.mass })) });
}

/** Stop sampling now and keep what is in the claw (if enough), else the sampling failed. */
export function keepWhatWeHave(n: FlightState, min: number, cause: Cause): boolean {
  const a = n.asteroid!;
  if (a.sample.collected) return true;
  if (a.samplingProgress >= min && a.site) { collect(n, a, a.samplingProgress, cause); return true; }
  a.sampling = 'failed';
  return false;
}

/** Early phase end for the asteroid (Titan's survey ends early the same way). */
export function asteroidPhaseDone(n: FlightState, phaseId: string): boolean {
  const a = n.asteroid!;
  if (phaseId === 'cruise') return a.cruise >= 1;
  if (phaseId === 'approach') return a.approach >= 1 && !n.crisis;
  if (phaseId === 'sampling') return a.prepFired && !n.crisis;
  return false;
}

/** Leaving a phase. */
export function onAsteroidPhaseEnd(n: FlightState, build: Build, phaseId: string, cause: Cause) {
  const a = n.asteroid!;
  if (phaseId === 'approach') {
    a.debrisPending = false;
    if (a.approach < 1) {
      a.approachFailed = true;
      const ids = [...(a.fuel <= 0 ? ['propellant_tank', 'fuel'] : []), ...(ASTEROID.approach.navIds.some((id) => has(build, id)) ? [] : ['nav_camera', 'radar_altimeter']), ...(n.causes.some((c) => c.ref === 'approach-no-engine') ? ['chem_thrusters', 'deficit'] : []), ...(n.stoppedTicks > 0 ? ['holds'] : [])];
      cause({ kind: 'route', ref: 'approach-failed', causeIds: ids.length ? ids : ['holds'], ...ev(m('ast.approachFailed', { pct: Math.round(a.approach * 100) })) });
    }
  }
  if (phaseId === 'site' && !a.site && !a.approachFailed) {
    a.site = 'regolith';
    a.siteBy = 'auto';
    cause({ kind: 'science', ref: 'site-auto', causeIds: ['site'], ...ev(m('ast.siteAuto')) });
  }
  if (phaseId === 'sampling') {
    if (a.jamPending) { a.jamPending = false; a.jamDone = true; }
    if (!a.sample.collected && a.sampling !== 'failed' && !a.approachFailed) {
      const ok = keepWhatWeHave(n, ASTEROID.sampling.minKeep, cause);
      if (!ok) cause({ kind: 'science', ref: 'sample-failed', causeIds: samplingCauses(n, build), ...ev(m('ast.sampleFailed', { pct: Math.round(a.samplingProgress * 100) })) });
    }
  }
  if (phaseId === 'stow' && a.sample.collected && !a.sample.sealed) {
    const why = m(!has(build, 'sample_sealer') ? 'ast.notSealedNone' : n.off.includes('sample_sealer') ? 'ast.notSealedOff' : 'ast.notSealedLate');
    cause({ kind: 'science', ref: 'not-sealed', causeIds: ['sample_sealer', ...(n.off.includes('sample_sealer') ? ['deficit'] : [])], ...ev(m('ast.notSealed', { why })) });
  }
}

export function samplingCauses(n: FlightState, build: Build): string[] {
  const a = n.asteroid!;
  const ids: string[] = [];
  if (n.history.some((h) => h.kind === 'arm_jam')) ids.push('arm_jam', 'vibration_dampers');
  if (n.off.includes('robotic_arm') || n.off.includes('drill')) ids.push('robotic_arm', 'drill', 'deficit');
  if (a.site) ids.push(`site:${a.site}`);
  if (!has(build, 'drill') && a.site === 'boulder') ids.push('drill');
  if (n.stoppedTicks > 0) ids.push('holds');
  return [...new Set(ids)];
}

/** Entering a phase. */
export function onAsteroidPhaseStart(n: FlightState, build: Build, phaseId: string, seed: number, cause: Cause) {
  const a = n.asteroid!;
  if (phaseId === 'sampling') {
    if (a.approachFailed) {
      a.sampling = 'failed';
      cause({ kind: 'science', ref: 'sample-failed', causeIds: ['approach-failed'], ...ev(m('ast.noSamplingApproach')) });
      return;
    }
    a.tool = toolNow(n, build);
    a.attempts = 1;
    if (!a.tool) {
      a.sampling = 'failed';
      cause({ kind: 'science', ref: 'sample-failed', causeIds: ['robotic_arm', 'drill'], ...ev(m('ast.noSamplingTools')) });
      return;
    }
    a.sampling = 'reach';
    a.resumeAt = n.tick + ASTEROID.sampling.reachTicks;
    n.jamPlan = jamPlan(seed, build, a.site!, a.armDamaged);
    cause({ kind: 'science', ref: 'sampling-start', causeIds: [], ...ev(m('ast.samplingStart', { tool: m(a.tool === 'drill' ? 'ast.samplingStartDrill' : 'ast.samplingStartArm'), site: SITE_BY_ID[a.site!].name })) });
  }
}

/** Capsule not found by the end of the flight → lost. */
export function onAsteroidFinal(n: FlightState, build: Build, cause: Cause) {
  const a = n.asteroid!;
  if (a.capsule === 'landed') {
    a.capsule = 'lost';
    a.stageTicks.lost = n.tick;
    cause({ kind: 'route', ref: 'capsule-lost', causeIds: ['recovery_beacon', ...(a.offTarget ? ['fuel-short', 'propellant_tank'] : [])], ...ev(m('ast.capsuleLost', { beacon: m(has(build, 'recovery_beacon') ? 'ast.capsuleLostBeaconOff' : 'ast.capsuleLostNoBeacon') })) });
  }
}

/** Science officer picks the sampling site (approach or site phase, before sampling begins). */
export function chooseSite(f: FlightState, site: AsteroidSiteId): { flight: FlightState; error?: string; errorMsg?: Msg } {
  const fail = (k: string) => { const errorMsg = m(k); return { flight: f, error: ru(errorMsg), errorMsg }; };
  if (!f.asteroid) return fail('ast.err.notAsteroid');
  if (!SITE_BY_ID[site]) return fail('ast.err.noSite');
  const phase = ['cruise', 'approach', 'site', 'sampling', 'stow', 'return'][f.phaseIndex];
  if (phase !== 'approach' && phase !== 'site') return fail(phase === 'cruise' ? 'ast.err.tooEarly' : 'ast.err.tooLate');
  if (f.asteroid.approachFailed) return fail('ast.err.approachFailed');
  const n = structuredClone(f);
  n.asteroid!.site = site;
  n.asteroid!.siteBy = 'science';
  const def = SITE_BY_ID[site];
  const label = m('ast.siteLabel', { site: def.name });
  trackCommand(n, { role: 'science', kind: 'science_mode', label: ru(label), shown: true, i18n: { label } });
  n.causes.push({ tick: n.tick, kind: 'science', ref: `site:${site}`, causeIds: [`site:${site}`], ...ev(m('ast.siteChosen', { site: def.name })) });
  return { flight: n };
}

function heaviest(build: Build): string[] {
  return installed(build).sort((x, y) => y.def.mass * y.count - x.def.mass * x.count).slice(0, 2).map((x) => x.def.id);
}
