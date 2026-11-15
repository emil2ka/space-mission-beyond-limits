// Cheap CPU particle pool drawn as one Points object in world space (flame, smoke, steam, sparks, ice).
// One draw call per emitter; sizes in metres (perspective-correct), colour/alpha/size interpolate over life.
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, NormalBlending, Points, ShaderMaterial, Vector3,
  type PerspectiveCamera,
} from 'three';
import { useQualityCount } from '../quality';

export interface SpawnOut { p: Vector3; v: Vector3 }

export interface EmitterProps {
  /** Pool size (max live particles). */
  count: number;
  /** Particles per second; read every frame (drive it from a ref / timeline). */
  rate: () => number;
  /** Fill the start position + velocity (world space). */
  spawn: (out: SpawnOut) => void;
  life: [number, number];
  size: [number, number];
  color: [string, string];
  alpha: [number, number];
  additive?: boolean;
  /** m/s² along Y (negative = falls). */
  gravity?: number;
  /** Velocity damping per second (0..1). */
  drag?: number;
  /** Hard comic edge (smoke puffs) instead of a soft glow. */
  hard?: boolean;
}

const VERT = /* glsl */ `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha; varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aSize * uScale / max(-mv.z, 0.1), 256.0);
    vAlpha = aAlpha; vColor = aColor;
  }`;
const FRAG = /* glsl */ `
  uniform float uHard;
  varying float vAlpha; varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = mix(smoothstep(0.5, 0.05, d), smoothstep(0.5, 0.44, d), uHard) * vAlpha;
    if (a < 0.01) discard;
    // comic two-tone: a lighter core on hard puffs
    vec3 c = mix(vColor, vColor * 1.18, uHard * step(d, 0.26));
    gl_FragColor = vec4(c, a);
  }`;

export function Emitter(p: EmitterProps) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const height = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);
  const props = useRef(p);
  props.current = p;
  const count = useQualityCount(p.count);

  const sim = useMemo(() => {
    const n = count;
    const geo = new BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const alpha = new Float32Array(n);
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new BufferAttribute(col, 3));
    geo.setAttribute('aSize', new BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new BufferAttribute(alpha, 1));
    const mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: p.additive ? AdditiveBlending : NormalBlending,
      uniforms: { uScale: { value: 600 }, uHard: { value: p.hard ? 1 : 0 } },
    });
    const points = new Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = p.additive ? 3 : 2;
    return {
      points, geo, mat, pos, col, size, alpha,
      vel: new Float32Array(n * 3), age: new Float32Array(n).fill(1e9), life: new Float32Array(n).fill(1),
      carry: 0, next: 0, c0: new Color(p.color[0]), c1: new Color(p.color[1]), out: { p: new Vector3(), v: new Vector3() },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, p.additive, p.hard]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const q = props.current;
    const s = sim;
    s.c0.set(q.color[0]); s.c1.set(q.color[1]);
    s.mat.uniforms.uScale.value = (height * dpr) / (2 * Math.tan(((camera.fov ?? 50) * Math.PI) / 360));
    const n = count;
    // spawn
    s.carry += Math.max(0, q.rate()) * dt;
    let spawnN = Math.min(n, Math.floor(s.carry));
    s.carry -= spawnN;
    while (spawnN-- > 0) {
      const i = s.next; s.next = (s.next + 1) % n;
      s.out.p.set(0, 0, 0); s.out.v.set(0, 0, 0);
      q.spawn(s.out);
      s.pos[i * 3] = s.out.p.x; s.pos[i * 3 + 1] = s.out.p.y; s.pos[i * 3 + 2] = s.out.p.z;
      s.vel[i * 3] = s.out.v.x; s.vel[i * 3 + 1] = s.out.v.y; s.vel[i * 3 + 2] = s.out.v.z;
      s.age[i] = 0;
      s.life[i] = q.life[0] + Math.random() * (q.life[1] - q.life[0]);
    }
    // integrate
    const g = q.gravity ?? 0;
    const damp = Math.pow(1 - Math.min(0.99, q.drag ?? 0), dt);
    for (let i = 0; i < n; i++) {
      const a = (s.age[i] += dt);
      const k = a / s.life[i];
      if (k >= 1) { s.alpha[i] = 0; s.size[i] = 0; continue; }
      const j = i * 3;
      s.vel[j] *= damp; s.vel[j + 1] = s.vel[j + 1] * damp + g * dt; s.vel[j + 2] *= damp;
      s.pos[j] += s.vel[j] * dt; s.pos[j + 1] += s.vel[j + 1] * dt; s.pos[j + 2] += s.vel[j + 2] * dt;
      s.size[i] = q.size[0] + (q.size[1] - q.size[0]) * k;
      s.alpha[i] = (q.alpha[0] + (q.alpha[1] - q.alpha[0]) * k) * Math.min(1, a * 12);
      s.col[j] = s.c0.r + (s.c1.r - s.c0.r) * k;
      s.col[j + 1] = s.c0.g + (s.c1.g - s.c0.g) * k;
      s.col[j + 2] = s.c0.b + (s.c1.b - s.c0.b) * k;
    }
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) (s.geo.getAttribute(name) as BufferAttribute).needsUpdate = true;
  });

  return <primitive object={sim.points} />;
}

/** Random point in a unit disc (x, z) scaled by r. */
export function discXZ(out: Vector3, r: number): Vector3 {
  const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
  return out.set(Math.cos(a) * d, 0, Math.sin(a) * d);
}
