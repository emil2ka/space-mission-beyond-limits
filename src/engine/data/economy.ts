// Agency economy: upgrades bought with Mission Credits and the starter craft (docs/03 Design/Economy.md).
// ALL NUMBERS ARE GAME VALUES. Rewards and upkeep are REWARDS in data/titan.ts.
import type { Build, Department, MissionId, UpgradeId } from '../types';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** MC. */
  cost: number;
  /** What it gives (shown in the shop). */
  effect: string;
  /** The honest price besides MC (Economy.md: «каждое улучшение — понятный компромисс»). */
  tradeoff: string;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'light_alloys', name: 'Лёгкие сплавы', cost: 80,
    effect: 'Масса корпуса −10 %.',
    tradeoff: 'Лёгкий корпус хуже держит удары: урон от обломков ×1.25.',
  },
  {
    id: 'better_antennas', name: 'Улучшенные антенны', cost: 60,
    effect: 'Пропускная способность антенн +30 %.',
    tradeoff: 'Антенны потребляют на 20 % больше энергии.',
  },
  {
    id: 'better_batteries', name: 'Эффективные батареи', cost: 60,
    effect: 'Ёмкость батарей +25 %.',
    tradeoff: 'Каждая батарея тяжелее на 3 кг.',
  },
  {
    id: 'pdu_v2', name: 'Контроллер питания PDU v2', cost: 50,
    effect: 'Умное отключение: что отключилось при разряде, включится само, когда батарея зарядится (нужен PDU).',
    tradeoff: 'PDU потребляет 8 W вместо 5 W.',
  },
  {
    id: 'extra_slot', name: 'Дополнительный монтажный слот', cost: 70,
    effect: '+1 слот выбранного отдела (по умолчанию «Наука»).',
    tradeoff: 'Крепление добавляет корпусу 5 кг.',
  },
  {
    id: 'fc_v2', name: 'Flight Computer v2', cost: 60,
    effect: '6 правил автономии на каждый Flight Computer вместо 3.',
    tradeoff: 'Flight Computer потребляет +5 W и греется сильнее (+3).',
  },
];
export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpgradeId, UpgradeDef>;

/** Upgrade effect numbers (computeStats / flight read them). */
export const UPGRADE_FX = {
  lightAlloysMass: 0.9,
  antennaBandwidth: 1.3, antennaPower: 1.2,
  batteryCapacity: 1.25, batteryMass: 3,
  pduV2Watts: 8,
  /** PDU v2 brings shed loads back when the battery is above this share. */
  pduV2RestorePct: 50,
  extraSlotMass: 5,
  fcRules: 6, fcWatts: 5, fcHeat: 3,
};

export const DEFAULT_EXTRA_SLOT: Department = 'science';

/**
 * Starter configuration: what a team gets after a free basic repair (no MC for prep) — a modest craft
 * that passes the readiness check, so the game never soft-locks (ТЗ test E).
 */
export const STARTER_BUILD: Record<MissionId, Build> = {
  titan: {
    rtg: 2, battery_hc: 1, power_bus: 2, pdu: 1, rotor_system: 1, flight_computer: 1, imu: 1, atmo_sensor: 1, wide_camera: 1,
    transceiver: 1, antenna_standard: 1, thermal_insulation: 1, thermal_radiator: 1, data_storage: 1, temp_sensor: 1,
  },
  asteroid: {
    solar_array: 4, battery_hc: 1, power_bus: 1, chem_thrusters: 1, propellant_tank: 2, nav_camera: 1, flight_computer: 1,
    robotic_arm: 1, sample_container: 1, sample_sealer: 1, spectrometer: 1, data_buffer: 1, transceiver: 1, antenna_standard: 1,
    return_capsule: 1, heat_shield: 1, parachute: 1, recovery_beacon: 1,
  },
};
