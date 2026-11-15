// The task widgets again, in flight (the P2 mini-games of the TZ, decision 0013 §1):
// comms re-aims the antenna after a blackout (radar), the engineer isolates a node in Power Drop (schematic),
// science lowers the measurement intensity in Overheat (mode picker). Small, inside the existing Flight / crisis UI.
// Plus the report card: each task's grade and what it did in the flight.
import { useMemo, useState } from 'react';
import {
  COMPONENT_BY_ID, engineerSetup, goalMsg, isolateCandidates, MISSIONS, scienceSetup, signalAt, taskCtx, TASKS,
  type FlightState, type MeasureMode, type MissionReport, type RoleId, type TaskNote,
} from '../../engine';
import { useT, type T } from '../../i18n';
import { useGame } from '../../store/game';
import { ROLE_ICON } from '../components/common';
import { Icon } from '../kit/Icon';
import { ModuleIcon } from '../kit/ModuleIcon';
import { useReducedMotion } from '../settings';
import { ModePicker, Radar, SignalMeter, WiringBoard } from './widgets';
import './tasks.css';

const MODE_IDS = new Set(['cautious', 'normal', 'intensive']);

/** What a task did in the flight (TaskNote from the engine → one sentence). */
function taskEffect(t: T, n: TaskNote): string {
  const v = n.n ?? {};
  const list = (s: unknown) => String(s ?? '').split(',').filter(Boolean).map((id) => COMPONENT_BY_ID[id]?.name ?? t.m(goalMsg(id))).join(', ');
  switch (n.id) {
    case 'main-goals': return t('ftask.e.main-goals', { list: list(v.goals) });
    case 'emergency': return t('ftask.e.emergency', { list: list(v.nodes) });
    case 'slower': return t('ftask.e.slower', { sec: v.sec });
    case 'secondary': return v.nodes ? t('ftask.e.secondary', { list: list(v.nodes) }) : t('ftask.e.secondaryEmpty');
    case 'harsh': return t('ftask.e.harsh', { sec: v.sec, hull: v.hull ? { k: 'ftask.e.harshHull', p: { n: v.hull } } : '' });
    case 'isolated': return t('ftask.e.isolated', { list: list(v.nodes) });
    case 'quality': return t('ftask.e.quality', { pct: v.pct });
    case 'mode': return t('ftask.e.mode', {
      mode: MODE_IDS.has(String(v.mode)) ? t(`ftask.mode.${v.mode}`) : String(v.mode),
      data: Number(v.data) ? { k: 'ftask.e.modeData', p: { d: `${Number(v.data) > 0 ? '+' : ''}${v.data}` } } : '',
    });
    case 'bandwidth': return t('ftask.e.bandwidth', { pct: v.pct, lost: Number(v.lost) > 0 ? { k: 'ftask.e.bandwidthLost', p: { n: v.lost } } : '' });
    case 'reaim': return t('ftask.e.reaim', { drops: v.drops, reaims: v.reaims });
    case 'evicted': return t('ftask.e.evicted', { units: v.units });
    default: return n.id;
  }
}

/** Comms, after a blackout: re-aim on a small radar (side panel card). */
export function ReaimCard({ f, role }: { f: FlightState; role: RoleId | null }) {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const [reducedMotion] = useReducedMotion();
  const [aim, setAim] = useState({ x: 0, y: 0 });
  const tk = f.tasks;
  if (role !== 'comms' || !tk?.reaim || f.signal === 'lost') return null;
  const noise = TASKS.comms.noise[f.mission];
  const auto = Math.max(0, tk.aimUntil - f.tick);
  const pctOf = (acc: number) => Math.round((TASKS.comms.bandwidthMin + (TASKS.comms.bandwidthMax - TASKS.comms.bandwidthMin) * acc) * 100);
  const bw = pctOf(tk.aim);
  return (
    <div className="card card--cream tk-fly-card" data-testid="tk-reaim">
      <div className="card__head card__head--comms"><Icon name="res_signal" size={32} /><div className="grow min0"><div className="card__title">{t('ftask.reaimTitle')}</div></div></div>
      <p className="t-small">{t('ftask.reaimText', { auto })}</p>
      <Radar earth={tk.reaim} aim={aim} beam={tk.beam} noise={noise} onAim={setAim} animate={!reducedMotion} label={t('ftask.reaimTitle')} size={200} />
      <SignalMeter strength={signalAt(aim, tk.reaim, tk.beam)} noise={noise} animate={!reducedMotion} />
      <div className="t-small t-muted">{t('ftask.reaimNow', { pct: bw, max: pctOf(tk.aimBase) })}</div>
      <button type="button" className="btn btn--primary btn--block" onClick={() => dispatch({ type: 'reaimAntenna', x: aim.x, y: aim.y })}><Icon name="act_approve" size={24} />{t('ftask.reaimBtn')}</button>
    </div>
  );
}

/** Crisis options the widget answers (hidden from the plain option list). */
export const widgetOption = (f: FlightState, role: RoleId | null, id: string) => !!f.tasks && role === 'science' && f.crisis?.kind === 'overheat' && id.startsWith('oh_intensity_');

/** Inside the crisis card: the engineer's schematic in Power Drop, the science mode picker in Overheat. */
export function CrisisTaskWidget({ f, role, chosen }: { f: FlightState; role: RoleId | null; chosen: string | null }) {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const ctx = useMemo(() => taskCtx(room), [room.mission, room.build, room.seed, room.agency]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = f.crisis;
  if (!c || !role) return null;

  if (role === 'engineer' && c.kind === 'power_drop') {
    const cand = isolateCandidates(f, room.build);
    const caps = engineerSetup(ctx).caps;
    const lines = Object.fromEntries(cand.map((x) => [x.id, x.line]));
    const loads = {
      main: cand.filter((x) => x.on && x.line === 'main').reduce((s, x) => s + x.watts, 0) + MISSIONS[room.mission].baseLoad,
      secondary: cand.filter((x) => x.on && x.line === 'secondary').reduce((s, x) => s + x.watts, 0),
    };
    const picked = chosen === 'pd_isolate' ? c.options.find((o) => o.id === 'pd_isolate')?.nodeIds?.[0] ?? null : null;
    return (
      <div className="tk-fly" data-testid="tk-isolate">
        <div className="row gap-2"><Icon name="dept_power" size={24} /><b>{t('ftask.isolateTitle')}</b></div>
        <WiringBoard compact selectable={false} nodes={cand.map((x) => ({ id: x.id, name: COMPONENT_BY_ID[x.id]?.name ?? x.id, watts: x.watts, on: x.on, tag: '', icon: <ModuleIcon id={x.id} mission={room.mission} size={20} /> }))}
          lines={lines} caps={caps} loads={loads} picked={picked} onPick={(id) => !chosen && dispatch({ type: 'isolateNode', node: id })} />
        <div className="t-small t-muted">{t('ftask.isolateHint')}</div>
      </div>
    );
  }

  if (role === 'science' && c.kind === 'overheat' && f.tasks) {
    const opts = c.options.filter((o) => o.id.startsWith('oh_intensity_'));
    if (!opts.length) return null;
    const only = opts.map((o) => o.id.slice('oh_intensity_'.length) as MeasureMode);
    const value = chosen?.startsWith('oh_intensity_') ? (chosen.slice('oh_intensity_'.length) as MeasureMode) : f.tasks.mode;
    return (
      <div className="tk-fly" data-testid="tk-intensity">
        <div className="row gap-2"><Icon name="res_heat" size={24} /><b>{t('ftask.intensityTitle')}</b></div>
        <ModePicker modes={scienceSetup(ctx).modes} value={value} only={chosen ? [] : only} disabled={!!chosen}
          onChange={(m) => dispatch({ type: 'crisisChoice', optionId: `oh_intensity_${m}` })} />
        <div className="t-small t-muted">{t('ftask.intensityHint')}</div>
      </div>
    );
  }
  return null;
}

/** Mission Report: each task's grade and what it did in the flight. */
export function TaskReportCard({ report }: { report: MissionReport }) {
  const t = useT();
  if (!report.tasks?.length) return null;
  return (
    <section className="card card--cream" data-testid="tk-report">
      <div className="card__head card__head--gold"><Icon name="act_approve" size={32} /><div className="card__title">{t('ftask.reportTitle')}</div></div>
      <div className="tk-report">
        {report.tasks.map((tr) => (
          <div key={tr.role} className="tk-report__role">
            <div className="row gap-2"><Icon name={ROLE_ICON[tr.role]} size={24} /><b>{t('role.' + tr.role)}</b></div>
            <div className={`tk-report__grade tk-report__grade--${tr.grade}`}>{t('ftask.grade.' + tr.grade)}{tr.skipped ? ` · ${t('ftask.skipped')}` : ` · ${tr.score} %`}</div>
            <ul>{tr.effects.map((e, i) => <li key={i}>{taskEffect(t, e)}</li>)}</ul>
          </div>
        ))}
      </div>
    </section>
  );
}
