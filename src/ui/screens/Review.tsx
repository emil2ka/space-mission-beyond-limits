// Screens 12–13: readiness check + commander approve / veto (docs/03 Design/Screens.md).
// Blockers forbid the launch; warnings can be approved only with an explicit «approve despite warnings» confirmation
// (the engine records it as approve-against-warning). Problem modules glow on the stand (Craft highlights stats.issues).
import { useMemo, useState } from 'react';
import { computeStats, holderOf, MISSIONS, readiness, rolesOf, type Issue, type MissionId } from '../../engine';
import { SecondKeyCard } from '../rules/SecondKey';
import { StandScene } from '../../scene/StandScene';
import { useGame, useMe } from '../../store/game';
import { A11yToggles, Check, DemoRoleSwitch, IssueLine, LeaveRoom, MeChip, Meter, MISSION_ICON, Note, RoleChip, roleName, TopBar } from '../components/common';
import { Icon, type IconName } from '../kit/Icon';
import { useReducedMotion } from '../settings';
import { useGraphicsQuality } from '../graphics';
import { RulesSummary } from '../AutonomyPlanner';
import { useT, type T } from '../../i18n';

type Cat = { id: string; icon: IconName; match: (id: string) => boolean };
const CATS: Cat[] = [
  { id: 'req', icon: 'need_required', match: (id) => id.startsWith('req:') },
  { id: 'mass', icon: 'res_mass', match: (id) => id === 'mass' || id === 'mass-near' },
  { id: 'budget', icon: 'res_budget', match: (id) => id === 'budget' },
  { id: 'power', icon: 'dept_power', match: (id) => ['no-gen', 'deficit', 'bus-overload', 'solar-weak'].includes(id) },
  { id: 'heat', icon: 'res_heat', match: (id) => ['freeze', 'cold', 'hot', 'overheat'].includes(id) },
  { id: 'link', icon: 'res_signal', match: (id) => ['dsl-no-hga', 'no-transceiver'].includes(id) },
  { id: 'compat', icon: 'dept_structure', match: (id) => id.startsWith('incompat:') || id.startsWith('useless:') || id === 'frame' },
  { id: 'slots', icon: 'act_add', match: (id) => id.startsWith('slots:') },
];

export function Review() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const me = useMe();
  const [reducedMotion] = useReducedMotion();
  const quality = useGraphicsQuality();
  const mission = MISSIONS[room.mission];
  const stats = useMemo(() => computeStats(room.build, mission, room.agency), [room.build, mission, room.agency]);
  const r = useMemo(() => readiness(room.build, mission, room.agency), [room.build, mission, room.agency]);
  const [focus, setFocus] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [vetoText, setVetoText] = useState('');
  const commander = rolesOf(me).includes('commander');
  const commanderName = holderOf(room.players, 'commander')?.name;

  // Stand glow: only blockers + warnings (not info notes); a clicked issue shows alone.
  const all = useMemo(() => [...r.blockers, ...r.warnings], [r]);
  const standStats = useMemo(() => ({ ...stats, issues: focus ? all.filter((i) => i.id === focus) : all }), [stats, all, focus]);

  const sev = (list: Issue[]) => (list.some((i) => r.blockers.includes(i)) ? 'bad' : list.length ? 'warn' : 'ok');
  const verdict = r.ok ? (r.warnings.length ? t('review.verdict.risky') : t('review.verdict.ok')) : t('review.verdict.no');

  return (
    <div className="scr scr--fixed">
      <TopBar icon="act_approve" title={t('review.title')} sub={mission.name}><MeChip /></TopBar>
      <div className="layout-constructor layout-review">
        <section className="lc-catalog panel--night review-list">
          <div className="lc-catalog__list">
            <div className={`review-verdict review-verdict--${r.ok ? (r.warnings.length ? 'warn' : 'ok') : 'bad'}`}>
              <Icon name={r.ok ? (r.warnings.length ? 'st_warn' : 'st_ok') : 'st_crit'} size={48} />
              <div><div className="t-eyebrow">{t('review.title')}</div><h2 className="t-h3">{verdict}</h2></div>
            </div>
            <ul className="stack gap-2 review-cats">
              {CATS.map((c) => {
                const list = all.filter((i) => c.match(i.id));
                const s = sev(list);
                return (
                  <li key={c.id} className={`check-line check-line--compact check-line--static ${s === 'bad' ? 'check-line--block' : s === 'warn' ? 'check-line--warn' : ''}`}>
                    <span className="check-line__badge"><Icon name={c.icon} size={24} /></span>
                    <span className="check-line__title">{t(`review.cat.${c.id}`)}<span className="check-line__word">{t(`review.word.${s}`)}</span></span>
                    <span className="t-mono t-small">{catValue(t, c.id, stats)}</span>
                  </li>
                );
              })}
            </ul>
            <IssueList title={t('review.blockers')} list={r.blockers} severity="critical" focus={focus} setFocus={setFocus} mission={room.mission} />
            <IssueList title={t('review.warnings')} list={r.warnings} severity="warn" focus={focus} setFocus={setFocus} mission={room.mission} />
            {r.notes.length > 0 && <IssueList title={t('review.notes')} list={r.notes} severity="info" focus={focus} setFocus={setFocus} mission={room.mission} />}
            {!all.length && <Note level="ok">{t('review.noIssues')}</Note>}
            <RulesSummary />
          </div>
        </section>

        <section className="lc-stage">
          <div className="viewport viewport--scene">
            <div className="viewport__canvas">
              <StandScene build={room.build} stats={standStats} role={me?.role ?? null} reducedMotion={reducedMotion} quality={quality} mission={room.mission} />
            </div>
            <div className="viewport__hud">
              <div className="hud-row">
                <span className="chip"><Icon name={MISSION_ICON[room.mission]} size={24} />{mission.name}{t('review.onCheck')}</span>
              </div>
              <div className="hud-row">
                <span className="chip chip--night">
                  <Icon name={focus ? 'st_info' : 'st_warn'} size={24} />{focus ? t('review.focusOne') : t('review.focusAll')}
                </span>
              </div>
            </div>
          </div>
        </section>

        <aside className="lc-params panel--night">
          <Meter icon="res_mass" label={t('review.cat.mass')} value={<>{stats.mass} <span className="meter__limit">{t('review.ofKg', { n: stats.massLimit })}</span></>} k={stats.mass / stats.massLimit} />
          <Meter icon="res_budget" label={t('review.cat.budget')} value={<>{stats.cost} <span className="meter__limit">{t('review.ofMoney', { n: stats.budget })}</span></>} k={stats.cost / stats.budget} />
          <div className="row gap-2">
            <span className="stat"><Icon name="res_power_gen" size={20} />{stats.generation} W</span>
            <span className="stat"><Icon name="res_power_use" size={20} />{stats.consumption} W</span>
            <span className={`stat ${stats.netPower < 0 ? 'stat--crit' : ''}`}><Icon name="dept_power" size={20} />{stats.netPower < 0 ? t('review.deficit', { n: -stats.netPower }) : t('review.reserve', { n: stats.netPower })} W</span>
            <span className="stat"><Icon name="res_power_use" size={20} />{t('review.bus', { n: stats.busLimit })}</span>
            <span className="stat"><Icon name="res_heat" size={20} />{t('review.heat', { n: stats.heatBalance })}</span>
          </div>

          <div className="card card--cream card--tight decision">
            <div className="card__head card__head--commander"><Icon name="role_commander" size={32} /><span className="card__title">{t('review.decision')}</span></div>
            <div className="stack gap-3">
              <DemoRoleSwitch />
              <SecondKeyCard />
              {commander ? (
                <>
                  {r.warnings.length > 0 && r.ok && (
                    <Check checked={ack} onChange={setAck}>
                      {t('review.ack', { n: r.warnings.length })}
                    </Check>
                  )}
                  <button className="btn btn--primary btn--block" disabled={!r.ok || (r.warnings.length > 0 && !ack) || !!room.pendingKey} onClick={() => dispatch({ type: 'approve' })}>
                    <Icon name="act_approve" size={24} />{r.warnings.length ? t('review.approveRisk') : t('review.approve')}
                  </button>
                  {!r.ok && <Note level="bad">{t('review.blockFirst')}</Note>}
                  <label className="field">
                    <span className="field__label">{t('review.vetoReason')}</span>
                    <textarea className="input textarea" value={vetoText} onChange={(e) => setVetoText(e.target.value)} maxLength={200} rows={2} placeholder={t('review.vetoPh')} />
                  </label>
                  <button className="btn btn--danger btn--block" onClick={() => { dispatch({ type: 'veto', text: vetoText.trim() || t('review.vetoDefault') }); setVetoText(''); }}>
                    <Icon name="act_veto" size={24} />{t('review.veto')}
                  </button>
                </>
              ) : (
                <div className="stack gap-2">
                  <p className="t-small t-muted">
                    {commanderName ? t('review.waitCmd', { name: commanderName }) : t('review.cmdFree')} {t('review.buildLocked')}
                  </p>
                  <div className="row gap-2"><span className="t-small">{t('review.you')}</span>{me?.role ? <RoleChip role={me.role} /> : <span className="chip chip--text">{roleName(me?.role)}</span>}</div>
                </div>
              )}
            </div>
          </div>
          <div className="panel-foot">
            <A11yToggles />
            <LeaveRoom />
          </div>
        </aside>
      </div>
    </div>
  );
}

function IssueList({ title, list, severity, focus, setFocus, mission }: { title: string; list: Issue[]; severity: Issue['severity']; focus: string | null; setFocus: (id: string | null) => void; mission: MissionId }) {
  const t = useT();
  if (!list.length) return null;
  return (
    <div className="stack gap-2">
      <div className="t-eyebrow t-muted">{title}</div>
      {list.map((i) => (
        <IssueLine key={i.id} severity={severity} text={t.f(i, 'text')} selected={focus === i.id} onClick={() => setFocus(focus === i.id ? null : i.id)} modules={i.componentIds} mission={mission} />
      ))}
    </div>
  );
}

function catValue(t: T, id: string, s: ReturnType<typeof computeStats>): string {
  switch (id) {
    case 'mass': return t('review.kgRatio', { a: s.mass, b: s.massLimit });
    case 'budget': return t('review.moneyRatio', { a: s.cost, b: s.budget });
    case 'power': return `${s.netPower >= 0 ? '+' : ''}${s.netPower} W`;
    case 'heat': return `${s.heatBalance}`;
    case 'link': return `${s.bandwidth}`;
    default: return '';
  }
}
