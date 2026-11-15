// A player with several roles (decision 0013 §4) gets one panel tab per role. Each tab shows exactly what that role sees
// (blackout asymmetry stays per role); a «!» marks a tab whose role still has to answer the open crisis.
import { useEffect, useState } from 'react';
import type { FlightState, RoleId } from '../../engine';
import { Icon } from '../kit/Icon';
import { ROLE_ICON, ROLE_SHORT } from '../components/common';
import { t, useT } from '../../i18n';
import './rules.css';

/** Texts (current language). Dictionary: rules.ui.tabs.* */
export const TABS_TEXT = {
  get label() { return t('rules.ui.tabs.label'); },
  get needs() { return t('rules.ui.tabs.needs'); },
  hint: (n: number) => t('rules.ui.tabs.hint', { n }),
};

/** Roles of mine that still have to choose in the open crisis. */
export function rolesToAnswer(f: FlightState | null, roles: RoleId[]): RoleId[] {
  const c = f?.crisis;
  if (!c) return [];
  return roles.filter((r) => !c.chosen[r] && c.options.some((o) => o.role === r));
}

/** Active role tab: defaults to the first role; jumps to a role that must answer when a new crisis opens. */
export function useRoleTab(roles: RoleId[], f: FlightState | null): [RoleId | null, (r: RoleId) => void] {
  const [tab, setTab] = useState<RoleId | null>(null);
  const crisisId = f?.crisis?.id ?? null;
  useEffect(() => {
    if (!crisisId || roles.length < 2) return;
    const need = rolesToAnswer(f, roles);
    if (need.length && (!tab || !need.includes(tab))) setTab(need[0]);
  }, [crisisId]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = tab && roles.includes(tab) ? tab : roles[0] ?? null;
  return [active, setTab];
}

export function RoleTabs({ roles, active, onPick, needs }: { roles: RoleId[]; active: RoleId | null; onPick: (r: RoleId) => void; needs: RoleId[] }) {
  useT();
  if (roles.length < 2) return null;
  return (
    <div className="role-tabs stack gap-1">
      <div className="tabs role-tabs__bar" role="tablist" aria-label={TABS_TEXT.label}>
        {roles.map((r) => (
          <button key={r} type="button" role="tab" aria-selected={r === active} className={`tab role-tabs__tab role-tabs__tab--${r} ${r === active ? 'is-selected' : ''}`}
            onClick={() => onPick(r)} data-testid={`role-tab-${r}`} title={needs.includes(r) ? TABS_TEXT.needs : undefined}>
            <Icon name={ROLE_ICON[r]} size={24} /><span>{ROLE_SHORT[r]}</span>
            {needs.includes(r) && <span className="role-tabs__alert" aria-label={TABS_TEXT.needs}>!</span>}
          </button>
        ))}
      </div>
      <span className="t-small t-muted">{TABS_TEXT.hint(roles.length)}</span>
    </div>
  );
}
