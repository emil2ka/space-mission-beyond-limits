// One energy tick (ТЗ §6):
//   Net = Generation − Active Consumption
//   Stored(next) = clamp(Stored + Net × Δt, 0, Capacity)
// When the battery is empty, loads are shed by priority (5 first, 1 = critical never shed).
import { TICK_HOURS } from './constants';

export interface Load {
  id: string;
  watts: number;
  priority: number;
  /** Individual tasks (tasks.ts loadRank): higher = shed earlier — secondary power line, then the commander's sacrifice order. */
  rank?: number;
}

export interface EnergyIn {
  stored: number;
  capacityWh: number;
  generation: number;
  loads: Load[];
  /** Loads already switched off (by players, rules or earlier shedding). */
  off: string[];
  /** With a PDU, shedding follows priorities; without it, the biggest load goes first. */
  hasPdu: boolean;
}

export interface EnergyOut {
  stored: number;
  net: number;
  off: string[];
  /** Loads shed during this tick. */
  shed: string[];
  wasted: number;
}

export function stepEnergy(e: EnergyIn, dt = TICK_HOURS): EnergyOut {
  const off = new Set(e.off);
  const active = () => e.loads.filter((l) => !off.has(l.id));
  const demand = () => active().reduce((s, l) => s + l.watts, 0);
  const shed: string[] = [];

  let net = e.generation - demand();
  let next = e.stored + net * dt;

  if (next < 0) {
    const candidates = active()
      .filter((l) => l.priority > 1)
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0) || (e.hasPdu ? b.priority - a.priority || b.watts - a.watts : b.watts - a.watts));
    for (const l of candidates) {
      if (e.stored + (e.generation - demand()) * dt >= 0) break;
      off.add(l.id);
      shed.push(l.id);
    }
    net = e.generation - demand();
    next = e.stored + net * dt;
  }

  const clamped = Math.min(Math.max(next, 0), e.capacityWh);
  const wasted = next > e.capacityWh ? (next - e.capacityWh) / dt : 0;
  return { stored: clamped, net, off: [...off], shed, wasted };
}
