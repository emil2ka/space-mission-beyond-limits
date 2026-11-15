// Team rules of decision 0013 §2–4 (pure functions over the room state, no React):
// - who installs which module: own department at once, a foreign one (or over the department's budget share) as a request to the commander;
// - the commander's budget split across departments;
// - Team Trust tiers and their effects (crisis bonus, second key, agency audit);
// - 2–3 players: a player may hold several roles; free roles get a balanced default owner.
// The engine returns structured data (ids, numbers, reasons); the UI words it.
import { ROLES } from './constants';
import { COMPONENT_BY_ID } from './data/components';
import { MISSIONS } from './data/missions';
import { DEFAULT_SPLIT, DEPT_OWNER, OWNER_ROLES, SPLIT_STEP, TRUST, type BudgetSplit, type OwnerRole } from './data/rules';
import type { Department, Issue, MissionId, RoleId } from './types';
import type { Player, RoomState } from './room';
import { m, ru, type Msg } from './msg';

export { DEFAULT_SPLIT, DEPT_OWNER, OWNER_ROLES, SPLIT_STEP, TRUST, type BudgetSplit, type OwnerRole };

/** Canonical role order (commander, engineer, science, comms). */
export const ROLE_SEQ: RoleId[] = ROLES.map((r) => r.id);

// ───────────────────────────── roles ─────────────────────────────

/** Every role a player holds (old states have only `role`). The first one is the player's own pick. */
export function rolesOf(p: Pick<Player, 'role'> & { roles?: RoleId[] } | null | undefined): RoleId[] {
  if (!p) return [];
  return p.roles ?? (p.role ? [p.role] : []);
}

/** Set a player's roles; `role` stays the first one (M1/M2 screens and old clients read it). */
export function setRoles(p: Player, roles: RoleId[]) {
  p.roles = [...new Set(roles)];
  p.role = p.roles[0] ?? null;
}

/** Old saved states: give every player a `roles` list. */
export function normalizeRoles(s: RoomState) {
  for (const p of s.players) if (!Array.isArray(p.roles)) setRoles(p, p.role ? [p.role] : []);
}

export function holderOf(players: readonly Player[], role: RoleId): Player | undefined {
  return players.find((p) => rolesOf(p).includes(role));
}

/** Roles nobody holds. */
export function freeRoles(players: readonly Player[]): RoleId[] {
  return ROLE_SEQ.filter((r) => !holderOf(players, r));
}

/**
 * Balanced default for the free roles (0013 §4): each free role, in role order, goes to the player who holds
 * the fewest roles so far (ties: the earliest to join). Used at the start and shown in the lobby beforehand.
 */
export function rolePlan(players: readonly Player[]): { role: RoleId; playerId: string }[] {
  const count = new Map(players.map((p) => [p.id, rolesOf(p).length]));
  const order = [...players].sort((a, b) => a.joinOrder - b.joinOrder);
  const out: { role: RoleId; playerId: string }[] = [];
  for (const role of freeRoles(players)) {
    const to = order.reduce<Player | null>((best, p) => (!best || count.get(p.id)! < count.get(best.id)! ? p : best), null);
    if (!to) break;
    out.push({ role, playerId: to.id });
    count.set(to.id, count.get(to.id)! + 1);
  }
  return out;
}

// ───────────────────────────── departments ─────────────────────────────

export function ownerOfDept(dept: Department): OwnerRole {
  return DEPT_OWNER[dept];
}

/** Owner role of a component (by its department). */
export function ownerOf(componentId: string): OwnerRole | null {
  const def = COMPONENT_BY_ID[componentId];
  return def ? DEPT_OWNER[def.department] : null;
}

/** The commander may install anything; others own the departments of their roles. */
export function ownsDepartment(roles: readonly RoleId[], dept: Department): boolean {
  return roles.includes('commander') || roles.includes(DEPT_OWNER[dept]);
}

/** Departments a set of roles owns. */
export function departmentsOf(roles: readonly RoleId[]): Department[] {
  return (Object.keys(DEPT_OWNER) as Department[]).filter((d) => ownsDepartment(roles, d));
}

// ───────────────────────────── budget split ─────────────────────────────

export interface BudgetPlan {
  split: BudgetSplit;
  /** false = the mission's default, the commander has not confirmed a split yet. */
  set: boolean;
  by?: string;
}

/** Module budget the split divides: mission budget minus the frame. */
export function moduleBudget(mission: MissionId): number {
  const m = MISSIONS[mission];
  return m.budget - m.frameCost;
}

export function budgetPlanOf(s: Pick<RoomState, 'mission'> & { budgetSplit?: BudgetPlan | null }): BudgetPlan {
  return s.budgetSplit ?? { split: { ...DEFAULT_SPLIT[s.mission] }, set: false };
}

/** Error text for an invalid split, else null. Integers in steps of 5 that add up to 100. */
export function validateSplit(split: unknown): string | null {
  const msg = validateSplitMsg(split);
  return msg && ru(msg);
}
/** validateSplit as a message (null = ok). */
export function validateSplitMsg(split: unknown): Msg | null {
  if (!split || typeof split !== 'object') return m('rules.split.none');
  const o = split as Record<string, unknown>;
  for (const r of OWNER_ROLES) {
    const v = o[r];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100 || v % SPLIT_STEP !== 0) return m('rules.split.step', { step: SPLIT_STEP });
  }
  if (OWNER_ROLES.reduce((sum, r) => sum + (o[r] as number), 0) !== 100) return m('rules.split.sum');
  return null;
}

/** M$ spent per owner on the installed modules (whoever installed them). */
export function departmentSpend(build: Readonly<Record<string, number>>): Record<OwnerRole, number> {
  const out: Record<OwnerRole, number> = { engineer: 0, science: 0, comms: 0 };
  for (const [id, n] of Object.entries(build)) {
    const def = COMPONENT_BY_ID[id];
    if (def && n > 0) out[DEPT_OWNER[def.department]] += def.cost * n;
  }
  return out;
}

export interface ShareLine { owner: OwnerRole; pct: number; share: number; spent: number; left: number }

/** Every department's share (M$), what it spent and what is left (negative = over its share). */
export function budgetShares(s: Pick<RoomState, 'mission' | 'build'> & { budgetSplit?: BudgetPlan | null }): ShareLine[] {
  const plan = budgetPlanOf(s);
  const total = moduleBudget(s.mission);
  const spent = departmentSpend(s.build);
  return OWNER_ROLES.map((owner) => {
    const share = Math.round((total * plan.split[owner]) / 100);
    return { owner, pct: plan.split[owner], share, spent: spent[owner], left: share - spent[owner] };
  });
}

// ───────────────────────────── build requests ─────────────────────────────

export type RequestReason = 'foreign' | 'over-share';

export interface BuildRequest {
  id: string;
  kind: 'add' | 'remove';
  componentId: string;
  department: Department;
  owner: OwnerRole;
  /** Requesting player and the role he acted as (his own pick). */
  by: string;
  byRole: RoleId | null;
  reasons: RequestReason[];
  /** over-share: M$ above the department's share after the change. */
  overBy: number;
  status: 'pending' | 'approved' | 'vetoed' | 'cancelled';
  /** Veto reason (commander) or why it was cancelled. */
  note?: string;
  /** Engine-made note (cancel / lapse / default veto) as a message; a player's own veto text has none. */
  i18n?: { note: Msg };
  at: number;
  resolvedBy?: string;
  resolvedAt?: number;
}

/** Does the room run the department rules? Not in the demo (one player does everything) and not without a commander. */
export function rulesActive(s: Pick<RoomState, 'demo' | 'players'>): boolean {
  return !s.demo && !!holderOf(s.players, 'commander');
}

/**
 * Why this change can't be made at once (empty = immediate). Own department within its share → immediate;
 * a foreign department → `foreign`; going over the department's budget share → `over-share` (0013 §2).
 */
export function changeReasons(
  s: Pick<RoomState, 'demo' | 'players' | 'mission' | 'build'> & { budgetSplit?: BudgetPlan | null },
  roles: readonly RoleId[], kind: 'add' | 'remove', componentId: string,
): { reasons: RequestReason[]; owner: OwnerRole | null; overBy: number } {
  const def = COMPONENT_BY_ID[componentId];
  const owner = def ? DEPT_OWNER[def.department] : null;
  if (!def || !owner || !rulesActive(s) || roles.includes('commander')) return { reasons: [], owner, overBy: 0 };
  const reasons: RequestReason[] = [];
  if (!roles.includes(owner)) reasons.push('foreign');
  let overBy = 0;
  if (kind === 'add') {
    const line = budgetShares(s).find((l) => l.owner === owner)!;
    overBy = Math.max(0, line.spent + def.cost - line.share);
    if (overBy > 0) reasons.push('over-share');
  }
  return { reasons, owner, overBy };
}

export const pendingRequests = (s: { requests?: BuildRequest[] }) => (s.requests ?? []).filter((r) => r.status === 'pending');

// ───────────────────────────── Team Trust ─────────────────────────────

export type TrustTierId = 'cohesive' | 'steady' | 'watch' | 'audit';

/** ≥ 80 cohesive · 50–79 steady · 25–49 watch · < 25 audit (audit includes the watch rules). */
export function trustTier(trust: number): TrustTierId {
  if (trust >= TRUST.cohesive) return 'cohesive';
  if (trust >= TRUST.watch) return 'steady';
  if (trust >= TRUST.audit) return 'watch';
  return 'audit';
}

export interface TrustEffects {
  tier: TrustTierId;
  /** Extra seconds on crisis decision timers. */
  crisisBonus: number;
  /** Approve-against-critical-warning needs the owner's second key. */
  secondKey: boolean;
  /** A mandatory diagnostic at the next preparation (MC; the free basic repair covers it). */
  audit: boolean;
  auditCost: number;
}

export function trustEffects(trust: number): TrustEffects {
  const tier = trustTier(trust);
  return {
    tier,
    crisisBonus: tier === 'cohesive' ? TRUST.crisisBonus : 0,
    secondKey: trust < TRUST.watch,
    audit: trust < TRUST.audit,
    auditCost: TRUST.auditCost,
  };
}

/** One Team Trust change with its reason (report.trust, room.trustHistory). */
export interface TrustChange { delta: number; reason: string; issueId: string; attempt?: number; from?: number; to?: number }

// ───────────────────────────── second key ─────────────────────────────

/** Accepted warnings that are critical risks (the ones a second key guards): critical severity or over the mass limit. */
export function criticalWarnings(warnings: readonly Issue[]): Issue[] {
  return warnings.filter((i) => i.severity === 'critical' || i.id === 'mass');
}

/** Departments' owners of an issue: its roles without the commander, else the owners of its modules, else the engineer. */
export function issueOwners(i: Issue): OwnerRole[] {
  const own = i.roles.filter((r): r is OwnerRole => r !== 'commander');
  if (own.length) return [...new Set(own)];
  const byModule = i.componentIds.map(ownerOf).filter((r): r is OwnerRole => !!r);
  return byModule.length ? [...new Set(byModule)] : ['engineer'];
}

export interface PendingKey {
  issueIds: string[];
  /** The accepted warnings' text (for the decision). */
  text: string;
  i18n?: { text: Msg };
  /** Commander who asked. */
  by: string;
  stage: 'build' | 'review';
  /** Players whose key is needed (all of them), or — `any` — one key from any of them. */
  need: string[];
  any: boolean;
  /** Owner roles the key stands for. */
  owners: OwnerRole[];
  keys: string[];
  at: number;
}

/**
 * Who must give the second key for these critical warnings (null = no key needed): online holders of the
 * owner roles other than the approving commander. If the commander holds them all himself (2 players), any other
 * online player turns the key — a second key is always a second person. Nobody else online → no key.
 */
export function keyHolders(s: Pick<RoomState, 'players'>, issues: readonly Issue[], commanderId: string): { need: string[]; any: boolean; owners: OwnerRole[] } | null {
  const owners = [...new Set(issues.flatMap(issueOwners))];
  const others = s.players.filter((p) => p.id !== commanderId && p.online);
  const need = others.filter((p) => rolesOf(p).some((r) => (owners as RoleId[]).includes(r))).map((p) => p.id);
  if (need.length) return { need, any: false, owners };
  if (others.length) return { need: others.map((p) => p.id), any: true, owners };
  return null;
}

export function keysComplete(k: PendingKey): boolean {
  return k.any ? k.keys.length > 0 : k.need.every((id) => k.keys.includes(id));
}

// ───────────────────────────── contribution per player ─────────────────────────────

export interface PlayerContribution {
  id: string;
  name: string;
  roles: RoleId[];
  /** Modules installed (directly or through an approved request). */
  built: number;
  /** Requests to the commander: sent / approved / vetoed. */
  requests: { sent: number; approved: number; vetoed: number };
  /** Commander decisions taken (approve / veto / request decisions). */
  decisions: number;
  crisisChoices: number;
  radio: number;
  /** Second keys given. */
  keys: number;
}

/** What each player did this attempt (report «вклад по игрокам»). */
export function playerContributions(room: Pick<RoomState, 'players' | 'log' | 'decisionLog' | 'decisions'> & { requests?: BuildRequest[] }): PlayerContribution[] {
  const decisions = room.decisionLog?.length ? room.decisionLog : room.decisions;
  return [...room.players].sort((a, b) => a.joinOrder - b.joinOrder).map((p) => {
    const mine = (room.requests ?? []).filter((r) => r.by === p.id);
    const logs = room.log.filter((e) => e.by === p.id);
    return {
      id: p.id, name: p.name, roles: rolesOf(p),
      built: logs.filter((e) => e.kind === 'build' && /\+1 \S+$/.test(e.text)).length,
      requests: { sent: mine.length, approved: mine.filter((r) => r.status === 'approved').length, vetoed: mine.filter((r) => r.status === 'vetoed').length },
      decisions: decisions.filter((d) => d.by === p.id && d.kind !== 'key-denied').length,
      crisisChoices: logs.filter((e) => e.kind === 'crisis').length,
      radio: logs.filter((e) => e.kind === 'radio').length,
      keys: decisions.reduce((n, d) => n + (d.keys?.includes(p.id) ? 1 : 0), 0),
    };
  });
}
