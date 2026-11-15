// Capsule return (M3): Earth with turning clouds, the return capsule separates from the craft, re-entry (glowing
// heat_shield + plasma trail), parachute opening (pivot_chute 0 → 1), touchdown on the steppe (or ocean),
// blinking recovery beacon + a search helicopter when found, a dark silent beacon when lost. Camera follows the capsule.
// Pure component: everything comes from props (docs/04 Tech/M3 Asteroid Contract.md, section C).
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AdditiveBlending, BackSide, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, ShaderMaterial, SphereGeometry, Vector3,
  type Material, type MeshToonMaterial, type PointLight,
} from 'three';
import type { Build } from '../engine';
import { MISSIONS } from '../engine/data/missions';
import { computeStats } from '../engine/stats';
import {
  chuteAltitude, chuteOpen, entryAltitude, entryHeat, returnWorld, separation, smooth,
} from './asteroid/timeline';
import type { ReturnSceneProps } from './asteroid/types';
import { Craft } from './Craft';
import { SkyDome, glowMaterial } from './flight/Effects';
import { Emitter } from './flight/Particles';
import { SCENE_MODELS, useComponentModel, useEnvModel, useModelsReady } from './models/loader';
import { markOwnMaterial, toonGradient, toonify } from './models/toon';
import { DEV_FPS, FpsProbe, QStars, QualityProvider, qualityDpr, qualityGl } from './quality';
import { useT } from '../i18n';

export type { ReturnSceneProps } from './asteroid/types';

const WRAP: CSSProperties = { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' };
const FADE: CSSProperties = { position: 'absolute', inset: 0, background: '#0B1030', pointerEvents: 'none', opacity: 0 };

const LOADING: CSSProperties = {
  position: 'absolute', inset: 0, display: 'grid', placeContent: 'center', gap: 6, textAlign: 'center', pointerEvents: 'none',
  fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#CFE8FF', transition: 'opacity 0.5s ease-out',
};

export function ReturnScene(props: ReturnSceneProps) {
  const t = useT();
  const world = returnWorld(props.capsule);
  // M5: the capsule set + Earth are preloaded during the asteroid flight; until they (and the first frame) are in,
  // a placeholder in the set's colours instead of a black canvas.
  const modelsReady = useModelsReady(SCENE_MODELS.return);
  const [drawn, setDrawn] = useState(false);
  const ready = modelsReady && drawn;
  return (
    <div style={{ ...WRAP, background: world === 'space' ? '#03040A' : '#9CCBF0' }}>
      <Canvas dpr={qualityDpr(props.quality)} camera={{ fov: 48, near: 0.1, far: 3000, position: [0, 30, 30] }} gl={qualityGl(props.quality)}>
        <QualityProvider quality={props.quality}>
          <ReturnWorld {...props} />
          {modelsReady && !drawn && <AfterFrames n={2} onDone={() => setDrawn(true)} />}
          {DEV_FPS && <FpsProbe />}
        </QualityProvider>
      </Canvas>
      <div aria-hidden={ready} data-testid="return-loading" style={{
        ...LOADING, opacity: ready ? 0 : 1,
        background: world === 'space' ? 'radial-gradient(ellipse at 50% 40%, #1C2452 0%, #0E1330 55%, #03040A 100%)' : 'linear-gradient(#9CCBF0, #DDEBF7)',
        color: world === 'space' ? '#CFE8FF' : '#0E1330',
      }}>
        <b style={{ letterSpacing: '0.12em' }}>{t('scene.capsule')}</b>
        <span style={{ opacity: 0.7 }}>{t('scene.loadingReturn')}</span>
      </div>
      {/* a soft cut when the set changes (space ↔ sky) */}
      <div key={world} style={{ ...FADE, animation: props.reducedMotion ? undefined : 'sm-return-cut 0.9s ease-out' }} />
      <style>{'@keyframes sm-return-cut{0%{opacity:1}100%{opacity:0}}'}</style>
    </div>
  );
}

/** Calls onDone after `n` frames have been rendered (shaders compiled, first image on screen). */
function AfterFrames({ n, onDone }: { n: number; onDone: () => void }) {
  const left = useRef(n);
  const done = useRef(onDone);
  done.current = onDone;
  useFrame(() => { if (left.current > 0 && --left.current === 0) done.current(); });
  return null;
}

// ---------- shared ----------

const CAPSULE_SET = ['return_capsule', 'heat_shield', 'parachute', 'recovery_beacon'] as const;
const EARTH_R = 100;
const EARTH_C = new Vector3(0, -EARTH_R - 24, 0);
const SUN_SPACE = new Vector3(-0.5, 0.55, 0.65).normalize();
const SUN_SKY = new Vector3(0.45, 0.7, 0.4).normalize();
/** Canopy scale when fully open (the authored canopy is small next to the capsule). */
const CHUTE_FULL = 2.4;
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

function ReturnWorld(p: ReturnSceneProps) {
  const world = returnWorld(p.capsule);
  const cap = useCapsule(p.build);
  return (
    <>
      {world === 'space' ? <SpaceSet reducedMotion={p.reducedMotion} /> : <SkySet {...p} />}
      <CapsuleRig {...p} cap={cap} />
    </>
  );
}

// ---------- capsule assembly (own clones; materials we light up are per-instance) ----------

interface CapsuleRigParts {
  root: Group;
  chute: Object3D | null;
  shieldGlow: MeshToonMaterial[];
  beaconGlow: MeshToonMaterial[];
  beaconAt: Object3D;
  shieldAt: Object3D;
  hasShield: boolean;
  hasChute: boolean;
  hasBeacon: boolean;
}

function useCapsule(build: Build): CapsuleRigParts {
  const capsule = useComponentModel('return_capsule');
  const shield = useComponentModel('heat_shield');
  const chute = useComponentModel('parachute');
  const beacon = useComponentModel('recovery_beacon');
  const has = (id: string) => (build[id] ?? 0) > 0;
  // Clones: the memo may run twice (StrictMode) and must not move shared instances between roots.
  return useMemo(() => {
    const root = new Group();
    const body = capsule?.scene.clone() ?? placeholderCapsule();
    root.add(body);
    const mountOf = (name: string, fallback: [number, number, number]) => {
      const m = body.getObjectByName(name);
      const g = new Group();
      if (m) { body.updateMatrixWorld(true); m.matrixWorld.decompose(g.position, g.quaternion, g.scale); } else g.position.set(...fallback);
      root.add(g);
      return g;
    };
    const shieldAt = mountOf('mount_heat_shield', [0, 0.12, 0]);
    const chuteAt = mountOf('mount_parachute', [0, 0.57, 0]);
    const beaconAt = mountOf('mount_beacon', [0, 0.31, 0.32]);
    const shieldGlow: MeshToonMaterial[] = [];
    const beaconGlow: MeshToonMaterial[] = [];
    if (has('heat_shield')) {
      const s = shield?.scene.clone() ?? placeholderShield();
      shieldAt.add(s);
      shieldGlow.push(...ownEmissive(s, '#FF7A2E'));
    }
    let pivot: Object3D | null = null;
    if (has('parachute')) {
      const c = chute?.scene.clone() ?? placeholderChute();
      chuteAt.add(c);
      pivot = c.getObjectByName('pivot_chute') ?? null;
    }
    if (has('recovery_beacon')) {
      const b = beacon?.scene.clone() ?? placeholderBeacon();
      beaconAt.add(b);
      beaconGlow.push(...ownEmissive(b, '#FFD25C'));
    }
    return {
      root, chute: pivot, shieldGlow, beaconGlow, beaconAt, shieldAt,
      hasShield: has('heat_shield'), hasChute: has('parachute'), hasBeacon: has('recovery_beacon'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capsule, shield, chute, beacon, build.heat_shield, build.parachute, build.recovery_beacon]);
}

/** Per-instance copies of the emissive materials under `root` (so the stand / constructor never glows). */
function ownEmissive(root: Object3D, fallback: string): MeshToonMaterial[] {
  const out: MeshToonMaterial[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh) || o.userData.inkOutline || Array.isArray(o.material)) return;
    const m = o.material as Material & { emissive?: Color; emissiveIntensity?: number };
    const glowing = m.name === 'M_Emissive' || (m.emissive && m.emissive.getHex() !== 0);
    if (!glowing) return;
    const own = m.clone() as MeshToonMaterial;
    if (own.emissive.getHex() === 0) own.emissive = new Color(fallback);
    own.userData.base = own.emissive.clone();
    o.material = own;
    markOwnMaterial(o);
    out.push(own);
  });
  return out;
}

const toonMat = (c: string, emissive?: string) => new MeshStandardMaterial({ color: c, emissive: emissive ?? '#000000', flatShading: true });
function placeholderCapsule(): Object3D {
  const g = new Group();
  const m = new Mesh(new CylinderGeometry(0.16, 0.38, 0.42, 20), toonMat('#F2EAD8'));
  m.position.y = 0.33;
  g.add(m);
  toonify(g, { castShadow: false });
  return g;
}
function placeholderShield(): Object3D {
  const g = new Group();
  const m = new Mesh(new SphereGeometry(0.4, 20, 8, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), toonMat('#5A4636', '#FF7A2E'));
  m.position.y = 0.2;
  (m.material as MeshStandardMaterial).emissiveIntensity = 0.05;
  g.add(m);
  toonify(g, { castShadow: false });
  return g;
}
function placeholderChute(): Object3D {
  const g = new Group();
  const pivot = new Group(); pivot.name = 'pivot_chute'; pivot.position.y = 0.18;
  const canopy = new Mesh(new SphereGeometry(1.05, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), toonMat('#FF9A4A'));
  canopy.position.y = 1.2; canopy.scale.y = 0.6;
  pivot.add(canopy);
  g.add(pivot);
  toonify(g, { castShadow: false });
  return g;
}
function placeholderBeacon(): Object3D {
  const g = new Group();
  const m = new Mesh(new CylinderGeometry(0.03, 0.04, 0.14, 10), toonMat('#FFD25C', '#FFD25C'));
  m.position.y = 0.07;
  g.add(m);
  toonify(g, { castShadow: false });
  return g;
}

// ---------- space set: stars, sun, big Earth with turning clouds ----------

function SpaceSet({ reducedMotion }: { reducedMotion: boolean }) {
  const earth = useEnvModel('earth');
  const clouds = useMemo(() => earth?.scene.getObjectByName('pivot_clouds') ?? null, [earth]);
  // the model's low-poly atmosphere shell reads as a grey slab this close → a smooth fresnel halo instead
  useEffect(() => {
    const atm = earth?.scene.getObjectByName('atmosphere');
    if (atm) atm.visible = false;
  }, [earth]);
  const halo = useMemo(() => new ShaderMaterial({
    side: BackSide, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
    uniforms: { uC: { value: new Color('#7FC4FF') } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uC; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(vN, vV)); float a = pow(f, 0.6) * smoothstep(0.0, 0.35, abs(dot(vN, vV))) * 0.9; gl_FragColor = vec4(uC * a, a); }`,
  }), []);
  useFrame((_, dt) => { if (clouds && !reducedMotion) clouds.rotation.y += dt * 0.012; });
  return (
    <>
      <color attach="background" args={['#03040A']} />
      <QStars radius={900} depth={80} count={reducedMotion ? 1500 : 2400} factor={7} fade speed={0} />
      <ambientLight intensity={0.2} />
      <hemisphereLight args={['#CFE8FF', '#1A2040', 0.5]} />
      <directionalLight position={SUN_SPACE.clone().multiplyScalar(200).toArray()} intensity={2.3} color="#FFF4E0" />
      <group position={EARTH_C.toArray()} rotation={[0.35, 4.3, 0.1]}>
        {earth ? <primitive object={earth.scene} scale={EARTH_R / 3} /> : <PlaceholderEarth />}
      </group>
      <mesh position={EARTH_C.toArray()} material={halo} renderOrder={1}>
        <sphereGeometry args={[EARTH_R * 1.045, 96, 48]} />
      </mesh>
    </>
  );
}

function PlaceholderEarth() {
  return (
    <mesh>
      <sphereGeometry args={[EARTH_R, 48, 24]} />
      <meshToonMaterial color="#2D6FB3" gradientMap={toonGradient()} />
    </mesh>
  );
}

// ---------- sky set: sky dome, steppe / ocean, clouds, helicopter ----------

function SkySet(p: ReturnSceneProps) {
  const lost = p.capsule === 'lost';
  const ocean = p.landing === 'ocean';
  return (
    <>
      <fog attach="fog" args={[lost ? '#8E6A70' : '#BFE3FF', 60, 420]} />
      <SkyDome top={lost ? '#232A5E' : '#3C7FD8'} horizon={lost ? '#D98A6A' : '#CFEAFF'} bottom={ocean ? '#2D6FB3' : '#C9B27A'} radius={900} />
      <hemisphereLight args={[lost ? '#C9A0A8' : '#E8F4FF', ocean ? '#1E4E80' : '#5A4A40', lost ? 0.55 : 1.0]} />
      <directionalLight position={SUN_SKY.clone().multiplyScalar(120).toArray()} intensity={lost ? 0.6 : 1.6} color={lost ? '#FFB27A' : '#FFF4E0'} />
      {ocean ? <Ocean reducedMotion={p.reducedMotion} /> : <Steppe />}
      <Clouds />
      {p.capsule === 'found' && <Helicopter reducedMotion={p.reducedMotion} />}
    </>
  );
}

function Steppe() {
  const tufts = useMemo(() => {
    const n = 500;
    const geo = new ConeGeometry(0.18, 0.6, 5);
    geo.translate(0, 0.3, 0);
    const mesh = new InstancedMesh(geo, new MeshStandardMaterial({ color: '#8E9A4E', flatShading: true }), n);
    const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), v = new Vector3();
    for (let i = 0; i < n; i++) {
      const a = i * 2.399, r = 2.2 + Math.sqrt(i / n) * 90;
      v.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      q.setFromAxisAngle(Y, a * 3);
      const k = 0.6 + ((i * 37) % 10) / 10;
      s.set(k, k * (0.8 + ((i * 13) % 7) / 10), k);
      mesh.setMatrixAt(i, m.compose(v, q, s));
    }
    toonify(mesh, { outlines: false, castShadow: false });
    return mesh;
  }, []);
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <circleGeometry args={[900, 48]} />
        <meshToonMaterial color="#C9B27A" gradientMap={toonGradient()} />
      </mesh>
      {/* low far hills */}
      {[[-140, -260, 90], [180, -300, 120], [320, 40, 80], [-300, 120, 100]].map(([x, z, r], i) => (
        <mesh key={i} position={[x, -r * 0.82, z]}>
          <sphereGeometry args={[r, 20, 10]} />
          <meshToonMaterial color={i % 2 ? '#B9A36C' : '#A9955F'} gradientMap={toonGradient()} />
        </mesh>
      ))}
      <primitive object={tufts} />
    </>
  );
}

function Ocean({ reducedMotion }: { reducedMotion: boolean }) {
  const ring = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current || reducedMotion) return;
    const k = (clock.elapsedTime * 0.35) % 1;
    ring.current.scale.setScalar(1 + k * 3);
    (ring.current.material as MeshStandardMaterial).opacity = 0.5 * (1 - k);
  });
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[900, 48]} />
        <meshToonMaterial color="#2D6FB3" gradientMap={toonGradient()} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.7, 0.85, 32]} />
        <meshBasicMaterial color="#F7FBFF" transparent opacity={0.4} depthWrite={false} />
      </mesh>
    </>
  );
}

/** Flat comic cloud puffs around the descent column (they pass by while the chute comes down). */
function Clouds() {
  const g = useMemo(() => {
    const root = new Group();
    const mat = new MeshStandardMaterial({ color: '#FFFFFF', flatShading: true });
    const geo = new IcosahedronGeometry(1, 1);
    const spots = [[-14, 46, -18, 5], [12, 34, -24, 6], [-22, 26, 8, 4], [18, 58, 6, 5], [-8, 72, 20, 6], [26, 22, -40, 7], [-40, 40, -60, 9], [50, 64, -30, 8]];
    for (const [x, y, z, r] of spots) {
      const c = new Group();
      for (let i = 0; i < 4; i++) {
        const b = new Mesh(geo, mat);
        b.position.set((i - 1.5) * r * 0.55, (i % 2) * r * 0.15, ((i * 7) % 3 - 1) * r * 0.25);
        b.scale.set(r * (0.7 + (i % 2) * 0.25), r * 0.42, r * 0.6);
        c.add(b);
      }
      c.position.set(x, y, z);
      root.add(c);
    }
    toonify(root, { castShadow: false });
    return root;
  }, []);
  return <primitive object={g} />;
}

/** Search helicopter: a simple toon body circling with a searchlight cone (static hover with reducedMotion). */
function Helicopter({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<Group>(null);
  const rotor = useRef<Object3D | null>(null);
  const beam = useRef<Mesh>(null);
  const heli = useMemo(() => {
    const g = new Group();
    const body = new Mesh(new SphereGeometry(0.9, 16, 10), toonMat('#E8533F'));
    body.scale.set(1, 0.85, 1.5);
    const glass = new Mesh(new SphereGeometry(0.6, 12, 8), toonMat('#9FD8FF'));
    glass.position.set(0, 0.15, 0.9); glass.scale.set(1, 0.8, 0.7);
    const tail = new Mesh(new BoxGeometry(0.22, 0.22, 2.6), toonMat('#E8533F'));
    tail.position.set(0, 0.2, -2.1);
    const fin = new Mesh(new BoxGeometry(0.08, 0.7, 0.4), toonMat('#F2EAD8'));
    fin.position.set(0, 0.5, -3.3);
    const skidL = new Mesh(new BoxGeometry(0.08, 0.08, 2.2), toonMat('#3A3550'));
    skidL.position.set(0.6, -0.95, 0);
    const skidR = skidL.clone(); skidR.position.x = -0.6;
    const mast = new Mesh(new CylinderGeometry(0.06, 0.06, 0.4, 8), toonMat('#3A3550'));
    mast.position.y = 0.9;
    const r = new Group(); r.position.y = 1.1;
    for (let i = 0; i < 2; i++) {
      const blade = new Mesh(new BoxGeometry(0.16, 0.04, 5.2), toonMat('#3A3550'));
      blade.rotation.y = (i * Math.PI) / 2;
      r.add(blade);
    }
    g.add(body, glass, tail, fin, skidL, skidR, mast, r);
    toonify(g, { castShadow: false });
    rotor.current = r;
    return g;
  }, []);
  const tmp = useMemo(() => new Vector3(), []);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = clock.elapsedTime;
    const a = reducedMotion ? 0.9 : t * 0.3;
    g.position.set(Math.cos(a) * 10, 8 + (reducedMotion ? 0 : Math.sin(t * 0.8) * 0.4), Math.sin(a) * 10);
    // nose along the circle, banked inwards
    g.rotation.set(0, -a, reducedMotion ? 0 : 0.18, 'YXZ');
    if (rotor.current) rotor.current.rotation.y += dt * (reducedMotion ? 4 : 22);
    if (beam.current) {
      // from the helicopter down to the capsule (at the origin)
      const from = g.position;
      beam.current.position.copy(from).multiplyScalar(0.5);
      beam.current.scale.set(1, from.length(), 1);
      beam.current.quaternion.setFromUnitVectors(Y, tmp.copy(from).normalize());
    }
  });
  return (
    <>
      <group ref={ref}><primitive object={heli} /></group>
      <mesh ref={beam} renderOrder={4}>
        <cylinderGeometry args={[0.15, 2.2, 1, 18, 1, true]} />
        <meshBasicMaterial color="#FFF2C8" transparent opacity={0.16} depthWrite={false} side={DoubleSide} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
    </>
  );
}

// ---------- the capsule, its effects and the camera ----------

function CapsuleRig(p: ReturnSceneProps & { cap: CapsuleRigParts }) {
  const { cap, capsule: stage, reducedMotion } = p;
  const world = returnWorld(stage);
  const { camera } = useThree();
  const capRef = useRef<Group>(null);
  const mother = useRef<Group>(null);
  const beaconLight = useRef<PointLight>(null);
  const beaconSprite = useRef<Mesh>(null);
  const heatGlow = useRef<Mesh>(null);
  const sheath = useRef<Mesh>(null);
  const heatMat = useMemo(() => glowMaterial('#FFB060', 1), []);
  const beaconMat = useMemo(() => glowMaterial('#FFE07A', 1), []);
  const motherBuild = useMemo(() => {
    const b: Build = { ...p.build };
    for (const id of CAPSULE_SET) delete b[id];
    return b;
  }, [p.build]);
  const motherStats = useMemo(() => ({ ...computeStats(motherBuild, MISSIONS.asteroid), issues: [] }), [motherBuild]);

  const st = useRef({
    init: false, prog: p.capsuleProgress, stage, touch: 0, shake: 0, heat: 0,
    pos: new Vector3(), quat: new Quaternion(), vel: new Vector3(0, -1, 0), cam: new Vector3(), look: new Vector3(),
    orbit: 0.6,
  });
  // stage change: snap the smoothed progress, touchdown burst on landing
  useEffect(() => {
    const s = st.current;
    const prev = s.stage;
    s.stage = stage;
    s.prog = p.capsuleProgress;
    if (returnWorld(prev) !== returnWorld(stage)) s.init = false;
    if (stage === 'landed' && prev === 'chute') s.touch = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = st.current;
    const c = capRef.current;
    if (!c) return;
    const t = clock.elapsedTime;
    s.prog += (p.capsuleProgress - s.prog) * (1 - Math.exp(-dt * 1.5));
    const k = s.prog;
    const pos = new Vector3();
    const quat = new Quaternion();
    let heat = 0;
    let chute = 0;
    let beaconOn = false;
    const cam = new Vector3();
    const look = new Vector3();

    if (world === 'space') {
      // orbit frame at angle θ around Earth (+X = direction of travel, +Y = away from Earth)
      const at = (theta: number, h: number, out: Vector3) => out.set(Math.sin(theta), Math.cos(theta), 0).multiplyScalar(EARTH_R + h).add(EARTH_C);
      const up = (theta: number) => new Vector3(Math.sin(theta), Math.cos(theta), 0);
      const fwd = (theta: number) => new Vector3(Math.cos(theta), -Math.sin(theta), 0);
      const th0 = -0.05, h0 = 24;
      const mPos = at(th0, h0, new Vector3());
      // mothership: deck (+Y) facing the direction of travel
      const mQuat = new Quaternion().setFromUnitVectors(Y, fwd(th0));
      if (mother.current) {
        mother.current.visible = stage !== 'entry';
        mother.current.position.copy(mPos);
        mother.current.quaternion.copy(mQuat);
      }
      const deck = new Vector3(0, 1.3, 0).applyQuaternion(mQuat).add(mPos);
      if (stage === 'stowed' || stage === 'separated') {
        const sep = stage === 'stowed' ? { distance: 0, flip: 0 } : separation(k);
        pos.copy(deck).addScaledVector(fwd(th0), sep.distance).addScaledVector(up(th0), -sep.distance * 0.18);
        quat.copy(mQuat).multiply(new Quaternion().setFromAxisAngle(Z, sep.flip));
        s.vel.copy(fwd(th0));
        const mid = pos.clone().lerp(mPos, 0.5);
        cam.copy(mid).addScaledVector(fwd(th0), -3.5).addScaledVector(up(th0), 3.2).add(new Vector3(0, 0, 9 + sep.distance * 0.4));
        look.copy(mid).addScaledVector(up(th0), -1.5);
      } else {
        // entry: forward and down into the atmosphere, shield first
        const th = th0 + 0.075 + 0.11 * smooth(k);
        const h = entryAltitude(k);
        at(th, h, pos);
        const ahead = at(th + 0.004, entryAltitude(Math.min(1, k + 0.03)), new Vector3());
        s.vel.copy(ahead).sub(pos).normalize();
        quat.setFromUnitVectors(Y, s.vel.clone().negate());
        heat = entryHeat(k);
        cam.copy(pos).addScaledVector(s.vel, -7).addScaledVector(up(th), 2.4).add(new Vector3(0, 0, 4.5));
        look.copy(pos).addScaledVector(s.vel, 3);
      }
    } else {
      // sky / ground: capsule over (0, 0); chute descent, then on the ground
      const ocean = p.landing === 'ocean';
      if (stage === 'chute') {
        const h = chuteAltitude(k);
        chute = chuteOpen(k);
        const sway = reducedMotion ? 0 : Math.sin(t * 0.9) * 0.07 * chute;
        pos.set(Math.sin(t * 0.45) * 0.3 * (reducedMotion ? 0 : 1), h, 0);
        quat.setFromAxisAngle(Z, sway);
        cam.copy(pos).add(new Vector3(6.5, -1.6 + chute * 1.2, 9.5));
        look.copy(pos).add(new Vector3(0, 1.4 + chute * 2.2, 0));
      } else {
        const bob = ocean && !reducedMotion ? Math.sin(t * 1.3) * 0.08 : 0;
        pos.set(0, (ocean ? -0.18 : 0.05) + bob, 0);
        quat.setFromAxisAngle(Z, ocean ? (reducedMotion ? 0 : Math.sin(t * 1.1) * 0.08) : 0.12);
        beaconOn = cap.hasBeacon && p.beacon && stage !== 'lost';
        const wide = stage === 'found';
        if (!reducedMotion) s.orbit += dt * (wide ? 0.05 : 0.08);
        const r = wide ? 17 : 7.5;
        cam.set(Math.cos(s.orbit) * r, wide ? 5 : 2.4, Math.sin(s.orbit) * r);
        look.set(0, wide ? 4 : 0.5, 0);
      }
    }

    // smooth (snap on a set change)
    if (!s.init) { s.pos.copy(pos); s.quat.copy(quat); s.cam.copy(cam); s.look.copy(look); s.init = true; }
    s.pos.lerp(pos, 1 - Math.exp(-dt * 4));
    s.quat.slerp(quat, 1 - Math.exp(-dt * 4));
    c.position.copy(s.pos);
    c.quaternion.copy(s.quat);
    s.cam.lerp(cam, 1 - Math.exp(-dt * 2.2));
    s.look.lerp(look, 1 - Math.exp(-dt * 3));
    camera.position.copy(s.cam);
    camera.lookAt(s.look);
    s.heat += (heat - s.heat) * (1 - Math.exp(-dt * 3));
    if (!reducedMotion && s.heat > 0.2) {
      const a = 0.03 * s.heat;
      camera.position.x += (Math.random() - 0.5) * a; camera.position.y += (Math.random() - 0.5) * a;
    }

    // heat shield glow + plasma sheath + hot sprite
    for (const m of cap.shieldGlow) {
      m.emissive.copy(m.userData.base as Color).lerp(WHITE_HOT, s.heat * 0.5);
      m.emissiveIntensity = 0.15 + 3.5 * s.heat;
    }
    const shieldW = cap.shieldAt.getWorldPosition(new Vector3());
    if (heatGlow.current) {
      heatGlow.current.visible = s.heat > 0.02;
      heatGlow.current.position.copy(shieldW).addScaledVector(s.vel, 0.3);
      heatGlow.current.lookAt(camera.position);
      heatGlow.current.scale.setScalar(0.9 + 1.8 * s.heat);
      (heatMat.uniforms.uO as { value: number }).value = Math.min(0.85, s.heat);
    }
    if (sheath.current) {
      sheath.current.visible = s.heat > 0.05;
      sheath.current.position.copy(shieldW).addScaledVector(s.vel, -0.75);
      sheath.current.quaternion.setFromUnitVectors(Y, s.vel);
      const f = reducedMotion ? 1 : 0.9 + 0.1 * Math.sin(t * 30);
      sheath.current.scale.set(1 + 0.2 * s.heat, (0.6 + 1.4 * s.heat) * f, 1 + 0.2 * s.heat);
      (sheath.current.material as MeshStandardMaterial).opacity = 0.28 * s.heat;
    }

    // parachute canopy: hidden while stowed, opens in 'chute', lies collapsed on the ground afterwards
    if (cap.chute) {
      const ground = world === 'sky' && stage !== 'chute';
      const open = ground ? 1 : chute;
      cap.chute.visible = open > 0.01;
      if (ground) {
        // tipped over and draped flat on the ground beside the capsule (local x → up after the turn)
        cap.chute.scale.set(CHUTE_FULL * 0.12, CHUTE_FULL * 0.75, CHUTE_FULL * 0.85);
        cap.chute.rotation.set(0, 0, 1.5);
        cap.chute.position.set(-0.1, -0.42, 0);
      } else {
        const sc = Math.max(0.001, open * CHUTE_FULL);
        cap.chute.scale.set(sc * (0.6 + 0.4 * open), sc, sc * (0.6 + 0.4 * open));
        cap.chute.rotation.set(0, 0, 0);
        cap.chute.position.set(0, 0.18, 0);
      }
    }

    // recovery beacon: slow blink (1.2 s, 25 % on) — steady with reducedMotion
    const phase = (t / 1.2) % 1;
    const lit = beaconOn && (reducedMotion || phase < 0.25);
    for (const m of cap.beaconGlow) m.emissiveIntensity = lit ? 2.4 : beaconOn ? 0.35 : 0;
    const bw = cap.beaconAt.getWorldPosition(new Vector3());
    if (beaconLight.current) { beaconLight.current.position.copy(bw); beaconLight.current.intensity = lit ? 4 : 0; }
    if (beaconSprite.current) {
      beaconSprite.current.visible = lit;
      beaconSprite.current.position.copy(bw).add(new Vector3(0, 0.12, 0));
      beaconSprite.current.lookAt(camera.position);
      beaconSprite.current.scale.setScalar(stage === 'found' ? 1.4 : 0.8);
    }
    s.touch = Math.max(0, s.touch - dt);
  });

  const trailOn = () => st.current.heat > 0.08;
  return (
    <>
      {world === 'space' && (
        <group ref={mother}>
          <Craft build={motherBuild} stats={motherStats} role={null} reducedMotion={reducedMotion} mission="asteroid" />
        </group>
      )}
      <group ref={capRef}><primitive object={cap.root} /></group>
      <mesh ref={heatGlow} material={heatMat} visible={false} renderOrder={6}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={sheath} visible={false} renderOrder={5}>
        <coneGeometry args={[0.5, 1.8, 20, 1, true]} />
        <meshBasicMaterial color="#FF7A2E" transparent opacity={0.25} depthWrite={false} side={DoubleSide} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={beaconSprite} material={beaconMat} visible={false} renderOrder={6}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <pointLight ref={beaconLight} color="#FFD25C" distance={8} decay={1.5} intensity={0} />
      {/* plasma trail streaming back from the shield */}
      <Emitter
        count={reducedMotion ? 80 : 180} additive life={[0.3, 0.8]} size={[0.32, 0.9]} color={['#FFC46A', '#FF3A1C']} alpha={[0.55, 0]} drag={0.5}
        rate={() => (trailOn() ? st.current.heat * (reducedMotion ? 80 : 200) : 0)}
        spawn={(o) => {
          const s = st.current;
          cap.shieldAt.getWorldPosition(o.p);
          // from the shield rim, streaming back past the capsule
          const a = Math.random() * Math.PI * 2;
          o.p.x += Math.cos(a) * 0.4; o.p.z += Math.sin(a) * 0.4; o.p.y += (Math.random() - 0.5) * 0.2;
          o.v.copy(s.vel).multiplyScalar(-(7 + Math.random() * 5));
          o.v.x += (Math.random() - 0.5) * 1.5; o.v.y += (Math.random() - 0.5) * 1.5; o.v.z += (Math.random() - 0.5) * 1.5;
        }}
      />
      {/* touchdown: dust (steppe) or spray (ocean) */}
      <Emitter
        count={90} life={[0.8, 1.8]} size={[0.4, 1.4]} color={p.landing === 'ocean' ? ['#F7FBFF', '#9FD8FF'] : ['#D8C38E', '#9C8A5E']} alpha={[0.8, 0]}
        gravity={p.landing === 'ocean' ? -6 : -0.6} drag={0.6} hard
        rate={() => (st.current.touch > 0.4 ? 160 : 0)}
        spawn={(o) => {
          const a = Math.random() * Math.PI * 2;
          o.p.set(Math.cos(a) * 0.4, 0.1, Math.sin(a) * 0.4);
          o.v.set(Math.cos(a) * (1.5 + Math.random() * 2), 0.8 + Math.random() * 2, Math.sin(a) * (1.5 + Math.random() * 2));
        }}
      />
    </>
  );
}

const WHITE_HOT = new Color('#FFF2C8');
