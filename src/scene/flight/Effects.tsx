// Shared flight effects: comic engine flame, methane rain, gradient sky dome, full-screen static noise.
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, Color, LineBasicMaterial, LineSegments, Mesh,
  PlaneGeometry, ShaderMaterial, Vector3, type Group, type Object3D, type PointLight,
} from 'three';
import { Emitter, discXZ } from './Particles';
import { qualityScale, useQuality } from '../quality';

const tmp = new Vector3();

/**
 * Engine flame under an fx_nozzle node: three nested emissive cones (white → yellow → orange) that flicker,
 * hot particles + a warm point light. `strength` 0 hides it. Cones are portalled under the nozzle (point down −Y);
 * particles live in world space.
 */
export function Flame({ strength, scale = 1, nozzle, reducedMotion, light = true }: {
  strength: () => number; scale?: number; nozzle: Object3D | null; reducedMotion: boolean; light?: boolean;
}) {
  const group = useRef<Group>(null);
  const lamp = useRef<PointLight>(null);
  useFrame(({ clock }) => {
    const s = strength();
    const g = group.current;
    if (!g) return;
    g.visible = s > 0.01;
    const t = clock.elapsedTime;
    const flick = reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(t * 37) * Math.sin(t * 23 + 1);
    g.scale.set(scale * (0.7 + 0.3 * s), scale * s * flick, scale * (0.7 + 0.3 * s));
    if (lamp.current) lamp.current.intensity = s * (reducedMotion ? 60 : 90 * flick) * scale * scale;
  });
  const n = reducedMotion ? 90 : 220;
  const cones = (
      <group ref={group} visible={false}>
        <mesh position={[0, -2.2, 0]} rotation={[Math.PI, 0, 0]} renderOrder={4}>
          <coneGeometry args={[0.95, 4.4, 14, 1, true]} />
          <meshBasicMaterial color="#FF7A2E" transparent opacity={0.85} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position={[0, -1.5, 0]} rotation={[Math.PI, 0, 0]} renderOrder={5}>
          <coneGeometry args={[0.66, 3, 14, 1, true]} />
          <meshBasicMaterial color="#FFD25C" transparent opacity={0.92} depthWrite={false} toneMapped={false} />
        </mesh>
        <mesh position={[0, -0.8, 0]} rotation={[Math.PI, 0, 0]} renderOrder={6}>
          <coneGeometry args={[0.38, 1.6, 12, 1, true]} />
          <meshBasicMaterial color="#FFFBEA" toneMapped={false} />
        </mesh>
        {light && <pointLight ref={lamp} position={[0, -1.5, 0]} color="#FFB060" distance={60 * scale} decay={1.6} />}
      </group>
  );
  return (
    <>
      {nozzle && createPortal(cones, nozzle)}
      <Emitter
        count={n} additive life={[0.25, 0.6]} size={[1.1 * scale, 2.6 * scale]} color={['#FFE07A', '#FF4A1C']} alpha={[0.9, 0]}
        rate={() => (nozzle ? strength() * n * 2.2 : 0)}
        spawn={(o) => {
          if (!nozzle) return;
          nozzle.getWorldPosition(o.p);
          o.p.add(discXZ(tmp, 0.5 * scale));
          o.v.set((Math.random() - 0.5) * 3 * scale, -(16 + Math.random() * 10) * scale, (Math.random() - 0.5) * 3 * scale);
        }}
      />
    </>
  );
}

/** Light methane rain: long thin streaks falling slowly in a box that follows the camera. */
export function Rain({ count = 900, reducedMotion, storm = false }: { count?: number; reducedMotion: boolean; storm?: boolean }) {
  const camera = useThree((s) => s.camera);
  const box = { x: 46, y: 26, z: 46 };
  const k = qualityScale(useQuality());
  const sim = useMemo(() => {
    const n = Math.round(count * k * (storm ? 2.2 : 1) * (reducedMotion ? 0.5 : 1));
    const pos = new Float32Array(n * 6);
    const drops = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      drops[i * 3] = (Math.random() - 0.5) * box.x;
      drops[i * 3 + 1] = Math.random() * box.y;
      drops[i * 3 + 2] = (Math.random() - 0.5) * box.z;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    const mat = new LineBasicMaterial({ color: '#FFE6C2', transparent: true, opacity: 0.32, depthWrite: false, fog: true });
    const lines = new LineSegments(geo, mat);
    lines.frustumCulled = false;
    return { n, pos, drops, geo, lines };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, k, reducedMotion, storm]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const { n, pos, drops } = sim;
    const wind = storm && !reducedMotion ? 3.2 : 0.6;
    const fall = (reducedMotion ? 3.2 : 4.5) * (storm ? 1.5 : 1); // Titan rain: big slow drops
    const cx = camera.position.x, cy = camera.position.y - box.y * 0.45, cz = camera.position.z;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      drops[j + 1] -= fall * dt;
      drops[j] -= wind * dt;
      if (drops[j + 1] < 0) drops[j + 1] += box.y;
      // wrap around the camera so the box never runs out
      const x = cx + wrap(drops[j] - cx, box.x), y = cy + drops[j + 1], z = cz + wrap(drops[j + 2] - cz, box.z);
      const k = i * 6;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      pos[k + 3] = x + wind * 0.14; pos[k + 4] = y + 0.75; pos[k + 5] = z;
    }
    (sim.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
  });
  return <primitive object={sim.lines} />;
}
const wrap = (v: number, size: number) => ((((v + size / 2) % size) + size) % size) - size / 2;

/** Big inverted sphere with a vertical gradient (no fog), centred on the camera each frame. */
export function SkyDome({ top, horizon, bottom, radius = 300 }: { top: string; horizon: string; bottom: string; radius?: number }) {
  const ref = useRef<Mesh>(null);
  const mat = useMemo(() => new ShaderMaterial({
    side: BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new Color(top) }, uHor: { value: new Color(horizon) }, uBot: { value: new Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uBot; varying vec3 vP;
      void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(uHor, uTop, smoothstep(0.0, 0.6, y)) : mix(uHor, uBot, smoothstep(0.0, 0.3, -y));
      gl_FragColor = vec4(c, 1.0); }`,
  }), [top, horizon, bottom]);
  useFrame(({ camera }) => { ref.current?.position.copy(camera.position); });
  return (
    <mesh ref={ref} material={mat} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[radius, 24, 12]} />
    </mesh>
  );
}

/**
 * "Post-effect" static: one full-screen quad drawn last (no extra render pass). Grain + scanline tears + a faint
 * colour split. `level` 0..1; reducedMotion freezes the grain and drops the tears.
 */
export function StaticNoise({ level, reducedMotion }: { level: () => number; reducedMotion: boolean }) {
  const mesh = useMemo(() => {
    const mat = new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
      uniforms: { uT: { value: 0 }, uL: { value: 0 }, uTear: { value: reducedMotion ? 0 : 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform float uT; uniform float uL; uniform float uTear; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec2 cell = floor(vUv * vec2(320.0, 180.0));
          float n = h(cell + floor(uT * 24.0) * 7.31);
          float band = uTear * step(0.985 - uL * 0.06, h(vec2(floor(vUv.y * 60.0), floor(uT * 9.0))));
          float scan = 0.5 + 0.5 * sin(vUv.y * 720.0);
          float a = uL * (0.55 * n + 0.25 * scan * n) + band * 0.5 * uL;
          vec3 c = mix(vec3(n), vec3(0.75, 0.95, 1.0) * n, 0.4);
          gl_FragColor = vec4(c, clamp(a, 0.0, 0.9));
        }`,
    });
    const m = new Mesh(new PlaneGeometry(2, 2), mat);
    m.frustumCulled = false;
    m.renderOrder = 1000;
    return m;
  }, [reducedMotion]);
  useFrame(({ clock }) => {
    const mat = mesh.material as ShaderMaterial;
    const l = level();
    mesh.visible = l > 0.005;
    mat.uniforms.uL.value = l;
    if (!reducedMotion) mat.uniforms.uT.value = clock.elapsedTime;
  });
  return <primitive object={mesh} />;
}

/** Soft additive glow sprite material (sun disc, lake glint). */
export function glowMaterial(color: string, opacity = 1) {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false,
    uniforms: { uC: { value: new Color(color) }, uO: { value: opacity } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uC; uniform float uO; varying vec2 vUv;
      void main(){ float d = length(vUv - 0.5) * 2.0; float a = (smoothstep(1.0, 0.0, d) * 0.6 + smoothstep(0.35, 0.25, d) * 0.6) * uO;
      gl_FragColor = vec4(uC * a, a); }`,
  });
}
