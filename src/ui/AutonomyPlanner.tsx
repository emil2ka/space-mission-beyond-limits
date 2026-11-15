// Screen 11 — AUTONOMY PLANNER (docs/03 Design/Autonomy Planner.md, Core Loop step 7).
// «ЕСЛИ [условие] И [доп. условие] → ТО [действие]» from CONDITIONS / ACTIONS; blocks that need a missing module are grey
// with the reason; rules ≤ Flight Computer capacity. Engineer / commander save (setRules), everyone sees the team's rules.
import { useEffect, useMemo, useState } from 'react';
import {
  ACTIONS, blockProblem, computeStats, CONDITIONS, DEFAULT_VALUE, findConflicts, MAX_CONDITIONS, MISSIONS, ruleProblem, ruleText,
  rolesOf, testRules, validateRules, type ActionKind, type AutonomyRule, type ConditionKind,
} from '../engine';
import { useT } from '../i18n';
import { useGame, useMe } from '../store/game';
import { Icon } from './kit/Icon';
import { Note } from './components/common';

const COND_KINDS = Object.keys(CONDITIONS) as ConditionKind[];
const ACTION_KINDS = Object.keys(ACTIONS) as ActionKind[];
const newId = () => `r${Math.random().toString(36).slice(2, 8)}`;

export function AutonomyPlanner() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const me = useMe();
  const stats = useMemo(() => computeStats(room.build, MISSIONS[room.mission], room.agency), [room.build, room.mission, room.agency]);
  const slots = stats.ruleSlots;
  const canEdit = rolesOf(me).some((r) => r === 'engineer' || r === 'commander') && (room.stage === 'build' || room.stage === 'tasks');
  const [draft, setDraft] = useState<AutonomyRule[]>(room.rules);
  const [dirty, setDirty] = useState(false);
  const [test, setTest] = useState<ReturnType<typeof testRules> | null>(null);
  // Someone else saved: take the team's rules unless I have unsaved edits.
  useEffect(() => { if (!dirty) setDraft(room.rules); }, [room.rules, dirty]);

  const edit = (next: AutonomyRule[]) => { setDraft(next); setDirty(true); setTest(null); };
  const patch = (i: number, r: AutonomyRule) => edit(draft.map((x, j) => (j === i ? r : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    edit(next);
  };
  const add = () => {
    const firstOk = (kinds: string[], defs: Record<string, { needs?: string[] }>) => kinds.find((k) => !blockProblem(defs[k].needs, room.build))!;
    edit([...draft, { id: newId(), when: [{ kind: firstOk(COND_KINDS, CONDITIONS) as ConditionKind }], then: firstOk(ACTION_KINDS, ACTIONS) as ActionKind }]);
  };
  const error = validateRules(draft, room.build, slots);
  const conflicts = findConflicts(draft);
  const inConflict = new Set(conflicts.flat());

  return (
    <div className="planner stack gap-3">
      <div className="row row--between gap-2">
        <div>
          <div className="t-eyebrow t-muted">{t('planner.eyebrow')}</div>
          <h3 className="t-h3">Autonomy Planner</h3>
        </div>
        <span className="chip chip--night" title={t('planner.capTitle')}><Icon name="fl_rule" size={24} />{t('planner.count', { n: draft.length, slots })}</span>
      </div>
      {slots === 0 && <Note level="warn">{t('planner.noFc')}</Note>}
      {!canEdit && <Note level="info">{room.stage === 'build' ? t('planner.readOnly') : t('planner.locked')}</Note>}

      {draft.map((r, i) => {
        const problem = ruleProblem(r, room.build);
        return (
          <div key={r.id} className={`rule-card ${problem ? 'is-bad' : ''} ${inConflict.has(r.id) ? 'is-conflict' : ''} ${i >= slots ? 'is-over' : ''}`}>
            <div className="rule-card__head">
              <Icon name="fl_rule" size={24} />
              <b className="grow">{t('planner.rule', { n: i + 1 })}{i === 0 ? t('planner.top') : ''}</b>
              {canEdit && (
                <span className="row gap-1 row--nowrap">
                  <button type="button" className="btn btn--mini btn--icon" disabled={i === 0} onClick={() => move(i, -1)} title={t('planner.upTitle')} aria-label={t('planner.up')}>↑</button>
                  <button type="button" className="btn btn--mini btn--icon" disabled={i === draft.length - 1} onClick={() => move(i, 1)} title={t('planner.down')} aria-label={t('planner.down')}>↓</button>
                  <button type="button" className="btn btn--mini btn--icon" onClick={() => edit(draft.filter((_, j) => j !== i))} title={t('planner.delete')} aria-label={t('planner.delete')}><Icon name="act_remove" size={20} /></button>
                </span>
              )}
            </div>
            {[0, 1].slice(0, MAX_CONDITIONS).map((ci) => {
              const c = r.when[ci];
              if (ci > 0 && !c && !canEdit) return null;
              const others = r.when.filter((_, k) => k !== ci).map((x) => x.kind);
              return (
                <div key={ci} className="rule-line">
                  <span className="rule-kw">{ci === 0 ? t('planner.if') : t('planner.and')}</span>
                  <span className="select-wrap grow">
                    <select className="select" disabled={!canEdit} value={c?.kind ?? ''}
                      onChange={(e) => {
                        const kind = e.target.value as ConditionKind | '';
                        const when = [...r.when];
                        if (!kind) when.splice(ci, 1);
                        else when[ci] = { kind, ...(CONDITIONS[kind].hasValue ? { value: DEFAULT_VALUE[kind] } : {}) };
                        patch(i, { ...r, when });
                      }}>
                      {ci > 0 && <option value="">{t('planner.noExtra')}</option>}
                      {COND_KINDS.map((k) => {
                        const why = blockProblem(CONDITIONS[k].needs, room.build);
                        return <option key={k} value={k} disabled={!!why || others.includes(k)}>{t.f(CONDITIONS[k], 'label')}{why ? ` — ${t.m(why)}` : ''}</option>;
                      })}
                    </select>
                  </span>
                  {c && CONDITIONS[c.kind].hasValue && (
                    <input className="input rule-num t-mono" type="number" min={1} max={99} disabled={!canEdit} value={c.value ?? ''} aria-label={t('planner.value')}
                      onChange={(e) => patch(i, { ...r, when: r.when.map((x, k) => (k === ci ? { ...x, value: Number(e.target.value) } : x)) })} />
                  )}
                </div>
              );
            })}
            <div className="rule-line">
              <span className="rule-kw rule-kw--then">{t('planner.then')}</span>
              <span className="select-wrap grow">
                <select className="select" disabled={!canEdit} value={r.then} onChange={(e) => patch(i, { ...r, then: e.target.value as ActionKind })}>
                  {ACTION_KINDS.map((k) => {
                    const why = blockProblem(ACTIONS[k].needs, room.build);
                    return <option key={k} value={k} disabled={!!why}>{t.f(ACTIONS[k], 'label')}{why ? ` — ${t.m(why)}` : ''}</option>;
                  })}
                </select>
              </span>
            </div>
            {problem && <div className="module-card__reason"><Icon name="st_warn" size={20} />{t.m(problem)}{t('planner.wontFire')}</div>}
            {i >= slots && <div className="module-card__reason module-card__reason--max"><Icon name="st_info" size={20} />{t('planner.noFit', { slots })}</div>}
          </div>
        );
      })}
      {!draft.length && <Note level="info">{t('planner.empty')}</Note>}
      {conflicts.length > 0 && <Note level="warn">{t('planner.conflict', { list: conflicts.map(([a, b]) => t('planner.pair', { a: draft.findIndex((x) => x.id === a) + 1, b: draft.findIndex((x) => x.id === b) + 1 })).join('; ') })}</Note>}

      {canEdit && (
        <div className="row gap-2">
          <button type="button" className="btn btn--secondary btn--sm" onClick={add} disabled={draft.length >= slots}><Icon name="act_add" size={20} />{t('planner.add')}</button>
          <button type="button" className="btn btn--primary btn--sm" disabled={!dirty || !!error} onClick={() => { dispatch({ type: 'setRules', rules: draft }); setDirty(false); }}><Icon name="act_approve" size={20} />{t('planner.save')}</button>
          {dirty && <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setDraft(room.rules); setDirty(false); }}>{t('planner.cancel')}</button>}
        </div>
      )}
      {error && draft.length > 0 && <Note level="bad">{t.m(error)}</Note>}
      {dirty && !error && <div className="t-small t-muted">{t('planner.dirty')}</div>}

      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setTest(testRules(draft, room.build, slots))}><Icon name="act_play" size={20} />{t('planner.test')}</button>
      {test && (
        <ul className="stack gap-2">
          {test.map((sc) => (
            <li key={sc.id} className={`check-line check-line--compact check-line--static ${sc.safe ? 'check-line--warn' : ''}`}>
              <span className="check-line__badge"><Icon name={sc.safe ? 'st_warn' : 'fl_rule'} size={24} /></span>
              <span className="min0">
                <span className="check-line__title">{t.f(sc, 'name')}</span>
                <span className="check-line__reason">{sc.safe ? t('planner.safe') : sc.fired.map((x) => t('planner.fired', { n: draft.findIndex((r) => r.id === x.ruleId) + 1, action: t.f(ACTIONS[x.action], 'label') })).join('; ')}</span>
              </span>
              <span />
            </li>
          ))}
        </ul>
      )}
      <div className="t-small t-muted">{t('planner.order')}</div>
    </div>
  );
}

/** Read-only list of the team's rules (review screen). */
export function RulesSummary() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const slots = useMemo(() => computeStats(room.build, MISSIONS[room.mission], room.agency).ruleSlots, [room.build, room.mission, room.agency]);
  return (
    <div className="stack gap-2">
      <div className="t-eyebrow t-muted">{t('planner.summary', { n: room.rules.length, slots })}</div>
      {room.rules.length ? (
        <ol className="stack gap-2">
          {room.rules.map((r, i) => {
            const p = ruleProblem(r, room.build);
            return (
              <li key={r.id} className={`rule-summary ${p ? 'is-bad' : ''}`}>
                <Icon name={p ? 'st_warn' : 'fl_rule'} size={20} /><span>{i + 1}. {t.m(ruleText(r))}{p ? ` — ${t.m(p)}` : ''}</span>
              </li>
            );
          })}
        </ol>
      ) : <Note level="info">{t('planner.emptyShort')}</Note>}
    </div>
  );
}
