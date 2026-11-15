// Lobby, decision 0013 §4: 2–3 players. Free roles get a balanced default owner (shown before the start);
// the host can hand a free role to a chosen player or take an extra one back; a player may drop his extra role.
import { freeRoles, MIN_PLAYERS, rolePlan, rolesOf, type RoleId, type RoomState } from '../../engine';
import { useGame } from '../../store/game';
import { t, useT, type Params } from '../../i18n';
import { Icon } from '../kit/Icon';
import { RoleChip, ROLE_BY_ID } from '../components/common';
import './rules.css';

/** Texts (current language; components call useT() to re-render). Dictionary: rules.ui.lobby.* */
const tx = (k: string, p?: Params) => t(`rules.ui.lobby.${k}`, p);
export const LOBBY_ROLES_TEXT = {
  get title() { return tx('title'); },
  intro: (n: number) => tx('intro', { n }),
  get byDefault() { return tx('byDefault'); },
  assignTo: (role: string) => tx('assignTo', { role }),
  get give() { return tx('give'); },
  get hostOnly() { return tx('hostOnly'); },
  get extra() { return tx('extra'); },
  get takeBack() { return tx('takeBack'); },
  get drop() { return tx('drop'); },
  get minPlayers() { return tx('minPlayers', { n: MIN_PLAYERS }); },
};

/** Who would hold which free role at the start (the engine's default). */
export function startPlan(room: RoomState): { role: RoleId; playerId: string }[] {
  return room.demo ? [] : rolePlan(room.players);
}

export function LobbyRoles() {
  useT();
  const room = useGame((s) => s.room)!;
  const myId = useGame((s) => s.me.id);
  const dispatch = useGame((s) => s.dispatch);
  if (room.demo) return null;
  const isHost = room.hostId === myId;
  const free = freeRoles(room.players);
  const plan = startPlan(room);
  const extras = room.players.flatMap((p) => rolesOf(p).slice(1).map((role) => ({ p, role })));
  if (!free.length && !extras.length) return null;
  return (
    <div className="card card--cream card--tight lobby-free stack gap-3" data-testid="lobby-free-roles">
      <div className="row gap-2"><Icon name="role_commander" size={32} /><b className="t-h3 grow">{LOBBY_ROLES_TEXT.title}</b></div>
      {room.players.length < 4 && <p className="t-small">{LOBBY_ROLES_TEXT.intro(room.players.length)}</p>}
      {free.map((role) => {
        const def = plan.find((x) => x.role === role);
        const defName = room.players.find((p) => p.id === def?.playerId)?.name;
        return (
          <div key={role} className="lobby-free__row" data-testid={`free-${role}`}>
            <RoleChip role={role} />
            <span className="t-small t-muted grow">{defName ? <>{LOBBY_ROLES_TEXT.byDefault} → <b>{defName}</b></> : '—'}</span>
            {isHost && (
              <span className="select-wrap lobby-free__pick">
                <select className="select" aria-label={LOBBY_ROLES_TEXT.assignTo(ROLE_BY_ID[role].name)} value="" data-testid={`assign-${role}`}
                  onChange={(e) => e.target.value && dispatch({ type: 'assignRole', target: e.target.value, role, give: true })}>
                  <option value="">{LOBBY_ROLES_TEXT.give}…</option>
                  {[...room.players].sort((a, b) => a.joinOrder - b.joinOrder).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </span>
            )}
          </div>
        );
      })}
      {extras.length > 0 && (
        <div className="stack gap-2">
          <div className="t-eyebrow t-muted">{LOBBY_ROLES_TEXT.extra}</div>
          {extras.map(({ p, role }) => (
            <div key={`${p.id}-${role}`} className="lobby-free__row" data-testid={`extra-${role}`}>
              <RoleChip role={role} />
              <span className="t-small grow"><b>{p.name}</b></span>
              {(isHost || p.id === myId) && (
                <button type="button" className="btn btn--secondary btn--mini" onClick={() => dispatch({ type: 'assignRole', target: p.id, role, give: false })}>
                  {p.id === myId ? LOBBY_ROLES_TEXT.drop : LOBBY_ROLES_TEXT.takeBack}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!isHost && <div className="t-small t-muted">{LOBBY_ROLES_TEXT.hostOnly}</div>}
    </div>
  );
}
