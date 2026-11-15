// Toasts for the team rules (decision 0013 §2–3): request outcomes for the requester, new requests for the commander
// and the department owner, the second key for its owner and the commander. Derived from room state changes only.
import { useEffect, useRef, useState } from 'react';
import { COMPONENT_BY_ID, rolesOf, type BuildRequest, type RoomState } from '../../engine';
import { useGame } from '../../store/game';
import { t, tf, useT, type Params } from '../../i18n';
import { Icon, type IconName } from '../kit/Icon';
import { ROLE_BY_ID } from '../components/common';
import './rules.css';

/** Texts (current language when the toast is made). Dictionary: rules.ui.toast.* */
const tx = (k: string, p?: Params) => t(`rules.ui.toast.${k}`, p);
export const TOAST_TEXT = {
  get approved() { return tx('approved'); },
  get vetoed() { return tx('vetoed'); },
  get newRequest() { return tx('newRequest'); },
  get inYourDept() { return tx('inYourDept'); },
  get keyNeeded() { return tx('keyNeeded'); },
  get keyGiven() { return tx('keyGiven'); },
  get keyDenied() { return tx('keyDenied'); },
  what: (r: BuildRequest) => tx(r.kind === 'add' ? 'whatAdd' : 'whatRemove', { name: COMPONENT_BY_ID[r.componentId]?.name ?? r.componentId }),
  by: (name: string, r: BuildRequest) => `${name}: ${TOAST_TEXT.what(r)}${r.reasons.includes('over-share') ? tx('over', { n: r.overBy }) : ''}.`,
  vetoNote: (r: BuildRequest) => `${TOAST_TEXT.what(r)} — «${r.note ?? ''}».`,
  done: (r: BuildRequest) => `${TOAST_TEXT.what(r)}: ${tx(r.kind === 'add' ? 'doneAdd' : 'doneRemove')}.`,
  get keyText() { return tx('keyText'); },
  get close() { return tx('close'); },
};

interface ToastItem { id: string; title: string; text: string; tone: 'ok' | 'warn' | 'err'; icon: IconName; until?: number }
const LIFE_MS = 6500;

function diff(prev: RoomState, next: RoomState, myId: string): ToastItem[] {
  const out: ToastItem[] = [];
  const me = next.players.find((p) => p.id === myId);
  const roles = rolesOf(me);
  const name = (id: string) => next.players.find((p) => p.id === id)?.name ?? '?';
  const before = new Map((prev.requests ?? []).map((r) => [r.id, r]));
  for (const r of next.requests ?? []) {
    const was = before.get(r.id);
    if (!was && r.status === 'pending' && r.by !== myId) {
      if (roles.includes('commander')) out.push({ id: `${r.id}-new`, title: TOAST_TEXT.newRequest, text: TOAST_TEXT.by(name(r.by), r), tone: 'warn', icon: 'role_commander' });
      else if (roles.includes(r.owner)) out.push({ id: `${r.id}-own`, title: `${TOAST_TEXT.inYourDept} · ${ROLE_BY_ID[r.owner].name}`, text: TOAST_TEXT.by(name(r.by), r), tone: 'warn', icon: 'st_info' });
    }
    if (was?.status === 'pending' && r.status !== 'pending' && r.by === myId && r.resolvedBy !== myId) {
      if (r.status === 'approved') out.push({ id: `${r.id}-ok`, title: TOAST_TEXT.approved, text: TOAST_TEXT.done(r), tone: 'ok', icon: 'act_approve' });
      if (r.status === 'vetoed') out.push({ id: `${r.id}-veto`, title: TOAST_TEXT.vetoed, text: TOAST_TEXT.vetoNote(r), tone: 'err', icon: 'act_veto' });
    }
  }
  const k = next.pendingKey;
  if (k && !prev.pendingKey && k.need.includes(myId)) out.push({ id: `key-${k.at}-${next.version}`, title: TOAST_TEXT.keyNeeded, text: TOAST_TEXT.keyText, tone: 'warn', icon: 'st_locked' });
  // The commander learns what happened to his request for a key.
  const pk = prev.pendingKey;
  if (pk && pk.by === myId && !k) {
    const last = next.decisionLog.at(-1);
    if (last?.kind === 'key-denied') out.push({ id: `key-denied-${next.version}`, title: TOAST_TEXT.keyDenied, text: `${name(last.by)}: «${tf(last, 'text')}»`, tone: 'err', icon: 'act_veto' });
    else if (last?.keys?.length) out.push({ id: `key-given-${next.version}`, title: TOAST_TEXT.keyGiven, text: last.keys.map(name).join(', '), tone: 'ok', icon: 'act_approve' });
  }
  return out;
}

export function RulesToasts() {
  useT();
  const room = useGame((s) => s.room);
  const myId = useGame((s) => s.me.id);
  const prev = useRef<RoomState | null>(null);
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    const p = prev.current;
    prev.current = room;
    if (!room || !p || p.code !== room.code) return;
    const add = diff(p, room, myId);
    const until = Date.now() + LIFE_MS;
    if (add.length) setItems((xs) => [...xs.filter((x) => !add.some((a) => a.id === x.id)), ...add.map((a) => ({ ...a, until }))].slice(-3));
  }, [room, myId]);
  // Each toast lives LIFE_MS on its own.
  const any = items.length > 0;
  useEffect(() => {
    if (!any) return;
    const t = setInterval(() => setItems((xs) => (xs.some((x) => (x.until ?? 0) <= Date.now()) ? xs.filter((x) => (x.until ?? 0) > Date.now()) : xs)), 500);
    return () => clearInterval(t);
  }, [any]);
  if (!items.length) return null;
  return (
    <div className="toast-stack toast-stack--fixed rules-toasts" aria-live="polite" data-testid="rules-toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'err' ? 'toast--err' : t.tone === 'warn' ? 'toast--warn' : 'toast--ok'}`} role="status" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
          <span className="toast__badge"><Icon name={t.icon} size={24} /></span>
          <div><div className="toast__title">{t.title}</div><div className="toast__text">{t.text}</div></div>
          <button type="button" className="btn btn--mini btn--icon" aria-label={TOAST_TEXT.close}>✕</button>
          <span className="toast__timer" />
        </div>
      ))}
    </div>
  );
}
