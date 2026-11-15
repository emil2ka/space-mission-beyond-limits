// Screen: room lobby (ТЗ §2). 4 slots: name, role, ONLINE / Reconnecting / OFFLINE, READY.
// A role can't be taken twice (engine + disabled button here). The host picks the mission and starts
// when everyone is READY. Demo mode (fewer than 4 players, role switching) is a clearly labelled host toggle.
// Look: UI kit lobby (docs/05 Assets/UI/kit/shots/lobby-*.png).
import { useEffect, useState } from 'react';
import { holderOf, MAX_PLAYERS, MIN_PLAYERS, MISSIONS, RECONNECT_MS, ROLES, rolesOf, type MissionId, type Player, type RoomState } from '../../engine';
import { LobbyRoles, startPlan } from '../rules/LobbyRoles';
import { TrustCard } from '../rules/Trust';
import { useGame, useMe } from '../../store/game';
import { useView } from '../view';
import { Icon } from '../kit/Icon';
import { Check, MISSION_ICON, Note, RoleChip, ROLE_ICON, TopBar } from '../components/common';
import { t as tNow, useT, type Params } from '../../i18n';

/** Translator: the reactive t() of a component, or the current-language one. */
type Tr = (key: string, params?: Params) => string;

/** Re-render every second (Reconnecting countdown). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export type Presence = 'online' | 'reconnecting' | 'offline';

/** ONLINE / «Reconnecting… 27 с» / OFFLINE for a player, as the others see it. */
export function presenceLabel(p: Player, now: number, t: Tr = tNow): { text: string; state: Presence } {
  if (p.online) return { text: t('lobby.online'), state: 'online' };
  const left = p.offlineAt ? Math.ceil((RECONNECT_MS - (now - p.offlineAt)) / 1000) : 0;
  return left > 0 ? { text: t('lobby.reconnecting', { n: left }), state: 'reconnecting' } : { text: t('lobby.offline'), state: 'offline' };
}

/** Why the host can't start yet (empty = can start). Mirrors the engine's goStage checks. */
export function startBlockers(room: RoomState, t: Tr = tNow): string[] {
  const out: string[] = [];
  if (room.agency?.pendingPrep) out.push(t('lobby.block.prep'));
  // 0013 §4: a team of 2–4 (free roles are handed out); one player = the demo.
  if (!room.demo && room.players.length < MIN_PLAYERS) out.push(t('lobby.block.min', { min: MIN_PLAYERS, n: room.players.length }));
  const off = room.players.filter((p) => !p.online);
  if (off.length) out.push(t('lobby.block.offline', { names: off.map((p) => p.name).join(', ') }));
  const noRole = room.players.filter((p) => !rolesOf(p).length);
  if (noRole.length) out.push(t('lobby.block.noRole', { names: noRole.map((p) => p.name).join(', ') }));
  const notReady = room.players.filter((p) => rolesOf(p).length && !p.ready);
  if (notReady.length) out.push(t('lobby.block.notReady', { names: notReady.map((p) => p.name).join(', ') }));
  return out;
}

const PRESENCE_ICON = { online: 'st_ok', reconnecting: 'res_signal', offline: 'fl_blackout' } as const;

export function Lobby() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const leave = useGame((s) => s.leave);
  const myId = useGame((s) => s.me.id);
  const me = useMe();
  const now = useNow();
  const isHost = room.hostId === myId;
  const openView = useView((s) => s.open);
  const blockers = startBlockers(room, t);
  const slots = [...room.players].sort((a, b) => a.joinOrder - b.joinOrder);
  const onlineN = room.players.filter((p) => p.online).length;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(room.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined);
  };

  return (
    <div className="scr scr--lobby">
      <TopBar icon="act_launch" title="Space Mission" sub={t('lobby.sub')}>
        <button className="btn btn--gold btn--sm" onClick={() => openView('hq')} data-testid="lobby-hq">
          <Icon name="hq_upgrade" size={20} />{t('lobby.hq')} · <b className="t-mono">{room.agency.credits} MC</b>
        </button>
        <button className="btn btn--secondary btn--sm" onClick={leave}><Icon name="act_exit" size={20} />{t('lobby.leave')}</button>
      </TopBar>

      <div className="layout-lobby">
        <section className="lobby-room stack gap-5">
          <div className="card card--cream">
            <div className="card__head card__head--teal">
              <Icon name="act_radio" size={32} /><span className="card__title">{t('lobby.code')}</span>
              <span className="chip chip--text">{t('lobby.onlineN', { n: onlineN, max: MAX_PLAYERS })}</span>
            </div>
            <div className="code-input code-input--hero" data-testid="room-code" aria-label={t('lobby.codeAria', { code: room.code })}>
              {room.code.split('').map((ch, i) => <span key={i} className="code-input__cell">{ch}</span>)}
            </div>
            <div className="row gap-3 lobby-room__foot">
              <button className="btn btn--primary btn--sm" onClick={copy}><Icon name="act_add" size={20} />{copied ? t('lobby.copied') : t('lobby.copy')}</button>
              <span className="t-small t-muted grow">{t('lobby.dictate', { min: MIN_PLAYERS, max: MAX_PLAYERS })}</span>
            </div>
          </div>

          {room.demo && (
            <Note level="warn">
              {t('lobby.demoNote', { min: MIN_PLAYERS, max: MAX_PLAYERS })}
            </Note>
          )}

          <div className="stack gap-3">
            <h2 className="section-title"><Icon name="role_commander" size={24} />{t('lobby.crew', { n: room.players.length, max: MAX_PLAYERS })}</h2>
            <div className="stack gap-3" data-testid="slots">
              {Array.from({ length: MAX_PLAYERS }, (_, i) => {
                const p = slots[i];
                if (!p) {
                  return (
                    <div className="player-slot player-slot--empty" key={`free-${i}`} data-testid={`slot-${i}`}>
                      <span className="avatar">+</span>
                      <div><div className="player-slot__name">{t('lobby.freeSlot')}</div><div className="t-small">{t('lobby.waitCode', { code: room.code })}</div></div>
                      <span />
                    </div>
                  );
                }
                const pres = presenceLabel(p, now, t);
                return (
                  <div className={`player-slot ${p.ready ? 'is-ready' : ''} ${pres.state === 'reconnecting' ? 'is-reconnecting' : ''} ${pres.state === 'offline' ? 'is-offline' : ''}`}
                    key={p.id} data-testid={`slot-${i}`}>
                    <span className={`avatar ${p.role ? `avatar--${p.role}` : ''}`}><span>{p.name.slice(0, 1).toUpperCase()}</span></span>
                    <div className="min0">
                      <div className="player-slot__name">{p.name}{p.id === myId ? t('lobby.you') : ''}{p.id === room.hostId ? t('lobby.host') : ''}</div>
                      <div className="player-slot__meta">
                        {rolesOf(p).length ? rolesOf(p).map((r) => <RoleChip key={r} role={r} />) : <span className="chip chip--text chip--offline">{t('lobby.noRole')}</span>}
                        {startPlan(room).filter((x) => x.playerId === p.id).map((x) => <span key={x.role} className="chip chip--text chip--extra" title={t('lobby.extraTitle')}>{t('lobby.extra', { role: t(`role.${x.role}`) })}</span>)}
                        <span className={`chip chip--${pres.state}`}><Icon name={PRESENCE_ICON[pres.state]} size={24} />{pres.text}</span>
                      </div>
                    </div>
                    <div className="player-slot__ready">
                      {p.ready ? <><span className="player-slot__check">✓</span>READY</> : <span className="t-small t-muted">{t('lobby.notReady')}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <TrustCard value={room.teamTrust} history={room.trustHistory} tight />
        </section>

        <section className="lobby-roles stack gap-3">
          <h2 className="section-title"><Icon name="role_engineer" size={24} />{t('lobby.pickRole')}</h2>
          <div className="grid-4 lobby-roles__grid">
            {ROLES.map((r) => {
              const holder = holderOf(room.players, r.id);
              const mine = holder?.id === myId;
              // 0013 §4: the extra role of a player holding two can be taken (lobby).
              const spare = !!holder && !mine && rolesOf(holder).length > 1;
              const myRoles = rolesOf(me);
              const pick = () => {
                if (mine && myRoles.length > 1) dispatch({ type: 'assignRole', target: myId, role: r.id, give: false });
                else dispatch({ type: 'pickRole', role: mine ? null : r.id });
              };
              return (
                <button key={r.id} className={`role-card role-card--${r.id} ${mine ? 'is-mine' : ''} ${holder && !mine && !spare ? 'is-taken' : ''}`} data-role={r.id}
                  disabled={!!holder && !mine && !spare} title={holder && !mine ? (spare ? t('lobby.spareTitle', { name: holder.name }) : t('lobby.takenTitle', { name: holder.name })) : undefined}
                  onClick={pick}>
                  <span className="role-card__band">
                    <Icon name={ROLE_ICON[r.id]} size={48} />
                    {mine ? <span className="role-card__mine-mark">✓</span> : holder ? <span className="role-card__mine-mark">{holder.name.slice(0, 1).toUpperCase()}</span> : null}
                  </span>
                  <span className="role-card__name">{t(`role.${r.id}`)}</span>
                  <span className="role-card__en">{r.nameEn}</span>
                  <span className="role-card__state">
                    {mine ? <span className={`chip chip--${r.id}`}><Icon name="st_ok" size={24} />{t('lobby.mine')}</span>
                      : spare ? <span className="chip chip--extra"><Icon name="act_add" size={24} />{t('lobby.spare', { name: holder!.name })}</span>
                      : holder ? <span className="chip chip--locked"><Icon name="st_locked" size={24} />{t('lobby.taken', { name: holder.name })}</span>
                        : <span className="chip chip--open"><Icon name="act_add" size={24} />{t('lobby.free')}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <LobbyRoles />
        </section>

        <section className="lobby-missions stack gap-3">
          <h2 className="section-title"><Icon name="fl_waypoint" size={24} />{t('lobby.mission')} {!isHost && <span className="t-small t-muted lobby-missions__who">{t('lobby.hostPicks')}</span>}</h2>
          <div className="grid lobby-missions__grid">
            {(Object.keys(MISSIONS) as MissionId[]).map((id) => {
              const m = MISSIONS[id];
              const open = room.agency.unlocked.includes(id);
              const chosen = room.mission === id;
              return (
                <div key={id} className={`mission-card ${id === 'asteroid' ? 'mission-card--asteroid' : ''} ${chosen && open ? 'is-selected' : ''} ${open ? '' : 'is-locked'}`}>
                  <div className="mission-card__art">
                    <Icon name={MISSION_ICON[id]} size={64} />
                    {!open && <Icon name="st_locked" size={32} className="mission-card__lock" />}
                  </div>
                  <div className="mission-card__body">
                    <div className="mission-card__title">{m.name.toUpperCase()}</div>
                    <div className="mission-card__desc">{t.d(m.goal)}</div>
                    <div className="mission-card__foot">
                      {open ? (
                        <>
                          <span className="chip chip--open"><Icon name="st_ok" size={24} />{t('lobby.open')}</span>
                          {chosen ? <span className="chip chip--ready">{t('lobby.chosen')}</span>
                            : <button className="btn btn--primary btn--sm" disabled={!isHost} onClick={() => dispatch({ type: 'selectMission', mission: id })}>{t('lobby.choose')}</button>}
                        </>
                      ) : (
                        <button className="btn btn--gold btn--sm" onClick={() => openView('hq')} title={t('lobby.openInHq')} data-testid={`lobby-locked-${id}`}>
                          <Icon name="st_locked" size={20} />{m.unlockCost} MC{room.agency.credits < m.unlockCost ? t('lobby.short', { n: m.unlockCost - room.agency.credits }) : t('lobby.openHq')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {room.agency.pendingPrep && (
            <div className="card card--cream card--tight row gap-3">
              <Icon name="hq_repair" size={48} />
              <span className="grow">{t('lobby.pendingPrep')}</span>
              <button className="btn btn--primary btn--sm" onClick={() => openView('prep', 'build')}><Icon name="hq_repair" size={20} />{t('lobby.toPrep')}</button>
            </div>
          )}
          {isHost && (
            <div className="lobby-demo">
              <Check checked={room.demo} onChange={(v) => dispatch({ type: 'setDemo', demo: v })}>{t('lobby.demo')}</Check>
            </div>
          )}
        </section>
      </div>

      <footer className="action-bar">
        <span className="t-small action-bar__note">{blockers.length ? <>{t('lobby.start', { list: blockers.join(' · ') })}</> : isHost ? t('lobby.allReady') : t('lobby.hostStarts')}</span>
        <button className="btn btn--secondary" disabled={!me?.role} onClick={() => dispatch({ type: 'setReady', ready: !me?.ready })}>
          <Icon name={me?.ready ? 'act_veto' : 'st_ok'} size={24} />{me?.ready ? t('lobby.unready') : t('lobby.ready')}
        </button>
        {isHost && (
          <button className="btn btn--primary btn--lg" disabled={blockers.length > 0} onClick={() => dispatch({ type: 'goStage', stage: 'briefing' })}>
            <Icon name="act_launch" size={32} />{t('lobby.briefing')}
          </button>
        )}
      </footer>
    </div>
  );
}
