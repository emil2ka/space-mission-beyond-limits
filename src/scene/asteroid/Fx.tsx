// Small space-flight effects: attitude-thruster jets on fx_nozzle* nodes, the ion beam on fx_beam,
// and a soft additive glow sprite. Cones are portalled under the node (exhaust along the node's local +Y,
// the module's outward direction); puffs live in world space.
import { createPortal, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { AdditiveBlending, Color, DoubleSide, Quaternion, ShaderMaterial, Vector3, type Group, type Object3D } from 'three';
import { Emitter } from '../flight/Particles';

const tmp = new Vector3();
const tq = new Quaternion();
const Y = new Vector3(0, 1, 0);

/**
 * One cold-gas / hypergolic attitude jet: a short white-blue cone + a few puffs.
 * `strength` 0..1 is read every frame (0 hides it).
 */
export function Jet({ node, strength, length = 0.6, reducedMotion }: {
  node: Object3D; strength: () => number; length?: number; reducedMotion: boolean;
}) {
  const g = useRef<Group>(null);
  useFrame(({ clock }) => {
    const s = strength();
    if (!g.current) return;
    g.current.visible = s > 0.02;
    const f = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(clock.elapsedTime * 41 + node.id);
    g.current.scale.set(0.6 + 0.4 * s, s * f, 0.6 + 0.4 * s);
  });
  const cone = (
    <group ref={g} visible={false}>
      <mesh rotation={[Math.PI, 0, 0]} position={[0, length / 2, 0]} renderOrder={5}>
        <coneGeometry args={[length * 0.22, length, 10, 1, true]} />
        <meshBasicMaterial color="#9FC4FF" transparent opacity={0.45} depthWrite={false} toneMapped={false} side={DoubleSide} blending={AdditiveBlending} />
      </mesh>
      <mesh rotation={[Math.PI, 0, 0]} position={[0, length * 0.15, 0]} renderOrder={6}>
        <coneGeometry args={[length * 0.08, length * 0.3, 8, 1, true]} />
        <meshBasicMaterial color="#FFFFFF" transparent opacity={0.85} depthWrite={false} toneMapped={false} side={DoubleSide} blending={AdditiveBlending} />
      </mesh>
    </group>
  );
  return (
    <>
      {createPortal(cone, node)}
      <Emitter
        count={reducedMotion ? 16 : 36} additive life={[0.25, 0.55]} size={[length * 0.25, length * 0.9]} color={['#F7FBFF', '#7CA8FF']} alpha={[0.55, 0]}
        drag={0.4}
        rate={() => strength() * (reducedMotion ? 20 : 55)}
        spawn={(o) => {
          node.getWorldPosition(o.p);
          node.getWorldQuaternion(tq);
          const d = tmp.copy(Y).applyQuaternion(tq);
          o.v.copy(d).multiplyScalar(2.5 + Math.random() * 1.5);
          o.v.x += (Math.random() - 0.5) * 0.4; o.v.y += (Math.random() - 0.5) * 0.4; o.v.z += (Math.random() - 0.5) * 0.4;
        }}
      />
    </>
  );
}

/** Ion beam: a long faint blue-violet column out of fx_beam with moving bands (frozen with reducedMotion). */
export function IonBeam({ node, strength, length = 7, reducedMotion }: {
  node: Object3D; strength: () => number; length?: number; reducedMotion: boolean;
}) {
  const g = useRef<Group>(null);
  const mat = useMemo(() => new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, toneMapped: false,
    uniforms: { uT: { value: 0 }, uS: { value: 1 }, uC: { value: new Color('#7FA8FF') }, uC2: { value: new Color('#E2D8FF') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform float uT; uniform float uS; uniform vec3 uC; uniform vec3 uC2; varying vec2 vUv;
      void main(){
        float along = vUv.y;                     // 0 at the grid, 1 at the far end
        float edge = 0.55 + 0.45 * sin(vUv.x * 6.2831 * 3.0);
        float bands = 0.75 + 0.25 * sin(along * 28.0 - uT * 9.0);
        float a = pow(1.0 - along, 1.6) * bands * (0.35 + 0.25 * edge) * uS;
        gl_FragColor = vec4(mix(uC2, uC, along) * a, a);
      }`,
  }), []);
  useFrame(({ clock }) => {
    const s = strength();
    if (!g.current) return;
    g.current.visible = s > 0.02;
    mat.uniforms.uS.value = s;
    if (!reducedMotion) mat.uniforms.uT.value = clock.elapsedTime;
  });
  return createPortal(
    <group ref={g} visible={false}>
      <mesh material={mat} position={[0, length / 2, 0]} renderOrder={4}>
        <cylinderGeometry args={[0.32, 0.12, length, 20, 1, true]} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <circleGeometry args={[0.13, 20]} />
        <meshBasicMaterial color="#E2D8FF" toneMapped={false} side={DoubleSide} />
      </mesh>
    </group>,
    node,
  );
}
