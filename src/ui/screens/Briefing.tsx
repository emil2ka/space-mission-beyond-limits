import { COMPONENT_BY_ID, MISSIONS } from '../../engine';
import { useGame } from '../../store/game';
import { Icon } from '../kit/Icon';
import { useT } from '../../i18n';
import { LeaveRoom, MeChip, MISSION_ICON, TopBar } from '../components/common';

export function Briefing() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const me = useGame((s) => s.me);
  const m = MISSIONS[room.mission];
  const isHost = room.hostId === me.id;
  return (
    <div className="scr">
      <TopBar icon={MISSION_ICON[room.mission]} title={t('brief.title')} sub={m.name}><MeChip /></TopBar>
      <div className="page">
        <div className="briefing stack gap-5">
          <div className="card card--cream">
            <div className="card__head card__head--orange">
              <Icon name={MISSION_ICON[room.mission]} size={48} />
              <div className="grow"><div className="t-eyebrow">{t('brief.goal')}</div><h1 className="t-h2">{m.name}</h1></div>
            </div>
            <p className="t-lead">{t.d(m.goal)}</p>
            <div className="row gap-2 briefing__env">{m.environment.map((e) => <span key={e} className="chip chip--text chip--dept">{t.d(e)}</span>)}</div>
            <div className="row gap-2 briefing__stats">
              <span className="stat"><Icon name="res_budget" size={20} />{t('brief.budget', { n: m.budget })}</span>
              <span className="stat"><Icon name="res_mass" size={20} />{t('brief.mass', { n: m.massLimit })}</span>
              <span className="stat"><Icon name="dept_structure" size={20} />{t('brief.frame', { n: m.frameMass })}</span>
              <span className="stat"><Icon name="res_signal" size={20} />{t('brief.delay', { n: m.signalDelay })}</span>
            </div>
          </div>

          <div className="grid-2 briefing__cols">
            <div className="card card--cream">
              <div className="card__head card__head--teal"><Icon name="need_required" size={32} /><span className="card__title">{t('brief.required')}</span></div>
              <ul className="stack gap-2">
                {m.requirements.map((r) => (
                  <li key={r.reason} className="check-line check-line--compact check-line--static">
                    <span className="check-line__badge"><Icon name="need_required" size={24} /></span>
                    <span className="check-line__title">{r.anyOf.map((id) => COMPONENT_BY_ID[id]?.name).join(t('brief.or'))}</span>
                    <span />
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel--night">
              <div className="card__head card__head--night"><Icon name="fl_phase" size={32} /><span className="card__title">{t('brief.phases')}</span></div>
              <ol className="briefing__phases">
                {m.phases.map((p, i) => (
                  <li key={p.id} className="phase-row"><span className="phase-row__n">{i + 1}</span><Icon name="fl_phase" size={20} />{t.f(p, 'name')}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
      <footer className="action-bar">
        <LeaveRoom />
        <span className="action-bar__note t-small">{isHost ? t('brief.hostNote') : t('brief.guestNote')}</span>
        {isHost && (
          <button className="btn btn--primary btn--lg" onClick={() => dispatch({ type: 'goStage', stage: 'build' })}><Icon name="dept_structure" size={32} />{t('brief.toBuild')}</button>
        )}
      </footer>
    </div>
  );
}
