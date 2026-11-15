// «Под наблюдением» (decision 0013 §3, Team Trust < 50): the commander's approval against a critical warning waits for
// the owner's second key. The owner turns it or refuses with a reason; the commander sees whom we wait for.
import { useEffect, useState } from 'react';
import { criticalWarnings, MISSIONS, readiness, rolesOf, rulesActive, trustEffects, type RoomState } from '../../engine';
import { useGame, useMe } from '../../store/game';
import { t, useT, type Params } from '../../i18n';
import { Icon } from '../kit/Icon';
import { Note, ROLE_BY_ID } from '../components/common';
import { TrustChip } from './Trust';
import './rules.css';

/** Texts (current language; components call useT() to re-render). Dictionary: rules.ui.key.* */
const tx = (k: string, p?: Params) => t(`rules.ui.key.${k}`, p);
export const KEY_TEXT = {
  get title() { return tx('title'); },
  why: (trust: number) => tx('why', { trust }),
  hint: (trust: number) => tx('hint', { trust }),
  waiting: (names: string, any: boolean) => tx(any ? 'waitingAny' : 'waiting', { names }),
  get yourTurn() { return tx('yourTurn'); },
  get risks() { return tx('risks'); },
  get give() { return tx('give'); },
  get deny() { return tx('deny'); },
  get denyReason() { return tx('denyReason'); },
  get denyPlaceholder() { return tx('denyPlaceholder'); },
  get denySend() { return tx('denySend'); },
  get cancel() { return tx('cancel'); },
  get given() { return tx('given'); },
  owners: (r: string) => tx('owners', { r }),
};

/** Review side card. Renders nothing when no key is involved. */
export function SecondKeyCard() {
  const tr = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const me = useMe();
  const [denying, setDenying] = useState(false);
  const [text, setText] = useState('');
  const k = room.pendingKey;
  const roles = rolesOf(me);
  // A new request for the key starts clean (the last one may have been refused with this form open).
  useEffect(() => { setDenying(false); setText(''); }, [k?.at, k?.by]);
  if (!me || !rulesActive(room)) return null;
  if (!k) return <KeyHint room={room} commander={roles.includes('commander')} />;
  const names = k.need.map((id) => room.players.find((p) => p.id === id)?.name ?? '?').join(k.any ? tr('rules.ui.key.or') : ', ');
  const mine = k.need.includes(me.id) && !k.keys.includes(me.id);
  return (
    <div className="key-card" data-testid="second-key">
      <div className="key-card__head"><Icon name="st_locked" size={32} /><b className="key-card__title grow">{KEY_TEXT.title}</b></div>
      <div className="stack gap-2">
        <TrustChip value={room.teamTrust} />
        <p className="t-small">{KEY_TEXT.why(room.teamTrust)}</p>
        <div className="t-eyebrow t-muted">{KEY_TEXT.risks}</div>
        <p className="t-small key-card__risk">{tr.f(k, 'text')}</p>
        <div className="t-small t-muted">{KEY_TEXT.owners(k.owners.map((r) => ROLE_BY_ID[r].name).join(', '))}</div>
        {mine ? (denying ? (
          <div className="stack gap-2">
            <label className="field">
              <span className="field__label">{KEY_TEXT.denyReason}</span>
              <input className="input" value={text} maxLength={200} placeholder={KEY_TEXT.denyPlaceholder} onChange={(e) => setText(e.target.value)} autoFocus data-testid="key-reason" />
            </label>
            <div className="row gap-2">
              <button type="button" className="btn btn--danger btn--sm grow" data-testid="key-deny-send" onClick={() => dispatch({ type: 'secondKey', give: false, reason: text.trim() })}><Icon name="act_veto" size={20} />{KEY_TEXT.denySend}</button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setDenying(false)}>{KEY_TEXT.cancel}</button>
            </div>
          </div>
        ) : (
          <>
            <Note level="warn">{KEY_TEXT.yourTurn}</Note>
            <div className="row gap-2">
              <button type="button" className="btn btn--primary btn--sm grow" data-testid="key-give" onClick={() => dispatch({ type: 'secondKey', give: true })}><Icon name="act_approve" size={20} />{KEY_TEXT.give}</button>
              <button type="button" className="btn btn--danger btn--sm" data-testid="key-deny" onClick={() => setDenying(true)}><Icon name="act_veto" size={20} />{KEY_TEXT.deny}</button>
            </div>
          </>
        )) : <Note level="info">{k.keys.includes(me.id) ? KEY_TEXT.given : KEY_TEXT.waiting(names, k.any)}</Note>}
      </div>
    </div>
  );
}

/** Before approving: tell the commander a key will be needed. */
function KeyHint({ room, commander }: { room: RoomState; commander: boolean }) {
  useT();
  if (!commander || room.stage !== 'review' || !trustEffects(room.teamTrust).secondKey) return null;
  const r = readiness(room.build, MISSIONS[room.mission], room.agency);
  if (!r.ok || !criticalWarnings(r.warnings).length) return null;
  return <Note level="warn" testId="key-hint">{KEY_TEXT.hint(room.teamTrust)}</Note>;
}
