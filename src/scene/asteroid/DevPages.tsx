// Dev-only demo pages for the M3 scenes (no engine, mock props): `?scene=asteroid` and `?scene=return`.
// Reached through flight/DevScenes (mounted from main.tsx only when import.meta.env.DEV).
import { useEffect, useMemo, useState } from 'react';
import type { Build } from '../../engine';
import { COMPONENT_BY_ID } from '../../engine/data/components';
import { AsteroidScene } from '../AsteroidScene';
import { Check, HINT, ON, PAGE, Panel, Row, SMALL, STAGE, Select } from '../flight/devUi';
import type { SignalState } from '../flight/types';
import { ReturnScene } from '../ReturnScene';
import {
  ASTEROID_PHASES, CAPSULE_STAGES, SAMPLING_STATES, SITE_IDS,
  type AsteroidCrisisKind, type AsteroidSceneProps, type AsteroidSiteId, type CapsuleStage, type SamplingState,
} from './types';
import { DEV_QUALITY } from '../quality';

/** A typical valid asteroid build (all mission requirements + shield, dampers, ion engine). */
export const ASTEROID_BUILD: Build = {
  rtg: 1, solar_array: 1, battery_hc: 1, pdu: 1, power_bus: 1,
  chem_thrusters: 1, chem_main_engine: 1, ion_engine: 1, propellant_tank: 1,
  flight_computer: 1, star_tracker: 1, imu: 1,
  robotic_arm: 1, sample_container: 1, sample_sealer: 1, spectrometer: 1,
  micrometeoroid_shield: 1, vibration_dampers: 1,
  transceiver: 1, antenna_high_gain: 1,
  return_capsule: 1, heat_shield: 1, parachute: 1, recovery_beacon: 1,
};

const CRISES: (AsteroidCrisisKind | 'none')[] = ['none', 'debris_alert', 'arm_jam', 'power_drop', 'overheat', 'freeze', 'signal_distortion'];
const SIGNALS: SignalState[] = ['ok', 'delay', 'interference', 'lost'];

/** Scripted run for the auto button: [seconds, patch]. */
type Patch = Partial<Pick<AsteroidSceneProps, 'phaseId' | 'approach' | 'site' | 'sampling' | 'sampleSealed'>>;
const SCRIPT: [number, Patch][] = [
  [0, { phaseId: 'cruise', approach: 0, site: null, sampling: 'idle', sampleSealed: false }],
  [5, { phaseId: 'approach', approach: 0.2 }], [8, { approach: 0.45 }], [11, { approach: 0.65 }], [14, { approach: 0.85 }], [17, { approach: 1 }],
  [21, { phaseId: 'site' }], [25, { site: 'boulder' }],
  [29, { phaseId: 'sampling', sampling: 'reach' }], [34, { sampling: 'grab' }], [39, { sampling: 'stowed', phaseId: 'stow' }],
  [43, { sampleSealed: true }], [47, { phaseId: 'return' }],
];

export function AsteroidDemo() {
  const [tool, setTool] = useState<'arm' | 'drill'>('arm');
  const build = useMemo<Build>(() => (tool === 'arm' ? ASTEROID_BUILD : { ...ASTEROID_BUILD, robotic_arm: 0, drill: 1 }), [tool]);
  const ids = useMemo(() => Object.keys(build).filter((id) => build[id] > 0 && COMPONENT_BY_ID[id]), [build]);
  const [s, setS] = useState<Required<Patch>>({ phaseId: 'site', approach: 1, site: null, sampling: 'idle', sampleSealed: false });
  const set = (patch: Patch) => setS((x) => ({ ...x, ...patch }));
  const [crisis, setCrisis] = useState<AsteroidCrisisKind | 'none'>('none');
  const [node, setNode] = useState('robotic_arm');
  const [debris, setDebris] = useState(false);
  const [offIds, setOff] = useState<string[]>([]);
  const [signal, setSignal] = useState<SignalState>('delay');
  const [reducedMotion, setRM] = useState(false);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    if (!auto) return;
    const t0 = performance.now();
    let i = 0;
    const id = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      while (i < SCRIPT.length && SCRIPT[i][0] <= t) set(SCRIPT[i++][1]);
      if (i >= SCRIPT.length) setAuto(false);
    }, 200);
    return () => clearInterval(id);
  }, [auto]);

  const props: AsteroidSceneProps = {
    build, phaseId: s.phaseId, approach: s.approach, site: s.site, sampling: s.sampling, sampleSealed: s.sampleSealed,
    crisis: crisis === 'none' ? null : { kind: crisis, nodeIds: crisis === 'arm_jam' || crisis === 'debris_alert' ? [] : [node] },
    debris: debris || crisis === 'debris_alert', offIds, signal, reducedMotion,
  };

  return (
    <div style={PAGE}>
      <div style={STAGE}><AsteroidScene {...props} quality={DEV_QUALITY} /></div>
      <Panel title="?scene=asteroid">
        <button style={auto ? ON : undefined} onClick={() => setAuto((a) => !a)}>{auto ? '■ стоп' : '▶ авто-прогон (≈50 с)'}</button>
        <Row label="phaseId"><Select value={s.phaseId} options={ASTEROID_PHASES} set={(v) => set({ phaseId: v })} /></Row>
        <Row label={`approach ${s.approach.toFixed(2)}`}>
          <input type="range" min={0} max={1} step={0.01} value={s.approach} onChange={(e) => set({ approach: Number(e.target.value) })} style={{ width: '100%' }} />
        </Row>
        <Row label="site">
          {([null, ...SITE_IDS] as (AsteroidSiteId | null)[]).map((v) => (
            <button key={v ?? 'none'} style={{ ...SMALL, ...(s.site === v ? ON : null) }} onClick={() => set({ site: v })}>{v ?? 'нет'}</button>
          ))}
        </Row>
        <Row label="sampling">
          {SAMPLING_STATES.map((v) => (
            <button key={v} style={{ ...SMALL, ...(s.sampling === v ? ON : null) }} onClick={() => set({ sampling: v as SamplingState })}>{v}</button>
          ))}
        </Row>
        <Check label="sampleSealed" value={s.sampleSealed} set={(v) => set({ sampleSealed: v })} />
        <Row label="инструмент (сборка)">
          <button style={{ ...SMALL, ...(tool === 'arm' ? ON : null) }} onClick={() => setTool('arm')}>robotic_arm</button>
          <button style={{ ...SMALL, ...(tool === 'drill' ? ON : null) }} onClick={() => { setTool('drill'); setNode('drill'); }}>drill</button>
        </Row>
        <Row label="crisis"><Select value={crisis} options={CRISES} set={setCrisis} /></Row>
        <Row label="nodeIds[0] (power_drop / overheat)"><Select value={node} options={ids} set={setNode} /></Row>
        <Check label="debris (обломки летят мимо)" value={debris} set={setDebris} />
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
        <Check label="reducedMotion" value={reducedMotion} set={setRM} />
        <p style={HINT}>debris_alert включает обломки сам и даёт вспышку попадания; arm_jam = рывки + искры + 3 мигания.</p>
      </Panel>
    </div>
  );
}

const NEXT: Partial<Record<CapsuleStage, CapsuleStage>> = { stowed: 'separated', separated: 'entry', entry: 'chute', chute: 'landed', landed: 'found' };

export function ReturnDemo() {
  const [{ stage, progress }, setSP] = useState<{ stage: CapsuleStage; progress: number }>({ stage: 'entry', progress: 0.4 });
  const setStage = (v: CapsuleStage) => setSP((x) => ({ ...x, stage: v }));
  const setProgress = (v: number) => setSP((x) => ({ ...x, progress: v }));
  const [beacon, setBeacon] = useState(true);
  const [landing, setLanding] = useState<'steppe' | 'ocean'>('steppe');
  const [reducedMotion, setRM] = useState(false);
  const [auto, setAuto] = useState(false);

  // Auto: progress 0 → 1 in ~8 s per stage, then the next stage (like the engine's capsuleProgress).
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => {
      setSP(({ stage: st, progress: p }) => {
        if (p < 1) return { stage: st, progress: Math.min(1, p + 0.025) };
        const n = NEXT[st];
        return n ? { stage: n, progress: 0 } : { stage: st, progress: p };
      });
    }, 200);
    return () => clearInterval(id);
  }, [auto]);
  useEffect(() => { if (auto && stage === 'found' && progress >= 1) setAuto(false); }, [auto, stage, progress]);

  return (
    <div style={PAGE}>
      <div style={STAGE}><ReturnScene build={ASTEROID_BUILD} capsule={stage} capsuleProgress={progress} beacon={beacon} reducedMotion={reducedMotion} landing={landing} quality={DEV_QUALITY} /></div>
      <Panel title="?scene=return">
        <button style={auto ? ON : undefined} onClick={() => { if (!auto) setSP({ stage: 'stowed', progress: 0 }); setAuto((a) => !a); }}>
          {auto ? '■ стоп' : '▶ авто-прогон с начала'}
        </button>
        <Row label="capsule">
          {CAPSULE_STAGES.map((v) => (
            <button key={v} style={{ ...SMALL, ...(stage === v ? ON : null) }} onClick={() => setStage(v)}>{v}</button>
          ))}
        </Row>
        <Row label={`capsuleProgress ${progress.toFixed(2)}`}>
          <input type="range" min={0} max={1} step={0.01} value={progress} onChange={(e) => setProgress(Number(e.target.value))} style={{ width: '100%' }} />
        </Row>
        <Check label="beacon" value={beacon} set={setBeacon} />
        <Row label="landing (необяз.)"><Select value={landing} options={['steppe', 'ocean'] as const} set={setLanding} /></Row>
        <Check label="reducedMotion" value={reducedMotion} set={setRM} />
      </Panel>
    </div>
  );
}
