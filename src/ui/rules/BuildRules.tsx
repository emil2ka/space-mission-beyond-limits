// Constructor rules of decision 0013 §2: who installs which module, the commander's budget split and the request queue.
// The engine decides (room.ts: addComponent → request, resolveRequest, setBudgetSplit); this file only shows and sends.
import { useEffect, useState } from 'react';
import {
  budgetPlanOf, budgetShares, changeReasons, COMPONENT_BY_ID, departmentsOf, DEPARTMENTS, OWNER_ROLES, pendingRequests, rolesOf, rulesActive, SPLIT_STEP,
  type BudgetSplit, type BuildRequest, type OwnerRole, type RoleId, type RoomState,
} from '../../engine';
import { useGame, useMe } from '../../store/game';
import { t, useT, type Params } from '../../i18n';
import { Icon } from '../kit/Icon';
import { Meter, ROLE_BY_ID, RoleChip, tKeys } from '../components/common';
import { TrustCard } from './Trust';
import './rules.css';

/** Texts of this panel (current language; components call useT() to re-render on a switch). Dictionary: rules.ui.* */
const tx = (k: string, p?: Params) => t(`rules.ui.${k}`, p);
export const RULES_TEXT = {
  get own() { return tx('own'); },
  get commanderAny() { return tx('commanderAny'); },
  get viaCommander() { return tx('viaCommander'); },
  overShare: (n: number) => tx('overShare', { n }),
  get pendingHere() { return tx('pendingHere'); },
  ownerOf: (r: OwnerRole) => tx('ownerOf', { role: ROLE_BY_ID[r].name }),
  addTitle: (name: string, req: boolean) => (req ? tx('addReq', { name }) : tx('add', { name })),
  removeTitle: (name: string, req: boolean) => (req ? tx('removeReq', { name }) : tx('remove', { name })),

  get panel() { return tx('panel'); },
  get yourDepts() { return tx('yourDepts'); },
  get allDepts() { return tx('allDepts'); },
  ownerGroup: tKeys('rules.ui.ownerGroup', OWNER_ROLES) satisfies Record<OwnerRole, string>,
  ownerDepts: tKeys('rules.ui.ownerDepts', OWNER_ROLES) satisfies Record<OwnerRole, string>,
  get split() { return tx('split'); },
  get splitDefault() { return tx('splitDefault'); },
  get splitSet() { return tx('splitSet'); },
  get splitAsk() { return tx('splitAsk'); },
  splitSum: (n: number) => tx('splitSum', { n }),
  get splitConfirm() { return tx('splitConfirm'); },
  get splitEdit() { return tx('splitEdit'); },
  get splitCancel() { return tx('splitCancel'); },
  spent: (spent: number, share: number) => tx('spent', { spent, share }),
  get queue() { return tx('queue'); },
  get queueEmpty() { return tx('queueEmpty'); },
  reason: { foreign: (r: OwnerRole) => tx('reasonForeign', { role: ROLE_BY_ID[r].name }), over: (n: number) => tx('overShare', { n }) },
  kind: tKeys('rules.ui.kind', ['add', 'remove'] as const),
  get approve() { return tx('approve'); },
  get veto() { return tx('veto'); },
  get vetoReason() { return tx('vetoReason'); },
  get vetoPlaceholder() { return tx('vetoPlaceholder'); },
  get vetoSend() { return tx('vetoSend'); },
  get cancel() { return tx('cancel'); },
  get inYourDept() { return tx('inYourDept'); },
  waitCommander: (name?: string) => (name ? tx('waitCommanderName', { name }) : tx('waitCommander')),
  get resolved() { return tx('resolved'); },
  status: tKeys('rules.ui.status', ['approved', 'vetoed', 'cancelled', 'pending'] as const) satisfies Record<BuildRequest['status'], string>,
  blockReview: (n: number) => tx('blockReview', { n }),
};

const nameOf = (id: string) => COMPONENT_BY_ID[id]?.name ?? id;

/** Badge on a catalog card: «ваш отдел» / «через командира» (+ over share, + a pending request of mine). */
export function OwnershipBadge({ componentId }: { componentId: string }) {
  useT();
  const room = useGame((s) => s.room)!;
  const me = useMe();
  if (!rulesActive(room) || !me) return null;
  const roles = rolesOf(me);
  const { reasons, owner, overBy } = changeReasons(room, roles, 'add', componentId);
  const mine = pendingRequests(room).find((r) => r.by === me.id && r.componentId === componentId);
  const foreign = reasons.includes('foreign');
  const over = reasons.includes('over-share');
  return (
    <div className="own-badge" data-testid={`own-${componentId}`}>
      {foreign
        ? <span className="chip chip--warn chip--sm" title={owner ? RULES_TEXT.ownerOf(owner) : undefined}><Icon name="role_commander" size={24} />{RULES_TEXT.viaCommander}</span>
        : <span className="chip chip--ok chip--sm"><Icon name="st_ok" size={24} />{owner && !roles.includes(owner) && roles.includes('commander') ? RULES_TEXT.commanderAny : RULES_TEXT.own}</span>}
      {owner && foreign && <span className="own-badge__who">{RULES_TEXT.ownerOf(owner)}</span>}
      {over && <span className="chip chip--risk chip--sm"><Icon name="res_budget" size={24} />{RULES_TEXT.overShare(overBy)}</span>}
      {mine && <span className="chip chip--info chip--sm"><Icon name="fl_timer" size={24} />{RULES_TEXT.pendingHere}</span>}
    </div>
  );
}

/** Constructor side panel: my departments, the budget split (commander edits it) and the request queue. */
export function RulesPanel() {
  useT();
  const room = useGame((s) => s.room)!;
  const me = useMe();
  if (!rulesActive(room) || !me) return null;
  const roles = rolesOf(me);
  const commander = roles.includes('commander');
  return (
    <div className="rules-panel stack gap-3" data-testid="rules-panel">
      <div className="row row--between gap-2">
        <h2 className="section-title"><Icon name="role_commander" size={24} />{RULES_TEXT.panel}</h2>
      </div>
      {commander && <TrustCard value={room.teamTrust} history={room.trustHistory} tight dark />}
      <MyDepartments roles={roles} />
      <BudgetSplitView room={room} commander={commander} />
      <RequestQueue room={room} myId={me.id} roles={roles} />
    </div>
  );
}

function MyDepartments({ roles }: { roles: RoleId[] }) {
  const t = useT();
  if (roles.includes('commander')) {
    return <div className="t-small rules-depts"><b>{RULES_TEXT.yourDepts}:</b> {RULES_TEXT.allDepts}.</div>;
  }
  const depts = departmentsOf(roles);
  return (
    <div className="t-small rules-depts">
      <b>{RULES_TEXT.yourDepts}:</b> {DEPARTMENTS.filter((d) => depts.includes(d.id)).map((d) => t(`dept.${d.id}`)).join(', ') || '—'}
    </div>
  );
}

function BudgetSplitView({ room, commander }: { room: RoomState; commander: boolean }) {
  useT();
  const dispatch = useGame((s) => s.dispatch);
  const plan = budgetPlanOf(room);
  const [draft, setDraft] = useState<BudgetSplit | null>(null);
  // Open the editor for the commander at the start of the constructor, until he confirms a split.
  useEffect(() => { if (commander && !plan.set && !draft) setDraft({ ...plan.split }); }, [commander, plan.set]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = budgetShares({ ...room, budgetSplit: draft ? { split: draft, set: true } : plan });
  const sum = draft ? OWNER_ROLES.reduce((s, r) => s + draft[r], 0) : 100;
  const step = (r: OwnerRole, d: number) => setDraft((x) => (x ? { ...x, [r]: Math.max(0, Math.min(100, x[r] + d)) } : x));
  return (
    <div className="budget-split stack gap-2" data-testid="budget-split">
      <div className="row row--between gap-2">
        <span className="t-eyebrow">{RULES_TEXT.split}</span>
        <span className={`t-small ${plan.set ? 't-ok' : 't-warn'}`}>{plan.set ? RULES_TEXT.splitSet : RULES_TEXT.splitDefault}</span>
      </div>
      {commander && draft && !plan.set && <div className="t-small">{RULES_TEXT.splitAsk}</div>}
      {lines.map((l) => (
        <div key={l.owner} className="budget-split__row">
          <div className="budget-split__head">
            <RoleChip role={l.owner}>{RULES_TEXT.ownerGroup[l.owner]}</RoleChip>
            <b className="t-mono">{l.pct} %</b>
            {draft && (
              <span className="budget-split__step">
                <button type="button" className="btn btn--secondary btn--mini" aria-label={`${RULES_TEXT.ownerGroup[l.owner]} −${SPLIT_STEP} %`} disabled={draft[l.owner] <= 0} onClick={() => step(l.owner, -SPLIT_STEP)}>−</button>
                <button type="button" className="btn btn--secondary btn--mini" aria-label={`${RULES_TEXT.ownerGroup[l.owner]} +${SPLIT_STEP} %`} disabled={draft[l.owner] >= 100} onClick={() => step(l.owner, SPLIT_STEP)}>+</button>
              </span>
            )}
          </div>
          <Meter compact k={l.share ? l.spent / l.share : l.spent > 0 ? 2 : 0}
            status={<><span className={`t-mono ${l.left < 0 ? 't-crit' : ''}`}>{RULES_TEXT.spent(l.spent, l.share)}</span> · {RULES_TEXT.ownerDepts[l.owner]}</>} />
        </div>
      ))}
      {commander && (draft ? (
        <div className="row gap-2">
          {sum !== 100 && <span className="t-small t-crit grow">{RULES_TEXT.splitSum(sum)}</span>}
          <button type="button" className="btn btn--primary btn--sm grow" disabled={sum !== 100} data-testid="split-confirm"
            onClick={() => { dispatch({ type: 'setBudgetSplit', split: draft }); setDraft(null); }}><Icon name="act_approve" size={20} />{RULES_TEXT.splitConfirm}</button>
          {plan.set && <button type="button" className="btn btn--secondary btn--sm" onClick={() => setDraft(null)}>{RULES_TEXT.splitCancel}</button>}
        </div>
      ) : <button type="button" className="btn btn--secondary btn--sm" onClick={() => setDraft({ ...plan.split })} data-testid="split-edit"><Icon name="res_budget" size={20} />{RULES_TEXT.splitEdit}</button>)}
    </div>
  );
}

function reasonText(r: BuildRequest) {
  return r.reasons.map((x) => (x === 'foreign' ? RULES_TEXT.reason.foreign(r.owner) : RULES_TEXT.reason.over(r.overBy))).join(' · ');
}

function RequestQueue({ room, myId, roles }: { room: RoomState; myId: string; roles: RoleId[] }) {
  useT();
  const pending = pendingRequests(room);
  const resolved = (room.requests ?? []).filter((r) => r.status !== 'pending').slice(-3).reverse();
  const commanderName = room.players.find((p) => rolesOf(p).includes('commander'))?.name;
  return (
    <div className="req-queue stack gap-2" data-testid="request-queue">
      <div className="row row--between gap-2">
        <span className="t-eyebrow">{RULES_TEXT.queue}</span>
        {pending.length > 0 && <span className="chip chip--warn chip--sm">{pending.length}</span>}
      </div>
      {!pending.length && <div className="t-small t-muted">{RULES_TEXT.queueEmpty}</div>}
      {pending.map((r) => <RequestRow key={r.id} r={r} room={room} myId={myId} roles={roles} commanderName={commanderName} />)}
      {resolved.length > 0 && (
        <ul className="req-queue__done">
          {resolved.map((r) => (
            <li key={r.id} className={`req-done req-done--${r.status}`}>
              <Icon name={r.status === 'approved' ? 'st_ok' : r.status === 'vetoed' ? 'act_veto' : 'st_info'} size={20} />
              <span>{room.players.find((p) => p.id === r.by)?.name}: {RULES_TEXT.kind[r.kind]} {nameOf(r.componentId)} — <b>{RULES_TEXT.status[r.status]}</b>{r.status === 'vetoed' && r.note ? ` («${r.note}»)` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestRow({ r, room, myId, roles, commanderName }: { r: BuildRequest; room: RoomState; myId: string; roles: RoleId[]; commanderName?: string }) {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const [vetoing, setVetoing] = useState(false);
  const [text, setText] = useState('');
  const commander = roles.includes('commander');
  const who = room.players.find((p) => p.id === r.by)?.name ?? '?';
  const ownerHere = roles.includes(r.owner) && r.by !== myId;
  return (
    <div className="req-row" data-testid={`request-${r.id}`}>
      <div className="req-row__head">
        <Icon name={r.kind === 'add' ? 'act_add' : 'act_remove'} size={24} />
        <div className="grow min0">
          <div className="req-row__title">{who}{r.byRole ? ` (${ROLE_BY_ID[r.byRole].name})` : ''}: {RULES_TEXT.kind[r.kind]} <b>{nameOf(r.componentId)}</b></div>
          <div className="t-small t-muted">{reasonText(r)} · {t('build.mc', { n: COMPONENT_BY_ID[r.componentId]?.cost ?? 0 })}</div>
        </div>
        {ownerHere && <span className="chip chip--info chip--sm">{RULES_TEXT.inYourDept}</span>}
      </div>
      {commander ? (vetoing ? (
        <div className="stack gap-2">
          <label className="field">
            <span className="field__label">{RULES_TEXT.vetoReason}</span>
            <input className="input" value={text} maxLength={200} placeholder={RULES_TEXT.vetoPlaceholder} onChange={(e) => setText(e.target.value)} autoFocus data-testid="veto-reason" />
          </label>
          <div className="row gap-2">
            <button type="button" className="btn btn--danger btn--sm grow" data-testid="veto-send" onClick={() => dispatch({ type: 'resolveRequest', requestId: r.id, approve: false, reason: text.trim() })}><Icon name="act_veto" size={20} />{RULES_TEXT.vetoSend}</button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setVetoing(false)}>{RULES_TEXT.splitCancel}</button>
          </div>
        </div>
      ) : (
        <div className="row gap-2">
          <button type="button" className="btn btn--primary btn--sm grow" data-testid="req-approve" onClick={() => dispatch({ type: 'resolveRequest', requestId: r.id, approve: true })}><Icon name="act_approve" size={20} />{RULES_TEXT.approve}</button>
          <button type="button" className="btn btn--danger btn--sm grow" data-testid="req-veto" onClick={() => setVetoing(true)}><Icon name="act_veto" size={20} />{RULES_TEXT.veto}</button>
        </div>
      )) : (
        <div className="row gap-2">
          <span className="t-small t-muted grow">{RULES_TEXT.waitCommander(commanderName)}</span>
          {r.by === myId && <button type="button" className="btn btn--secondary btn--mini" onClick={() => dispatch({ type: 'cancelRequest', requestId: r.id })}>{RULES_TEXT.cancel}</button>}
        </div>
      )}
    </div>
  );
}
