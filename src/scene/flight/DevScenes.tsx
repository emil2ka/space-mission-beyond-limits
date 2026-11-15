// Dev-only demo pages for the M1 flight scenes (no engine, mock props): `?scene=launch` and `?scene=titan`.
// Mounted from main.tsx only when import.meta.env.DEV, so none of this reaches the production bundle.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { Build } from '../../engine';
import { COMPONENT_BY_ID } from '../../engine/data/components';
import { LaunchScene } from '../LaunchScene';
import { TitanScene } from '../TitanScene';
import { Check, HINT, ON, PAGE, Panel, Row, SMALL, STAGE, Select } from './devUi';
import type { CrisisKind, RouteState, SignalState, TitanSceneProps } from './types';
import { DEV_QUALITY } from '../quality';

// M3 demo pages (?scene=asteroid / ?scene=return) live with the M3 scenes.
const AsteroidDemo = lazy(() => import('../asteroid/DevPages').then((m) => ({ default: m.AsteroidDemo })));
const ReturnDemo = lazy(() => import('../asteroid/DevPages').then((m) => ({ default: m.ReturnDemo })));

/** A typical valid Titan build (all mission requirements + instruments). */
export const DEMO_BUILD: Build = {
  rotor_system: 1, landing_system: 1, power_bus: 1, thermal_insulation: 1,
  rtg: 2, battery_hc: 1, pdu: 1,
  flight_computer: 1, imu: 1, radar_altimeter: 1, nav_camera: 1,
  atmo_sensor: 1, wide_camera: 1, spectrometer: 1, temp_sensor: 1,
  transceiver: 1, antenna_high_gain: 1, signal_amp: 1,
  heater: 1,
};
const MIN_BUILD: Build = { rotor_system: 1, power_bus: 1, rtg: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1 };

export function DevScenes({ scene }: { scene: string }) {
  if (scene === 'asteroid') return <Suspense fallback={null}><AsteroidDemo /></Suspense>;
  if (scene === 'return') return <Suspense fallback={null}><ReturnDemo /></Suspense>;
  return scene === 'launch' ? <LaunchDemo /> : <TitanDemo />;
}

function LaunchDemo() {
  const [run, setRun] = useState(0);
  const [done, setDone] = useState(false);
  const [reducedMotion, setRM] = useState(false);
  const [minimal, setMinimal] = useState(false);
  const [startAt, setStartAt] = useState(0);
  const replay = (at: number) => { setStartAt(at); setDone(false); setRun((r) => r + 1); };
  return (
    <div style={PAGE}>
      <div style={STAGE}>
        {!done ? (
          <LaunchScene key={run} build={minimal ? MIN_BUILD : DEMO_BUILD} mission="titan" reducedMotion={reducedMotion} quality={DEV_QUALITY} startAt={startAt} onDone={() => setDone(true)} />
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>onDone() вызван → хост шлёт launchDone</div>
        )}
      </div>
      <Panel title="?scene=launch">
        <button onClick={() => replay(0)}>▶ Заново</button>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button style={SMALL} onClick={() => replay(3.2)}>с зажигания</button>
          <button style={SMALL} onClick={() => replay(8.2)}>с отделения</button>
          <button style={SMALL} onClick={() => replay(9.8)}>с обтекателя</button>
        </div>
        <Check label="reducedMotion" value={reducedMotion} set={(v) => { setRM(v); setDone(false); setRun((r) => r + 1); }} />
        <Check label="минимальная сборка" value={minimal} set={(v) => { setMinimal(v); setDone(false); setRun((r) => r + 1); }} />
        <p style={HINT}>Клик по сцене или любая клавиша — пропуск.</p>
      </Panel>
    </div>
  );
}

const CRISES: (CrisisKind | 'none')[] = ['none', 'power_drop', 'signal_distortion', 'freeze', 'overheat'];
const SIGNALS: SignalState[] = ['ok', 'delay', 'interference', 'lost'];
const ROUTES: RouteState[] = ['flying', 'landed', 'stopped'];
const PHASES = ['cruise', 'entry', 'survey', 'uplink'];

function TitanDemo() {
  const ids = useMemo(() => Object.keys(DEMO_BUILD).filter((id) => COMPONENT_BY_ID[id]), []);
  const [wp, setWp] = useState({ i: 0, p: 0.6 });
  const waypointIndex = wp.i, waypointProgress = wp.p;
  const setIndex = (i: number) => setWp((w) => ({ ...w, i }));
  const setProgress = (p: number) => setWp((w) => ({ ...w, p }));
  const [route, setRoute] = useState<RouteState>('flying');
  const [crisis, setCrisis] = useState<CrisisKind | 'none'>('none');
  const [node, setNode] = useState('rtg');
  const [offIds, setOff] = useState<string[]>([]);
  const [signal, setSignal] = useState<SignalState>('delay');
  const [phaseId, setPhase] = useState('survey');
  const [reducedMotion, setRM] = useState(false);
  const [auto, setAuto] = useState(false);
  const [storm, setStorm] = useState(false);

  // Auto-fly: advances like the engine would (1 Hz ticks, one segment per ~20 s here).
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      setWp(({ i, p }) => (p < 1 ? { i, p: Math.min(1, p + 0.05) } : i < 2 ? { i: i + 1, p: 0 } : { i, p }));
    }, 1000);
    return () => clearInterval(id);
  }, [auto]);

  const props: TitanSceneProps = {
    build: DEMO_BUILD, phaseId, waypointIndex, waypointProgress, route,
    crisis: crisis === 'none' ? null : { kind: crisis, nodeIds: [node] },
    offIds, signal, role: null, reducedMotion, storm,
  };

  return (
    <div style={PAGE}>
      <div style={STAGE}><TitanScene {...props} quality={DEV_QUALITY} /></div>
      <Panel title="?scene=titan">
        <Row label="phaseId"><Select value={phaseId} options={PHASES} set={setPhase} /></Row>
        <Row label="waypointIndex">
          {[0, 1, 2].map((i) => (
            <button key={i} style={i === waypointIndex ? ON : undefined} onClick={() => setIndex(i)}>{['дюны', 'озеро', 'кратер'][i]}</button>
          ))}
        </Row>
        <Row label={`progress ${waypointProgress.toFixed(2)}`}>
          <input type="range" min={0} max={1} step={0.01} value={waypointProgress} onChange={(e) => setProgress(Number(e.target.value))} style={{ width: '100%' }} />
        </Row>
        <Check label="авто-полёт (1 Гц)" value={auto} set={setAuto} />
        <Row label="route"><Select value={route} options={ROUTES} set={setRoute} /></Row>
        <Row label="crisis"><Select value={crisis} options={CRISES} set={setCrisis} /></Row>
        <Row label="nodeIds[0]"><Select value={node} options={ids} set={setNode} /></Row>
        <Row label="signal"><Select value={signal} options={SIGNALS} set={setSignal} /></Row>
        <div style={{ fontSize: 12, opacity: 0.8, margin: '8px 0 4px' }}>offIds (выключены)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {ids.map((id) => (
            <button
              key={id} style={{ ...SMALL, ...(offIds.includes(id) ? ON : null) }}
              onClick={() => setOff((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))}
            >{id}</button>
          ))}
        </div>
        <Check label="storm (буря)" value={storm} set={setStorm} />
        <Check label="reducedMotion" value={reducedMotion} set={setRM} />
      </Panel>
    </div>
  );
}
