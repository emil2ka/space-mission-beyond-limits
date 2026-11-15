// Primitive stand-ins used whenever a GLB is missing. All in contract coordinates:
// modules grow along +Y from y = 0; frame/overlays in frame coordinates; stand top plate at y 0.35, craft origin at 0.80.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';
import type { Department } from '../engine';
import { DEPT_COLOR, FRAME, HEX, SLOT_TABLE, slotTransform, type FrameId } from './layout';

interface ModuleProps { id: string; color: string; emissive: string }

export function ModulePlaceholder({ id, color, emissive }: ModuleProps) {
  const mat = <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.6} roughness={0.55} metalness={0.1} />;
  switch (id) {
    case 'rtg':
      return <mesh castShadow position={[0, 0.25, 0]}><cylinderGeometry args={[0.14, 0.14, 0.5, 12]} />{mat}</mesh>;
    case 'solar_array':
      return (
        <group>
          <mesh castShadow position={[0, 0.12, 0]}><cylinderGeometry args={[0.03, 0.03, 0.25, 8]} />{mat}</mesh>
          <mesh castShadow position={[0, 0.45, 0]}><boxGeometry args={[0.9, 0.45, 0.02]} />{mat}</mesh>
        </group>
      );
    case 'antenna_high_gain':
      return (
        <group>
          <mesh castShadow position={[0, 0.15, 0]}><cylinderGeometry args={[0.03, 0.04, 0.3, 8]} />{mat}</mesh>
          <mesh castShadow position={[0, 0.38, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.35, 0.16, 24, 1, true]} />{mat}</mesh>
        </group>
      );
    case 'propellant_tank':
      return <mesh castShadow position={[0, 0.25, 0]}><sphereGeometry args={[0.25, 16, 12]} />{mat}</mesh>;
    case 'return_capsule':
      // Clamp ring 0.12 + gumdrop Ø 0.7 × 0.45 (mounts: layout.ts CAPSULE_MOUNT_DEFAULT).
      return (
        <group>
          <mesh castShadow position={[0, 0.06, 0]}><cylinderGeometry args={[0.37, 0.37, 0.12, 20]} /><meshStandardMaterial color="#FF9A4A" emissive={emissive} emissiveIntensity={0.6} roughness={0.55} /></mesh>
          <mesh castShadow position={[0, 0.345, 0]}><cylinderGeometry args={[0.2, 0.35, 0.45, 20]} /><meshStandardMaterial color="#F7F8FF" emissive={emissive} emissiveIntensity={0.6} roughness={0.5} /></mesh>
        </group>
      );
    case 'heat_shield':
      // Origin on the top face, dish hangs down to y = -0.1.
      return <mesh castShadow position={[0, -0.05, 0]}><cylinderGeometry args={[0.36, 0.3, 0.1, 24]} /><meshStandardMaterial color="#5A4636" emissive={emissive} emissiveIntensity={0.6} roughness={0.8} /></mesh>;
    case 'parachute':
      // Stowed: canister + orange lid only (the canopy is pivot_chute, scaled ≈ 0 until deploy).
      return (
        <group>
          <mesh castShadow position={[0, 0.08, 0]}><cylinderGeometry args={[0.1, 0.1, 0.16, 16]} /><meshStandardMaterial color="#F7F8FF" emissive={emissive} emissiveIntensity={0.6} /></mesh>
          <mesh castShadow position={[0, 0.17, 0]}><cylinderGeometry args={[0.105, 0.105, 0.03, 16]} /><meshStandardMaterial color="#FF9A4A" emissive={emissive} emissiveIntensity={0.6} /></mesh>
        </group>
      );
    case 'recovery_beacon':
      return (
        <group>
          <mesh castShadow position={[0, 0.05, 0]}><boxGeometry args={[0.12, 0.1, 0.12]} /><meshStandardMaterial color="#FFD25C" emissive={emissive} emissiveIntensity={0.6} /></mesh>
          <mesh position={[0.03, 0.12, 0]}><sphereGeometry args={[0.025, 10, 8]} /><meshStandardMaterial color="#FF5A6A" emissive="#FF5A6A" emissiveIntensity={1.4} /></mesh>
        </group>
      );
    case 'robotic_arm':
      return <mesh castShadow position={[0, 0.32, 0]}><capsuleGeometry args={[0.04, 0.55, 4, 8]} />{mat}</mesh>;
    default:
      return <mesh castShadow position={[0, 0.09, 0]}><boxGeometry args={[0.24, 0.18, 0.18]} />{mat}</mesh>;
  }
}

/** Coloured bay rims on every slot of the frame (placeholder only; the real GLB has its own bays). */
function BayRims({ frame }: { frame: FrameId }) {
  const rims = useMemo(() => Object.entries(SLOT_TABLE[frame]).flatMap(([dept, list]) =>
    (list ?? []).map((_, i) => ({ key: `${dept}_${i}`, color: DEPT_COLOR[dept as Department], t: slotTransform(dept as Department, i, frame) }))), [frame]);
  return (
    <group>
      {rims.map(({ key, color, t }) => (
        <group key={key} position={t.position} quaternion={t.quaternion}>
          <mesh position={[0, -0.005, 0]}><boxGeometry args={[0.3, 0.01, 0.3]} /><meshStandardMaterial color="#3A3F5C" roughness={0.7} /></mesh>
          {[[0, 0.15], [0, -0.15], [0.15, 0], [-0.15, 0]].map(([x, z], j) => (
            <mesh key={j} position={[x, 0.04, z]}><boxGeometry args={[x ? 0.035 : 0.335, 0.03, z ? 0.035 : 0.335]} /><meshStandardMaterial color={color} roughness={0.6} /></mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** frame_titan v2: low box 1.1 × 0.55 × 1.6 + 4 outrigger arms with motor pads. frame_asteroid v2: hexagonal prism, flat face to +Z. */
export function FramePlaceholder({ xray, frame = 'frame_titan' }: { xray: boolean; frame?: FrameId }) {
  const hull = <meshStandardMaterial color="#F7F8FF" roughness={0.45} transparent={xray} opacity={xray ? 0.22 : 1} depthWrite={!xray} />;
  const dark = <meshStandardMaterial color="#5A5478" roughness={0.6} transparent={xray} opacity={xray ? 0.3 : 1} depthWrite={!xray} />;
  if (frame === 'frame_asteroid') {
    const h = HEX.height - 0.04;
    return (
      <group>
        <mesh castShadow receiveShadow position={[0, HEX.height / 2, 0]}>
          {/* thetaStart 30°: corners at 30°, 90°…, so a flat face points to +Z */}
          <cylinderGeometry args={[HEX.cornerRadius - 0.04 / Math.cos(Math.PI / 6), HEX.cornerRadius - 0.04 / Math.cos(Math.PI / 6), h, 6, 1, false, Math.PI / 6]} />{hull}
        </mesh>
        {[30, 90, 150, 210, 270, 330].map((a) => (
          <mesh key={a} castShadow position={[Math.sin(deg(a)) * HEX.cornerRadius * 0.97, HEX.height / 2, Math.cos(deg(a)) * HEX.cornerRadius * 0.97]}>
            <boxGeometry args={[0.09, HEX.height, 0.09]} />{dark}
          </mesh>
        ))}
        <mesh position={[0, HEX.ringTopY - 0.03, 0]}><cylinderGeometry args={[0.42, 0.42, 0.06, 32, 1, true]} /><meshStandardMaterial color="#FFD25C" roughness={0.5} side={2} /></mesh>
        <mesh position={[0, 0.0, 0]}><cylinderGeometry args={[0.18, 0.18, 0.04, 24]} />{dark}</mesh>
        <BayRims frame={frame} />
      </group>
    );
  }
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, (FRAME.deckY - 0.04) / 2, 0]}>
        <boxGeometry args={[FRAME.halfWidth * 2 - 0.08, FRAME.deckY - 0.04, FRAME.halfLength * 2 - 0.08]} />{hull}
      </mesh>
      {/* rails along the deck edges + the rear RTG cradle ears */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <mesh castShadow position={[sx * (FRAME.halfWidth - 0.03), FRAME.deckY - 0.02, 0]}><boxGeometry args={[0.06, 0.04, FRAME.halfLength * 2]} />{dark}</mesh>
          <mesh castShadow position={[sx * 0.34, 0.72, -0.56]}><boxGeometry args={[0.08, 0.36, 0.48]} />{dark}</mesh>
        </group>
      ))}
      {FRAME.pads.map(([x, y, z], i) => {
        const root: [number, number, number] = [Math.sign(x) * 0.5, 0.45, Math.sign(z) * 0.74];
        const dx = x - root[0], dy = y - 0.05 - root[1], dz = z - root[2];
        const len = Math.hypot(dx, dy, dz);
        return (
          <group key={i}>
            <mesh castShadow position={[(x + root[0]) / 2, (y - 0.05 + root[1]) / 2, (z + root[2]) / 2]} rotation={[0, Math.atan2(dx, dz), 0]}>
              <boxGeometry args={[0.12, 0.1, len]} />{dark}
            </mesh>
            <mesh castShadow position={[x, y - 0.03, z]}><cylinderGeometry args={[0.11, 0.11, 0.06, 16]} />{dark}</mesh>
          </group>
        );
      })}
      <BayRims frame={frame} />
    </group>
  );
}

/** Rotor i (0..7 = pad·2 + lower/upper): pads alternate, and each coaxial pair counter-rotates. */
const PAD_SPIN = [1, -1, -1, 1, 1, -1, -1, 1];

const deg = (d: number) => (d * Math.PI) / 180;

export function OverlayPlaceholder({ id, frame = 'frame_titan', reducedMotion, emissive, xray = false }: { id: string; frame?: FrameId; reducedMotion: boolean; emissive: string; xray?: boolean }) {
  const hex = frame === 'frame_asteroid';
  const rotors = useRef<(Group | null)[]>([]);
  useFrame((_, dt) => {
    if (id !== 'rotor_system' || reducedMotion) return;
    rotors.current.forEach((g, i) => { if (g) g.rotation.y += dt * 16 * PAD_SPIN[i]; });
  });
  const mat = (color: string) => <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={0.6} roughness={0.55} />;
  switch (id) {
    case 'rotor_system':
      return (
        <group>
          {FRAME.pads.map(([x, y, z], i) => (
            <group key={i} position={[x, 0, z]}>
              <mesh castShadow position={[0, y + 0.05, 0]}><cylinderGeometry args={[0.07, 0.08, 0.1, 12]} />{mat('#3A3F5C')}</mesh>
              <mesh castShadow position={[0, (y + FRAME.rotorHubY[1]) / 2, 0]}><cylinderGeometry args={[0.03, 0.03, FRAME.rotorHubY[1] - y, 8]} />{mat('#3A3F5C')}</mesh>
              {FRAME.rotorHubY.map((hy, k) => (
                <group key={k} position={[0, hy, 0]} ref={(g) => { rotors.current[i * 2 + k] = g; }}>
                  <mesh castShadow><boxGeometry args={[FRAME.rotorSpan, 0.025, 0.12]} />{mat(k ? '#F7F8FF' : '#FF9A4A')}</mesh>
                </group>
              ))}
            </group>
          ))}
        </group>
      );
    case 'landing_system':
      if (hex) {
        // 3 legs from the corner lugs (90°, 210°, 330°) to round footpads touching y = -0.35 at radius 0.95.
        return (
          <group>
            {HEX.legAngles.map((a) => (
              <group key={a} rotation={[0, deg(a), 0]}>
                <mesh castShadow position={[0, (HEX.footY + 0.06) / 2, (0.62 + HEX.footR) / 2]} rotation={[Math.atan2(HEX.footR - 0.62, 0.41), 0, 0]}>
                  <cylinderGeometry args={[0.035, 0.035, 0.52, 8]} />{mat('#FF9A4A')}
                </mesh>
                <mesh castShadow position={[0, HEX.footY + 0.02, HEX.footR]}><cylinderGeometry args={[0.12, 0.12, 0.04, 16]} />{mat('#3A3F5C')}</mesh>
              </group>
            ))}
          </group>
        );
      }
      return (
        <group>
          {[-1, 1].map((sx) => (
            <mesh key={sx} castShadow position={[sx * FRAME.skidX, FRAME.skidY + 0.035, 0]}><boxGeometry args={[0.07, 0.07, 1.7]} />{mat('#3A3F5C')}</mesh>
          ))}
          {[[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, z], i) => (
            <mesh key={i} castShadow position={[x * 0.5, FRAME.skidY / 2, z * 0.5]} rotation={[0, 0, x * 0.5]}>
              <cylinderGeometry args={[0.03, 0.03, 0.52, 8]} />{mat('#FF9A4A')}
            </mesh>
          ))}
        </group>
      );
    case 'thermal_insulation':
      // Gold strips on the panels between the bays (never over a bay opening).
      return (
        <group>
          {(hex ? [] : [-1, 1]).map((sx) => [-0.72, -0.36, 0, 0.36, 0.72].map((z) => (
            <mesh key={`${sx}${z}`} position={[sx * (FRAME.halfWidth + 0.005), 0.28, z]}><boxGeometry args={[0.01, 0.42, 0.03]} />
              <meshStandardMaterial color="#D9B44A" emissive={emissive} emissiveIntensity={0.4} roughness={0.7} transparent={xray} opacity={xray ? 0.2 : 1} depthWrite={!xray} />
            </mesh>
          )))}
          {hex && [0, 60, 120, 180, 240, 300].map((a) => (
            <group key={a} rotation={[0, deg(a), 0]}>
              <mesh position={[0, 0.47, HEX.apothem + 0.005]}><boxGeometry args={[0.6, 0.05, 0.01]} />
                <meshStandardMaterial color="#D9B44A" emissive={emissive} emissiveIntensity={0.4} roughness={0.7} transparent={xray} opacity={xray ? 0.2 : 1} depthWrite={!xray} />
              </mesh>
            </group>
          ))}
        </group>
      );
    case 'power_bus':
      // Cable bundle along the deck edge rails.
      return hex
        ? <mesh position={[0, HEX.height + 0.02, 0]} rotation={[Math.PI / 2, 0, Math.PI / 6]}><torusGeometry args={[HEX.cornerRadius - 0.06, 0.02, 8, 6]} />{mat('#FF9A4A')}</mesh>
        : (
          <group>
            {[-1, 1].map((sx) => (
              <mesh key={sx} position={[sx * (FRAME.halfWidth - 0.03), FRAME.deckY + 0.02, 0]}><boxGeometry args={[0.04, 0.04, 1.5]} />{mat('#FF9A4A')}</mesh>
            ))}
          </group>
        );
    case 'reinforced_frame': {
      // Graphite bumper rails at the bottom and top edges + corner sleeves.
      const posts: [number, number][] = hex
        ? [30, 90, 150, 210, 270, 330].map((a) => [Math.sin(deg(a)) * (HEX.cornerRadius + 0.02), Math.cos(deg(a)) * (HEX.cornerRadius + 0.02)])
        : [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, z]) => [x * (FRAME.halfWidth + 0.02), z * (FRAME.halfLength + 0.02)]);
      const h = hex ? HEX.height : FRAME.deckY;
      return (
        <group>
          {posts.map(([x, z], i) => (
            <mesh key={i} castShadow position={[x, h / 2, z]}><boxGeometry args={[0.08, h, 0.08]} />{mat('#3A3F5C')}</mesh>
          ))}
          {[0.06, h - 0.03].map((y) => hex
            ? <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, Math.PI / 6]}><torusGeometry args={[HEX.cornerRadius + 0.03, 0.025, 6, 6]} />{mat('#3A3F5C')}</mesh>
            : [-1, 1].map((sx) => (
              <mesh key={`${y}${sx}`} position={[sx * (FRAME.halfWidth + 0.03), y, 0]}><boxGeometry args={[0.04, 0.04, FRAME.halfLength * 2]} />{mat('#3A3F5C')}</mesh>
            )))}
        </group>
      );
    }
    default:
      return null;
  }
}

/** Test stand: base Ø3.2 × 0.30, top plate to y 0.35, teal light ring. Craft origin goes to y 0.80. */
export function StandPlaceholder() {
  return (
    <group>
      <mesh receiveShadow position={[0, 0.15, 0]}>
        <cylinderGeometry args={[1.6, 1.7, 0.3, 48]} />
        <meshStandardMaterial color="#1C2452" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[1.71, 1.71, 0.04, 48, 1, true]} />
        <meshStandardMaterial color="#5BE0E6" emissive="#5BE0E6" emissiveIntensity={0.8} />
      </mesh>
      <mesh receiveShadow position={[0, 0.325, 0]}>
        <cylinderGeometry args={[1.2, 1.2, 0.05, 48]} />
        <meshStandardMaterial color="#26306A" roughness={0.5} />
      </mesh>
    </group>
  );
}

export const STAND_DEFAULT = { craftMount: [0, 0.8, 0] as [number, number, number] };
