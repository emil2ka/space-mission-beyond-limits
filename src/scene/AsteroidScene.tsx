// Asteroid mission (M3): black space, stars, a slowly tumbling asteroid (lod0/lod1), the real build on frame_asteroid
// closing in by `approach`, attitude jets on chem_thrusters, ion beam on the cruise/return legs, three sampling sites,
// the robotic arm (or drill) reaching the chosen site, dust on the grab, arm jam (jerks + sparks + 3 blinks),
// container lid closing when sealed, debris streaming past, switched-off modules dark, signal static.
// Pure component: everything comes from props (docs/04 Tech/M3 Asteroid Contract.md, section C).
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Group, Mesh, Object3D, Quaternion, Vector3, type PointLight } from 'three';
import { MISSIONS } from '../engine/data/missions';
import { computeStats } from '../engine/stats';
import { AsteroidRock, RADIUS, SiteMarkers, useAsteroid } from './asteroid/AsteroidBody';
import { Debris } from './asteroid/Debris';
import { IonBeam, Jet } from './asteroid/Fx';
import { approachDistance, armTarget, blinkLit, lidOpen, smooth, standoff, syncK } from './asteroid/timeline';
import type { AsteroidSceneProps } from './asteroid/types';
import { Craft, type CraftFx } from './Craft';
import { StaticNoise, glowMaterial } from './flight/Effects';
import { Emitter } from './flight/Particles';
import { noiseLevel } from './flight/route';
import { holdMechanics } from './models/mechanics';
import { preloadModels, SCENE_MODELS } from './models/loader';
import { DEV_FPS, FpsProbe, QStars, QualityProvider, qualityDpr, qualityGl } from './quality';

export type { AsteroidSceneProps } from './asteroid/types';

const BG = '#03040A';
const WRAP: CSSProperties = { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: BG };

export function AsteroidScene(props: AsteroidSceneProps) {
  // M5: the return set (capsule, chute, Earth) loads during the flight, so ReturnScene opens without a black gap.
  useEffect(() => preloadModels(SCENE_MODELS.return), []);
  return (
    <div style={WRAP}>
      <Canvas dpr={qualityDpr(props.quality)} camera={{ fov: 50, near: 0.1, far: 2000, position: [20, 10, 280] }} gl={qualityGl(props.quality)}>
        <QualityProvider quality={props.quality}>
          <AsteroidWorld {...props} />
          {DEV_FPS && <FpsProbe />}
        </QualityProvider>
      </Canvas>
    </div>
  );
}

const SUN_DIR = new Vector3(0.75, 0.42, 0.55).normalize();
const TUMBLE_AXIS = new Vector3(0.3, 1, 0.18).normalize();
const TUMBLE = 0.05; // rad/s
/** Inertial approach line (from the asteroid outwards), close to the sites' side so far → near is continuous. */
const DIR_FAR = new Vector3(0.42, 0.2, 1).normalize();
const UP = new Vector3(0, 1, 0);
const Y = new Vector3(0, 1, 0);

function AsteroidWorld(p: AsteroidSceneProps) {
  const a = useAsteroid();
  const spin = useRef<Group>(null);
  const stars = useRef<Group>(null);
  const collected = p.sampling === 'stowed' || p.sampleSealed;
  const near = p.phaseId !== 'cruise' && p.phaseId !== 'return' && syncK(p.approach, p.phaseId) > 0.3;
  return (
    <>
      <color attach="background" args={[BG]} />
      <group ref={stars}>
        <QStars radius={700} depth={80} count={p.reducedMotion ? 1600 : 2600} factor={7} fade speed={0} />
      </group>
      <SunDisc />
      <ambientLight intensity={0.18} />
      <hemisphereLight args={['#CFE8FF', '#2A2238', 0.55]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(80).toArray()} intensity={2.4} color="#FFF4E0" />
      <group ref={spin}>
        <AsteroidRock a={a} />
        <SiteMarkers sites={a.sites} chosen={p.site} collected={collected} visible={near} reducedMotion={p.reducedMotion} />
      </group>
      <CraftRig {...p} sites={a.sites} spin={spin} stars={stars} />
    </>
  );
}

function SunDisc() {
  const ref = useRef<Mesh>(null);
  const mat = useMemo(() => glowMaterial('#FFF1C8', 1), []);
  useFrame(({ camera }) => {
    const m = ref.current;
    if (!m) return;
    m.position.copy(camera.position).addScaledVector(SUN_DIR, 900);
    m.lookAt(camera.position);
  });
  return (
    <mesh ref={ref} material={mat} renderOrder={-5}>
      <planeGeometry args={[90, 90]} />
    </mesh>
  );
}

interface RigProps extends AsteroidSceneProps {
  sites: ReturnType<typeof useAsteroid>['sites'];
  spin: RefObject<Group | null>;
  stars: RefObject<Group | null>;
}

/** Nodes of the installed modules the scene drives (re-scanned while modules load / the build changes). */
interface Rig {
  tool: Object3D | null;
  toolId: 'robotic_arm' | 'drill' | null;
  arm: Record<string, Object3D | undefined>;
  tip: Object3D | null;
  lid: Object3D | null;
  nozzles: Object3D[];
  main: Object3D[];
  beams: Object3D[];
  reach: number;
  key: string;
}

const ARM_NODES = ['pivot_arm_1', 'pivot_arm_2', 'pivot_arm_3', 'pivot_claw', 'pivot_claw_l', 'pivot_claw_r'];
const tq = new Quaternion();
const tq2 = new Quaternion();

/** Arm pose: reach 0 (authored stowed pose) … 1 (stretched outward along the slot +Y), claw 0 open … 1 closed. */
function poseArm(arm: Rig['arm'], reach: number, claw: number, jerk: number) {
  const set = (name: string, axis: Vector3, angle: number) => {
    const o = arm[name];
    if (!o) return;
    const rest = o.userData.restQuaternion as Quaternion | undefined;
    o.quaternion.copy(rest ?? o.quaternion).multiply(tq.setFromAxisAngle(axis, angle));
  };
  const r = smooth(reach);
  set('pivot_arm_1', Y, 0.25 * r + jerk * 0.5);
  set('pivot_arm_2', X, 1.2 * r + jerk);
  set('pivot_arm_3', X, -3.0 * r - jerk * 1.4);
  set('pivot_claw', X, 0.25 * r);
  set('pivot_claw_l', Y, 0.4 * (1 - claw));
  set('pivot_claw_r', Y, -0.4 * (1 - claw));
}
const X = new Vector3(1, 0, 0);

function poseDrill(arm: Rig['arm'], reach: number, spinAngle: number) {
  const slide = arm.pivot_drill_slide;
  if (slide) slide.position.copy((slide.userData.restPosition as Vector3) ?? slide.position).addScaledVector(Y, 0.16 * smooth(reach));
  const d = arm.pivot_drill;
  if (d) d.quaternion.copy((d.userData.restQuaternion as Quaternion) ?? d.quaternion).multiply(tq.setFromAxisAngle(Y, spinAngle));
}

function scanRig(craft: Object3D, build: AsteroidSceneProps['build']): Rig {
  const units = new Map<string, Object3D>();
  craft.traverse((o) => { if (o.name.startsWith('unit_') && !units.has(o.name)) units.set(o.name, o); });
  const within = (unit: string, re: RegExp) => {
    const out: Object3D[] = [];
    craft.traverse((o) => {
      if (!o.name.startsWith('unit_') || o.name !== unit) return;
      o.traverse((c) => { if (re.test(c.name)) out.push(c); });
    });
    return out;
  };
  const toolId = (build.robotic_arm ?? 0) > 0 ? 'robotic_arm' : (build.drill ?? 0) > 0 ? 'drill' : null;
  const tool = toolId ? units.get(`unit_${toolId}`) ?? null : null;
  const arm: Rig['arm'] = {};
  let tip: Object3D | null = null;
  if (tool && toolId === 'robotic_arm') {
    for (const n of ARM_NODES) { const o = tool.getObjectByName(n); if (o) { holdMechanics(o); arm[n] = o; } }
    tip = tool.getObjectByName('fx_grab') ?? arm.pivot_claw ?? null;
  } else if (tool && toolId === 'drill') {
    for (const n of ['pivot_drill_slide', 'pivot_drill']) { const o = tool.getObjectByName(n); if (o) { holdMechanics(o); arm[n] = o; } }
    tip = tool.getObjectByName('fx_dust') ?? null;
  }
  const lid = units.get('unit_sample_container')?.getObjectByName('pivot_lid') ?? null;
  if (lid) holdMechanics(lid);

  // Tip distance along the slot normal at full reach (measured on the real model, restored afterwards).
  let reach = 0.9;
  if (tool && tip) {
    if (toolId === 'robotic_arm') poseArm(arm, 1, 1, 0); else poseDrill(arm, 1, 0);
    tool.updateMatrixWorld(true);
    const w = tip.getWorldPosition(new Vector3());
    reach = Math.max(0.3, tool.worldToLocal(w).y);
    if (toolId === 'robotic_arm') poseArm(arm, 0, 1, 0); else poseDrill(arm, 0, 0);
  }
  const nozzles = within('unit_chem_thrusters', /^fx_nozzle_\d+$/);
  const main = within('unit_chem_main_engine', /^fx_nozzle$/);
  const beams = within('unit_ion_engine', /^fx_beam$/);
  const key = [tool?.uuid, Object.keys(arm).length, tip?.uuid, lid?.uuid, nozzles.length, main.length, beams.length].join('|');
  return { tool, toolId, arm, tip, lid, nozzles, main, beams, reach, key };
}

const EMPTY_RIG: Rig = { tool: null, toolId: null, arm: {}, tip: null, lid: null, nozzles: [], main: [], beams: [], reach: 0.9, key: '' };

function CraftRig(p: RigProps) {
  const { build, reducedMotion, crisis, sites } = p;
  const craft = useRef<Group>(null);
  const sparkLight = useRef<PointLight>(null);
  const hitLight = useRef<PointLight>(null);
  const hitGlow = useRef<Mesh>(null);
  const hitMat = useMemo(() => { const m = glowMaterial('#FFE6B0', 1); m.depthTest = false; return m; }, []);
  const stats = useMemo(() => ({ ...computeStats(build, MISSIONS.asteroid), issues: [] }), [build]);
  const { camera } = useThree();
  const [rig, setRig] = useState<Rig>(EMPTY_RIG);

  const st = useRef({
    init: false, a: p.approach, k: syncK(p.approach, p.phaseId), phi: syncK(p.approach, p.phaseId) > 0.5 ? 0 : 1.1, starPhi: 0, stand: 7, reach: 0, claw: 1, lid: 0,
    jerk: 0, jerkT: 0, drillA: 0, dep: 0, shake: 0, noise: 0, prevA: p.approach,
    burn: 0, pulseT: 0, pulseI: 0, pulse: 0, standV: 0, grabT: 0, scanT: 0,
    hit: 0, sparkBurst: 0,
    pos: new Vector3(), quat: new Quaternion(),
    S: new Vector3(), n: new Vector3(0, 0, 1), cam: new Vector3(), look: new Vector3(), hitP: new Vector3(),
    elbow: new Vector3(), contact: new Vector3(), nodeP: new Vector3(), nodeT: 0,
  });

  // ---- crisis: blink plan (power_drop / arm_jam / sampling jam), steady glow (overheat) ----
  const jam = crisis?.kind === 'arm_jam' || p.sampling === 'jam';
  const node = crisis?.nodeIds[0] ?? (jam ? rig.toolId : null);
  const blinkKind = crisis?.kind === 'power_drop' || jam;
  const crisisKey = crisis ? `${crisis.kind}:${crisis.nodeIds.join(',')}` : jam ? 'jam' : '';
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (!crisisKey) { setLit(false); return; }
    if (!reducedMotion && crisis) st.current.shake = 0.6;
    if (!blinkKind || reducedMotion) { setLit(true); return; }
    const t0 = performance.now();
    setLit(true);
    const id = setInterval(() => {
      const ms = performance.now() - t0;
      setLit(blinkLit(ms));
      if (ms > 2600) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crisisKey, reducedMotion]);

  const flashOn = !!node && lit && (blinkKind || crisis?.kind === 'overheat');
  const fx: CraftFx = {
    dimIds: p.offIds,
    flashIds: flashOn && node ? [node] : [],
    flashColor: crisis?.kind === 'overheat' || p.sampling === 'failed' ? 'crit' : 'warn',
    frost: crisis?.kind === 'freeze',
  };
  if (p.sampling === 'failed' && rig.toolId && !fx.flashIds?.length) fx.flashIds = [rig.toolId];

  const noiseTarget = noiseLevel(p.signal, crisis?.kind === 'signal_distortion', reducedMotion);
  const off = (id: string) => p.offIds.includes(id);
  const beamOn = (p.phaseId === 'cruise' || p.phaseId === 'return') && !off('ion_engine');
  const site = p.site ? sites[p.site] : sites.regolith;
  const arm = armTarget(p.sampling);
  const stand = standoff(p.sampling, rig.reach, !!p.site);
  const lidT = lidOpen(p.sampling, p.sampleSealed);
  const departing = p.phaseId === 'return';

  // grab start → dust burst clock
  useEffect(() => { if (p.sampling === 'grab') st.current.grabT = 0; }, [p.sampling]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = st.current;
    const g = craft.current;
    if (!g) return;
    const time = clock.elapsedTime;

    // modules load asynchronously / build edits remount them → re-scan once a second
    s.scanT -= dt;
    if (s.scanT <= 0) {
      s.scanT = 1;
      const r = scanRig(g, build);
      if (r.key !== rig.key) setRig(r);
    }

    // approach follows the (1 Hz) engine value smoothly
    s.prevA = s.a;
    s.a += (p.approach - s.a) * (1 - Math.exp(-dt * 1.2));
    const da = (s.a - s.prevA) / Math.max(dt, 1e-3);
    s.k += (syncK(s.a, p.phaseId) - s.k) * (1 - Math.exp(-dt * 1.5));
    const k = s.k;

    // tumble: slows and settles on a whole turn as the craft matches it; the stars turn instead
    // (the craft rides along with the site meanwhile; landing on a whole turn keeps the site in sunlight)
    const gap = Math.PI * 2 * Math.ceil(s.phi / (Math.PI * 2)) - s.phi;
    s.phi += (TUMBLE * (1 - k) + k * Math.min(TUMBLE * 2, gap * 0.3)) * dt;
    s.starPhi -= TUMBLE * k * dt * 0.6;
    spinQ(p.spin.current, s.phi);
    if (p.stars.current) p.stars.current.quaternion.setFromAxisAngle(TUMBLE_AXIS, s.starPhi);
    const R = p.spin.current?.quaternion ?? tq2.identity();

    // site in world
    s.S.copy(site.p).applyQuaternion(R);
    s.n.copy(site.n).applyQuaternion(R);

    // tool slot in craft coordinates (Module group: local +Y = outward)
    const toolN = rig.tool ? Y.clone().applyQuaternion(rig.tool.quaternion) : new Vector3(0, 0, 1);
    const toolP = rig.tool ? rig.tool.position : new Vector3(0, 0.7, 0.9);

    // ---- orientation ----
    const qFar = new Quaternion().setFromUnitVectors(Y, DIR_FAR.clone().negate());
    const qSite = alignTool(toolN, s.n.clone().negate());
    const q = qFar.clone().slerp(qSite, k);
    // departure (return phase): turn the engines to the asteroid and back away
    s.dep += ((departing ? 1 : 0) - s.dep) * (1 - Math.exp(-dt * (departing ? 0.08 : 0.6)));
    const dep = smooth(s.dep);
    if (dep > 0.001) q.slerp(new Quaternion().setFromUnitVectors(Y, s.n), smooth(s.dep * 3));

    // ---- position ----
    const standT = stand;
    const pv = s.stand;
    s.stand += (standT - s.stand) * (1 - Math.exp(-dt * (p.sampling === 'grab' ? 1.6 : 0.9)));
    s.standV = (s.stand - pv) / Math.max(dt, 1e-3);
    const far = DIR_FAR.clone().multiplyScalar(RADIUS + 3 + approachDistance(s.a));
    const hover = s.S.clone().addScaledVector(s.n, s.stand).sub(toolP.clone().applyQuaternion(q));
    const pos = far.lerp(hover, k);
    pos.addScaledVector(s.n, dep * 140);
    const bob = reducedMotion ? 0 : Math.sin(time * 0.7) * 0.05 * (p.sampling === 'grab' ? 0.2 : 1);
    pos.addScaledVector(s.n, bob);
    if (!s.init) { s.pos.copy(pos); s.quat.copy(q); }
    s.pos.lerp(pos, 1 - Math.exp(-dt * 3));
    s.quat.slerp(q, 1 - Math.exp(-dt * 2.5));
    g.position.copy(s.pos);
    g.quaternion.copy(s.quat);

    // ---- arm / drill / lid ----
    s.jerkT -= dt;
    if (jam && !reducedMotion) {
      if (s.jerkT <= 0) { s.jerkT = 0.32 + Math.random() * 0.4; s.jerk = (Math.random() - 0.5) * 0.18; s.sparkBurst = 0.16; }
    } else s.jerk *= Math.exp(-dt * 8);
    s.sparkBurst = Math.max(0, s.sparkBurst - dt);
    s.reach += (arm.reach - s.reach) * (1 - Math.exp(-dt * (jam ? 3 : 0.9)));
    s.claw += (arm.claw - s.claw) * (1 - Math.exp(-dt * 2.2));
    if (rig.toolId === 'robotic_arm') poseArm(rig.arm, s.reach, s.claw, s.jerk);
    if (rig.toolId === 'drill') {
      const spinning = !off('drill') && (p.sampling === 'grab' || (p.sampling === 'reach' && s.reach > 0.6));
      if (spinning && !(jam && s.jerkT > 0.2)) s.drillA += dt * (p.sampling === 'grab' ? 14 : 4);
      poseDrill(rig.arm, s.reach, s.drillA + s.jerk * 3);
    }
    s.lid += (lidT - s.lid) * (1 - Math.exp(-dt * 1.6));
    if (rig.lid) {
      const rest = rig.lid.userData.restQuaternion as Quaternion | undefined;
      rig.lid.quaternion.copy(rest ?? rig.lid.quaternion).multiply(tq.setFromAxisAngle(X, -1.05 * smooth(s.lid)));
    }
    g.updateMatrixWorld(true);
    if (rig.tip) rig.tip.getWorldPosition(s.contact); else s.contact.copy(s.S);
    if (rig.arm.pivot_arm_3) rig.arm.pivot_arm_3.getWorldPosition(s.elbow); else s.elbow.copy(s.contact);
    s.grabT += dt;
    s.nodeT -= dt;
    if (s.nodeT <= 0) { s.nodeT = 0.4; nodeWorld(g, node, s.nodeP); }

    // ---- jets ----
    s.burn += ((Math.abs(da) > 0.0015 && s.a < 0.92 ? Math.min(1, Math.abs(da) * 60) : 0) - s.burn) * (1 - Math.exp(-dt * 4));
    s.pulseT -= dt;
    if (s.pulseT <= 0) { s.pulseT = 1.2 + Math.random() * 1.6; s.pulseI = Math.floor(Math.random() * 4); s.pulse = 0.28; }
    s.pulse = Math.max(0, s.pulse - dt);

    // ---- debris hit flash ----
    s.hit = Math.max(0, s.hit - dt * 1.7);
    s.hitP.copy(camera.position).sub(s.pos).normalize().multiplyScalar(1.1).add(s.pos).addScaledVector(s.n, 0.4).addScaledVector(UP, 0.7);
    if (hitGlow.current) {
      hitGlow.current.visible = s.hit > 0.01;
      hitGlow.current.position.copy(s.hitP);
      hitGlow.current.lookAt(camera.position);
      hitGlow.current.scale.setScalar(1.5 + 2.5 * s.hit);
      (hitMat.uniforms.uO as { value: number }).value = s.hit;
    }
    if (hitLight.current) { hitLight.current.position.copy(s.hitP); hitLight.current.intensity = 30 * s.hit; }
    if (sparkLight.current) {
      sparkLight.current.position.copy(s.elbow);
      sparkLight.current.intensity = jam && s.sparkBurst > 0 ? 8 : 0;
    }

    // ---- camera ----
    const t1 = new Vector3().crossVectors(s.n, UP);
    if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = new Vector3().crossVectors(t1, s.n).normalize();
    // near: from the side, between the surface and the craft (arm + site + horizon in frame)
    const d = s.pos.distanceTo(s.S);
    const mid = s.S.clone().lerp(s.pos, 0.5);
    const camNear = mid.clone().addScaledVector(t1, 5.4 + d * 0.85).addScaledVector(s.n, 1.2 + d * 0.25).addScaledVector(t2, 2.2);
    const lookNear = mid;
    const t1f = new Vector3().crossVectors(DIR_FAR, UP).normalize();
    // far: behind and well to the side of the craft; look a fixed distance ahead so craft + asteroid share the frame
    const camFar = s.pos.clone().addScaledVector(DIR_FAR, 8).addScaledVector(t1f, 3.4).addScaledVector(UP, 2.6);
    const toRock = s.pos.clone().negate().normalize();
    const lookFar = s.pos.clone().addScaledVector(toRock, Math.min(6, s.pos.length() * 0.3));
    const cam = camFar.lerp(camNear, k);
    const look = lookFar.lerp(lookNear, k);
    if (dep > 0.001) {
      cam.lerp(s.pos.clone().addScaledVector(s.n, 7).addScaledVector(t1, 8).addScaledVector(t2, 3), smooth(s.dep * 2));
      look.lerp(s.pos.clone().lerp(new Vector3(), 0.22), smooth(s.dep * 2));
    }
    if (!s.init) { s.cam.copy(cam); s.look.copy(look); s.init = true; }
    s.cam.lerp(cam, 1 - Math.exp(-dt * 2.4));
    s.look.lerp(look, 1 - Math.exp(-dt * 3));
    camera.position.copy(s.cam);
    camera.lookAt(s.look);
    if (s.shake > 0) {
      s.shake = Math.max(0, s.shake - dt);
      if (!reducedMotion) {
        const amp = 0.08 * s.shake;
        camera.position.x += (Math.random() - 0.5) * amp; camera.position.y += (Math.random() - 0.5) * amp;
      }
    }
    s.noise += (noiseTarget - s.noise) * (1 - Math.exp(-dt * 3));
  });

  const kind = crisis?.kind ?? null;
  const onHit = () => {
    if (kind !== 'debris_alert') return;
    const s = st.current;
    s.hit = 1;
    s.sparkBurst = 0.2;
    if (!reducedMotion) s.shake = 0.45;
  };
  // debris crosses the screen (camera right → left, a little downwards) through the craft's position
  const debrisFrame = useMemo(() => {
    const along = new Vector3(), up = new Vector3();
    return {
      centre: () => st.current.pos,
      along: () => along.setFromMatrixColumn(camera.matrixWorld, 0).negate().addScaledVector(up.setFromMatrixColumn(camera.matrixWorld, 1), -0.25).normalize(),
      up: () => up.setFromMatrixColumn(camera.matrixWorld, 1),
    };
  }, [camera]);

  const thrusterStrength = (i: number) => () => {
    if (off('chem_thrusters')) return 0;
    const s = st.current;
    const nearK = s.k;
    const pulse = s.pulse > 0 && s.pulseI === i % 4 && nearK > 0.15 && s.dep < 0.05 ? 1 : 0;
    const move = Math.min(1, Math.abs(s.standV) * 1.2) * (i % 2 === 0 ? 1 : 0.6);
    return Math.max(pulse, move, s.burn * 0.5);
  };

  return (
    <>
      <group ref={craft}>
        <Craft build={build} stats={stats} role={null} reducedMotion={reducedMotion} mission="asteroid" fx={fx} />
      </group>
      {rig.nozzles.map((n, i) => <Jet key={n.uuid} node={n} strength={thrusterStrength(i)} length={0.55} reducedMotion={reducedMotion} />)}
      {rig.main.map((n) => (
        <Jet key={n.uuid} node={n} strength={() => (off('chem_main_engine') ? 0 : st.current.burn)} length={1.6} reducedMotion={reducedMotion} />
      ))}
      {rig.beams.map((n) => <IonBeam key={n.uuid} node={n} strength={() => (beamOn ? 1 : 0)} reducedMotion={reducedMotion} />)}

      {/* dust on the grab: a burst, then a thin trickle, drifting off the surface (no gravity to speak of) */}
      <Emitter
        count={reducedMotion ? 60 : 160} life={[1.2, 2.8]} size={[0.12, 0.5]} color={['#EADFC8', '#9A90A6']} alpha={[0.9, 0]} drag={0.35}
        rate={() => (p.sampling === 'grab' && st.current.k > 0.8 && !off(rig.toolId ?? '') ? (st.current.grabT < 1.4 ? (reducedMotion ? 50 : 120) : 10) : 0)}
        spawn={(o) => {
          const s = st.current;
          o.p.copy(s.contact).addScaledVector(s.n, -0.05);
          const t1 = new Vector3().crossVectors(s.n, UP).normalize();
          const t2 = new Vector3().crossVectors(t1, s.n);
          const a = Math.random() * Math.PI * 2, sp = 0.3 + Math.random() * 0.9;
          o.v.copy(s.n).multiplyScalar(0.25 + Math.random() * 0.6).addScaledVector(t1, Math.cos(a) * sp).addScaledVector(t2, Math.sin(a) * sp);
        }}
      />
      {/* sparks: arm jam at the elbow, debris hit on the hull, power drop on the node */}
      <Emitter
        count={reducedMotion ? 40 : 120} additive life={[0.3, 0.7]} size={[0.1, 0.03]} color={['#FFFBEA', '#FF9A4A']} alpha={[1, 0.1]} drag={0.2}
        rate={() => {
          const s = st.current;
          if (s.sparkBurst <= 0) return kind === 'power_drop' && !reducedMotion && (Math.sin(performance.now() / 180) > 0.85) ? 160 : 0;
          return reducedMotion ? 70 : 240;
        }}
        spawn={(o) => {
          const s = st.current;
          o.p.copy(s.hit > 0.3 ? s.hitP : kind === 'power_drop' ? s.nodeP : s.elbow);
          o.v.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
        }}
      />
      <pointLight ref={sparkLight} color="#FFD25C" distance={5} decay={1.5} intensity={0} />
      <pointLight ref={hitLight} color="#FFC27A" distance={9} decay={1.4} intensity={0} />
      <mesh ref={hitGlow} material={hitMat} visible={false} renderOrder={7}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <Debris active={p.debris} centre={debrisFrame.centre} along={debrisFrame.along} up={debrisFrame.up} onHit={onHit} reducedMotion={reducedMotion} />
      <StaticNoise level={() => st.current.noise} reducedMotion={reducedMotion} />
    </>
  );
}

function spinQ(g: Group | null, phi: number) {
  if (g) g.quaternion.setFromAxisAngle(TUMBLE_AXIS, phi);
}

/** Rotation taking the tool's slot normal onto `down` (toward the surface), twisted so the craft's +Y stays near world up. */
function alignTool(toolN: Vector3, down: Vector3): Quaternion {
  const q1 = new Quaternion().setFromUnitVectors(toolN.clone().normalize(), down);
  const yAfter = Y.clone().applyQuaternion(q1);
  const proj = (v: Vector3) => v.clone().addScaledVector(down, -v.dot(down));
  const a = proj(yAfter), b = proj(UP);
  if (a.lengthSq() < 1e-4 || b.lengthSq() < 1e-4) return q1;
  a.normalize(); b.normalize();
  const ang = Math.atan2(new Vector3().crossVectors(a, b).dot(down), a.dot(b));
  return new Quaternion().setFromAxisAngle(down, ang).multiply(q1);
}

/** World position of a component's module (centre of its unit group), for power-drop sparks. */
function nodeWorld(craft: Object3D | null, id: string | null, out: Vector3): Vector3 {
  const o = craft && id ? craft.getObjectByName(`unit_${id}`) : null;
  if (!o) return craft ? craft.getWorldPosition(out) : out.set(0, -999, 0);
  return o.getWorldPosition(out);
}
