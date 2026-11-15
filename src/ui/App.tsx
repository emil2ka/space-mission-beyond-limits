import { lazy, Suspense, useEffect } from 'react';
import { electHost, HOST_TIMEOUT_MS, rolesOf } from '../engine';
import { RulesToasts } from './rules/RulesToasts';
import { useGame } from '../store/game';
import { Home } from './screens/Home';
import { Lobby, presenceLabel, useNow } from './screens/Lobby';
import { Briefing } from './screens/Briefing';
import { roleName } from './components/common';
import { HQ, Prep } from './screens/HQ';
import { useView } from './view';
import { startAudio } from '../audio';
import { SoundSettings } from './components/SoundSettings';
import { AiNotice } from './components/AiNotice';
import { Icon } from './kit/Icon';
import { useSettings } from './settings';
import { Tasks } from './screens/Tasks';
import { useT } from '../i18n';

// Device QA: the 3D screens (three.js + R3F + drei ≈ 1 MB) are separate chunks, so the home screen loads fast on a
// slow network. They start downloading as soon as a room exists (lobby), long before the build stage needs them.
const loadConstructor = () => import('./screens/Constructor');
const loadReview = () => import('./screens/Review');
const loadFlight = () => import('./screens/Flight');
const loadReport = () => import('./screens/Report');
const Constructor = lazy(() => loadConstructor().then((m) => ({ default: m.Constructor })));
const Review = lazy(() => loadReview().then((m) => ({ default: m.Review })));
const Flight = lazy(() => loadFlight().then((m) => ({ default: m.Flight })));
const Report = lazy(() => loadReport().then((m) => ({ default: m.Report })));

function ScreenLoading() {
  const t = useT();
  return <div className="page page--center" role="status" aria-live="polite"><span className="t-small">{t('app.loading')}</span></div>;
}

/** Outside the lobby: who lost connection («Reconnecting… N с» / OFFLINE) and a silent host's hand-over countdown. */
function NetStatus() {
  const t = useT();
  const room = useGame((s) => s.room);
  const myId = useGame((s) => s.me.id);
  const online = useGame((s) => s.online);
  const hostMissingSince = useGame((s) => s.hostMissingSince);
  const now = useNow();
  if (!room) return null;
  const notes: string[] = [];
  if (hostMissingSince !== null) {
    const host = room.players.find((p) => p.id === room.hostId);
    const next = room.players.find((p) => p.id === electHost(room, new Set(online)));
    const left = Math.max(0, Math.ceil((HOST_TIMEOUT_MS - (now - hostMissingSince)) / 1000));
    notes.push(t('app.hostSilent', { name: host?.name ?? '', left: left > 0 ? t('app.in', { n: left }) : '', next: next?.id === myId ? t('app.yourTab') : (next?.name ?? '…') }));
  }
  if (room.stage !== 'lobby') {
    for (const p of room.players) {
      if (p.online || p.id === myId) continue;
      notes.push(`${p.name} (${rolesOf(p).map(roleName).join(', ') || roleName(null)}): ${presenceLabel(p, now, t).text}`);
    }
  }
  if (!notes.length) return null;
  return (
    <div className="net-status" role="status">
      <span className="chip chip--reconnecting chip--wrap"><Icon name="res_signal" size={24} />{notes.join(' · ')}</span>
    </div>
  );
}

export function App() {
  const t = useT();
  const room = useGame((s) => s.room);
  const error = useGame((s) => s.error);
  const clearError = useGame((s) => s.clearError);
  const reducedMotion = useSettings((s) => s.reducedMotion);
  const noFlash = useSettings((s) => s.disableFlash);
  const view = useView((s) => s.view);
  const closeView = useView((s) => s.close);
  const stage = room?.stage ?? null;

  // Sound (src/audio): reacts to store changes on its own; starts its AudioContext on the first click.
  useEffect(() => startAudio(), []);

  // HQ / preparation are overlays of one stage: a new stage (commander confirmed, host moved on) closes them for everyone.
  useEffect(() => { closeView(); }, [stage, room?.code, closeView]);
  useEffect(() => { window.scrollTo(0, 0); }, [view, stage]);
  // Prefetch the 3D screens once in a room (idle network after the lobby renders).
  const inRoom = !!room;
  useEffect(() => {
    if (!inRoom) return;
    const timer = setTimeout(() => { void loadConstructor(); void loadReview(); void loadFlight(); void loadReport(); }, 300);
    return () => clearTimeout(timer);
  }, [inRoom]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(clearError, 4000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  let screen = <Home />;
  if (room) {
    switch (room.stage) {
      case 'lobby': screen = <Lobby />; break;
      case 'briefing': screen = <Briefing />; break;
      case 'build': screen = <Constructor />; break;
      case 'tasks': screen = <Tasks />; break;
      case 'review': screen = <Review />; break;
      case 'launch': case 'flight': screen = <Flight />; break;
      case 'report': screen = <Report />; break;
    }
    if ((room.stage === 'lobby' || room.stage === 'report') && view) screen = view === 'hq' ? <HQ /> : <Prep />;
  }

  return (
    <div className={`app ${reducedMotion ? 'a11y-reduced-motion' : ''} ${noFlash ? 'a11y-no-flash' : ''}`} data-stage={stage ?? 'home'}>
      <NetStatus />
      <Suspense fallback={<ScreenLoading />}>{screen}</Suspense>
      <AiNotice />
      <SoundSettings />
      <RulesToasts />
      {error && (
        <div className="toast-stack toast-stack--fixed">
          <div className="toast toast--err" role="alert" onClick={clearError}>
            <span className="toast__badge"><Icon name="st_crit" size={24} /></span>
            <div><div className="toast__title">{t('app.fail')}</div><div className="toast__text">{error}</div></div>
            <button type="button" className="btn btn--mini btn--icon" aria-label={t('app.close')} onClick={clearError}>✕</button>
            <span className="toast__timer" key={error} />
          </div>
        </div>
      )}
    </div>
  );
}
