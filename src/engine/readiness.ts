// Readiness check before launch (ТЗ §6, «Проверка готовности»).
// Blockers stop the launch; warnings may be accepted by the commander (recorded as approve-against-warning).
import { TITAN } from './data/titan';
import { DEPARTMENTS } from './constants';
import { computeStats } from './stats';
import type { Build, Issue, MissionDef, Mods } from './types';
import { m, ru } from './msg';

export interface Readiness {
  ok: boolean;
  blockers: Issue[];
  warnings: Issue[];
  /** Informational notes (useless modules etc.) — never block, never need confirmation. */
  notes: Issue[];
}

/** Critical stats issues that are a risk the commander may accept (they become flight consequences). */
const ACCEPTABLE = new Set(['bus-overload', 'freeze', 'overheat']);

export function readiness(build: Build, mission: MissionDef, mods?: Mods): Readiness {
  const stats = computeStats(build, mission, mods);
  const blockers: Issue[] = [];
  const warnings: Issue[] = [];
  const notes: Issue[] = [];

  for (const i of stats.issues) {
    if (i.severity === 'info') { notes.push(i); continue; }
    if (i.severity === 'warn') { warnings.push(i); continue; }
    if (i.id === 'mass') {
      // ТЗ test C: going over the launcher limit is a warning the commander may accept…
      // …but only a little: a craft far above the limit cannot be launched at all.
      const over = stats.mass - stats.massLimit;
      if (over <= stats.massLimit * TITAN.overweight.maxRatio) { warnings.push({ ...i, severity: 'warn' }); continue; }
      const msg = m('issue.overweightMax', { text: i.i18n?.text ?? i.text, pct: Math.round(TITAN.overweight.maxRatio * 100) });
      blockers.push({ ...i, text: ru(msg), i18n: { text: msg } });
      continue;
    }
    if (ACCEPTABLE.has(i.id)) { warnings.push(i); continue; }
    blockers.push(i);
  }

  for (const d of DEPARTMENTS) {
    if (stats.slotsUsed[d.id] > stats.slotsTotal[d.id]) {
      const msg = m('issue.slotsOver', { dept: m(`dept.${d.id}`), used: stats.slotsUsed[d.id], total: stats.slotsTotal[d.id] });
      blockers.push({ id: `slots:${d.id}`, severity: 'critical', text: ru(msg), componentIds: [], roles: ['commander', 'engineer'], i18n: { text: msg } });
    }
  }

  return { ok: blockers.length === 0, blockers, warnings, notes };
}
