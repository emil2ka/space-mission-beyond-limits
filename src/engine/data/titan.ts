// Titan flight tuning. ALL NUMBERS ARE GAME VALUES, not real mission data.
// Human-readable table: docs/03 Design/Balance Table.md (section «Полёт Титана»).
// Phase lengths live in missions.ts; everything else about the flight lives here.

export type WaypointId = 'dunes' | 'lake' | 'crater';
export type ScienceTargetId = 'atmo_profile' | 'surface_images' | 'surface_chem' | 'env_temp'
  // Asteroid (data/asteroid.ts)
  | 'composition' | 'site_images';
export type ScienceMode = 'fast' | 'precise';

export const WAYPOINT_DEFS: { id: WaypointId; name: string }[] = [
  { id: 'dunes', name: 'Дюны Белет' },
  { id: 'lake', name: 'Метановое озеро Лигейя' },
  { id: 'crater', name: 'Кратер Селк' },
];

/** Where an instrument collects data for a target (data units per tick). */
export interface TargetRate {
  instrument: string;
  /** Entry phase after the rotors are deployed. */
  entry?: number;
  /** Survey phase while flying between waypoints. */
  flying?: number;
  /** Hovering/standing at a waypoint (any mode). */
  dwell?: number;
  /** Only when landed at a waypoint (precise mode). */
  landed?: number;
  /** Base quality of this instrument's data, 0..1. */
  quality: number;
  /** Asteroid: rate per phase id (Titan uses entry/flying/dwell/landed instead). */
  phases?: Record<string, number>;
  /** Asteroid: in these phases data comes only once the tool has touched the surface. */
  contact?: string[];
  /** Asteroid: in these phases data comes only from a collected sample. */
  sample?: string[];
}

export interface TargetDef {
  id: ScienceTargetId;
  name: string;
  /** Data units that must reach Earth for the target to count as delivered. */
  required: number;
  rates: TargetRate[];
}

export const TARGET_DEFS: TargetDef[] = [
  {
    id: 'atmo_profile', name: 'Профиль атмосферы', required: 40,
    rates: [{ instrument: 'atmo_sensor', entry: 0.6, flying: 0.1, quality: 1 }],
  },
  {
    id: 'surface_images', name: 'Снимки поверхности', required: 60,
    rates: [
      { instrument: 'hires_camera', flying: 0.15, dwell: 1.0, quality: 1 },
      { instrument: 'wide_camera', flying: 0.12, dwell: 0.6, quality: 0.75 },
    ],
  },
  {
    id: 'surface_chem', name: 'Химия поверхности', required: 50,
    rates: [{ instrument: 'spectrometer', landed: 0.7, quality: 1 }],
  },
  {
    id: 'env_temp', name: 'Температура среды', required: 20,
    rates: [{ instrument: 'temp_sensor', entry: 0.07, flying: 0.07, dwell: 0.07, quality: 1 }],
  },
];

/** How many delivered targets make the main goal. */
export const MAIN_GOAL_TARGETS = 2;

export const TITAN = {
  /** Entry: first ticks under the parachute with folded antenna — no signal. */
  entryBlackoutTicks: 15,
  /** Entry tick when the rotors spin up (then they draw power and the craft flies). */
  rotorDeployTick: 15,
  /** Ticks of flight between two waypoints at full speed. */
  legTicks: 70,
  /** Ticks spent at a waypoint, by science mode (null = fast). */
  dwell: { fast: 20, precise: 40 } as Record<ScienceMode, number>,
  /** Mode effects on data at a waypoint. */
  modeRate: { fast: 1.2, precise: 1 } as Record<ScienceMode, number>,
  modeQuality: { fast: 0.7, precise: 1 } as Record<ScienceMode, number>,
  /** Chemistry quality when landing on rotors without a Landing System. */
  noLandingGearQuality: 0.75,
  /** Built-in memory of the frame, data units. */
  builtInMemory: 20,
  /** A target stops collecting at required × this (enough data). */
  dataCapFactor: 1.5,
  /** In cruise the craft loses less heat (no atmosphere). */
  cruiseHeatLossFactor: 0.5,
  /** Data quality multiplier by thermal state. */
  thermalQuality: { freezing: 0.3, cold: 0.7, nominal: 1, hot: 1, overheat: 0.8 } as Record<string, number>,

  crisis: {
    /** Decision timer (ticks = seconds at TICK_SECONDS = 1). */
    deadline: 20,
    /** Quiet ticks after a crisis before the next may start. */
    cooldown: 25,
    max: 3,
    /** No crisis before this flight tick. */
    earliestTick: 10,
    /** Battery share that triggers Power Drop on a deficit. */
    batteryPct: 20,
    /** Consecutive ticks beyond a thermal threshold before Freeze/Overheat. */
    thermalTicks: 3,
    /** Consecutive «hot» ticks after which heat has piled up → Overheat (two RTG without a radiator). */
    warmTicks: 60,
  },

  storm: {
    /** Survey tick window where the methane storm may start (seeded). */
    window: [30, 150] as [number, number],
    length: 60,
    /** Without Signal Amplifier the storm always distorts the link; with it — only this share of seeds. */
    chanceWithAmp: 0.2,
    /** Link speed and packet loss in the storm. */
    factor: 0.5, loss: 0.4,
    ampFactor: 0.75, ampLoss: 0.15,
    /** Camera data quality in the storm. */
    cameraQuality: 0.5,
    /** Unanswered distortion escalates to a full blackout for this many ticks. */
    escalationLost: 20,
    /** «Point antenna to Earth» rule shortens that blackout to this. */
    escalationLostPointed: 6,
  },

  /** Tactical Radio: in a blackout normal phrases wait this long; one phrase per role per `cooldown` ticks. */
  radio: { blackoutDelay: 10, cooldown: 2 },
  /** Ground → craft commands: commander hold length, DSN search gain (ticks off a storm blackout), pending per role. */
  commands: { holdTicks: 10, searchGain: 6, maxPending: 2 },

  overweight: {
    /** Over the limit by up to this share → warning (commander may accept); above → blocker. */
    maxRatio: 0.1,
    hullPerRatio: 300, hullMax: 25,
    drawPerRatio: 3,
    speedPerRatio: 2, minSpeed: 0.5,
  },

  /** Team Trust lost per ignored warning whose risk came true (ТЗ §3.1). */
  trustPenalty: 15,
};

/** Crisis option effects (ticks). */
export const CRISIS_FX = {
  cycleTicks: 15,
  pauseTicks: 20,
  holdTicks: 20,
  sleepTicks: 30,
  coolTicks: 20,
  keepAllHull: 8,
  overheatHull: 10,
  retuneLost: 5,
  heaterBoost: 40, heaterBoostWatts: 20,
  routeHeat: 50, routeHeatSpeed: 0.7,
  ventHeat: 20,
  pointWatts: 10, stabilizeWatts: 5,
};

/** Mission Credits (docs/03 Design/Economy.md). */
export const REWARDS = {
  perfect: 120, success: 90, partial: 50, failed: 20,
  perTarget: 10,
  upkeep: { maintenance: 10, diagnostics: 5, consumables: 5 },
  /** Repair: MC per 10 % of hull lost, and per broken module. */
  repairPer10Hull: 2, repairPerModule: 5,
  /** Optional insurance bought at prep: covers repairs after the next flight. */
  insurance: 15,
};

/** Report weights (docs/03 Design/Mission Report.md), Titan variant. */
export const SCORE_WEIGHTS = [
  { key: 'main', label: 'Главная научная задача', weight: 35 },
  { key: 'data', label: 'Объём и качество данных', weight: 20 },
  { key: 'craft', label: 'Состояние аппарата', weight: 10 },
  { key: 'comms', label: 'Работа связи', weight: 15 },
  { key: 'extra', label: 'Дополнительные цели', weight: 10 },
  { key: 'route', label: 'Завершение маршрута', weight: 5 },
  { key: 'resources', label: 'Расход ресурсов', weight: 5 },
] as const;

export const OUTCOME_THRESHOLDS = { perfect: 90, success: 70, partial: 40 };
