// Screen 17: Mission Report (docs/03 Design/Mission Report.md). Data: room.report (engine buildReport).
// Tone: what happened → why → what you could have done. ≤ 3 main chains, the rest under «Подробнее».
import { useState, type ReactNode } from 'react';
import { buildReport, COMPONENT_BY_ID, MISSIONS, OUTCOME_NAMES, prepCosts, SITE_BY_ID, type CapsuleStage, type CauseChain, type Decision, type MissionId, type MissionReport } from '../../engine';
import { useGame } from '../../store/game';
import { useT } from '../../i18n';
import { McChip, Meter, MISSION_ICON, mmss, Note, RoleChip, TopBar } from '../components/common';
import { Icon, type IconName } from '../kit/Icon';
import { ModuleIcon } from '../kit/ModuleIcon';
import { ReportReplay } from '../components/ReportReplay';
import { useView } from '../view';
import { useCanManage } from './HQ';
import { PlayersCard } from '../rules/ReportRules';
import { TRUST_TEXT, TrustChip } from '../rules/Trust';
import { TaskReportCard } from '../tasks/FlightTasks';
/** Dictionary keys of the decision names. */
const DECISION_NAME: Record<Decision['kind'], string> = {
  approve: 'report.dec.approve', 'approve-against-warning': 'report.dec.approveAgainst', veto: 'report.dec.veto',
  'request-approve': 'report.dec.requestApprove', 'request-veto': 'report.dec.requestVeto', 'key-denied': 'report.dec.keyDenied',
};

export function Report() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const isHost = useGame((s) => s.room?.hostId === s.me.id);
  const openView = useView((s) => s.open);
  const { can, who } = useCanManage();
  const [more, setMore] = useState(false);
  const r = room.report ?? buildReport(room);
  const mission = MISSIONS[room.mission];
  const main = r.chains.slice(0, 3);
  const rest = r.chains.slice(3);
  const prep = prepCosts(room.agency, false);

  const outcomeCls = r.outcome === 'failed' ? 'outcome--fail' : r.outcome === 'partial' ? 'outcome--partial' : r.outcome === 'perfect' ? 'outcome--perfect' : '';
  const trustTone = r.teamTrust >= 80 ? 'ok' : r.teamTrust >= 50 ? 'warn' : 'crit';

  const actions = room.agency.pendingPrep ? (
    <>
      <button className="btn btn--secondary" onClick={() => openView('hq')}><Icon name="hq_upgrade" size={24} />{t('report.toHq')}</button>
      <button className="btn btn--primary btn--lg" onClick={() => openView('prep', 'build')} data-testid="report-again"><Icon name="act_replay" size={32} />{t('report.againPrep')}</button>
    </>
  ) : isHost ? (
    <>
      <button className="btn btn--secondary" onClick={() => dispatch({ type: 'goStage', stage: 'lobby' })}><Icon name="act_exit" size={24} />{t('report.toLobby')}</button>
      <button className="btn btn--primary btn--lg" onClick={() => dispatch({ type: 'goStage', stage: 'build' })}><Icon name="act_replay" size={32} />{t('report.again')}</button>
    </>
  ) : <span className="t-small action-bar__note">{t('report.hostPicks')}</span>;

  return (
    <div className="scr scr--report">
      <TopBar icon={MISSION_ICON[room.mission]} title={<>Mission Report · {mission.name}</>} sub={t('report.flight', { time: mmss(r.ticks) })}><McChip value={room.agency.credits} /></TopBar>
      <div className="layout-report">
        <div className="report-left">
          <div className="card card--cream report-out">
            <div className="t-eyebrow t-muted">{t('report.outcome')}</div>
            <h1 className={`outcome ${outcomeCls}`}>{t.d(OUTCOME_NAMES[r.outcome])}</h1>
            <div className="t-eyebrow t-muted report-out__label">{t('report.score')}</div>
            <div className="score"><b>{r.score}</b><span>/ 100</span></div>
            <div className="t-small t-muted">{t('report.delivered', { n: r.delivered.length })}</div>
            {r.mc.earned > 0 && (
              <div className="burst burst--gold burst--sm burst--gain report-out__gain"><div className="burst__text">+{r.mc.earned} MC<span className="burst__sub">{t('report.earnedSub')}</span></div></div>
            )}
          </div>

          <div className="card card--cream card--tight">
            <Meter icon="role_commander" label="Team Trust" value={`${r.teamTrust}`} k={r.teamTrust / 100} tone={trustTone} />
            <div className="stack gap-2 report-trust">
              {r.trust.length ? r.trust.map((x) => <Note key={x.issueId} level={x.delta < 0 ? 'warn' : 'ok'}>{x.delta > 0 ? '+' : ''}{x.delta} · {t.f(x, 'reason')}</Note>)
                : <div className="t-small t-muted row gap-2 row--nowrap"><Icon name="st_ok" size={20} />{t('report.trustKept')}</div>}
              {r.trustTier && <div className="row gap-2"><TrustChip value={r.teamTrust} /><span className="t-small">{TRUST_TEXT.effect[r.trustTier.tier](r.trustTier)}</span></div>}
            </div>
            <div className="t-eyebrow t-muted report-sub">{t('report.decisions')}</div>
            <ul className="stack gap-2">
              {r.decisions.map((d, i) => (
                <li key={i} className="row gap-2 row--nowrap t-small">
                  <Icon name={d.kind === 'veto' || d.kind === 'request-veto' || d.kind === 'key-denied' ? 'act_veto' : d.kind === 'approve' || d.kind === 'request-approve' ? 'act_approve' : 'st_warn'} size={24} />
                  <span><b>{t(DECISION_NAME[d.kind])}</b>{d.kind !== 'approve' && <>: {t.f(d, 'text')}</>}{d.keys?.length ? <>{t('report.secondKey')}{d.keys.map((id) => room.players.find((p) => p.id === id)?.name ?? id).join(', ')}</> : null}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card card--cream card--tight" data-testid="report-mc">
            <div className="card__head card__head--gold"><Icon name="res_credits" size={32} /><span className="card__title">Mission Credits</span></div>
            <div className="breakdown">
              <div className="kv-row"><span>{t('report.earnedFlight')}</span><b className="t-mono t-ok">+{r.mc.earned}</b></div>
              <div className="kv-row"><span>{t('report.balance')}</span><b className="t-mono">{room.agency.credits} MC</b></div>
              {room.agency.pendingPrep ? (
                prep.fallback === 'free_basic_repair'
                  ? <div className="kv-row"><span>{t('report.prepShort')}</span><b className="t-ok">{t('report.freeRepair')}</b></div>
                  : <div className="kv-row"><span>{t('report.prepNext')}</span><b className="t-mono t-risk">−{prep.total}</b></div>
              ) : <div className="kv-row"><span>{t('report.prep')}</span><b>{t('report.paid')}</b></div>}
              {room.agency.pendingPrep && prep.fallback === 'none' && <div className="kv-row kv-row--sum"><span>{t('report.left')}</span><b className="t-mono">{prep.balanceAfter} MC</b></div>}
            </div>
            {(r.damaged?.length ?? 0) > 0 && <div className="t-small t-muted row gap-2 row--nowrap report-sub"><Icon name="hq_repair" size={20} />{t('report.repairNeeded')}{r.damaged.map((id, i) => <span key={id} className="chain__mod">{i > 0 && ', '}<ModuleIcon id={id} mission={room.mission} size={24} />{COMPONENT_BY_ID[id]?.name ?? id}</span>)}</div>}
            <div className="t-small t-muted report-sub">{t('report.prepDetails')}</div>
            <button className="btn btn--gold btn--block report-sub" onClick={() => openView('hq')} data-testid="report-hq"><Icon name="hq_upgrade" size={24} />{t('report.toHqLong')}</button>
          </div>
        </div>

        <section className="report-replay panel--night">
          <div className="card__head card__head--night"><Icon name="act_replay" size={32} /><span className="card__title">{t('report.replay')}</span></div>
          <ReportReplay report={r} build={room.build} mission={room.mission} />
          {!r.replay?.windows.length && <Note level="info">{t('report.noReplay')}</Note>}
        </section>

        <div className="report-mid stack gap-5">
          <div className="card card--cream card--tight">
            <div className="t-eyebrow t-muted">{t('report.highlights')}</div>
            <div className="row gap-2 report-hl">
              {r.highlights.map((h, i) => (
                <span key={i} className={`chip chip--wrap ${h.kind === 'crisis' ? 'chip--crit' : h.kind === 'final' ? 'chip--ok' : 'chip--info'}`}>
                  <Icon name={h.kind === 'crisis' ? 'fl_crisis' : h.kind === 'final' ? 'st_ok' : 'act_launch'} size={24} /><span className="t-mono">T+{mmss(h.tick)}</span> {t.f(h, 'text')}
                </span>
              ))}
            </div>
          </div>
          {r.asteroid && <AsteroidSummary a={r.asteroid} />}
          <div className="card card--cream card--tight">
            <div className="card__head card__head--teal"><Icon name="st_ok" size={32} /><span className="card__title">{t('report.points')}</span></div>
            <div className="breakdown">
              {r.breakdown.map((b) => {
                const k = b.got / b.weight;
                return (
                  <div key={b.key} className={`breakdown__row ${k > 0.7 ? 'meter--ok' : k > 0.4 ? 'meter--warn' : 'meter--crit'}`}>
                    <span>{t.f(b, 'label')}</span>
                    <span className="meter__track"><i className="meter__fill" style={{ width: `${Math.min(1, k) * 100}%` }} /></span>
                    <span className="breakdown__pts">{Math.round(b.got * 10) / 10} / {b.weight}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card card--cream card--tight">
            <div className="card__head"><Icon name="role_commander" size={32} /><span className="card__title">{t('report.roles')}</span></div>
            <div className="stack gap-3">
              {r.roles.map((x) => (
                <div key={x.role} className="stack gap-2">
                  <RoleChip role={x.role} />
                  <ul className="report-did">{t.fl(x, 'did').map((d, i) => <li key={i}>{d}</li>)}</ul>
                </div>
              ))}
            </div>
          </div>
          <PlayersCard r={r} />
          <TaskReportCard report={r} />
        </div>

        <div className="report-side stack gap-5">
          <div className="card card--cream card--tight">
            <div className="card__head card__head--orange"><Icon name="fl_rule" size={32} /><span className="card__title">{t('report.whatMattered')}</span></div>
            <div className="stack gap-3">
              {main.length ? main.map((c, i) => <Chain key={c.key + i} c={c} n={i + 1} mission={room.mission} />) : <Note level="ok">{t('report.allOk')}</Note>}
              {rest.length > 0 && (
                <>
                  <button className="btn btn--secondary btn--sm" onClick={() => setMore(!more)}>{more ? t('report.hide') : t('report.more', { n: rest.length })}</button>
                  {more && rest.map((c, i) => <Chain key={c.key + i} c={c} n={i + 4} mission={room.mission} />)}
                </>
              )}
            </div>
          </div>
          {r.autonomy && (
            <div className="card card--cream card--tight">
              <div className="card__head"><Icon name="fl_rule" size={32} /><span className="card__title">{t('build.autonomy')}</span></div>
              <div className="t-small t-muted">{t('report.autoSummary', { n: r.autonomy.configured, slots: r.autonomy.slots, sp: r.autonomy.safeProtocol })}</div>
              {r.autonomy.fired.length ? (
                <ul className="stack gap-2 report-sub">
                  {r.autonomy.fired.map((x) => (
                    <li key={x.ruleId} className="row gap-2 row--nowrap t-small"><Icon name="st_ok" size={20} /><span>{t('report.fired', { text: t.f(x, 'text'), where: t.fl(x, 'where').join(', '), times: x.times > 1 ? t('report.times', { n: x.times }) : '', time: `${Math.floor(x.firstTick / 60)}:${String(x.firstTick % 60).padStart(2, '0')}` })}</span></li>
                  ))}
                </ul>
              ) : <div className="t-small report-sub">{r.autonomy.configured ? t('report.noneFired') : t('report.noRules')}</div>}
            </div>
          )}
        </div>
      </div>

      <footer className="action-bar report-actions">
        {!can && <span className="t-small action-bar__note">{who}</span>}
        {actions}
      </footer>
    </div>
  );
}

/** Dictionary keys: report.capsule.<stage>. */
const CAPSULE_TEXT: Record<CapsuleStage, string> = {
  stowed: 'report.capsule.stowed', separated: 'report.capsule.separated', entry: 'report.capsule.entry', chute: 'report.capsule.chute', landed: 'report.capsule.landed', found: 'report.capsule.found', lost: 'report.capsule.lost',
};

/** Asteroid: the sample, the capsule and the composition data — the three Perfect conditions. */
function AsteroidSummary({ a }: { a: NonNullable<MissionReport['asteroid']> }) {
  const t = useT();
  const sample = a.sample.collected ? `${t('report.grams', { n: a.sample.mass })} · ${a.sample.sealed ? t('report.sealed') : t('report.notSealed')}${a.sample.heated ? t('report.heated') : ''}` : t('report.notCollected');
  return (
    <div className="card card--cream card--tight" data-testid="report-asteroid">
      <div className="card__head"><Icon name="mis_asteroid" size={32} /><span className="card__title">{t('report.perfectCond')}</span></div>
      <div className="stack gap-2">
        <Fact ok={a.sample.collected && a.sample.sealed} warn={a.sample.collected && !a.sample.sealed} icon="fl_sample"
          title={<>{t('report.sample')}{a.site ? ` · ${t.f(SITE_BY_ID[a.site], 'name')}${a.siteBy === 'auto' ? t('report.siteAuto') : ''}` : ''}</>}
          word={`${a.sample.collected ? t('report.wCollected') : t('report.wNotCollected')}${a.sample.collected ? (a.sample.sealed ? t('report.wSealed') : t('report.wNotSealed')) : ''}`} text={sample} />
        <Fact ok={a.capsule === 'found'} icon="fl_capsule" title={t('report.capsule')} word={a.capsule === 'found' ? t('report.wFound') : `✗ ${t(CAPSULE_TEXT[a.capsule])}`}
          text={`${a.home ? t('report.home') : t('report.notHome')} · ${t('report.fuel', { n: Math.round(a.fuel.left), max: a.fuel.max })}`} />
        <Fact ok={a.compositionDelivered} icon="res_data" title={t('report.composition')} word={a.compositionDelivered ? t('report.wDelivered') : t('report.wNotDelivered')}
          text={t('report.perfectLine', { s: a.perfect.sealed ? '✓' : '✗', c: a.perfect.capsuleFound ? '✓' : '✗', d: a.perfect.composition ? '✓' : '✗' })} />
      </div>
    </div>
  );
}

function Fact({ ok, warn, icon, title, word, text }: { ok: boolean; warn?: boolean; icon: IconName; title: ReactNode; word: string; text: string }) {
  return (
    <div className={`check-line check-line--compact check-line--static ${ok ? '' : warn ? 'check-line--warn' : 'check-line--block'}`}>
      <span className="check-line__badge"><Icon name={icon} size={24} /></span>
      <span className="min0">
        <span className="check-line__title">{title}<span className="check-line__word">{word}</span></span>
        <span className="check-line__reason t-mono">{text}</span>
      </span>
      <span />
    </div>
  );
}

function Chain({ c, n, mission }: { c: CauseChain; n: number; mission: MissionId }) {
  const t = useT();
  const mods = [...new Set(c.causeIds)].filter((id) => COMPONENT_BY_ID[id]).slice(0, 4);
  return (
    <div className="chain">
      <div className="chain__step"><span className="chain__k">{t('report.chainWhat', { n })}</span>{t.f(c, 'what')}</div>

      <div className="chain__step"><span className="chain__k">{t('report.chainWhy')}</span>{t.f(c, 'why')}</div>
      <div className="chain__step chain__step--help"><span className="chain__k">{t('report.chainCould')}</span>{t.f(c, 'couldDo')}</div>
      {mods.length > 0 && (
        <div className="chain__mods" aria-label={t('report.chainMods')}>
          {mods.map((id) => <span key={id} className="chain__mod"><ModuleIcon id={id} mission={mission} size={32} />{COMPONENT_BY_ID[id].name}</span>)}
        </div>
      )}
    </div>
  );
}
