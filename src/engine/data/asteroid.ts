// Asteroid Sample Return tuning. ALL NUMBERS ARE GAME VALUES, not real mission data.
// Human-readable table: docs/03 Design/Balance Table.md (section «Полёт Астероида»).
// Phase lengths (maximums) live in missions.ts; everything else about the asteroid flight lives here.
import type { TargetDef } from './titan';

export type AsteroidSiteId = 'regolith' | 'boulder' | 'crack';
export type CapsuleStage = 'stowed' | 'separated' | 'entry' | 'chute' | 'landed' | 'found' | 'lost';

export interface SiteDef {
  id: AsteroidSiteId;
  name: string;
  /** What the science officer sees before choosing. */
  text: string;
  /** Base Sampling Arm Jam risk (0..1 before dampers). */
  jamRisk: number;
  /** Sampling progress per tick: arm / drill. */
  armRate: number;
  drillRate: number;
  /** Composition data: rate × science, quality × quality. */
  science: number;
  quality: number;
  /** Full sample mass, g. */
  mass: number;
}

export const SITE_DEFS: SiteDef[] = [
  {
    id: 'regolith', name: 'Мягкий реголит',
    text: 'Рыхлая пыль и мелкие камешки: рука берёт легко, риск заклинивания низкий. Материал «обычный» — данных о составе меньше.',
    jamRisk: 0.35, armRate: 1 / 35, drillRate: 1 / 45, science: 0.8, quality: 0.8, mass: 60,
  },
  {
    id: 'boulder', name: 'Камень',
    text: 'Плотная порода: руке трудно отколоть кусок, бур справляется лучше. Высокий риск заклинивания без гасителей вибрации.',
    jamRisk: 0.8, armRate: 1 / 80, drillRate: 1 / 40, science: 1, quality: 1, mass: 40,
  },
  {
    id: 'crack', name: 'Рядом с трещиной',
    text: 'Свежий материал из глубины — лучшие данные о составе. Края неровные: средний риск заклинивания.',
    jamRisk: 0.6, armRate: 1 / 50, drillRate: 1 / 45, science: 1.3, quality: 1, mass: 50,
  },
];
export const SITE_BY_ID = Object.fromEntries(SITE_DEFS.map((s) => [s.id, s])) as Record<AsteroidSiteId, SiteDef>;

/** Asteroid science targets. `phases` = data units per tick by phase id. */
export const ASTEROID_TARGET_DEFS: TargetDef[] = [
  {
    id: 'composition', name: 'Состав астероида', required: 45,
    rates: [
      // Remote sensing on approach; then the site; at the surface only after the tool has touched it; then the sample itself.
      { instrument: 'spectrometer', phases: { approach: 0.05, site: 0.2, sampling: 0.35, stow: 0.5 }, contact: ['sampling'], sample: ['stow'], quality: 1 },
      { instrument: 'drill', phases: { sampling: 0.15 }, contact: ['sampling'], quality: 0.6 },
    ],
  },
  {
    // Navigation Camera (navigation slot) can image the site too — the science slots (4) are tight on this mission.
    id: 'site_images', name: 'Съёмка места отбора', required: 35,
    rates: [
      { instrument: 'hires_camera', phases: { approach: 0.2, site: 0.6, sampling: 0.1 }, quality: 1 },
      { instrument: 'wide_camera', phases: { approach: 0.25, site: 0.35, sampling: 0.1 }, quality: 0.75 },
      { instrument: 'nav_camera', phases: { approach: 0.15, site: 0.4, sampling: 0.1 }, quality: 0.6 },
    ],
  },
];

/** The target that must be delivered for Perfect («данные состава доставлены»). */
export const COMPOSITION_TARGET = 'composition';

export const ASTEROID = {
  /** Fuel units per Propellant Tank. */
  fuelPerTank: 100,
  /** Overweight burns more fuel: ×(1 + over-ratio × this). */
  overweightFuel: 3,

  cruise: {
    /** Ion Engine: slow and thrifty; chemical: fast and hungry. Ticks to reach the asteroid. */
    ionTicks: 140, chemTicks: 100,
    ionFuel: 0.07, chemFuel: 0.4,
  },
  approach: {
    /** Ticks to close in with a Navigation Camera or Radar, and without. */
    navTicks: 80, blindTicks: 110,
    navIds: ['nav_camera', 'radar_altimeter'],
    fuel: 0.3,
  },
  /** Station keeping at the surface. */
  samplingFuel: 0.05,
  sampling: {
    /** Arm reaches the surface before grabbing. */
    reachTicks: 12,
    /** Arm + drill together: drill adds this share of its rate. */
    drillAssist: 0.5,
    /** Phase over: a sample this full is kept (smaller mass); less → failed. */
    minKeep: 0.4,
    /** «Keep what we have» works from this progress. */
    keepNow: 0.25,
  },
  stow: { sealTicks: 20 },
  return: {
    burnTicks: 10,
    /** Ticks of the return phase when each capsule stage begins. */
    separateAt: 130, entryAt: 140, chuteAt: 155, landAt: 170,
    /** Beacon: found right after landing; without it a visual search on a nominal landing. */
    beaconFind: 3, searchFind: 15,
    chemBurn: 30, ionBurn: 5, ionFuel: 0.07,
  },
  debris: {
    /** Approach tick window where the debris stream may come (seeded). */
    window: [15, 45] as [number, number],
    /** With Micrometeoroid Shield the stream hits only this share of seeds. */
    chanceWithShield: 0.25,
    /** Seen late without Radar / Navigation Camera: shorter timer. */
    lateDeadline: 8,
    evadeFuel: 12, evadeHold: 8,
    /** After a dodge without Star Tracker / Reaction Wheels the antenna loses Earth. */
    misalignLost: 8,
    hull: { shield: 4, none: 18 }, braceHull: 4,
    /** Light alloys: impacts hurt more. */
    lightAlloyHull: 1.25,
  },
  jam: {
    /** Progress window where a jam hits (seeded). */
    at: [0.2, 0.5] as [number, number],
    dampers: -0.6, noDampers: 0.3, drillNoDampers: 0.1, armDamaged: 1,
    restartTicks: 10, retryTicks: 15,
    /** Safe Protocol: arm parked, then a careful restart at a lower rate. */
    safeHold: 25, safeRate: 0.5,
  },
  crisis: {
    deadline: 20, cooldown: 25, earliestTick: 10,
    /** Debris + Arm Jam always get their turn; Power Drop / Overheat / Freeze share this many. */
    maxGeneric: 2,
  },
  /** Fuel left (share of the tank) for full «resources» points. */
  fuelReserve: 0.1,
  /** Sample mass for full integrity points, g. */
  fullSample: 40,
};

/** Report weights (docs/03 Design/Mission Report.md), asteroid variant. */
export const ASTEROID_SCORE_WEIGHTS = [
  { key: 'main', label: 'Главная научная задача', weight: 35 },
  { key: 'data', label: 'Объём и качество данных', weight: 20 },
  { key: 'craft', label: 'Состояние аппарата', weight: 10 },
  { key: 'comms', label: 'Работа связи', weight: 15 },
  { key: 'sample', label: 'Сохранность образца', weight: 10 },
  { key: 'return', label: 'Возвращение капсулы', weight: 5 },
  { key: 'resources', label: 'Расход ресурсов', weight: 5 },
] as const;
