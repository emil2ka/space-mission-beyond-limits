// Launch (screen 14): ~13.5 s. Countdown on the pad → swing arms open → ignition → liftoff → stage separation →
// fairing opens → our craft (as built, scaled down at mount_payload) is revealed. Click / any key skips.
// Pure component: props in, onDone out (the host then sends `launchDone`). Timeline: scene/flight/launchTimeline.ts.
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Color, CylinderGeometry, Group, Mesh, MeshToonMaterial, Object3D, Quaternion, Vector3, type Fog } from 'three';
import type { Build, MissionId } from '../engine';
import { COMPONENT_BY_ID } from '../engine/data/components';
import { MISSIONS } from '../engine/data/missions';
import { computeStats } from '../engine/stats';
import { Craft } from './Craft';
import { Emitter, discXZ } from './flight/Particles';
import { Flame } from './flight/Effects';
import { DEV_FPS, FpsProbe, QStars, QualityProvider, qualityDpr, qualityGl } from './quality';
import { T, launchFrame, type LaunchFrame } from './flight/launchTimeline';
import type { LaunchSceneProps } from './flight/types';
import { preloadModels, SCENE_MODELS, useEnvModel } from './models/loader';
import { nodeTransform } from './models/nodes';
import { toonGradient } from './models/toon';
import { useT } from '../i18n';

export type { LaunchSceneProps } from './flight/types';

/** Craft scale inside the fairing (hulls v2: Titan rotor discs reach r ≈ 1.9 m → ≈ 0.68 m, inside the ~0.85 m fairing radius). */
const PAYLOAD_SCALE = 0.36;
/** Wait this long for the GLBs before running the timeline on placeholders (slow school network). */
const FALLBACK_S = 6;

export function LaunchScene({ build, mission, reducedMotion, onDone, skippable = true, startAt = 0, quality }: LaunchSceneProps) {
  const tr = useT();
  const [countdown, setCountdown] = useState<number | null>(null);
  // M5: the flight scene's environment loads while the rocket flies.
  useEffect(() => preloadModels(mission === 'asteroid' ? SCENE_MODELS.asteroid : SCENE_MODELS.titan), [mission]);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  useEffect(() => {
    if (!skippable) return;
    const onKey = (e: KeyboardEvent) => { if (!e.repeat) finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skippable, finish]);

  return (
    <div style={WRAP} onClick={skippable ? finish : undefined}>
      <Canvas dpr={qualityDpr(quality)} camera={{ fov: 42, near: 0.3, far: 1200, position: [27, 4.5, 34] }} gl={qualityGl(quality)}>
        <QualityProvider quality={quality}>
          <LaunchWorld build={build} mission={mission} reducedMotion={reducedMotion} onCountdown={setCountdown} onEnd={finish} startAt={startAt} />
          {DEV_FPS && <FpsProbe />}
        </QualityProvider>
      </Canvas>
      {countdown !== null && (
        <div key={countdown} style={{ ...COUNT, ...(reducedMotion ? null : { animation: 'sm-count-pop 0.5s ease-out' }) }}>
          {countdown === 0 ? tr('scene.start') : countdown}
        </div>
      )}
      {skippable && <div style={SKIP}>{tr('scene.skip')}</div>}
      <style>{'@keyframes sm-count-pop{0%{transform:translate(-50%,-50%) scale(1.6);opacity:0}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}'}</style>
    </div>
  );
}

const WRAP: CSSProperties = { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#0B0F2A', cursor: 'pointer' };
const COUNT: CSSProperties = {
  position: 'absolute', left: '50%', top: '38%', transform: 'translate(-50%,-50%)', pointerEvents: 'none',
  font: '900 clamp(64px, 14vw, 160px)/1 Manrope, system-ui, sans-serif', color: '#FFD25C', letterSpacing: '0.04em',
  WebkitTextStroke: '6px #0B0D1A', paintOrder: 'stroke fill', textShadow: '0 6px 0 #0B0D1A',
};
const SKIP: CSSProperties = {
  position: 'absolute', right: 16, bottom: 14, pointerEvents: 'none', font: '600 13px Manrope, system-ui, sans-serif',
  color: '#CFE8FF', opacity: 0.75, background: 'rgba(14,19,48,0.55)', padding: '6px 10px', borderRadius: 10,
};

interface WorldProps {
  build: Build;
  mission: MissionId;
  reducedMotion: boolean;
  onCountdown: (n: number | null) => void;
  onEnd: () => void;
  startAt: number;
}

interface RocketRig {
  root: Object3D;
  stage1: Object3D | null;
  nozzle1: Object3D | null;
  nozzle2: Object3D | null;
  payload: Object3D | null;
  fairL: Object3D | null;
  fairR: Object3D | null;
  rest: Map<Object3D, { p: Vector3; q: Quaternion }>;
}

function rigOf(root: Object3D): RocketRig {
  const get = (n: string) => root.getObjectByName(n) ?? null;
  const rig: RocketRig = {
    root, stage1: get('stage1'), nozzle1: get('fx_nozzle'), nozzle2: get('fx_nozzle_2'), payload: get('mount_payload'),
    fairL: get('pivot_fairing_l'), fairR: get('pivot_fairing_r'), rest: new Map(),
  };
  for (const o of [rig.stage1, rig.nozzle1, rig.fairL, rig.fairR]) if (o) rig.rest.set(o, { p: o.position.clone(), q: o.quaternion.clone() });
  return rig;
}

const Z = new Vector3(0, 0, 1);
const Y = new Vector3(0, 1, 0);
const tq = new Quaternion();
const camPos = new Vector3();
const camLook = new Vector3();
const tmpA = new Vector3();
const tmpB = new Vector3();
const SKY_GROUND = new Color('#1B2152');
const SKY_SPACE = new Color('#03040C');

function LaunchWorld({ build, mission, reducedMotion, onCountdown, onEnd, startAt }: WorldProps) {
  const padModel = useEnvModel('launch_pad');
  const rocketModel = useEnvModel('rocket');
  const pad = useMemo(() => padModel?.scene ?? makePadPlaceholder(), [padModel]);
  const rocket = useMemo(() => rocketModel?.scene ?? makeRocketPlaceholder(), [rocketModel]);
  const rig = useMemo(() => rigOf(rocket), [rocket]);
  const arms = useMemo(() => ['pivot_arm_1', 'pivot_arm_2'].map((n) => pad.getObjectByName(n)).filter((o): o is Object3D => !!o)
    .map((o) => ({ o, q: o.quaternion.clone() })), [pad]);
  const mountY = useMemo(() => nodeTransform(pad, 'mount_rocket')?.position[1] ?? 1.6, [pad]);

  const stats = useMemo(() => ({ ...computeStats(build, MISSIONS[mission]), issues: [] }), [build, mission]);
  const hasCraft = Object.keys(build).some((id) => build[id] > 0 && COMPONENT_BY_ID[id]);

  const rocketGroup = useRef<Group>(null);
  const scene = useThree((s) => s.scene);
  const t = useRef(Math.max(0, startAt));
  const [waited, setWaited] = useState(false);
  const frame = useRef<LaunchFrame>(launchFrame(0));
  const lastCd = useRef<number | null>(null);
  const ended = useRef(false);

  // Start once both models are in (or after FALLBACK_S with placeholders) so the timeline does not run on empty.
  const ready = !!padModel && !!rocketModel;
  useEffect(() => {
    const id = setTimeout(() => setWaited(true), FALLBACK_S * 1000);
    return () => clearTimeout(id);
  }, []);
  const show = ready || waited;

  useEffect(() => {
    scene.background = SKY_GROUND.clone();
    return () => { scene.background = null; };
  }, [scene]);

  useFrame(({ camera }, rawDt) => {
    // 0.25 s cap: a slow laptop still finishes in ~wall-clock time; a backgrounded tab does not jump to the end.
    const dt = Math.min(rawDt, 0.25);
    if (!show) return;
    t.current += dt;
    const f = (frame.current = launchFrame(t.current));
    if (f.countdown !== lastCd.current) { lastCd.current = f.countdown; onCountdown(f.countdown); }
    if (f.done && !ended.current) { ended.current = true; onEnd(); }

    // rocket + parts
    rocketGroup.current?.position.set(0, mountY + f.altitude, 0);
    if (rig.stage1) {
      const r = rig.rest.get(rig.stage1)!;
      rig.stage1.position.copy(r.p).add(tmpA.set(f.stage1Drop * 0.12, -f.stage1Drop, 0));
      rig.stage1.quaternion.copy(r.q).multiply(tq.setFromAxisAngle(Z, -f.stage1Tilt));
      rig.stage1.visible = f.stage1Drop < 400;
    }
    if (rig.nozzle1) rig.nozzle1.position.copy(rig.rest.get(rig.nozzle1)!.p).add(tmpA.set(f.stage1Drop * 0.12, -f.stage1Drop, 0));
    for (const [o, sign] of [[rig.fairL, 1], [rig.fairR, -1]] as const) {
      if (!o) continue;
      const r = rig.rest.get(o)!;
      const k = f.fairing;
      o.quaternion.copy(r.q).multiply(tq.setFromAxisAngle(Z, sign * k * 1.5));
      o.position.copy(r.p).add(tmpA.set(-sign * k * k * 3.2, -k * k * 1.6, 0));
      o.visible = k < 0.999;
    }
    for (const a of arms) a.o.quaternion.copy(a.q).multiply(tq.setFromAxisAngle(Y, f.arms * 1.25));

    // sky: night on the ground → black space
    if (scene.background instanceof Color) scene.background.copy(SKY_GROUND).lerp(SKY_SPACE, f.space);
    const fog = scene.fog as Fog | null;
    if (fog) { fog.color.copy(scene.background as Color); fog.far = 220 + f.space * 2000; }

    // camera choreography
    shot(t.current, f.altitude, mountY, camPos, camLook);
    if (!reducedMotion && f.flame1 > 0.2 && f.altitude < 80) {
      const amp = 0.09 * f.flame1 * (1 - f.altitude / 80);
      camPos.x += (Math.random() - 0.5) * amp; camPos.y += (Math.random() - 0.5) * amp;
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  });

  const flame1 = () => frame.current.flame1;
  const flame2 = () => frame.current.flame2;
  const smokeOn = () => (frame.current.flame1 > 0.1 && frame.current.altitude < 40 ? 1 : 0);
  const smokeN = reducedMotion ? 110 : 240;

  return (
    <>
      <fog attach="fog" args={['#1B2152', 60, 220]} />
      <QStars radius={500} depth={60} count={reducedMotion ? 1200 : 2200} factor={6} fade speed={0} />
      <hemisphereLight args={['#8E9BE0', '#2A2244', 0.9]} />
      <directionalLight position={[-30, 50, 40]} intensity={1.1} color="#CFE0FF" />
      <pointLight position={[6, 5, 6]} intensity={60} color="#FFD8A0" distance={40} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[700, 48]} />
        <meshToonMaterial color="#2C3060" gradientMap={toonGradient()} />
      </mesh>
      <PadLights />
      {show && <primitive object={pad} />}
      <group ref={rocketGroup} position={[0, mountY, 0]} visible={show}>
        <primitive object={rocket} />
      </group>
      {show && rig.payload && hasCraft && createPortal(
        <group scale={PAYLOAD_SCALE} position={[0, 0.45 * PAYLOAD_SCALE, 0]}>
          <Craft build={build} stats={stats} role={null} reducedMotion={reducedMotion} mission={mission} fx={{ rotorSpeed: 0 }} />
        </group>,
        rig.payload,
      )}
      <PayloadLight rig={rig} frame={frame} />
      <Flame nozzle={rig.nozzle1} strength={flame1} reducedMotion={reducedMotion} scale={1} />
      <Flame nozzle={rig.nozzle2} strength={flame2} reducedMotion={reducedMotion} scale={0.5} />
      {/* steam before ignition */}
      <Emitter
        count={60} hard life={[1.4, 2.4]} size={[0.8, 3]} color={['#F7F8FF', '#B8C0E0']} alpha={[0.55, 0]} gravity={0.6} drag={0.4}
        rate={() => (t.current > 0.2 && t.current < T.ignition + 0.4 ? 22 : 0)}
        spawn={(o) => { o.p.set((Math.random() < 0.5 ? -1 : 1) * 1.6, 1.2 + Math.random() * 2, (Math.random() - 0.5) * 2); o.v.set(o.p.x * 0.6, 0.8, 0); }}
      />
      {/* launch smoke: comic puffs rolling out from the pad */}
      <Emitter
        count={smokeN} hard life={[2.2, 3.6]} size={[2.5, 9]} color={['#F7F4FB', '#9A95B8']} alpha={[1, 0.15]} gravity={0.8} drag={0.55}
        rate={() => smokeOn() * smokeN * 0.65}
        spawn={(o) => {
          discXZ(o.p, 1.2).y = 0.6;
          const a = Math.random() * Math.PI * 2, s = 9 + Math.random() * 8;
          o.v.set(Math.cos(a) * s, 0.6 + Math.random() * 2, Math.sin(a) * s);
        }}
      />
    </>
  );
}

/** Light the payload once the fairing opens (space is dark). */
function PayloadLight({ rig, frame }: { rig: RocketRig; frame: { current: LaunchFrame } }) {
  const ref = useRef<import('three').DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  useFrame(() => {
    const l = ref.current;
    if (!l || !rig.payload) return;
    rig.payload.getWorldPosition(target.position);
    target.updateMatrixWorld();
    l.position.copy(target.position).add(tmpB.set(6, 5, 8));
    l.intensity = 2.2 * frame.current.space;
  });
  return <directionalLight ref={ref} target={target} color="#FFF4E0" intensity={0} />;
}

/** Shots: wide on the pad → low looking up → side tracking (separation) → above the payload (reveal). */
function shot(t: number, alt: number, mountY: number, pos: Vector3, look: Vector3) {
  const base = mountY + alt;
  const payloadY = base + 11.45;
  const shots: [number, (p: Vector3, l: Vector3) => void][] = [
    [0, (p, l) => { const k = Math.min(1, t / T.ignition); p.set(27 - k * 4, 4.5 - k * 1, 34 - k * 5); l.set(0, 8.5, 0); }],
    [T.ignition, (p, l) => { p.set(13, 1.4, 17); l.set(0, base + 7, 0); }],
    [6.4, (p, l) => { p.set(30, base + 5, 15); l.set(0, base + 6.5, 0); }],
    [T.fairing - 0.3, (p, l) => { const k = Math.min(1, (t - T.fairing) / 3); p.set(4.2 - k * 1.7, payloadY + 3.4 - k * 1.3, 5.6 - k * 2.6); l.set(0, payloadY + 0.45, 0); }],
  ];
  let i = 0;
  while (i + 1 < shots.length && t >= shots[i + 1][0]) i++;
  shots[i][1](pos, look);
  const blend = 0.9;
  if (i > 0 && t < shots[i][0] + blend) {
    const k = (t - shots[i][0]) / blend;
    const e = k * k * (3 - 2 * k);
    shots[i - 1][1](tmpA, tmpB);
    pos.lerpVectors(tmpA, pos, e);
    look.lerpVectors(tmpB, look, e);
  }
}

/** Blinking red beacons around the pad. */
function PadLights() {
  const mats = useRef<MeshToonMaterial[]>([]);
  useFrame(({ clock }) => {
    const on = Math.floor(clock.elapsedTime * 1.2) % 2 === 0;
    for (const m of mats.current) m.emissiveIntensity = on ? 1.6 : 0.3;
  });
  const spots: [number, number][] = [[-9, -9], [9, -9], [-9, 9], [9, 9]];
  return (
    <>
      {spots.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.4, z]}>
          <cylinderGeometry args={[0.18, 0.25, 0.8, 8]} />
          <meshToonMaterial ref={(m) => { if (m) mats.current[i] = m; }} color="#5A1020" emissive="#FF5A6A" gradientMap={toonGradient()} />
        </mesh>
      ))}
    </>
  );
}

// ---------- placeholders with the same node names (used when the GLBs are not in the manifest) ----------

function toon(color: string) {
  return new MeshToonMaterial({ color, gradientMap: toonGradient() });
}

function makeRocketPlaceholder(): Object3D {
  const root = new Group();
  root.name = 'rocket';
  const stage1 = new Group(); stage1.name = 'stage1';
  const body = new Mesh(new CylinderGeometry(1.1, 1.2, 9, 20), toon('#F2E8D8')); body.position.y = 4.5; stage1.add(body);
  const nozzle = new Group(); nozzle.name = 'fx_nozzle'; nozzle.position.y = 0.05;
  const s2 = new Group(); s2.name = 'pivot_stage2'; s2.position.y = 9;
  const s2body = new Mesh(new CylinderGeometry(0.95, 1.1, 2.2, 20), toon('#FF9A4A')); s2body.position.y = 1.1; s2.add(s2body);
  const n2 = new Group(); n2.name = 'fx_nozzle_2'; n2.position.y = -0.2; s2.add(n2);
  const pay = new Group(); pay.name = 'mount_payload'; pay.position.y = 2.45; s2.add(pay);
  for (const [name, x] of [['pivot_fairing_l', -0.9], ['pivot_fairing_r', 0.9]] as const) {
    const p = new Group(); p.name = name; p.position.set(x, 2.2, 0);
    const half = new Mesh(new CylinderGeometry(0.2, 0.92, 2.8, 16, 1, false, x < 0 ? Math.PI : 0, Math.PI), toon('#F2E8D8'));
    half.position.set(-x, 1.4, 0);
    p.add(half); s2.add(p);
  }
  root.add(stage1, nozzle, s2);
  return root;
}

function makePadPlaceholder(): Object3D {
  const root = new Group();
  root.name = 'launch_pad';
  const slab = new Mesh(new CylinderGeometry(6, 6.5, 1.2, 24), toon('#8E93B0')); slab.position.y = 0.6; root.add(slab);
  const tower = new Mesh(new CylinderGeometry(0.4, 0.4, 16, 6), toon('#FF9A4A')); tower.position.set(4.6, 8, 0); root.add(tower);
  const mount = new Group(); mount.name = 'mount_rocket'; mount.position.y = 1.6; root.add(mount);
  for (const [i, y] of [[1, 8.6], [2, 13.55]] as const) {
    const p = new Group(); p.name = `pivot_arm_${i}`; p.position.set(3.2, y, 0.95);
    const arm = new Mesh(new CylinderGeometry(0.15, 0.15, 2.2, 6), toon('#B8A9F0')); arm.rotation.z = Math.PI / 2; arm.position.x = -1.1;
    p.add(arm); root.add(p);
  }
  return root;
}
