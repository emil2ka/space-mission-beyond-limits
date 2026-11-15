// Agency HQ + Mission Preparation (docs/03 Design/Economy.md, M3 contract part B, ТЗ test E).
// Both are local overlays (ui/view.ts) over the lobby or the report: everyone can look; the engine lets
// the commander or the host press (unlockMission / buyUpgrade / confirmPrep). Nothing is charged without
// being shown first: the preparation lists every item and the total BEFORE the confirm button.
import { useEffect, useState } from 'react';
import {
  COMPONENT_BY_ID, DEPARTMENTS, MISSIONS, OUTCOME_NAMES, prepCosts, REWARDS, STARTER_BUILD, UPGRADES,
  type Department, type MissionId, type RoomState,
} from '../../engine';
import { useGame, useMe } from '../../store/game';
import { holderOf, rolesOf } from '../../engine';
import { TrustCard } from '../rules/Trust';
import { useView, type PrepNext } from '../view';
import { Icon } from '../kit/Icon';
import { Check, DEPT_ICON, McChip, MISSION_ICON, Note, TopBar } from '../components/common';
import { useT, type T } from '../../i18n';

export const OUTCOME_COLOR = { perfect: 'var(--teal)', success: 'var(--ok)', partial: 'var(--warn)', failed: 'var(--crit)' } as const;
/** Outcome chip class + icon (status = icon + word). */
export const OUTCOME_CHIP = {
  perfect: { cls: 'chip--need-required', icon: 'st_ok' }, success: { cls: 'chip--ok', icon: 'st_ok' },
  partial: { cls: 'chip--warn', icon: 'st_warn' }, failed: { cls: 'chip--crit', icon: 'st_crit' },
} as const;

/** Commander or host may spend MC (engine rule); others see why the button is off. */
export function useCanManage() {
  const t = useT();
  const room = useGame((s) => s.room);
  const myId = useGame((s) => s.me.id);
  const me = useMe();
  const can = !!room && (room.hostId === myId || rolesOf(me).includes('commander'));
  const commander = room ? holderOf(room.players, 'commander')?.name : undefined;
  const host = room?.players.find((p) => p.id === room.hostId)?.name;
  const who = t('hq.who', { cmd: commander ? ` (${commander})` : '', host: host ? ` (${host})` : '' });
  return { can, who };
}

function backLabel(t: T, room: RoomState) {
  return room.stage === 'report' ? t('hq.backReport') : t('hq.backLobby');
}

export function HQ() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const isHost = useGame((s) => s.room?.hostId === s.me.id);
  const { open, close } = useView();
  const { can, who } = useCanManage();
  const ag = room.agency;
  const prep = prepCosts(ag, false);
  const attempts = ag.history.length;

  return (
    <div className="scr scr--hq" data-testid="hq">
      <TopBar icon="hq_upgrade" title={t('hq.title')} sub={t('hq.room', { code: room.code })}>
        <McChip value={ag.credits} />
      </TopBar>
      <div className="hq-hero">
        <div className="mc-hero">
          <div className="t-eyebrow">{t('hq.balanceTitle')}</div>
          <div className="mc mc--hero" data-testid="hq-balance"><Icon name="res_credits" size={64} /><b>{ag.credits}</b> <span className="mc__unit">MC</span></div>
          <div className="t-small">Mission Credits{ag.history.length ? t('hq.lastEarned', { n: ag.history.at(-1)!.earned }) : ''}</div>
        </div>
        <div className="card card--cream hq-info">
          {ag.pendingPrep ? (
            <div className="row gap-4">
              <Icon name="hq_repair" size={48} />
              <div className="grow min0">
                <h2 className="t-h3">{t('hq.prepTitle', { what: prep.fallback === 'free_basic_repair' ? t('hq.freeRepair') : `${prep.total} MC` })}</h2>
                <p className="t-small t-muted">{prep.fallback === 'free_basic_repair' ? t('hq.prepFree') : t('hq.prepPaid')}</p>
              </div>
              <button className="btn btn--primary btn--lg" onClick={() => open('prep', room.stage === 'report' ? 'lobby' : 'build')}><Icon name="hq_repair" size={32} />{t('hq.toPrep')}</button>
            </div>
          ) : (
            <div className="row gap-4">
              <Icon name="hq_insurance" size={48} />
              <div className="grow min0"><h2 className="t-h3">{t('hq.ready')}</h2><p className="t-small t-muted">{t('hq.readySub')}</p></div>
            </div>
          )}
          <p className="t-small t-muted hq-info__rules">
            {t('hq.rules', { perfect: REWARDS.perfect, success: REWARDS.success, partial: REWARDS.partial, failed: REWARDS.failed, perTarget: REWARDS.perTarget })}
          </p>
          {!can && <Note level="info">{who} {t('hq.canWatch')}</Note>}
          <TrustCard value={room.teamTrust} history={room.trustHistory} />
        </div>
      </div>

      <div className="layout-hq">
        <section className="stack gap-4">
          <h2 className="section-title"><Icon name="fl_waypoint" size={24} />{t('hq.missions')}</h2>
          {(Object.keys(MISSIONS) as MissionId[]).map((id) => <MissionCard key={id} id={id} />)}
          {room.stage === 'lobby' && !isHost && <div className="t-small t-muted">{t('hq.hostPicks')}</div>}
        </section>

        <section className="stack gap-4">
          <h2 className="section-title"><Icon name="hq_upgrade" size={24} />{t('hq.upgrades')}</h2>
          <p className="t-small t-muted">{t('hq.upgradesNote')}</p>
          <div className="grid hq-shop">
            {UPGRADES.map((u) => <UpgradeCard key={u.id} u={u} />)}
          </div>
        </section>

        <section className="stack gap-4">
          <div className="card card--cream card--tight">
            <div className="card__head"><Icon name="hq_history" size={32} /><span className="card__title">{t('hq.history')}</span></div>
            {attempts ? (
              <ul className="hq-history" data-testid="hq-history">
                {ag.history.map((h, i) => (
                  <li key={i} className="hq-history__row">
                    <span className="t-mono t-muted">#{i + 1}</span>
                    <span className="grow min0"><b>{MISSIONS[h.mission].name.split(':')[0]}</b> <span className="t-mono t-small">+{h.earned} MC</span></span>
                    <span className={`chip ${OUTCOME_CHIP[h.outcome].cls}`}><Icon name={OUTCOME_CHIP[h.outcome].icon} size={24} />{t.d(OUTCOME_NAMES[h.outcome])}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="t-small t-muted">{t('hq.noFlights')}</p>}
          </div>
          <div className="card card--cream card--tight">
            <div className="card__head card__head--teal"><Icon name="hq_repair" size={32} /><span className="card__title">{t('hq.repairIns')}</span></div>
            <div className="stack gap-2 t-small">
              <div className="row gap-2"><Icon name="hq_repair" size={20} />{t('hq.freeRepairs')}<b>{ag.basicRepairs}</b></div>
              {ag.lastPrep && (
                <div className="row gap-2"><Icon name="hq_history" size={20} />{t('hq.lastPrep', { what: ag.lastPrep.fallback === 'free_basic_repair' ? t('hq.lastFree') : t('hq.lastPaid', { n: ag.lastPrep.charged, ins: ag.lastPrep.insurance ? t('hq.withIns') : '' }) })}</div>
              )}
              {ag.insured ? <Note level="ok">{t('hq.insured')}</Note>
                : <div className="row gap-2 t-muted"><Icon name="hq_insurance" size={20} />{t('hq.insHint')}</div>}
            </div>
          </div>
        </section>
      </div>

      <footer className="action-bar">
        <span className="t-small action-bar__note">{t('hq.saved')}</span>
        {ag.pendingPrep && <button className="btn btn--secondary" onClick={() => open('prep', room.stage === 'report' ? 'lobby' : 'build')}><Icon name="hq_repair" size={24} />{t('hq.prepAttempt')}</button>}
        <button className="btn btn--primary btn--lg" onClick={close}><Icon name="act_exit" size={32} />{backLabel(t, room)}</button>
      </footer>
    </div>
  );
}

function MissionCard({ id }: { id: MissionId }) {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const isHost = useGame((s) => s.room?.hostId === s.me.id);
  const { can, who } = useCanManage();
  const m = MISSIONS[id];
  const ag = room.agency;
  const open = ag.unlocked.includes(id);
  const cost = m.unlockCost;
  const missing = Math.max(0, cost - ag.credits);
  const inFlight = room.stage === 'flight' || room.stage === 'launch';
  return (
    <div className={`mission-card ${id === 'asteroid' ? 'mission-card--asteroid' : ''} ${open ? 'is-open' : 'is-locked'} ${open && room.mission === id ? 'is-selected' : ''}`} data-testid={`mission-${id}`}>
      <div className="mission-card__art">
        <Icon name={MISSION_ICON[id]} size={64} />
        {!open && <Icon name="st_locked" size={32} className="mission-card__lock" />}
      </div>
      <div className="mission-card__body">
        <div className="mission-card__title">{m.name.toUpperCase()}</div>
        <div className="mission-card__desc">{t.d(m.goal)}</div>
        {open ? (
          <div className="mission-card__foot">
            <span className="chip chip--open"><Icon name="st_ok" size={24} />{t('hq.open')}</span>
            {room.stage === 'lobby' && (room.mission === id ? <span className="chip chip--ready">{t('hq.chosen')}</span>
              : isHost ? <button className="btn btn--primary btn--sm" onClick={() => dispatch({ type: 'selectMission', mission: id })}>{t('hq.chooseFlight')}</button> : null)}
          </div>
        ) : (
          <>
            <div className="breakdown">
              <div className="kv-row"><span>{t('hq.unlockCost')}</span><b className="t-mono">{cost} MC</b></div>
              <div className="kv-row"><span>{t('hq.balance')}</span><b className="t-mono">{ag.credits} MC</b></div>
              <div className="kv-row"><span>{missing ? t('hq.missing') : t('hq.afterUnlock')}</span><b className={`t-mono ${missing ? 't-crit' : 't-ok'}`}>{missing ? `${missing} MC` : `${ag.credits - cost} MC`}</b></div>
            </div>
            <div className={`meter meter--compact ${missing ? 'meter--gold' : 'meter--ok'}`}><div className="meter__track"><i className="meter__fill" style={{ width: `${Math.min(1, ag.credits / cost) * 100}%` }} /></div></div>
            <button className={`btn btn--sm btn--block ${missing ? 'btn--secondary' : 'btn--gold'}`} disabled={!!missing || !can || inFlight} data-testid={`unlock-${id}`}
              title={!can ? who : missing ? t('hq.missingMc', { n: missing }) : undefined}
              onClick={() => dispatch({ type: 'unlockMission', mission: id })}>
              <Icon name={missing ? 'st_locked' : 'res_credits'} size={20} />{missing ? t('hq.openMissing', { n: missing }) : t('hq.openFor', { n: cost })}
            </button>
            {!missing && ag.pendingPrep && ag.credits - cost < prepCosts(ag, false).total && (
              <Note level="warn">{t('hq.afterWarn', { left: ag.credits - cost, prep: prepCosts(ag, false).total })}</Note>
            )}
            {missing > 0 && <div className="t-small t-muted">{t('hq.flyTitan', { success: REWARDS.success, perfect: REWARDS.perfect })}</div>}
          </>
        )}
      </div>
    </div>
  );
}

type UpgradeDef = (typeof UPGRADES)[number];

function UpgradeCard({ u }: { u: UpgradeDef }) {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const { can, who } = useCanManage();
  const ag = room.agency;
  const [slot, setSlot] = useState<Department>(ag.extraSlot ?? 'science');
  const owned = ag.upgrades.includes(u.id);
  const missing = Math.max(0, u.cost - ag.credits);
  const locked = ['review', 'launch', 'flight'].includes(room.stage);
  return (
    <div className={`upgrade-card ${owned ? 'is-bought' : ''}`} data-testid={`upgrade-${u.id}`}>
      <div className="upgrade-card__head">
        <Icon name="hq_upgrade" size={48} />
        <div className="upgrade-card__title">{t.f(u, 'name')}</div>
      </div>
      <div className="upgrade-card__effect"><Icon name="st_ok" size={20} />{t.f(u, 'effect')}</div>
      <div className="tradeoff"><span className="tradeoff__label"><Icon name="st_warn" size={20} />{t('hq.tradeoff')}</span><span className="tradeoff__text">{t.f(u, 'tradeoff')}</span></div>
      <div className="upgrade-card__foot">
        {owned ? (
          <>
            <span className="chip chip--bought chip--lg"><Icon name="st_ok" size={32} />{t('hq.bought')}</span>
            {u.id === 'extra_slot' && <div className="t-small t-muted row gap-2">{ag.extraSlot && <Icon name={DEPT_ICON[ag.extraSlot]} size={20} />}{t('hq.slot', { dept: ag.extraSlot ? t(`dept.${ag.extraSlot}`) : '' })}</div>}
          </>
        ) : (
          <>
            {u.id === 'extra_slot' && (
              <label className="field">
                <span className="field__label">{t('hq.slotDept')}</span>
                <span className="select-wrap">
                  <select className="select" value={slot} onChange={(e) => setSlot(e.target.value as Department)} aria-label={t('hq.slotDept')}>
                    {DEPARTMENTS.map((d) => <option key={d.id} value={d.id}>{t(`dept.${d.id}`)}</option>)}
                  </select>
                </span>
              </label>
            )}
            <button className={`btn btn--block ${missing ? 'btn--secondary' : 'btn--gold'}`} disabled={!!missing || !can || locked} title={!can ? who : missing ? t('hq.missingMc', { n: missing }) : undefined}
              onClick={() => dispatch({ type: 'buyUpgrade', id: u.id, ...(u.id === 'extra_slot' ? { slot } : {}) })}>
              <Icon name="res_credits" size={24} />{missing ? t('hq.missingMc', { n: missing }) : t('hq.buyFor', { n: u.cost })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}


/** MISSION PREPARATION COSTS: every item and the total before confirming; the free basic repair when MC is short. */
export function Prep() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const { prepNext, open, close } = useView();
  const { can, who } = useCanManage();
  const [insurance, setInsurance] = useState(false);
  const [next, setNext] = useState<PrepNext>(prepNext);
  const [sent, setSent] = useState(false);
  const ag = room.agency;
  // In the lobby the stage does not change on confirm: close the overlay once the engine took it.
  useEffect(() => { if (sent && !ag.pendingPrep) close(); }, [sent, ag.pendingPrep, close]);
  const base = prepCosts(ag, false);
  const free = base.fallback === 'free_basic_repair';
  const p = prepCosts(ag, insurance && !free);
  const inReport = room.stage === 'report';
  const starter = Object.entries(STARTER_BUILD[room.mission]).map(([id, n]) => `${COMPONENT_BY_ID[id]?.name ?? id}${n > 1 ? ` ×${n}` : ''}`);

  if (!ag.pendingPrep) {
    return (
      <div className="scr">
        <TopBar icon="hq_repair" title={t('hq.prep')} sub={MISSIONS[room.mission].name}><McChip value={ag.credits} /></TopBar>
        <div className="page page--center">
          <div className="card card--cream prep-card">
            <div className="card__head card__head--teal"><Icon name="hq_insurance" size={32} /><span className="card__title">{t('hq.noPrep')}</span></div>
            <p className="t-muted">{t('hq.noPrepText', { n: ag.credits })}</p>
            <div className="card__foot"><button className="btn btn--primary" onClick={close}><Icon name="act_exit" size={24} />{t('hq.back')}</button></div>
          </div>
        </div>
      </div>
    );
  }

  const confirm = () => { setSent(true); send(); };
  const send = () => dispatch({ type: 'confirmPrep', insurance: insurance && !free, ...(inReport ? { next } : {}) });

  return (
    <div className="scr">
      <TopBar icon="hq_repair" title={t('hq.prepLaunch')} sub={t('hq.attempt', { n: ag.history.length + 1, name: MISSIONS[room.mission].name })}><McChip value={ag.credits} /></TopBar>
      <div className="page page--center">
        <div className="card card--cream prep-card prep" data-testid="prep">
          <div className="card__head card__head--teal">
            <Icon name="hq_repair" size={48} />
            <div className="grow min0"><div className="t-eyebrow">Mission preparation costs</div><h2 className="t-h2">{t('hq.prepNext')}</h2></div>
          </div>
          <div className="stack gap-4">
            <p className="t-small t-muted">{t('hq.allHere')}</p>

            <ul className="prep-items breakdown" data-testid="prep-items">
              {p.items.map((i) => (
                <li key={i.id} className={`kv-row ${i.optional ? 'is-optional' : ''}`}>
                  <span className="row gap-2 row--nowrap"><Icon name={i.optional ? 'hq_insurance' : 'hq_repair'} size={20} />{t.f(i, 'label')}</span><b className="t-mono">{i.cost ? `${i.cost} MC` : '0'}</b>
                </li>
              ))}
              <li className="kv-row kv-row--sum"><span>{t('hq.total')}</span><b className="t-mono" data-testid="prep-total">{p.total} MC</b></li>
              <li className="kv-row"><span>{t('hq.balNow')}</span><b className="t-mono">{ag.credits} MC</b></li>
              <li className="kv-row"><span>{t('hq.charge')}</span><b className={`t-mono ${p.charge ? 't-risk' : 't-ok'}`}>{p.charge ? `−${p.charge} MC` : '0 MC'}</b></li>
              <li className="kv-row kv-row--sum"><span>{t('hq.balAfter')}</span><b className="t-mono" data-testid="prep-after">{p.balanceAfter} MC</b></li>
            </ul>

            {free ? (
              <div className="card card--cream card--tight free-repair" data-testid="free-repair">
                <div className="card__head card__head--teal"><Icon name="hq_repair" size={32} /><span className="card__title">{t('hq.shortTitle', { need: base.total, have: ag.credits })}</span></div>
                <p>{t('hq.freeA')}<b>{t('hq.freeB')}</b>{t('hq.freeC', { n: ag.credits })}</p>
                <p className="t-small t-muted">{t('hq.starter', { mission: MISSIONS[room.mission].name.split(':')[0], list: starter.join(', ') })}</p>
              </div>
            ) : (
              <div className="insurance">
                <Check checked={insurance} onChange={setInsurance} disabled={!can}>
                  <span className="row gap-2 row--nowrap"><Icon name="hq_insurance" size={24} />{t('hq.insurance', { n: REWARDS.insurance })}</span>
                </Check>
              </div>
            )}
            {insurance && !p.affordable && !free && <Note level="bad">{t('hq.insMissing', { n: p.missing })}</Note>}

            {inReport && (
              <div className="row gap-3">
                <span className="t-small t-muted">{t('hq.then')}</span>
                <div className="seg">
                  {(['build', 'lobby'] as PrepNext[]).map((n) => (
                    <button key={n} type="button" className="seg__item" aria-pressed={next === n} onClick={() => setNext(n)} disabled={!can}>{t(`hq.next.${n}`)}</button>
                  ))}
                </div>
              </div>
            )}

            {!can && <Note level="info">{who} {t('hq.waitConfirm')}</Note>}
            <div className="card__foot">
              <button className="btn btn--secondary btn--sm" onClick={() => open('hq')}><Icon name="hq_upgrade" size={20} />{t('hq.hq')}</button>
              <button className="btn btn--secondary btn--sm" onClick={close}>{backLabel(t, room)}</button>
              <button className="btn btn--primary" disabled={!can || (insurance && !p.affordable && !free)} onClick={confirm} data-testid="prep-confirm">
                <Icon name="act_approve" size={24} />{free ? t('hq.freeBtn') : t('hq.confirm', { n: p.total })}{inReport ? ` · ${next === 'build' ? t('hq.toBuild') : t('hq.toLobby')}` : ''}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
