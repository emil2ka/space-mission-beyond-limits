// Agency economy (M3 contract, ТЗ test E): Mission Credits, unlocks, upgrades, preparation between attempts.
// Rules: every charge is shown before it happens (prepCosts), the balance never goes below zero,
// and the game never soft-locks — short of MC the team gets a free basic repair and the starter craft.
import { COMPONENT_BY_ID } from './data/components';
import { DEFAULT_EXTRA_SLOT, UPGRADE_BY_ID } from './data/economy';
import { MISSIONS } from './data/missions';
import { REWARDS } from './data/titan';
import { DEPARTMENTS } from './constants';
import { TRUST } from './data/rules';
import type { Outcome } from './report';
import type { Department, MissionId, UpgradeId } from './types';
import { m, ru, type Msg } from './msg';

/** A prep line: Russian `label` + `i18n.label`. */
const item = (id: string, msg: Msg, cost: number, optional?: boolean): PrepItem => ({ id, label: ru(msg), cost, ...(optional ? { optional } : {}), i18n: { label: msg } });
/** Error result: Russian `error` + `errorMsg`. */
const err = (msg: Msg) => ({ error: ru(msg), errorMsg: msg });

export interface Agency {
  // ── M3 contract ──
  credits: number;
  unlocked: MissionId[];
  upgrades: UpgradeId[];
  /** Modules that need repair after the last flight. */
  damaged: string[];
  history: { mission: MissionId; outcome: Outcome; earned: number }[];

  // ── extra ──
  /** Department of the extra mounting slot (upgrade `extra_slot`). */
  extraSlot: Department;
  /** Hull % lost in the last flight (repair). */
  hullLoss: number;
  /** Insurance bought at the last prep: it will cover the repairs after the next flight. */
  insured: boolean;
  /** The flight that just ended was insured: its repairs are free. */
  coveredRepairs: boolean;
  /** A flight ended and its preparation is not confirmed yet («Ещё раз» / «В штаб» go through it). */
  pendingPrep: boolean;
  /** Free basic repairs used (short of MC). */
  basicRepairs: number;
  /** 0013 §3: Team Trust fell below 25 — the next preparation includes the agency's mandatory diagnostic. */
  audit?: boolean;
  lastPrep: { charged: number; fallback: PrepCosts['fallback']; insurance: boolean } | null;
}

export interface PrepItem { id: string; label: string; cost: number; optional?: boolean; i18n?: { label: Msg } }
export interface PrepCosts {
  items: PrepItem[];
  /** Sum of the items (with insurance if chosen). */
  total: number;
  /** The balance covers `total`. */
  affordable: boolean;
  /** Not enough even without insurance → free basic repair + starter craft, nothing is charged. */
  fallback: 'none' | 'free_basic_repair';
  /** What confirmPrep will actually take (0 with the fallback). */
  charge: number;
  /** Balance after confirming (never negative). */
  balanceAfter: number;
  /** MC missing for `total` (0 if affordable). */
  missing: number;
}

export function newAgency(): Agency {
  return {
    credits: 0, unlocked: ['titan'], upgrades: [], damaged: [], history: [],
    extraSlot: DEFAULT_EXTRA_SLOT, hullLoss: 0, insured: false, coveredRepairs: false, pendingPrep: false, basicRepairs: 0, lastPrep: null, audit: false,
  };
}

/** MC for a result (Economy.md): Perfect 120 / Success 90 / Partial 50 / Failed 20, +10 per delivered target. */
export function missionReward(outcome: Outcome, delivered: number): number {
  return REWARDS[outcome] + REWARDS.perTarget * delivered;
}

/** Repair price of one damaged module, MC. */
export function repairCost(id: string): number {
  const def = COMPONENT_BY_ID[id];
  return Math.max(REWARDS.repairPerModule, Math.round((def?.cost ?? 0) * 0.2));
}

export function hullRepairCost(hullLoss: number): number {
  return Math.round(hullLoss / 10) * REWARDS.repairPer10Hull;
}

/** Everything the next attempt costs — shown BEFORE confirmPrep. */
export function prepCosts(agency: Agency, insurance: boolean): PrepCosts {
  if (!agency.pendingPrep) return { items: [], total: 0, affordable: true, fallback: 'none', charge: 0, balanceAfter: agency.credits, missing: 0 };
  const covered = agency.coveredRepairs;
  const items: PrepItem[] = [
    item('maintenance', m('eco.maintenance'), REWARDS.upkeep.maintenance),
    item('diagnostics', m('eco.diagnostics'), REWARDS.upkeep.diagnostics),
  ];
  for (const id of agency.damaged) {
    items.push(item(`repair:${id}`, m('eco.repair', { name: COMPONENT_BY_ID[id]?.name ?? id, covered: covered ? m('eco.covered') : '' }), covered ? 0 : repairCost(id)));
  }
  const hull = hullRepairCost(agency.hullLoss);
  if (hull > 0) items.push(item('repair:hull', m('eco.repairHull', { pct: agency.hullLoss, covered: covered ? m('eco.covered') : '' }), covered ? 0 : hull));
  items.push(item('consumables', m('eco.consumables'), REWARDS.upkeep.consumables));
  // «Проверка агентства» (Team Trust < 25): mandatory, but never a soft-lock — short of MC the free basic repair covers it.
  if (agency.audit) items.push(item('audit', m('eco.audit'), TRUST.auditCost));
  const base = items.reduce((s, i) => s + i.cost, 0);
  if (insurance) items.push(item('insurance', m('eco.insurance'), REWARDS.insurance, true));
  const total = base + (insurance ? REWARDS.insurance : 0);
  const fallback: PrepCosts['fallback'] = agency.credits < base ? 'free_basic_repair' : 'none';
  const affordable = agency.credits >= total;
  const charge = fallback === 'free_basic_repair' ? 0 : affordable ? total : base;
  return { items, total, affordable, fallback, charge, balanceAfter: agency.credits - charge, missing: Math.max(0, total - agency.credits) };
}

/**
 * Confirm the preparation. Charges `prepCosts(...).total`, or — short of MC even without insurance —
 * does a free basic repair (nothing charged; the caller resets the craft to the starter build).
 */
export function applyPrep(agency: Agency, insurance: boolean): { agency: Agency; error?: string; errorMsg?: Msg; charged: number; basicRepair: boolean } {
  if (!agency.pendingPrep) return { agency, ...err(m('eco.err.prepDone')), charged: 0, basicRepair: false };
  const p = prepCosts(agency, insurance);
  const a: Agency = structuredClone(agency);
  if (p.fallback === 'free_basic_repair') {
    Object.assign(a, { damaged: [], hullLoss: 0, insured: false, coveredRepairs: false, pendingPrep: false, audit: false, basicRepairs: a.basicRepairs + 1, lastPrep: { charged: 0, fallback: p.fallback, insurance: false } });
    return { agency: a, charged: 0, basicRepair: true };
  }
  if (!p.affordable) return { agency, ...err(m('eco.err.insurance', { n: p.missing })), charged: 0, basicRepair: false };
  Object.assign(a, { credits: a.credits - p.total, damaged: [], hullLoss: 0, insured: insurance, coveredRepairs: false, pendingPrep: false, audit: false, lastPrep: { charged: p.total, fallback: 'none', insurance } });
  return { agency: a, charged: p.total, basicRepair: false };
}

/** After a flight: credit the reward, note damage for the prep, remember the result. */
export function recordFlight(agency: Agency, r: { mission: MissionId; outcome: Outcome; earned: number; broken: string[]; hull: number; audit?: boolean }): Agency {
  const a: Agency = structuredClone(agency);
  a.credits += Math.max(0, Math.round(r.earned));
  a.history.push({ mission: r.mission, outcome: r.outcome, earned: r.earned });
  a.damaged = [...new Set(r.broken)].filter((id) => COMPONENT_BY_ID[id]);
  a.hullLoss = Math.max(0, Math.min(100, Math.round(100 - r.hull)));
  a.coveredRepairs = a.insured;
  a.insured = false;
  a.pendingPrep = true;
  a.audit = !!r.audit;
  return a;
}

export function unlockMission(agency: Agency, mission: MissionId): { agency: Agency; error?: string; errorMsg?: Msg } {
  const cost = MISSIONS[mission]?.unlockCost;
  if (cost === undefined) return { agency, ...err(m('eco.err.noMission')) };
  if (agency.unlocked.includes(mission)) return { agency, ...err(m('eco.err.unlocked')) };
  if (agency.credits < cost) return { agency, ...err(m('eco.err.credits', { n: cost - agency.credits, cost, balance: agency.credits })) };
  return { agency: { ...agency, credits: agency.credits - cost, unlocked: [...agency.unlocked, mission] } };
}

export function buyUpgrade(agency: Agency, id: UpgradeId, slot?: Department): { agency: Agency; error?: string; errorMsg?: Msg } {
  const def = UPGRADE_BY_ID[id];
  if (!def) return { agency, ...err(m('eco.err.noUpgrade')) };
  if (agency.upgrades.includes(id)) return { agency, ...err(m('eco.err.bought')) };
  if (slot && !DEPARTMENTS.some((d) => d.id === slot)) return { agency, ...err(m('eco.err.noDept')) };
  if (agency.credits < def.cost) return { agency, ...err(m('eco.err.credits', { n: def.cost - agency.credits, cost: def.cost, balance: agency.credits })) };
  return {
    agency: {
      ...agency, credits: agency.credits - def.cost, upgrades: [...agency.upgrades, id],
      ...(id === 'extra_slot' ? { extraSlot: slot ?? agency.extraSlot ?? DEFAULT_EXTRA_SLOT } : {}),
    },
  };
}

/** For storage (B: localStorage of the host; later the Supabase `agency` table). */
export function exportAgency(agency: Agency): string {
  return JSON.stringify({ v: 1, agency });
}

const OUTCOMES: Outcome[] = ['perfect', 'success', 'partial', 'failed'];
const int = (x: unknown, min = 0, max = 1e6) => (typeof x === 'number' && isFinite(x) ? Math.max(min, Math.min(max, Math.round(x))) : min);

/** Parse a stored agency (string or object). Unknown ids are dropped, numbers clamped; null if it is not an agency. */
export function importAgency(input: unknown): Agency | null {
  let raw: unknown = input;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return null; } }
  if (!raw || typeof raw !== 'object') return null;
  const o = ((raw as { agency?: unknown }).agency ?? raw) as Record<string, unknown>;
  if (!o || typeof o !== 'object' || typeof o.credits !== 'number') return null;
  const base = newAgency();
  const missions = Object.keys(MISSIONS) as MissionId[];
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const unlocked = [...new Set(['titan', ...arr(o.unlocked).filter((m): m is MissionId => missions.includes(m as MissionId))])] as MissionId[];
  const upgrades = [...new Set(arr(o.upgrades).filter((u): u is UpgradeId => !!UPGRADE_BY_ID[u as UpgradeId]))];
  const history = arr(o.history)
    .filter((h): h is Agency['history'][number] => !!h && typeof h === 'object' && missions.includes((h as { mission: MissionId }).mission) && OUTCOMES.includes((h as { outcome: Outcome }).outcome))
    .map((h) => ({ mission: h.mission, outcome: h.outcome, earned: int(h.earned) }));
  const dept = DEPARTMENTS.some((d) => d.id === o.extraSlot) ? (o.extraSlot as Department) : base.extraSlot;
  return {
    ...base,
    credits: int(o.credits), unlocked, upgrades, history, extraSlot: dept,
    damaged: [...new Set(arr(o.damaged).filter((id): id is string => typeof id === 'string' && !!COMPONENT_BY_ID[id]))],
    hullLoss: int(o.hullLoss, 0, 100),
    insured: o.insured === true, coveredRepairs: o.coveredRepairs === true, pendingPrep: o.pendingPrep === true,
    basicRepairs: int(o.basicRepairs), lastPrep: null, audit: o.audit === true,
  };
}
