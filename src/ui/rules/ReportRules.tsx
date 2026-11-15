// Report parts of decision 0013: contribution per player (a player may hold several roles, §4) and the Team Trust tier (§3).
import type { MissionReport } from '../../engine';
import { Icon } from '../kit/Icon';
import { RoleChip } from '../components/common';
import { t, useT } from '../../i18n';
import './rules.css';

/** Texts (current language). Dictionary: rules.ui.rep.* */
export const REPORT_RULES_TEXT = {
  get players() { return t('rules.ui.rep.players'); },
  built: (n: number) => t('rules.ui.rep.built', { n }),
  requests: (s: number, a: number, v: number) => t('rules.ui.rep.requests', { s, a, v }),
  decisions: (n: number) => t('rules.ui.rep.decisions', { n }),
  crisis: (n: number) => t('rules.ui.rep.crisis', { n }),
  radio: (n: number) => t('rules.ui.rep.radio', { n }),
  keys: (n: number) => t('rules.ui.rep.keys', { n }),
  get nothing() { return t('rules.ui.rep.nothing'); },
};

export function PlayersCard({ r }: { r: MissionReport }) {
  useT();
  if (!r.players?.length) return null;
  return (
    <div className="card card--cream card--tight" data-testid="report-players">
      <div className="card__head"><Icon name="role_commander" size={32} /><span className="card__title">{REPORT_RULES_TEXT.players}</span></div>
      <div className="stack gap-3">
        {r.players.map((p) => {
          const parts = [
            p.built ? REPORT_RULES_TEXT.built(p.built) : '',
            p.requests.sent ? REPORT_RULES_TEXT.requests(p.requests.sent, p.requests.approved, p.requests.vetoed) : '',
            p.decisions ? REPORT_RULES_TEXT.decisions(p.decisions) : '',
            p.crisisChoices ? REPORT_RULES_TEXT.crisis(p.crisisChoices) : '',
            p.radio ? REPORT_RULES_TEXT.radio(p.radio) : '',
            p.keys ? REPORT_RULES_TEXT.keys(p.keys) : '',
          ].filter(Boolean);
          return (
            <div key={p.id} className="report-player">
              <div className="row gap-2"><b>{p.name}</b>{p.roles.map((role) => <RoleChip key={role} role={role} />)}</div>
              <div className="t-small t-muted">{parts.join(' · ') || REPORT_RULES_TEXT.nothing}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
