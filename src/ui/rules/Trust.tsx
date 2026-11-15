// Team Trust tier (decision 0013 §3): the value, the tier, what it does and why it changed.
// Shown on the commander's panels (constructor, flight), in the lobby / HQ and in the report.
import { trustEffects, TRUST, type TrustChange, type TrustEffects, type TrustTierId } from '../../engine';
import { Icon, type IconName } from '../kit/Icon';
import { t, useT } from '../../i18n';
import { tKeys } from '../components/common';
import './rules.css';

/** Texts (current language; components call useT() to re-render). Dictionary: trust.* */
export const TRUST_TEXT = {
  title: 'Team Trust',
  tier: tKeys('trust.tier', ['cohesive', 'steady', 'watch', 'audit'] as const) satisfies Record<TrustTierId, string>,
  effect: {
    cohesive: (e: TrustEffects) => t('trust.effect.cohesive', { s: e.crisisBonus }),
    steady: () => t('trust.effect.steady'),
    watch: () => t('trust.effect.watch'),
    audit: (e: TrustEffects) => t('trust.effect.audit', { mc: e.auditCost }),
  } satisfies Record<TrustTierId, (e: TrustEffects) => string>,
  next: (v: number) => (v >= TRUST.cohesive ? null : v >= TRUST.watch ? t('trust.next.cohesive', { n: TRUST.cohesive - v }) : v >= TRUST.audit ? t('trust.next.key', { n: TRUST.watch - v }) : t('trust.next.audit', { n: TRUST.audit - v })),
  get rules() { return t('trust.rules', { penalty: TRUST.penalty, recovery: TRUST.recovery }); },
  get history() { return t('trust.history'); },
  get noHistory() { return t('trust.noHistory'); },
  attempt: (n: number) => t('trust.attempt', { n }),
  /** Short line for a flight with a bonus. */
  flightBonus: (s: number) => t('trust.flightBonus', { s }),
};

const TIER_ICON: Record<TrustTierId, IconName> = { cohesive: 'st_ok', steady: 'st_info', watch: 'st_warn', audit: 'st_crit' };
const TIER_CHIP: Record<TrustTierId, string> = { cohesive: 'chip--ok', steady: 'chip--info', watch: 'chip--warn', audit: 'chip--crit' };

/** Chip: «Team Trust 72 · Рабочее доверие». */
export function TrustChip({ value, compact }: { value: number; compact?: boolean }) {
  useT();
  const tier = trustEffects(value).tier;
  return (
    <span className={`chip ${TIER_CHIP[tier]} trust-chip`} title={TRUST_TEXT.effect[tier](trustEffects(value))} data-testid="trust-chip" data-tier={tier}>
      <Icon name={TIER_ICON[tier]} size={24} />
      {compact ? `${value}` : `${TRUST_TEXT.title} ${value}`} · {TRUST_TEXT.tier[tier]}
    </span>
  );
}

/** Card: value + tier + its effect + the reasons of the last changes. */
export function TrustCard({ value, history, tight, dark }: { value: number; history?: TrustChange[]; tight?: boolean; dark?: boolean }) {
  const tr = useT();
  const e = trustEffects(value);
  const next = TRUST_TEXT.next(value);
  const list = [...(history ?? [])].reverse().slice(0, tight ? 2 : 4);
  return (
    <div className={`trust-card trust-card--${e.tier} ${dark ? 'trust-card--dark' : ''}`} data-testid="trust-card">
      <div className="trust-card__head">
        <Icon name="role_commander" size={32} />
        <div className="grow min0">
          <div className="t-eyebrow">{TRUST_TEXT.title}</div>
          <div className="trust-card__tier"><b className="t-mono">{value}</b> · {TRUST_TEXT.tier[e.tier]}</div>
        </div>
        <Icon name={TIER_ICON[e.tier]} size={24} />
      </div>
      <div className="trust-card__bar" aria-hidden>
        <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        <span style={{ left: `${TRUST.audit}%` }} /><span style={{ left: `${TRUST.watch}%` }} /><span style={{ left: `${TRUST.cohesive}%` }} />
      </div>
      <p className="trust-card__effect">{TRUST_TEXT.effect[e.tier](e)}</p>
      {next && <div className="t-small t-muted">{next}</div>}
      {!tight && <div className="t-small t-muted">{TRUST_TEXT.rules}</div>}
      <div className="trust-card__hist">
        <div className="t-eyebrow t-muted">{TRUST_TEXT.history}</div>
        {list.length ? list.map((c, i) => (
          <div key={i} className="trust-card__line">
            <b className={`t-mono ${c.delta < 0 ? 't-crit' : 't-ok'}`}>{c.delta > 0 ? '+' : ''}{c.delta}</b>
            <span>{c.attempt ? <span className="t-muted">{TRUST_TEXT.attempt(c.attempt)}{c.from !== undefined ? ` · ${c.from}→${c.to}` : ''}: </span> : null}{tr.f(c, 'reason')}</span>
          </div>
        )) : <div className="t-small t-muted">{TRUST_TEXT.noHistory}</div>}
      </div>
    </div>
  );
}
