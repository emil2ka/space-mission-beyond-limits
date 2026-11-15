// Mission Report: 3D replay of the key moments (docs/03 Design/Mission Report.md, «Итог крупно + 3D-повтор»).
// Chapters: Запуск (LaunchScene, short) → Главный кризис → Финал (Titan: the last waypoint / landing; asteroid: the capsule).
// Snapshot chapters drive the same pure scenes as the flight from report.replay (src/engine/replay.ts), interpolated
// between frames; the scenes smooth the rest. No replay in the report (old flights) → renders nothing.
import { useEffect, useMemo, useRef, useState } from 'react';
import { MISSIONS, OUTCOME_NAMES, WAYPOINT_DEFS, type Build, type FlightState, type MissionId, type MissionReport, type ReplayFrame, type ReplayWindow } from '../../engine';
import { AsteroidScene } from '../../scene/AsteroidScene';
import { LaunchScene } from '../../scene/LaunchScene';
import { ReturnScene } from '../../scene/ReturnScene';
import { TitanScene } from '../../scene/TitanScene';
import { T as LAUNCH_T } from '../../scene/flight/launchTimeline';
import { useGraphicsQuality } from '../graphics';
import { useReducedMotion } from '../settings';
import { useT, type T } from '../../i18n';
import { mmss } from './common';
import { Icon } from '../kit/Icon';
import './ReportReplay.css';

/** Launch chapter starts on the last second of the countdown (arms swing away → ignition → liftoff → reveal). */
const LAUNCH_FROM = LAUNCH_T.arms;
const LAUNCH_LEN = LAUNCH_T.end - LAUNCH_FROM;
/** Target length of a snapshot chapter, seconds (playback speed adapts to the window). */
const CHAPTER_S = 8;
/** UI update rate of the replay cursor (scenes interpolate between updates themselves). */
const STEP_MS = 100;
/** Pause on the last frame before the next chapter, seconds. */
const HOLD_S = 1.2;
/** The finale holds longer on its last frame (landing / capsule found) before the outcome card. */
const HOLD_FINAL_S = 3;

const SIGNAL: Record<ReplayFrame['sg'], FlightState['signal']> = { o: 'ok', d: 'delay', i: 'interference', l: 'lost' };
const ROUTE: Record<NonNullable<ReplayFrame['rt']>, FlightState['route']> = { f: 'flying', l: 'landed', s: 'stopped' };
/** Capsule stage words: dictionary keys replay.capsule.<stage>. */
const capsuleName = (t: T, cp: NonNullable<ReplayFrame['cp']>) => t(`replay.capsule.${cp}`);

type SceneKind = 'launch' | 'titan' | 'asteroid' | 'return';
interface Chapter { kind: ReplayWindow['kind']; label: string; caption: string; tick: number; win: ReplayWindow; scene: SceneKind; span: number; speed: number }

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Frame pair around `t` (ticks) and the blend between them. */
function at(w: ReplayWindow, t: number): { a: ReplayFrame; b: ReplayFrame; k: number } {
  const fr = w.frames;
  if (t <= fr[0].t) return { a: fr[0], b: fr[0], k: 0 };
  for (let i = 1; i < fr.length; i++) {
    if (t <= fr[i].t) return { a: fr[i - 1], b: fr[i], k: (t - fr[i - 1].t) / Math.max(1, fr[i].t - fr[i - 1].t) };
  }
  const last = fr[fr.length - 1];
  return { a: last, b: last, k: 0 };
}

function sceneOf(mission: MissionId, f: ReplayFrame): SceneKind {
  if (mission === 'titan') return 'titan';
  return f.cp && f.cp !== 'stowed' ? 'return' : 'asteroid';
}

function chaptersOf(t: T, r: MissionReport, mission: MissionId): Chapter[] {
  const rep = r.replay;
  if (!rep?.windows.length) return [];
  return rep.windows.map((w) => {
    const first = w.frames[0], last = w.frames[w.frames.length - 1];
    const span = Math.max(1, last.t - first.t);
    const h = r.highlights.find((x) => x.kind === w.kind && (w.kind !== 'crisis' || x.tick === w.tick));
    const trigger = w.frames.find((f) => f.t >= w.tick) ?? first;
    const scene: SceneKind = w.kind === 'launch' ? 'launch' : sceneOf(mission, w.kind === 'final' ? last : trigger);
    const label = w.kind === 'launch' ? t('replay.launch') : w.kind === 'crisis' ? t('replay.mainCrisis') : t('replay.final');
    const caption = w.kind === 'crisis' ? (h ? t.f(h, 'text').replace(/ — (главный кризис|main crisis)$/i, '') : t('replay.crisis'))
      : w.kind === 'final' ? finalCaption(t, mission, w, trigger, last, r.ticks)
        : t('replay.rocketStart');
    const secs = w.kind === 'final' && scene === 'return' ? CHAPTER_S + 2 : CHAPTER_S;
    return { kind: w.kind, label, caption, tick: w.kind === 'final' ? r.ticks : w.tick, win: w, scene, span, speed: Math.max(2, span / secs) };
  });
}

function finalCaption(t: T, mission: MissionId, w: ReplayWindow, trigger: ReplayFrame, last: ReplayFrame, ticks: number): string {
  if (mission !== 'titan') return last.cp ? t('replay.capsule', { stage: capsuleName(t, last.cp) }) : t('replay.flightEnd');
  // Titan: the window opens on a waypoint arrival; without one it is the end of the flight.
  if (w.tick >= ticks) return t('replay.flightEnd');
  const wp = WAYPOINT_DEFS[trigger.wi ?? 0];
  const name = wp ? t.f(wp, 'name') : t('replay.lastPoint');
  return t(last.rt === 'l' ? 'replay.landing' : 'replay.arrival', { name });
}

export function ReportReplay({ report, build, mission }: { report: MissionReport; build: Build; mission: MissionId }) {
  const t = useT();
  const chapters = useMemo(() => chaptersOf(t, report, mission), [t, report, mission]);
  const [reducedMotion] = useReducedMotion();
  const quality = useGraphicsQuality();
  const [idx, setIdx] = useState(0);
  const [cursor, setCursor] = useState(0); // seconds into the chapter
  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [launchRun, setLaunchRun] = useState(0); // remounts the launch scene (restart)
  const [inView, setInView] = useState(true);
  const box = useRef<HTMLElement>(null);
  const ch = chapters[idx];

  // Off screen (the team reads the chains below): pause and unmount the canvas.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [skipped]);

  const len = ch ? (ch.scene === 'launch' ? LAUNCH_LEN : ch.span / ch.speed) : 0;
  const go = (i: number) => {
    if (i >= chapters.length) { setEnded(true); setPlaying(false); return; }
    setEnded(false);
    setIdx(Math.max(0, i));
    setCursor(0);
    if (chapters[Math.max(0, i)]?.scene === 'launch') setLaunchRun((n) => n + 1);
  };

  // Playback clock. The launch scene runs its own timeline; the clock only tracks it for the progress bar.
  const running = !!ch && !skipped && !ended && inView && (playing || ch.scene === 'launch');
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setCursor((c) => c + STEP_MS / 1000), STEP_MS);
    return () => clearInterval(id);
  }, [running, idx]);
  useEffect(() => {
    if (!ch || ch.scene === 'launch' || !playing) return;
    if (cursor >= len + (ch.kind === 'final' ? HOLD_FINAL_S : HOLD_S)) go(idx + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  if (!chapters.length || !ch) return null;

  if (skipped) {
    return (
      <div className="rr-collapsed row gap-3">
        <button className="btn btn--primary btn--sm" onClick={() => { setSkipped(false); setPlaying(true); go(0); }} data-testid="replay-open"><Icon name="act_play" size={20} />{t('replay.open')}</button>
        <span className="t-small t-muted">{chapters.map((c) => c.label).join(' → ')}</span>
      </div>
    );
  }

  const t0 = ch.win.frames[0].t;
  const tick = ch.scene === 'launch' ? 0 : Math.min(t0 + ch.span, t0 + cursor * ch.speed);
  const progress = ended ? 1 : Math.min(1, cursor / Math.max(0.1, len));
  const now = ch.scene === 'launch' ? null : at(ch.win, tick);
  const phaseName = now ? t.d(MISSIONS[mission].phases[now.a.ph]?.name ?? '') : t('replay.start');
  // The capsule finale follows the stage on screen (the chapter caption would give the ending away).
  const caption = ch.scene === 'return' && now ? t('replay.capsule', { stage: capsuleName(t, (now.k < 0.5 ? now.a : now.b).cp ?? 'stowed') }) : ch.caption;
  const prev = () => { if (cursor > 1.5 && !ended) go(idx); else go(ended ? chapters.length - 1 : idx - 1); };
  const toggle = () => {
    if (ended) { setPlaying(true); go(0); return; }
    if (ch.scene === 'launch' && !playing) { setPlaying(true); go(idx); return; }
    setPlaying(!playing);
  };

  const kitOutcome = report.outcome === 'failed' ? 'outcome--fail' : report.outcome === 'partial' ? 'outcome--partial' : report.outcome === 'perfect' ? 'outcome--perfect' : '';
  return (
    <section ref={box} className={`rr${reducedMotion ? ' rr-calm' : ''}`} data-testid="report-replay" aria-label={t('replay.aria')}>
      <div className={`viewport viewport--scene viewport--wide rr-stage ${mission === 'titan' ? 'viewport--titan' : ''}`}>
        <div className="viewport__canvas">
          {inView && !ended && (
            ch.scene === 'launch'
              ? <LaunchScene key={`launch-${launchRun}`} build={build} mission={mission} reducedMotion={reducedMotion} quality={quality}
                skippable={false} startAt={LAUNCH_FROM} onDone={() => { if (playing) go(idx + 1); }} />
              : <SnapshotScene key={`${idx}-${ch.scene}`} ch={ch} tick={tick} build={build} mission={mission} reducedMotion={reducedMotion} quality={quality} />
          )}
        </div>
        {!ended && (
          <div className="viewport__hud">
            <div className="hud-row">
              <span className={`chip ${ch.kind === 'crisis' ? 'chip--crit' : 'chip--info'}`}>
                <Icon name={ch.kind === 'crisis' ? 'fl_crisis' : ch.kind === 'launch' ? 'act_launch' : 'fl_capsule'} size={24} /><b>{idx + 1}/{chapters.length}</b> {ch.label}
              </span>
            </div>
            <div className="hud-row">
              <span className="chip chip--hud rr-caption" data-testid="replay-caption">
                <Icon name="fl_timer" size={24} /><span className="t-mono">T+{mmss(ch.scene === 'launch' ? 0 : tick)}</span> <span className="chip__ellipsis">{caption}</span>
                <span className="chip__dim">{phaseName}</span>
              </span>
            </div>
          </div>
        )}
        {ended && (
          <div className="rr-end" data-testid="replay-end">
            <div className="t-eyebrow">{t('report.outcome')}</div>
            <div className={`outcome ${kitOutcome}`}>{t.d(OUTCOME_NAMES[report.outcome])}</div>
            <div className="score score--night"><b>{report.score}</b><span>/ 100</span></div>
            <button className="btn btn--secondary btn--sm" onClick={() => { setPlaying(true); go(0); }}><Icon name="act_replay" size={20} />{t('replay.again')}</button>
          </div>
        )}
      </div>
      <div className="replay-bar">
        <div className="player-ctrl">
          <button className="btn btn--secondary btn--sm btn--icon" onClick={prev} aria-label={t('replay.prev')} title={t('replay.prevTitle')}><Icon name="act_replay" size={24} /></button>
          <button className="btn btn--primary btn--icon" onClick={toggle} aria-label={playing && !ended ? t('replay.pause') : t('replay.watch')} data-testid="replay-play">
            <Icon name={playing && !ended ? 'act_pause' : 'act_play'} size={32} />
          </button>
          <button className="btn btn--secondary btn--sm btn--icon" onClick={() => go(idx + 1)} aria-label={t('replay.next')} title={t('replay.next')} data-testid="replay-next"><Icon name="act_skip" size={24} /></button>
        </div>
        <div className="chapters" style={{ gridTemplateColumns: `repeat(${chapters.length}, minmax(0, 1fr))` }}>
          {chapters.map((c, i) => {
            const k = ended || i < idx ? 1 : i === idx ? progress : 0;
            return (
              <button key={i} type="button" className={`chapter chapter--${c.kind} ${i < idx || ended ? 'is-done' : ''} ${i === idx && !ended ? 'is-current' : ''}`} onClick={() => { setPlaying(true); go(i); }} title={c.caption}>
                <span className="chapter__bar"><i style={{ width: `${k * 100}%` }} /></span>
                <span className="chapter__label">{c.label}</span>
              </button>
            );
          })}
        </div>
        <button className="btn btn--ghost btn--sm rr-skip" onClick={() => setSkipped(true)} data-testid="replay-skip">{t('replay.skip')}</button>
      </div>
    </section>
  );
}

/** Titan / asteroid / capsule scene at a (fractional) replay tick. */
function SnapshotScene({ ch, tick, build, mission, reducedMotion, quality }: {
  ch: Chapter; tick: number; build: Build; mission: MissionId; reducedMotion: boolean; quality: ReturnType<typeof useGraphicsQuality>;
}) {
  const { a, b, k } = at(ch.win, tick);
  const near = k < 0.5 ? a : b;
  const w = ch.win;
  const off = w.offs[near.o ?? 0] ?? [];
  const cr = near.c ? w.crises[near.c - 1] : null;
  const crisis = cr ? { kind: cr.kind, nodeIds: cr.nodeIds } : null;
  const signal = SIGNAL[near.sg];
  const phaseId = MISSIONS[mission].phases[near.ph]?.id ?? 'cruise';

  if (ch.scene === 'titan') {
    const sameLeg = a.wi === b.wi;
    const wi = sameLeg ? a.wi ?? 0 : near.wi ?? 0;
    const wp = sameLeg ? lerp(a.wp ?? 0, b.wp ?? 0, k) : near.wp ?? 0;
    return (
      <TitanScene build={build} phaseId={phaseId} waypointIndex={wi} waypointProgress={wp} route={ROUTE[near.rt ?? 'f']}
        crisis={crisis} offIds={off} signal={signal} role={null} reducedMotion={reducedMotion} quality={quality} storm={!!near.st} />
    );
  }
  if (ch.scene === 'return') {
    const cp = near.cp ?? 'stowed';
    const cq = a.cp === b.cp ? lerp(a.cq ?? 0, b.cq ?? 0, k) : near.cq ?? 0;
    const beacon = (build.recovery_beacon ?? 0) > 0 && !off.includes('recovery_beacon');
    return <ReturnScene build={build} capsule={cp} capsuleProgress={cq} beacon={beacon} reducedMotion={reducedMotion} quality={quality} />;
  }
  return (
    <AsteroidScene build={build} phaseId={phaseId} approach={lerp(a.ap ?? 0, b.ap ?? 0, k)} site={near.si ?? null} sampling={near.sm ?? 'idle'}
      sampleSealed={!!near.sl} crisis={crisis} debris={!!near.db} offIds={off} signal={signal} reducedMotion={reducedMotion} quality={quality} />
  );
}
