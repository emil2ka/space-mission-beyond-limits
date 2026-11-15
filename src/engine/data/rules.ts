// Team rules of decision 0013 §2–4: department owners, the commander's budget split, Team Trust tiers.
// ALL NUMBERS ARE GAME VALUES (docs/03 Design/Balance Table.md describes them).
import type { Department, MissionId, RoleId } from '../types';
import { TITAN } from './titan';

/** Roles that own departments. The commander owns none and may install anything (he approves). */
export type OwnerRole = Exclude<RoleId, 'commander'>;
export const OWNER_ROLES: OwnerRole[] = ['engineer', 'science', 'comms'];

/** Department → its owner (0013 §2). */
export const DEPT_OWNER: Record<Department, OwnerRole> = {
  power: 'engineer', propulsion: 'engineer', structure: 'engineer', recovery: 'engineer',
  science: 'science',
  comms: 'comms', navigation: 'comms',
};

export type BudgetSplit = Record<OwnerRole, number>;

/**
 * Default split of the module budget (mission budget − frame), % per owner.
 * Chosen so the mission's starter craft (STARTER_BUILD) fits every share: Titan 220/47/33 M$ of 340,
 * Asteroid 195/54/100 M$ of 390. The commander changes it at the start of the constructor.
 */
export const DEFAULT_SPLIT: Record<MissionId, BudgetSplit> = {
  titan: { engineer: 65, science: 15, comms: 20 },
  asteroid: { engineer: 50, science: 30, comms: 20 },
};
/** The split moves in steps of 5 %. */
export const SPLIT_STEP = 5;

/** Team Trust (0013 §3). */
export const TRUST = {
  start: 100,
  max: 100,
  /** Lost per knowingly accepted warning whose risk came true (ТЗ §3.1). */
  penalty: TITAN.trustPenalty,
  /** Gained per flight in which no accepted warning came true. */
  recovery: 10,
  /** ≥ this: «Слаженная команда». */
  cohesive: 80,
  /** < this: «Под наблюдением» — approve-against-critical-warning needs a second key. */
  watch: 50,
  /** < this: «Проверка агентства» — a mandatory diagnostic at the preparation. */
  audit: 25,
  /** «Слаженная команда»: extra seconds (= ticks) on crisis decision timers. */
  crisisBonus: 5,
  /** «Проверка агентства»: the mandatory diagnostic, MC (free basic repair covers it when MC are short, 0012). */
  auditCost: 15,
} as const;
