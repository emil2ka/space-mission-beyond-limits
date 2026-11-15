// Screen 10 — Individual Tasks (decision 0013 §1, docs/03 Design/Individual Tasks.md).
// Between the constructor and the readiness check: every role plays its own mini-game at the same time, no timer.
// Commander: goal priorities + sacrifice order (drag). Engineer: power line routing (wiring schematic).
// Science: calibration (knob on a spectrum) + measurement mode. Comms: antenna radar + packet queue (drag).
// The engine scores it (src/engine/tasks.ts); the grade becomes a flight modifier and a line in the report.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  commanderSetup, commsSetup, COMPONENT_BY_ID, computeStats, engineerSetup, goalMsg, holderOf, lineLoads, MISSIONS, previewCommander,
  previewComms, previewEngineer, previewScience, rolesOf, scienceSetup, signalAt, SPECTRA, taskCtx, taskRolesOf, tasksReady, taskStatus, TASKS,
  TICK_HOURS, type AnyAnswer, type CommanderAnswer, type CommsAnswer, type EngineerAnswer, type Line, type RoleId, type ScienceAnswer,
  type TaskCtx, type TaskNote, type TaskResult,
} from '../../engine';
import { useGame, useMe } from '../../store/game';
import { AutonomyPlanner } from '../AutonomyPlanner';
import { A11yToggles, LeaveRoom, MeChip, Note, ROLE_ICON, TopBar } from '../components/common';
import { Icon } from '../kit/Icon';
import { ModuleIcon } from '../kit/ModuleIcon';
import { useReducedMotion } from '../settings';
import { useT, type Params, type T } from '../../i18n';
import { ModePicker, Radar, ReorderList, SignalMeter, Spectrum, Knob, WiringBoard } from '../tasks/widgets';
import '../tasks/tasks.css';

const S = TASKS;
const pct = (x: number) => Math.round(x * 100);

/** Balance numbers for the «in flight» / «if skipped» texts (src/engine/tasks.ts TASKS). */
const EFFECT_P: Record<RoleId, Params> = {
  commander: { top: S.commander.focus.top, last: S.commander.focus.last },
  engineer: { deadline: S.engineer.overloadDeadline, hull: S.engineer.overloadHull },
  science: { qmin: S.science.qualityMin, rmin: S.science.rateMin, rmax: S.science.rateMax },
  comms: { bmin: pct(S.comms.bandwidthMin), bmax: pct(S.comms.bandwidthMax), loss: pct(S.comms.loss) },
};
const SKIP_P: Record<RoleId, Params> = {
  commander: { focus: S.commander.focus.skip, quality: S.commander.focusQuality.skip, deadline: S.commander.skipDeadline },
  engineer: { sag: S.engineer.skipSag, deadline: S.engineer.overloadDeadline, hull: S.engineer.overloadHull },
  science: { qmin: S.science.qualityMin, rmin: S.science.rateMin },
  comms: { bw: pct(S.comms.bandwidthMin + (S.comms.bandwidthMax - S.comms.bandwidthMin) * S.comms.skipAim), loss: pct(S.comms.loss * (1 - S.comms.skipAim)) },
};

/** A grade note of a task result (TaskNote ids come from the engine). */
function noteText(t: T, n: TaskNote): string {
  const v = n.n ?? {};
  const goal = (id: unknown) => t.m(goalMsg(String(id)));
  const name = (id: unknown) => COMPONENT_BY_ID[String(id)]?.name ?? goal(id);
  const mode = (id: unknown) => t(`tasks.mode.${String(id)}`);
  switch (n.id) {
    case 'goals': case 'sacrifice': case 'aim': case 'bus-small': return t(`tasks.note.${n.id}`, v);
    case 'goal-impossible': return t('tasks.note.goal-impossible', { goal: goal(v.goal) });
    case 'sacrifice-critical': case 'crit-secondary': return t(`tasks.note.${n.id}`, { node: name(v.node) });
    case 'overload': return t('tasks.note.overload', { ...v, line: t(v.line === 'main' ? 'tasks.line.main' : 'tasks.line.secondary') });
    case 'secondary-empty': case 'skipped': return t(`tasks.note.${n.id}`);
    case 'calib-off': return t('tasks.note.calib-off', { ...v, node: name(v.node) });
    case 'mode': return t('tasks.note.mode', { mode: mode(v.mode), best: mode(v.best) });
    case 'queue': return t('tasks.note.queue', { ...v, first: goal(v.first) });
    default: return n.id;
  }
}

// ── Drafts: start from the last answer (if any) merged with the current build ──

const mergeOrder = <T extends string>(prev: T[] | undefined, all: T[]) => [...(prev ?? []).filter((x) => all.includes(x)), ...all.filter((x) => !(prev ?? []).includes(x))];

function initialDraft(role: RoleId, ctx: TaskCtx, prev: AnyAnswer | null | undefined): AnyAnswer {
  if (role === 'commander') {
    const s = commanderSetup(ctx);
    const p = prev as CommanderAnswer | undefined;
    return p ? { goals: mergeOrder(p.goals, s.goals.map((g) => g.id)), sacrifice: mergeOrder(p.sacrifice, s.items.map((i) => i.id)) } : s.initial;
  }
  if (role === 'engineer') {
    const s = engineerSetup(ctx);
    const p = prev as EngineerAnswer | undefined;
    return p ? { lines: Object.fromEntries(s.consumers.map((c) => [c.id, p.lines[c.id] ?? 'main'])) } : s.initial;
  }
  if (role === 'science') {
    const s = scienceSetup(ctx);
    const p = prev as ScienceAnswer | undefined;
    return p ? { knobs: Object.fromEntries(s.instruments.map((i) => [i.id, p.knobs[i.id] ?? i.start])), mode: p.mode } : s.initial;
  }
  const s = commsSetup(ctx);
  const p = prev as CommsAnswer | undefined;
  return p ? { aim: p.aim, queue: mergeOrder(p.queue, s.targets.map((t) => t.id)) } : s.initial;
}

// ── Screen ──

export function Tasks() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const me = useMe();
  const myId = useGame((s) => s.me.id);
  const isHost = room.hostId === myId;
  const mission = MISSIONS[room.mission];
  const ctx = useMemo(() => taskCtx(room), [room.mission, room.build, room.seed, room.agency]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = taskRolesOf(room, myId);
  const ownFirst = [...rolesOf(me).filter((r) => mine.includes(r)), ...mine.filter((r) => !rolesOf(me).includes(r))];
  const [role, setRole] = useState<RoleId | null>(ownFirst[0] ?? null);
  useEffect(() => { if (!role || !mine.includes(role)) setRole(ownFirst[0] ?? null); }, [mine.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drafts, setDrafts] = useState<Partial<Record<RoleId, AnyAnswer>>>({});
  const [plannerOpen, setPlannerOpen] = useState(false);
  const ready = tasksReady(room.tasks, ctx);
  const results = room.tasks?.results ?? {};

  const draftOf = (r: RoleId) => drafts[r] ?? initialDraft(r, ctx, taskStatus(room.tasks, r, ctx) !== 'todo' ? results[r]?.answer : null);
  const setDraft = (r: RoleId, a: AnyAnswer) => setDrafts((d) => ({ ...d, [r]: a }));

  return (
    <div className="scr tk-screen">
      <TopBar icon="act_approve" title={t('tasks.screen')} sub={mission.name}><MeChip /></TopBar>
      <div className="tk-page">
        <TeamStrip ctx={ctx} current={role} onPick={(r) => mine.includes(r) && setRole(r)} mine={mine} />
        {role ? (
          <RoleTask key={`${role}:${ctx.mission}`} role={role} ctx={ctx} draft={draftOf(role)} setDraft={(a) => setDraft(role, a)}
            result={taskStatus(room.tasks, role, ctx) === 'done' ? results[role] ?? null : null}
            stale={taskStatus(room.tasks, role, ctx) === 'stale'}
            onSubmit={(a) => dispatch({ type: 'submitTask', role, answer: a })} />
        ) : <Note level="info">{t('tasks.notYours')}</Note>}

        <HostSkips ctx={ctx} isHost={isHost} />

        <section className={`tk-next panel--night ${ready.ready ? 'is-ready' : ''}`} aria-live="polite">
          <div className="row row--between gap-3">
            <div className="row gap-2">
              <Icon name={ready.ready ? 'st_ok' : 'fl_timer'} size={32} />
              <div>
                <div className="t-h3">{ready.ready ? t('tasks.allDone') : t('tasks.waiting', { n: ready.waiting.length })}</div>
                <div className="t-small t-muted">{t('tasks.next')}</div>
              </div>
            </div>
            <div className="row gap-2">
              {isHost && <button type="button" className="btn btn--secondary" onClick={() => dispatch({ type: 'goStage', stage: 'build' })}><Icon name="dept_structure" size={24} />{t('tasks.toBuild')}</button>}
              <button type="button" className="btn btn--ghost" onClick={() => setPlannerOpen((v) => !v)}><Icon name="fl_rule" size={24} />{plannerOpen ? t('tasks.plannerHide') : t('tasks.plannerShow')}</button>
              <button type="button" className="btn btn--primary btn--lg" disabled={!ready.ready} onClick={() => dispatch({ type: 'submitReview' })} data-testid="tasks-to-review">
                <Icon name="act_approve" size={32} />{t('tasks.toReview')}
              </button>
            </div>
          </div>
          {plannerOpen && <div className="tk-planner"><AutonomyPlanner /></div>}
        </section>
        <div className="panel-foot tk-foot"><A11yToggles /><LeaveRoom /></div>
      </div>
    </div>
  );
}

/** Who has done what: one chip per role (no timer). Click one of your roles to switch to it. */
function TeamStrip({ ctx, current, onPick, mine }: { ctx: TaskCtx; current: RoleId | null; onPick: (r: RoleId) => void; mine: RoleId[] }) {
  const t = useT();
  const room = useGame((s) => s.room)!;
  return (
    <ol className="tk-team" aria-label={t('tasks.team')}>
      {(['commander', 'engineer', 'science', 'comms'] as RoleId[]).map((r) => {
        const st = taskStatus(room.tasks, r, ctx);
        const res = room.tasks?.results[r];
        const holder = holderOf(room.players, r);
        const word = st === 'done' ? (res!.skipped ? t('tasks.status.skipped') : t(`tasks.grade.${res!.grade}`)) : st === 'stale' ? t('tasks.status.stale') : t('tasks.status.todo');
        const tone = st === 'done' ? (res!.skipped || res!.grade === 'weak' ? 'weak' : res!.grade) : st;
        const can = mine.includes(r);
        return (
          <li key={r}>
            <button type="button" className={`tk-team__role tk-team__role--${tone} ${current === r ? 'is-current' : ''}`} disabled={!can} onClick={() => onPick(r)}
              aria-pressed={current === r} data-testid={`tk-team-${r}`}>
              <Icon name={ROLE_ICON[r]} size={32} />
              <span className="tk-team__text">
                <span className="tk-team__name">{t(`role.${r}`)}</span>
                <span className="tk-team__who">{holder?.name ?? (room.demo ? t('tasks.demo') : '—')}{holder && !holder.online ? t('tasks.offline') : ''}</span>
              </span>
              <span className="tk-team__state"><Icon name={st === 'done' ? (tone === 'weak' ? 'st_warn' : 'st_ok') : st === 'stale' ? 'st_warn' : 'fl_timer'} size={20} />{word}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Host: skip the task of a role whose player is offline (the team must not get stuck). */
function HostSkips({ ctx, isHost }: { ctx: TaskCtx; isHost: boolean }) {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  if (!isHost || room.demo) return null;
  const stuck = (['commander', 'engineer', 'science', 'comms'] as RoleId[]).filter((r) => {
    const h = holderOf(room.players, r);
    return h && !h.online && taskStatus(room.tasks, r, ctx) !== 'done';
  });
  if (!stuck.length) return null;
  return (
    <div className="row gap-2">
      {stuck.map((r) => (
        <button key={r} type="button" className="btn btn--secondary btn--sm" onClick={() => dispatch({ type: 'submitTask', role: r, answer: null })}>
          <Icon name="act_skip" size={24} />{t('tasks.hostSkip', { name: holderOf(room.players, r)!.name })}
        </button>
      ))}
    </div>
  );
}

/** One role's task: the mini-game on a cream card, the live consequence and the buttons on the night panel beside it. */
function RoleTask({ role, ctx, draft, setDraft, result, stale, onSubmit }: {
  role: RoleId; ctx: TaskCtx; draft: AnyAnswer; setDraft: (a: AnyAnswer) => void; result: TaskResult | null; stale: boolean; onSubmit: (a: AnyAnswer | null) => void;
}) {
  const t = useT();
  const [askSkip, setAskSkip] = useState(false);
  const changed = !!result && !result.skipped && JSON.stringify(result.answer) !== JSON.stringify(draft);
  const preview = usePreview(role, draft, ctx);
  return (
    <div className="tk-layout">
      <section className={`card card--cream tk-card tk-card--${role}`} aria-labelledby={`tk-title-${role}`}>
        <div className={`card__head card__head--${role}`}>
          <Icon name={ROLE_ICON[role]} size={32} />
          <div className="grow min0">
            <div className="t-eyebrow">{t(`role.${role}`)}</div>
            <h2 className="card__title" id={`tk-title-${role}`}>{t(`tasks.title.${role}`)}</h2>
          </div>
        </div>
        <p className="tk-goal"><Icon name="fl_waypoint" size={24} />{t(`tasks.goal.${role}`)}</p>
        {role === 'commander' && <CommanderTask ctx={ctx} draft={draft as CommanderAnswer} setDraft={setDraft} />}
        {role === 'engineer' && <EngineerTask ctx={ctx} draft={draft as EngineerAnswer} setDraft={setDraft} />}
        {role === 'science' && <ScienceTask ctx={ctx} draft={draft as ScienceAnswer} setDraft={setDraft} />}
        {role === 'comms' && <CommsTask ctx={ctx} draft={draft as CommsAnswer} setDraft={setDraft} />}
      </section>

      <aside className="panel--night tk-side">
        <div className="tk-preview" aria-live="polite">
          <div className="t-eyebrow t-muted">{t('tasks.preview')}</div>
          <div className="tk-preview__line" data-testid="tk-preview">{preview}</div>
        </div>
        <div className="tk-effect"><div className="t-eyebrow t-muted">{t('tasks.inFlight')}</div><p className="t-small">{t(`tasks.effect.${role}`, EFFECT_P[role])}</p></div>
        {stale && <Note level="warn">{t('tasks.status.stale')}.</Note>}
        {result && <ResultCard result={result} />}
        {changed && <Note level="info">{t('tasks.changed')}</Note>}
        {askSkip ? (
          <div className="tk-skip">
            <Note level="warn">{t('tasks.skipWarn')} {t(`tasks.skip.${role}`, SKIP_P[role])}</Note>
            <div className="row gap-2">
              <button type="button" className="btn btn--danger" onClick={() => { setAskSkip(false); onSubmit(null); }}>{t('tasks.skipSure')}</button>
              <button type="button" className="btn btn--ghost" onClick={() => setAskSkip(false)}>{t('tasks.cancel')}</button>
            </div>
          </div>
        ) : (
          <div className="tk-actions">
            <button type="button" className="btn btn--primary btn--lg" onClick={() => onSubmit(draft)} data-testid="tk-done">
              <Icon name="act_approve" size={32} />{result && !result.skipped ? t('tasks.redo') : t('tasks.done')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setAskSkip(true)} data-testid="tk-skip"><Icon name="act_skip" size={24} />{t('tasks.skipBtn')}</button>
          </div>
        )}
      </aside>
    </div>
  );
}

function ResultCard({ result }: { result: TaskResult }) {
  const t = useT();
  const tone = result.skipped || result.grade === 'weak' ? 'weak' : result.grade;
  return (
    <div className={`tk-result tk-result--${tone}`} data-testid="tk-result">
      <div className="row gap-2"><Icon name={tone === 'weak' ? 'st_warn' : 'st_ok'} size={32} /><div><div className="t-eyebrow">{t('tasks.result')}</div>
        <div className="tk-result__grade">{t(`tasks.grade.${result.grade}`)}{!result.skipped && <small className="t-mono"> · {pct(result.score)} %</small>}</div></div></div>
      <ul className="tk-result__notes">{result.notes.map((n, i) => <li key={i}>{noteText(t, n)}</li>)}</ul>
    </div>
  );
}

function usePreview(role: RoleId, draft: AnyAnswer, ctx: TaskCtx): ReactNode {
  const t = useT();
  return useMemo(() => {
    if (role === 'commander') {
      const p = previewCommander(draft as CommanderAnswer, ctx);
      return t('tasks.pv.commander', { main: p.main.map((g) => t.m(goalMsg(g))).join(t('common.and')) || '—', first: (p.first[0] ? COMPONENT_BY_ID[p.first[0]]?.name ?? p.first[0] : '') || '—' });
    }
    if (role === 'engineer') {
      const p = previewEngineer(draft as EngineerAnswer, ctx);
      return <span className={p.over > 0 ? 't-warn' : ''}>{t('tasks.pv.engineer', { m: p.main, mc: p.caps.main, s: p.secondary, sc: p.caps.secondary, over: p.over > 0 ? { k: 'tasks.pv.over', p: { n: p.over } } : { k: 'tasks.pv.noOver' } })}</span>;
    }
    if (role === 'science') {
      const p = previewScience(draft as ScienceAnswer, ctx);
      return t('tasks.pv.science', { q: pct(p.quality), d: p.dataPct === 0 ? { k: 'tasks.pv.dataSame' } : { k: 'tasks.pv.data', p: { v: `${p.dataPct > 0 ? '+' : ''}${p.dataPct}` } }, h: p.heatDelta === 0 ? { k: 'tasks.pv.heatSame' } : { k: 'tasks.pv.heat', p: { v: `${p.heatDelta > 0 ? '+' : ''}${p.heatDelta}` } } });
    }
    const p = previewComms(draft as CommsAnswer, ctx);
    const bw = computeStats(ctx.build, MISSIONS[ctx.mission], ctx.mods).bandwidth;
    return t('tasks.pv.comms', { p: pct(p.bandwidth), u: Math.round(bw * TICK_HOURS * p.bandwidth * 100) / 100 });
  }, [role, draft, ctx, t]);
}

// ── Commander ──

function CommanderTask({ ctx, draft, setDraft }: { ctx: TaskCtx; draft: CommanderAnswer; setDraft: (a: CommanderAnswer) => void }) {
  const t = useT();
  const s = useMemo(() => commanderSetup(ctx), [ctx]);
  const goalItems = s.goals.map((g) => ({
    id: g.id, tone: g.possible ? undefined : ('muted' as const),
    body: (
      <span className="tk-goalrow">
        <b>{t.m(goalMsg(g.id))}</b>
        <span className="tk-stars" title={t('tasks.valueHint')} aria-label={`${t('tasks.valueHint')}: ${g.value}`}>{'★'.repeat(g.value)}<i>{'★'.repeat(4 - g.value)}</i></span>
        <span className="tk-goalrow__sys">
          {g.possible ? g.systems.map((id) => <ModuleIcon key={id} id={id} mission={ctx.mission} size={24} title={COMPONENT_BY_ID[id]?.name} />) : <span className="chip chip--sm chip--warn"><Icon name="st_warn" size={20} />{t('tasks.impossible')}</span>}
        </span>
      </span>
    ),
  }));
  const sacItems = s.items.map((i) => ({
    id: i.id,
    body: (
      <span className="tk-sacrow">
        <ModuleIcon id={i.id} mission={ctx.mission} size={24} />
        <b className="min0">{COMPONENT_BY_ID[i.id]?.name ?? i.id}</b>
        <span className="t-mono t-small">{i.watts} W</span>
        {i.goals.length > 0 && <span className="tk-sacrow__goals t-small">{t('tasks.serves')}: {i.goals.map((g) => t.m(goalMsg(g))).join(', ')}</span>}
      </span>
    ),
  }));
  return (
    <div className="tk-cmd">
      <div>
        <h3 className="t-h3 tk-sub">{t('tasks.goalsTitle')}</h3>
        <ReorderList items={goalItems} order={draft.goals} onChange={(goals) => setDraft({ ...draft, goals })} label={t('tasks.goalsTitle')} testId="tk-goals" />
      </div>
      <div>
        <h3 className="t-h3 tk-sub">{t('tasks.sacrificeTitle')}</h3>
        <ReorderList items={sacItems} order={draft.sacrifice} onChange={(sacrifice) => setDraft({ ...draft, sacrifice })} label={t('tasks.sacrificeTitle')} testId="tk-sacrifice" />
        {s.locked.length > 0 && <p className="t-small tk-locked"><Icon name="st_locked" size={20} />{t('tasks.locked')} {s.locked.map((l) => COMPONENT_BY_ID[l.id]?.name ?? l.id).join(', ')}</p>}
      </div>
    </div>
  );
}

// ── Engineer ──

function EngineerTask({ ctx, draft, setDraft }: { ctx: TaskCtx; draft: EngineerAnswer; setDraft: (a: EngineerAnswer) => void }) {
  const t = useT();
  const s = useMemo(() => engineerSetup(ctx), [ctx]);
  const loads = lineLoads(s, draft.lines);
  const nodes = s.consumers.map((c) => ({
    id: c.id, name: COMPONENT_BY_ID[c.id]?.name ?? c.id, watts: c.watts,
    tag: c.priority > 2 && c.mustMain ? t('tasks.tagMission') : t(`tasks.tag.${Math.min(3, c.priority)}`),
    tagTone: c.priority <= 1 ? ('crit' as const) : c.priority === 2 || c.mustMain ? ('warn' as const) : ('muted' as const),
    icon: <ModuleIcon id={c.id} mission={ctx.mission} size={24} />,
  }));
  return (
    <WiringBoard nodes={nodes} lines={draft.lines} caps={s.caps} loads={loads} frame={s.frame}
      onAssign={(id: string, line: Line) => setDraft({ lines: { ...draft.lines, [id]: line } })} />
  );
}

// ── Science ──

function ScienceTask({ ctx, draft, setDraft }: { ctx: TaskCtx; draft: ScienceAnswer; setDraft: (a: ScienceAnswer) => void }) {
  const t = useT();
  const s = useMemo(() => scienceSetup(ctx), [ctx]);
  const [reducedMotion] = useReducedMotion();
  const [cur, setCur] = useState(s.instruments[0]?.id ?? null);
  const inst = s.instruments.find((i) => i.id === cur) ?? s.instruments[0];
  const sp = SPECTRA[ctx.mission];
  return (
    <div className="tk-sci">
      {inst ? (
        <>
          <div className="seg seg--block tk-sci__tabs" role="tablist" aria-label={t('tasks.instrument')}>
            {s.instruments.map((i) => (
              <button key={i.id} type="button" role="tab" aria-selected={i.id === inst.id} aria-pressed={i.id === inst.id} className="seg__item" onClick={() => setCur(i.id)}>
                <ModuleIcon id={i.id} mission={ctx.mission} size={20} />{COMPONENT_BY_ID[i.id]?.name ?? i.id}
              </button>
            ))}
          </div>
          <div className="tk-sci__bench">
            <div className="tk-sci__plot">
              <Spectrum bands={sp.bands} shift={(draft.knobs[inst.id] ?? inst.start) - inst.peak} noise={sp.noise} animate={!reducedMotion} label={`${COMPONENT_BY_ID[inst.id]?.name}: ${t('tasks.match')}`} />
              <div className="t-small t-muted">{t('tasks.match')}</div>
            </div>
            <Knob value={draft.knobs[inst.id] ?? inst.start} onChange={(v) => setDraft({ ...draft, knobs: { ...draft.knobs, [inst.id]: v } })} label={`${t('tasks.instrument')}: ${COMPONENT_BY_ID[inst.id]?.name}`} />
          </div>
        </>
      ) : null}
      <h3 className="t-h3 tk-sub">{t('tasks.modeTitle')}</h3>
      <ModePicker modes={s.modes} value={draft.mode} onChange={(mode) => setDraft({ ...draft, mode })} />
    </div>
  );
}

// ── Comms ──

function CommsTask({ ctx, draft, setDraft }: { ctx: TaskCtx; draft: CommsAnswer; setDraft: (a: CommsAnswer) => void }) {
  const t = useT();
  const s = useMemo(() => commsSetup(ctx), [ctx]);
  const [reducedMotion] = useReducedMotion();
  const strength = signalAt(draft.aim, s.earth, s.beam);
  const items = s.targets.map((tg) => ({
    id: tg.id, tone: tg.possible ? undefined : ('muted' as const),
    body: <span className="tk-goalrow"><Icon name="res_data" size={20} /><b>{t.m(goalMsg(tg.id))}</b>{!tg.possible && <span className="chip chip--sm chip--warn">{t('tasks.noSource')}</span>}</span>,
  }));
  return (
    <div className="tk-comms">
      <div className="tk-comms__aim">
        <Radar earth={s.earth} aim={draft.aim} beam={s.beam} noise={s.noise} onAim={(aim) => setDraft({ ...draft, aim })} animate={!reducedMotion} label={t('tasks.title.comms')} />
        <SignalMeter strength={strength} noise={s.noise} animate={!reducedMotion} />
      </div>
      <div>
        <h3 className="t-h3 tk-sub">{t('tasks.queueTitle')}</h3>
        <ReorderList items={items} order={draft.queue} onChange={(queue) => setDraft({ ...draft, queue: queue as CommsAnswer['queue'] })} label={t('tasks.queueTitle')} testId="tk-queue" />
      </div>
    </div>
  );
}
