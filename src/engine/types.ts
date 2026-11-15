// Core game types. Pure data — no React, no three.js.
import type { Msg } from '../i18n/format';

export type MissionId = 'titan' | 'asteroid';
export type RoleId = 'commander' | 'engineer' | 'science' | 'comms';
export type Department =
  | 'power'
  | 'propulsion'
  | 'navigation'
  | 'science'
  | 'comms'
  | 'structure'
  | 'recovery';

/** How useful a component is for a given mission (shown as a badge on the card). */
/** Agency upgrades bought with Mission Credits (data/economy.ts). */
export type UpgradeId = 'light_alloys' | 'better_antennas' | 'better_batteries' | 'pdu_v2' | 'extra_slot' | 'fc_v2';

/** What changes computeStats beyond the build: the agency's upgrades. An `Agency` fits this shape. */
export interface Mods {
  upgrades: readonly UpgradeId[];
  /** Department that gets the extra mounting slot (upgrade `extra_slot`). */
  extraSlot?: Department;
}

export type Need = 'required' | 'recommended' | 'optional' | 'useless' | 'incompatible';

export interface MissionFit {
  need: Need;
  why: string;
}

export interface ComponentDef {
  id: string;
  department: Department;
  name: string;
  /** Short caption under the name (ТЗ: «короткое понятное описание»). */
  caption: string;
  /** What it does in the game. */
  purpose: string;
  mass: number; // kg
  cost: number; // M$ (mission budget)
  /** Base power generation in W (sources only). Mission environment may scale it. */
  generation?: number;
  /** Power draw in W when switched on. */
  consumption?: number;
  /** Battery capacity in Wh (storage only — never generation). */
  capacityWh?: number;
  /** Heat produced (positive) or rejected (negative), game units per tick. */
  heat: number;
  /** Fraction of environmental heat loss blocked (thermal insulation), 0..1. */
  insulation?: number;
  /** Data link throughput, data units per tick. */
  bandwidth?: number;
  /** Onboard memory, data units. */
  storage?: number;
  /** Autonomy rules supported (flight computer). */
  ruleSlots?: number;
  /** Max power a single bus can carry, W. */
  busLimit?: number;
  /** Power priority for load shedding: 1 = shed last (critical), 5 = shed first. */
  priority: 1 | 2 | 3 | 4 | 5;
  maxInstances: number;
  fit: Record<MissionId, MissionFit>;
  /** Consequence fields required by ТЗ §7. */
  sideEffect: string;
  roles: RoleId[];
  failure?: string;
  /** Model file id in public/models/<model>.glb (defaults to id). */
  model?: string;
  tags?: string[];
}

export interface MissionDef {
  id: MissionId;
  name: string;
  goal: string;
  environment: string[];
  budget: number; // M$
  massLimit: number; // kg
  /** The bare craft frame (always present). */
  frameMass: number;
  frameCost: number;
  /** Always-on avionics of the frame, W. */
  baseLoad: number;
  slots: Record<Department, number>;
  /** Multiplier applied to solar generation. */
  solarFactor: number;
  /** Heat lost to environment per tick without insulation. */
  envHeatLoss: number;
  /** Game signal delay in ticks. */
  signalDelay: number;
  /** Mission Credits needed to unlock (0 = available from start). */
  unlockCost: number;
  /** Required systems: each entry is satisfied if ANY id in anyOf is installed. */
  requirements: { anyOf: string[]; reason: string }[];
  phases: { id: string; name: string; ticks: number }[];
}

/** Installed components: component id → count. */
export type Build = Record<string, number>;

export interface Issue {
  id: string;
  severity: 'info' | 'warn' | 'critical';
  text: string;
  componentIds: string[];
  roles: RoleId[];
  /** The same text as a message (key + params) for the UI language; `text` stays Russian. */
  i18n?: { text: Msg };
}

export interface PowerLine {
  id: string;
  name: string;
  count: number;
  watts: number;
  /** Set for the non-module line «Бортовые системы корпуса». */
  i18n?: { name: Msg };
}

export interface CraftStats {
  mass: number;
  massLimit: number;
  cost: number;
  budget: number;
  generation: number;
  generationBySource: PowerLine[];
  consumption: number;
  consumptionByLoad: PowerLine[];
  netPower: number;
  capacityWh: number;
  /** Hours the current battery capacity lasts at the current deficit (Infinity if no deficit). */
  hoursOfReserve: number;
  heatBalance: number;
  thermalState: 'freezing' | 'cold' | 'nominal' | 'hot' | 'overheat';
  bandwidth: number;
  storage: number;
  ruleSlots: number;
  busLimit: number;
  slotsUsed: Record<Department, number>;
  slotsTotal: Record<Department, number>;
  issues: Issue[];
  /** PDU v2 upgrade with a PDU on board: loads shed on an empty battery come back when it recovers. */
  smartShed?: boolean;
  /** Upgrades these stats were computed with. */
  upgrades?: UpgradeId[];
}

/** `i18n` is non-enumerable (the Russian `reason` stays the only own enumerable field). */
export type AddCheck = { ok: true } | { ok: false; reason: string; i18n?: { reason: Msg } };
