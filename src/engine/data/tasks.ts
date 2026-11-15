// Individual Tasks (TZ screen 10, decision 0013 §1): numbers and mission content of the four role mini-games.
// ALL NUMBERS ARE GAME VALUES. Human-readable table: docs/03 Design/Individual Tasks.md and Balance Table.md («Индивидуальные задачи»).
import type { MissionId, RoleId } from '../types';
import type { ScienceTargetId } from './titan';

export type Grade = 'excellent' | 'good' | 'weak';
export type MeasureMode = 'cautious' | 'normal' | 'intensive';

/** Score (0..1) → grade. */
export const GRADE_AT = { excellent: 0.85, good: 0.6 };

/** Mission goals the commander ranks. `targets` = science targets of the goal; `systems` = parts that serve it. */
export interface GoalDef {
  id: string;
  /** Points weight hint shown on the card (game value, higher = more important for the report). */
  value: number;
  targets: ScienceTargetId[];
  systems: string[];
}

export const GOALS: Record<MissionId, GoalDef[]> = {
  titan: [
    { id: 'atmo_profile', value: 3, targets: ['atmo_profile'], systems: ['atmo_sensor'] },
    { id: 'surface_images', value: 3, targets: ['surface_images'], systems: ['hires_camera', 'wide_camera'] },
    { id: 'surface_chem', value: 2, targets: ['surface_chem'], systems: ['spectrometer'] },
    { id: 'route', value: 2, targets: [], systems: ['rotor_system'] },
    { id: 'env_temp', value: 1, targets: ['env_temp'], systems: ['temp_sensor'] },
  ],
  asteroid: [
    { id: 'sample', value: 4, targets: [], systems: ['robotic_arm', 'drill', 'sample_sealer'] },
    { id: 'composition', value: 3, targets: ['composition'], systems: ['spectrometer', 'drill'] },
    { id: 'capsule', value: 3, targets: [], systems: ['recovery_beacon'] },
    { id: 'site_images', value: 1, targets: ['site_images'], systems: ['hires_camera', 'wide_camera', 'nav_camera'] },
  ],
};

/**
 * How much the mission needs a system that can be switched off (higher = sacrifice later).
 * Instruments are not listed: their value comes from the commander's own goal ranking.
 * Anything else that draws power and is not listed counts as `TASKS.commander.otherKeep`.
 */
export const KEEP_VALUE: Record<MissionId, Record<string, number>> = {
  titan: {
    rotor_system: 10, heater: 7, data_storage: 6, data_buffer: 6, energy_regulator: 5, gnc_unit: 5, deep_space_link: 5,
    star_tracker: 4, reaction_wheels: 4, signal_amp: 3, nav_camera: 3, radar_altimeter: 3,
  },
  asteroid: {
    chem_main_engine: 10, chem_thrusters: 10, sample_sealer: 9, robotic_arm: 9, drill: 8, recovery_beacon: 8,
    ion_engine: 6, star_tracker: 6, reaction_wheels: 6, data_storage: 6, data_buffer: 6, nav_camera: 5, radar_altimeter: 5,
    energy_regulator: 5, gnc_unit: 5, deep_space_link: 5, heater: 3, signal_amp: 3,
  },
};

/** Spectrum flavour per mission: absorption bands (position 0..1, depth, width) of what the instruments look at. */
export const SPECTRA: Record<MissionId, { bands: [number, number, number][]; noise: number }> = {
  // Titan: methane bands in an orange haze — deep, several, noisier.
  titan: { bands: [[0.22, 0.5, 0.035], [0.47, 0.8, 0.05], [0.71, 0.45, 0.04]], noise: 0.06 },
  // Asteroid: olivine / pyroxene bands near «1 µm» and «2 µm» — broad and clean.
  asteroid: { bands: [[0.33, 0.6, 0.07], [0.68, 0.4, 0.09]], noise: 0.03 },
};

/** Base reference shift of each instrument (the seed adds ± jitter). */
export const CALIB_BASE: Record<string, number> = {
  atmo_sensor: 0.42, hires_camera: 0.6, wide_camera: 0.35, spectrometer: 0.55, temp_sensor: 0.48, radiation_sensor: 0.4,
};

/** Instruments the science officer calibrates (installed + they produce mission data). */
export const CALIBRATED: Record<MissionId, string[]> = {
  titan: ['atmo_sensor', 'hires_camera', 'wide_camera', 'spectrometer', 'temp_sensor'],
  asteroid: ['spectrometer', 'hires_camera', 'wide_camera'],
};

export const TASKS = {
  /** Several weak tasks compound, but never below these (data rate and quality multipliers of an instrument). */
  floor: { rate: 0.6, quality: 0.6 },
  commander: {
    /** Goal ranking vs sacrifice order in the score. */
    goalWeight: 0.5,
    /** Keep value of a powered system that is neither an instrument nor listed in KEEP_VALUE. */
    otherKeep: 3,
    /** Skipped: no agreed sacrifice order — Power Drop decision timer shorter by this (ticks). */
    skipDeadline: 5,
    /**
     * Mission plan: instruments of the top `topN` goals get the crew's attention (data rate ×top), the last goal's
     * instruments run «on what is left» (×last); without a plan everything runs at ×skip.
     */
    focus: { topN: 2, top: 1.2, last: 0.85, skip: 0.8 },
    /** Data quality with the plan: the last goal's instruments ×last, no plan at all ×skip (measurements taken «as it goes»). */
    focusQuality: { last: 0.9, skip: 0.75 },
  },
  engineer: {
    /** Share of the bus limit on the main line (the rest is the secondary line). */
    mainShare: 0.6,
    /** Systems with this power priority or lower must sit on the main line. */
    mustMainPriority: 2,
    /** Mission-critical systems (KEEP_VALUE ≥ this) must sit on the main line too. */
    mustMainKeep: 8,
    /** Score: share lost for critical systems on the secondary line; and for an avoidable overload. */
    critWeight: 0.5, overloadBase: 0.25, overloadMax: 0.5,
    /** No sheddable system on the secondary line: nothing is planned to go first. */
    emptySecondary: 0.2,
    /** Overloaded line (avoidable) or skipped routing: Power Drop timer −N ticks and hull −N % when it starts. */
    overloadDeadline: 6, overloadHull: 4,
    /**
     * Voltage sag: instruments on a line overloaded by the routing collect data ×(cap + unavoidable) / load (not below `sagMin`);
     * skipped routing (nothing planned, cables not sized) — ×`skipSag` for every instrument. A sagging line also makes the
     * data noisier: quality × the same factor.
     */
    sagMin: 0.5, skipSag: 0.8,
  },
  science: {
    /** Calibration error (share of the spectrum) at which accuracy is 0. */
    tolerance: 0.12,
    /** Data quality multiplier at accuracy 0 (1 at accuracy 1). */
    qualityMin: 0.6,
    /** Usable data rate: rateMin at accuracy 0 … rateMax at accuracy 1 (a badly tuned instrument's frames are rejected). */
    rateMin: 0.7, rateMax: 1.1,
    /** Seeded jitter of the reference peak around CALIB_BASE. */
    jitter: 0.08,
    /** Heat this close to «hot» (THERMAL.hot − margin) already counts as a risk for the mode choice. */
    margin: 25,
    /** Calibration vs mode in the score. */
    calibWeight: 0.7,
    modes: {
      titan: { cautious: { rate: 0.8, heat: 0.5 }, normal: { rate: 1, heat: 1 }, intensive: { rate: 1.3, heat: 2 } },
      asteroid: { cautious: { rate: 0.85, heat: 0.5 }, normal: { rate: 1, heat: 1 }, intensive: { rate: 1.3, heat: 2.5 } },
    } as Record<MissionId, Record<MeasureMode, { rate: number; heat: number }>>,
  },
  comms: {
    /** Beam half-width on the radar (radius 1) by the best antenna: narrow beam = precise aiming. */
    beam: { antenna_high_gain: 0.16, deep_space_link: 0.16, antenna_standard: 0.24, antenna_omni: 0.4 } as Record<string, number>,
    /** Signal meter noise by mission (Titan haze is noisier). */
    noise: { titan: 0.14, asteroid: 0.07 } as Record<MissionId, number>,
    /** Bandwidth = nominal × (min + (max − min) × accuracy): a precisely pointed narrow beam beats the nominal a little. */
    bandwidthMin: 0.5, bandwidthMax: 1.1,
    /** Skipped: antenna left at its factory pointing. */
    skipAim: 0.25,
    /** Packets that miss Earth: share lost = loss × (1 − accuracy). */
    loss: 0.3,
    aimWeight: 0.6,
    /** After a blackout the antenna has lost Earth: accuracy drops to this until comms re-aims or the computer finds Earth. */
    reaimDrop: 0.35,
    /** The flight computer finds Earth on its own after this many ticks (back to the pre-flight accuracy). */
    autoReaimTicks: 30,
  },
};

/** Roles in task order (the team strip). */
export const TASK_ROLES: RoleId[] = ['commander', 'engineer', 'science', 'comms'];
