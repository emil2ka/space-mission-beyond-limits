// Titan flight (screen 15): tiled titan_terrain with a glinting methane lake, orange haze, dim low sun, light rain.
// The craft (the real build via <Craft>) flies on rotors entry → dunes → lake → crater by waypointIndex/Progress,
// sets down when route ≠ 'flying'. Crisis visuals by cause; camera behind-and-to-the-side, damped.
// Pure component: everything comes from props (docs/04 Tech/M1 Flight Contract.md, section C).
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Box3, CatmullRomCurve3, Color, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D,
  ShaderMaterial, Vector3, type PointLight,
} from 'three';
import { MISSIONS } from '../engine/data/missions';
import { computeStats } from '../engine/stats';
import { Craft, type CraftFx } from './Craft';
import { Rain, SkyDome, StaticNoise, glowMaterial } from './flight/Effects';
import { Emitter } from './flight/Particles';
import { ROUTE, noiseLevel, pointAltitude, routeParam, segmentAltitude } from './flight/route';
import type { TitanSceneProps } from './flight/types';
import { useEnvModel } from './models/loader';
import { toonGradient } from './models/toon';
import { DEV_FPS, FpsProbe, QualityProvider, qualityDpr, qualityGl } from './quality';

export type { TitanSceneProps } from './flight/types';

const WRAP: CSSProperties = { position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#C47A35' };

export function TitanScene(props: TitanSceneProps) {
  return (
    <div style={WRAP}>
      <Canvas dpr={qualityDpr(props.quality)} camera={{ fov: 50, near: 0.2, far: 150, position: [44, 34, 50] }} gl={qualityGl(props.quality)}>
        <QualityProvider quality={props.quality}>
          <TitanWorld {...props} />
          {DEV_FPS && <FpsProbe />}
        </QualityProvider>
      </Canvas>
    </div>
  );
}

const HAZE = '#C47A35';
const SUN_DIR = new Vector3(-0.62, 0.2, -0.76).normalize();
const TILE = 60;
/** Craft origin above the ground when landed (skids at −0.45 in frame coordinates). */
const SKID = 0.47;
/** Camera offset in the craft's heading frame: right, up, back (front = +Z). */
/** Hulls v2: the craft is ~0.55 m tall (was a 1.4 m drum) → camera ~25 % closer. */
const CAM_OFFSET = new Vector3(3.3, 2.2, -7.2);

const tmp = new Vector3();
const tmp2 = new Vector3();

/** Heightfield grid step, m (the craft and camera only need a smooth ground estimate). */
const HF_STEP = 0.5;

/**
 * Highest surface of one terrain tile on a regular XZ grid (tile-local coordinates), rasterized from its triangles once.
 * Device QA: replaces per-frame raycasts against 9 × the full terrain mesh (no BVH) — those were ~15 % of the frame
 * time and long tasks of 80 ms+ on a throttled CPU. Same answer as a ray from above: the top-most surface, 0 off the mesh.
 */
function makeHeightfield(tile: Object3D) {
  tile.updateMatrixWorld(true);
  const inv = tile.matrixWorld.clone().invert();
  const box = new Box3();
  const meshes: Mesh[] = [];
  tile.traverse((o) => { if (o instanceof Mesh && !o.userData.inkOutline && o.geometry.getAttribute('position')) meshes.push(o); });
  for (const m of meshes) box.union(new Box3().setFromObject(m).applyMatrix4(inv));
  const x0 = Math.floor(box.min.x / HF_STEP) * HF_STEP, z0 = Math.floor(box.min.z / HF_STEP) * HF_STEP;
  const nx = Math.ceil((box.max.x - x0) / HF_STEP) + 1, nz = Math.ceil((box.max.z - z0) / HF_STEP) + 1;
  const h = new Float32Array(nx * nz).fill(-Infinity);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const m4 = new Matrix4();
  for (const mesh of meshes) {
    m4.multiplyMatrices(inv, mesh.matrixWorld);
    const pos = mesh.geometry.getAttribute('position');
    const idx = mesh.geometry.index;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m4); b.fromBufferAttribute(pos, ib).applyMatrix4(m4); c.fromBufferAttribute(pos, ic).applyMatrix4(m4);
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(det) < 1e-9) continue; // vertical face: its top edge belongs to neighbours
      const gx0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - x0) / HF_STEP)), gx1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - x0) / HF_STEP));
      const gz0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - z0) / HF_STEP)), gz1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - z0) / HF_STEP));
      for (let gz = gz0; gz <= gz1; gz++) {
        const pz = z0 + gz * HF_STEP;
        for (let gx = gx0; gx <= gx1; gx++) {
          const px = x0 + gx * HF_STEP;
          const l1 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / det;
          const l2 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const y = l1 * a.y + l2 * b.y + l3 * c.y;
          const k = gz * nx + gx;
          if (y > h[k]) h[k] = y;
        }
      }
    }
  }
  const at = (gx: number, gz: number) => {
    if (gx < 0 || gz < 0 || gx >= nx || gz >= nz) return 0;
    const v = h[gz * nx + gx];
    return v === -Infinity ? 0 : v;
  };
  /** Bilinear height at a tile-local point. */
  return (lx: number, lz: number): number => {
    const fx = (lx - x0) / HF_STEP, fz = (lz - z0) / HF_STEP;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    return (at(ix, iz) * (1 - tx) + at(ix + 1, iz) * tx) * (1 - tz) + (at(ix, iz + 1) * (1 - tx) + at(ix + 1, iz + 1) * tx) * tz;
  };
}

/** Ground height sampler over the 3 × 3 tiles (tile = round(x / TILE)). Flat 0 when there is no terrain. */
export function makeGround(root: Object3D | null) {
  if (!root || !root.children.length) return () => 0;
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  // One heightfield in tile-local coordinates (every tile is a clone of the same terrain, moved / turned by quarter turns).
  const field = makeHeightfield(root.children[0]);
  const toLocal = new Map<Object3D, Matrix4>();
  for (const t of root.children) toLocal.set(t, new Matrix4().multiplyMatrices(rootInv, t.matrixWorld).invert());
  const byCell = new Map<string, Object3D>();
  for (const t of root.children) byCell.set(`${Math.round(t.position.x / TILE)},${Math.round(t.position.z / TILE)}`, t);
  return (x: number, z: number): number => {
    const t = byCell.get(`${Math.round(x / TILE)},${Math.round(z / TILE)}`);
    if (!t) return 0;
    tmp2.set(x, 0, z).applyMatrix4(toLocal.get(t)!);
    return field(tmp2.x, tmp2.z);
  };
}

function TitanWorld(p: TitanSceneProps) {
  const terrainModel = useEnvModel('titan_terrain');
  const curve = useMemo(() => new CatmullRomCurve3(ROUTE.map((r) => new Vector3(r.x, 0, r.z)), false, 'centripetal'), []);

  // 3 × 3 tiles, rotated by quarter turns so the repeat is less obvious (tile edges are at height 0).
  const tiles = useMemo(() => {
    const g = new Group();
    if (!terrainModel) return g;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const t = i === 0 && j === 0 ? terrainModel.scene : terrainModel.scene.clone();
      t.position.set(i * TILE, 0, j * TILE);
      t.rotation.y = ((((i + 1) * 3 + (j + 1)) * 7) % 4) * (Math.PI / 2) * (i === 0 && j === 0 ? 0 : 1);
      g.add(t);
    }
    g.updateMatrixWorld(true);
    return g;
  }, [terrainModel]);

  const ground = useMemo(() => makeGround(terrainModel ? tiles : null), [terrainModel, tiles]);

  // Route altitude profile from the sampled ground (once per terrain).
  const profile = useMemo(() => {
    const g = ROUTE.map((r) => ground(r.x, r.z));
    const alt = g.map((h, i) => pointAltitude(i, h));
    const gmax = [0, 1, 2].map((k) => {
      let m = -Infinity;
      for (let s = 1; s < 24; s++) { const q = curve.getPoint((k + s / 24) / 3); m = Math.max(m, ground(q.x, q.z)); }
      return m;
    });
    return { g, alt, gmax };
  }, [ground, curve]);

  const lake = useMemo(() => {
    const o = terrainModel?.scene.getObjectByName('lake');
    if (!o) return null;
    const box = new Box3().setFromObject(o);
    return { box, y: box.max.y + 0.02 };
  }, [terrainModel, tiles]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <fog attach="fog" args={[p.storm ? '#A9652B' : HAZE, p.storm ? 8 : 14, p.storm ? 80 : 110]} />
      <SkyDome top="#7E4119" horizon="#DE9446" bottom={HAZE} radius={120} />
      <Sun />
      <hemisphereLight args={['#F0B26A', '#5A3418', 1.0]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(60).toArray()} intensity={0.85} color="#FFC27A" />
      {terrainModel ? <primitive object={tiles} /> : <FlatGround />}
      {lake && <LakeGlint box={lake.box} y={lake.y} />}
      <Crater x={ROUTE[3].x} z={ROUTE[3].z} y={profile.g[3]} />
      <Markers waypointIndex={p.waypointIndex} waypointProgress={p.waypointProgress} ground={profile.g} />
      <Rain reducedMotion={p.reducedMotion} storm={!!p.storm} />
      <FlyingCraft {...p} curve={curve} profile={profile} ground={ground} />
    </>
  );
}

function FlatGround() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[TILE * 3, TILE * 3]} />
      <meshToonMaterial color="#B8742F" gradientMap={toonGradient()} />
    </mesh>
  );
}

/** Dim sun disc low in the haze, always on the far side of the dome. */
function Sun() {
  const ref = useRef<Mesh>(null);
  const mat = useMemo(() => glowMaterial('#FFE0A8', 0.55), []);
  useFrame(({ camera }) => {
    const m = ref.current;
    if (!m) return;
    m.position.copy(camera.position).addScaledVector(SUN_DIR, 140);
    m.lookAt(camera.position);
  });
  return (
    <mesh ref={ref} material={mat} renderOrder={-5}>
      <planeGeometry args={[34, 34]} />
    </mesh>
  );
}

/** Sun glint on the lake: the mirror point of the sun as seen from the camera, clamped to the lake bounds. */
function LakeGlint({ box, y }: { box: Box3; y: number }) {
  const ref = useRef<Mesh>(null);
  const mat = useMemo(() => glowMaterial('#FFF2C8', 0.9), []);
  useFrame(({ camera, clock }) => {
    const m = ref.current;
    if (!m) return;
    const c = camera.position;
    const t = (c.y - y) / Math.max(SUN_DIR.y, 0.05);
    // Mirror point if it is on the water; else the farthest water point on the camera → sun line (where a low
    // sun's glint shows); else hidden. Water ≈ the ellipse inscribed in the lake bbox, 70 %.
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const rx = (box.max.x - box.min.x) / 2, rz = (box.max.z - box.min.z) / 2;
    const wet = (px: number, pz: number) => Math.hypot((px - cx) / rx, (pz - cz) / rz) <= 0.7;
    const hx = SUN_DIR.x / Math.hypot(SUN_DIR.x, SUN_DIR.z), hz = SUN_DIR.z / Math.hypot(SUN_DIR.x, SUN_DIR.z);
    const mirror = Math.hypot(SUN_DIR.x * t, SUN_DIR.z * t);
    let best = -1;
    for (let s = 0; s <= 120; s += 1) if (wet(c.x + hx * s, c.z + hz * s)) { best = s; if (s >= mirror) break; }
    m.visible = best >= 0;
    const x = c.x + hx * best, z = c.z + hz * best;
    m.position.set(x, y + 0.05, z);
    (mat.uniforms.uO as { value: number }).value = 0.9 * (0.8 + 0.2 * Math.sin(clock.elapsedTime * 2.1));
  });
  return (
    <mesh ref={ref} material={mat} rotation={[-Math.PI / 2, 0, 0]} scale={[0.9, 0.9, 1]} renderOrder={3}>
      <planeGeometry args={[9, 9]} />
    </mesh>
  );
}

/** Crater at the last waypoint: a low toon rim around a dark floor. */
function Crater({ x, z, y }: { x: number; z: number; y: number }) {
  return (
    <group position={[x, y - 0.1, z]}>
      <mesh scale={[1, 0.32, 1]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[5.2, 1.5, 8, 28]} />
        <meshToonMaterial color="#9A5A26" gradientMap={toonGradient()} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <circleGeometry args={[5, 28]} />
        <meshToonMaterial color="#5E3416" gradientMap={toonGradient()} />
      </mesh>
    </group>
  );
}

/** Ground rings at the 3 points: cyan = current target, green = reached, faint = ahead. */
function Markers({ waypointIndex, waypointProgress, ground }: { waypointIndex: number; waypointProgress: number; ground: number[] }) {
  const s = routeParam(waypointIndex, waypointProgress);
  return (
    <>
      {ROUTE.slice(1).map((r, i) => {
        const reached = s >= i + 1 - 1e-3;
        const target = !reached && Math.min(2, Math.max(0, Math.round(waypointIndex))) === i;
        const color = reached ? '#4CD69A' : target ? '#5BE0E6' : '#F7F8FF';
        return (
          <mesh key={r.id} position={[r.x, ground[i + 1] + 0.12, r.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[2.3, 2.75, 32]} />
            <meshBasicMaterial color={color} transparent opacity={target ? 0.85 : reached ? 0.7 : 0.3} depthWrite={false} side={DoubleSide} />
          </mesh>
        );
      })}
    </>
  );
}

interface FlyProps extends TitanSceneProps {
  curve: CatmullRomCurve3;
  profile: { g: number[]; alt: number[]; gmax: number[] };
  ground: (x: number, z: number) => number;
}

/** Blink plan for Power Drop: 3 slow blinks (≈1.4 Hz, no strobe), then a steady warning glow. */
const BLINKS = 3;
const BLINK_MS = 360;

function FlyingCraft(p: FlyProps) {
  const { build, curve, profile, ground, reducedMotion, crisis } = p;
  const craft = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const beam = useRef<Mesh>(null);
  const sparkLight = useRef<PointLight>(null);
  const stats = useMemo(() => ({ ...computeStats(build, MISSIONS.titan), issues: [] }), [build]);
  const { camera } = useThree();

  const state = useRef({
    s: routeParam(p.waypointIndex, p.waypointProgress), land: airborne(p) ? 0 : 1, rotor: airborne(p) ? 1 : 0,
    yaw: 0, pitch: 0, roll: 0, init: false, groundY: 0, groundT: 0, camGround: 0, shake: 0, noise: 0,
    landAt: null as null | { x: number; z: number; y: number }, nodeLocal: null as null | Vector3, nodeT: 0, burst: 0,
  });
  const target = routeParam(p.waypointIndex, p.waypointProgress);
  const flying = airborne(p);

  // crisis start → shake + blink plan
  const crisisKey = crisis ? `${crisis.kind}:${crisis.nodeIds.join(',')}` : '';
  const [blink, setBlink] = useState(0); // 0..2*BLINKS: odd = lit
  useEffect(() => {
    state.current.nodeLocal = null;
    state.current.nodeT = 0;
    if (!crisis) return;
    if (!reducedMotion) state.current.shake = 0.7;
    if (crisis.kind !== 'power_drop' || reducedMotion) { setBlink(2 * BLINKS); return; }
    setBlink(1);
    let n = 1;
    const id = setInterval(() => { n++; setBlink(n); if (n >= 2 * BLINKS) clearInterval(id); }, BLINK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crisisKey, reducedMotion]);

  const node = crisis?.nodeIds[0] ?? null;
  const flashOn = !!crisis && !!node && (crisis.kind === 'power_drop' ? blink % 2 === 1 || blink >= 2 * BLINKS : crisis.kind === 'overheat');
  const fx: CraftFx = {
    dimIds: p.offIds,
    flashIds: flashOn && node ? [node] : [],
    flashColor: crisis?.kind === 'overheat' ? 'crit' : 'warn',
    frost: crisis?.kind === 'freeze',
    rotorSpeed: () => state.current.rotor,
  };

  const noiseTarget = Math.max(noiseLevel(p.signal, crisis?.kind === 'signal_distortion', reducedMotion), p.storm ? (reducedMotion ? 0.06 : 0.12) : 0);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const st = state.current;
    const g = craft.current;
    if (!g) return;
    const time = clock.elapsedTime;

    // route parameter follows the (1 Hz) engine value smoothly along the curve
    const ds = target - st.s;
    st.s += Math.abs(ds) > 1.5 ? ds : ds * (1 - Math.exp(-dt * 1.4));
    const k = Math.min(2, Math.floor(st.s));
    const u = st.s - k;
    const q = curve.getPoint(Math.min(1, st.s / 3));
    let y = segmentAltitude(u, profile.alt[k], profile.alt[k + 1], profile.gmax[k]);
    let x = q.x, z = q.z;

    // landing: freeze XZ where the craft was, ease down onto the ground
    if (!flying && !st.landAt) st.landAt = { x, z, y: ground(x, z) + SKID };
    if (flying) st.landAt = null;
    st.land += ((flying ? 0 : 1) - st.land) * (1 - Math.exp(-dt * (flying ? 1.2 : 0.7)));
    if (st.landAt) { x = st.landAt.x; z = st.landAt.z; }
    const landY = st.landAt ? st.landAt.y : y;
    y = y + (landY - y) * smoothK(st.land);
    st.rotor += ((flying ? 1 : 0) - st.rotor) * (1 - Math.exp(-dt * (flying ? 2 : 0.6)));

    // hover bob + heading + lean
    const bob = reducedMotion ? 0 : Math.sin(time * 1.3) * 0.12 * (1 - st.land);
    const tan = curve.getTangent(Math.min(0.999, Math.max(0.001, st.s / 3)));
    const yawT = Math.atan2(tan.x, tan.z);
    let dy = yawT - st.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    st.yaw += dy * (1 - Math.exp(-dt * 1.5));
    const speed = Math.min(1, (Math.abs(ds) * 60) / 3) * (1 - st.land);
    st.pitch += (speed * 0.14 - st.pitch) * (1 - Math.exp(-dt * 2));
    st.roll += (-dy * 0.5 * (1 - st.land) - st.roll) * (1 - Math.exp(-dt * 2));
    const sway = reducedMotion ? 0 : Math.sin(time * 0.9) * 0.03 * (1 - st.land);
    g.position.set(x, y + bob, z);
    g.rotation.set(st.pitch, st.yaw, st.roll + sway, 'YXZ');

    // ground under the craft (periodic raycast) → blob shadow + beam
    st.groundT -= dt;
    if (st.groundT <= 0) {
      st.groundT = 0.2;
      st.groundY = ground(x, z);
      tmp.copy(CAM_OFFSET).applyAxisAngle(UP, st.yaw).add(g.position);
      // highest ground under the camera or halfway to the craft (a dune in between must not hide it)
      st.camGround = Math.max(ground(tmp.x, tmp.z), ground((tmp.x + x) / 2, (tmp.z + z) / 2) + 0.8);
    }
    if (shadow.current) {
      const h = Math.max(0, y - st.groundY);
      shadow.current.position.set(x, st.groundY + 0.08, z);
      shadow.current.scale.setScalar(1.6 + h * 0.08);
      (shadow.current.material as MeshBasicMaterial).opacity = Math.max(0.08, 0.42 - h * 0.012);
    }
    if (beam.current) {
      const hover = flying && p.waypointProgress >= 0.98 && p.waypointIndex >= 0 && st.land < 0.05 && Math.abs(ds) < 0.02;
      beam.current.visible = hover;
      const h = Math.max(0.5, y - st.groundY - 0.3);
      beam.current.position.set(x, y - 0.3 - h / 2, z);
      beam.current.scale.set(1, h, 1);
      (beam.current.material as ShaderMaterial).uniforms.uT.value = reducedMotion ? 0 : time;
    }

    // crisis node position (module box centre in craft space, refreshed while modules settle)
    st.nodeT -= dt;
    if (node && st.nodeT <= 0) {
      st.nodeT = 0.5;
      const o = g.getObjectByName(`unit_${node}`);
      if (o) {
        g.updateMatrixWorld(true);
        const box = new Box3().setFromObject(o);
        st.nodeLocal = box.isEmpty() ? null : g.worldToLocal(box.getCenter(new Vector3()));
      } else st.nodeLocal = new Vector3(0, 0.35, 0);
    }
    st.burst = (st.burst + dt) % 1.1;
    if (sparkLight.current) {
      const active = crisis?.kind === 'power_drop' && st.nodeLocal;
      if (active) sparkLight.current.position.copy(st.nodeLocal!).applyMatrix4(g.matrixWorld);
      const blinkLit = blink % 2 === 1 && blink < 2 * BLINKS;
      sparkLight.current.intensity = active ? (blinkLit ? 14 : reducedMotion ? 2 : st.burst < 0.18 ? 6 : 0) : 0;
    }

    // camera: behind and to the side, damped; brief shake on a crisis (not with reduced motion)
    tmp.copy(CAM_OFFSET).applyAxisAngle(UP, st.yaw).add(g.position);
    tmp.y += 2.2 * st.land; // landed: look down at it from a bit higher
    tmp.y = Math.max(tmp.y, st.camGround + 1.6);
    if (!st.init) { camera.position.copy(tmp); st.init = true; }
    camera.position.lerp(tmp, 1 - Math.exp(-dt * 2.2));
    const look = tmp2.set(Math.sin(st.yaw) * 2.5, 0.5, Math.cos(st.yaw) * 2.5).add(g.position);
    camera.lookAt(look);
    if (st.shake > 0) {
      st.shake = Math.max(0, st.shake - dt);
      const a = 0.06 * st.shake;
      camera.position.x += (Math.random() - 0.5) * a; camera.position.y += (Math.random() - 0.5) * a;
    }
    st.noise += (noiseTarget - st.noise) * (1 - Math.exp(-dt * 3));
  });

  const sparkOrigin = (out: Vector3) => {
    const st = state.current;
    if (!craft.current || !st.nodeLocal) return out.set(0, -999, 0);
    return out.copy(st.nodeLocal).applyMatrix4(craft.current.matrixWorld);
  };
  const kind = crisis?.kind ?? null;
  const beamMat = useMemo(() => new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide,
    uniforms: { uT: { value: 0 }, uC: { value: new Color('#5BE0E6') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uT; uniform vec3 uC; varying vec2 vUv;
      void main(){ float bands = 0.6 + 0.4 * step(0.5, fract(vUv.y * 6.0 + uT * 1.2)); gl_FragColor = vec4(uC, (0.12 + 0.18 * vUv.y) * bands); }`,
  }), []);

  return (
    <>
      <group ref={craft}>
        <Craft build={build} stats={stats} role={null} reducedMotion={reducedMotion} mission="titan" fx={fx} />
      </group>
      <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial color="#2A1406" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <mesh ref={beam} material={beamMat} visible={false}>
        <cylinderGeometry args={[0.25, 1.8, 1, 18, 1, true]} />
      </mesh>
      <pointLight ref={sparkLight} color="#FFD25C" distance={6} decay={1.5} intensity={0} />
      {/* Power Drop: spark bursts on the cause node */}
      <Emitter
        count={reducedMotion ? 40 : 110} additive life={[0.35, 0.8]} size={[0.16, 0.04]} color={['#FFFBEA', '#FF9A4A']} alpha={[1, 0.2]}
        gravity={-7} drag={0.3}
        rate={() => (kind === 'power_drop' && state.current.nodeLocal ? (state.current.burst < 0.18 ? (reducedMotion ? 80 : 260) : 0) : 0)}
        spawn={(o) => { sparkOrigin(o.p); o.v.set((Math.random() - 0.5) * 5, 1 + Math.random() * 3, (Math.random() - 0.5) * 5); }}
      />
      {/* Overheat: hot shimmer rising from the node */}
      <Emitter
        count={50} additive life={[0.8, 1.4]} size={[0.25, 0.6]} color={['#FF9A4A', '#FF5A6A']} alpha={[0.5, 0]} gravity={1.5} drag={0.5}
        rate={() => (kind === 'overheat' && state.current.nodeLocal ? 30 : 0)}
        spawn={(o) => { sparkOrigin(o.p); o.p.x += (Math.random() - 0.5) * 0.4; o.p.z += (Math.random() - 0.5) * 0.4; o.v.set(0, 0.6, 0); }}
      />
      {/* Freeze: ice glitter drifting around the hull */}
      <Emitter
        count={70} additive life={[1.2, 2.2]} size={[0.07, 0.02]} color={['#F7FBFF', '#9FD8FF']} alpha={[0.95, 0]} gravity={-0.2} drag={0.6}
        rate={() => (kind === 'freeze' ? 40 : 0)}
        spawn={(o) => {
          if (!craft.current) return;
          craft.current.getWorldPosition(o.p);
          const a = Math.random() * Math.PI * 2;
          o.p.add(tmp.set(Math.cos(a) * (0.9 + Math.random() * 0.5), 0.2 + Math.random() * 1.3, Math.sin(a) * (0.9 + Math.random() * 0.5)));
          o.v.set(0, -0.1, 0);
        }}
      />
      <StaticNoise level={() => state.current.noise} reducedMotion={reducedMotion} />
    </>
  );
}

const UP = new Vector3(0, 1, 0);

/**
 * In the air? 'flying' (incl. hovering at a point) — yes; 'landed' — no; 'stopped' (held by Safe Protocol / a crisis)
 * hovers where it is unless the rotors are switched off or not installed, then it sits down.
 */
function airborne({ route, offIds, build }: Pick<TitanSceneProps, 'route' | 'offIds' | 'build'>): boolean {
  if (route === 'flying') return true;
  if (route === 'landed') return false;
  return (build.rotor_system ?? 0) > 0 && !offIds.includes('rotor_system');
}
const smoothK = (x: number) => x * x * (3 - 2 * x);
