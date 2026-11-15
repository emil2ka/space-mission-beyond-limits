// Construction scene: HQ hangar (if modelled), turntable test stand, the craft, 4 role consoles.
// Every piece falls back to primitives when its GLB is not in public/models/manifest.json.
// Scale (contract): floor y 0, stand top plate 0.35, craft origin 0.80, drum r 0.9 × h 1.3, rotors at 1.25.
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { ROLES, type Build, type CraftStats, type MissionId, type RoleId } from '../engine';
import { Craft } from './Craft';
import type { SlotTransform } from './layout';
import { preloadModels, SCENE_MODELS, useComponentModel, type ModelInstance } from './models/loader';
import { nodeTransform } from './models/nodes';
import { recolorMaterial } from './models/toon';
import { STAND_DEFAULT, StandPlaceholder } from './Placeholders';
import { type Quality, DEV_FPS, FpsProbe, QStars, QualityProvider, qualityDpr } from './quality';

type Props = { build: Build; stats: CraftStats; role: RoleId | null; reducedMotion: boolean; mission: MissionId; quality?: Quality };

export function StandScene(props: Props) {
  // M5: the launch pad + rocket load while the team builds.
  useEffect(() => preloadModels(SCENE_MODELS.launch), []);
  return (
    <Canvas shadows={props.quality !== 'low'} camera={{ position: [3.4, 2.6, 3.9], fov: 40 }} dpr={qualityDpr(props.quality, [1, 2])} gl={{ antialias: props.quality !== 'low' }}>
      <color attach="background" args={['#0E1330']} />
      <QualityProvider quality={props.quality}>
        <Stage {...props} />
        {DEV_FPS && <FpsProbe />}
      </QualityProvider>
    </Canvas>
  );
}

const IDENTITY: SlotTransform = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
const toMatrix = (t: SlotTransform) =>
  new Matrix4().compose(new Vector3(...t.position), new Quaternion(...t.quaternion), new Vector3(...t.scale));
const fromMatrix = (m: Matrix4): SlotTransform => {
  const p = new Vector3(), q = new Quaternion(), s = new Vector3();
  m.decompose(p, q, s);
  return { position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w], scale: [s.x, s.y, s.z] };
};
const at = (t: SlotTransform) => ({ position: t.position, quaternion: t.quaternion, scale: t.scale });

function Stage(props: Props) {
  const hangar = useComponentModel('hq_hangar');
  const stand = useComponentModel('test_stand');

  const layout = useMemo(() => {
    const standAt = (hangar && nodeTransform(hangar.scene, 'mount_stand')) || IDENTITY;
    const craftLocal = (stand && nodeTransform(stand.scene, 'mount_craft')) || { ...IDENTITY, position: STAND_DEFAULT.craftMount };
    const craftAt = fromMatrix(toMatrix(standAt).multiply(toMatrix(craftLocal)));
    const consoles = hangar
      ? [1, 2, 3, 4].map((i) => nodeTransform(hangar.scene, `mount_console_${i}`)).filter((t): t is SlotTransform => !!t)
      : [];
    return { standAt, craftAt, consoles };
  }, [hangar, stand]);

  const [cx, cy, cz] = layout.craftAt.position;
  // Hulls v2: the craft is low (Titan deck 0.55, rotors ~0.9; asteroid deck 0.9) → aim at ~0.4 above its origin.
  const target: [number, number, number] = [cx, cy + 0.4, cz];
  const indoor = !!hangar;

  return (
    <>
      <fog attach="fog" args={['#0E1330', indoor ? 12 : 8, indoor ? 34 : 22]} />
      {!indoor && <QStars radius={40} depth={20} count={1500} factor={2} fade speed={props.reducedMotion ? 0 : 0.5} />}
      <ambientLight intensity={indoor ? 0.7 : 0.5} color="#CFE8FF" />
      <directionalLight position={[cx + 4, cy + 6, cz + 3]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[cx - 3, cy + 1, cz - 2]} intensity={8} color="#B8A9F0" />

      {hangar && <primitive object={hangar.scene} />}
      <group {...at(layout.standAt)}>
        {stand ? <primitive object={stand.scene} /> : <StandPlaceholder />}
      </group>
      <group {...at(layout.craftAt)}>
        <Craft {...props} />
      </group>
      {layout.consoles.map((t, i) => <RoleConsole key={i} index={i} at={t} />)}
      <CameraRig target={target} />

      <StandShadow position={[cx, cy - 0.44, cz]} quality={props.quality} build={props.build} />
      <OrbitControls
        target={target}
        enablePan={false}
        minDistance={1.8}
        maxDistance={indoor ? 8 : 9}
        maxPolarAngle={1.7}
        autoRotate={!props.reducedMotion}
        autoRotateSpeed={0.6}
      />
    </>
  );
}

/**
 * Soft contact shadow under the craft. It re-renders the whole scene into a texture every frame (≈ doubles the draw
 * calls), so on Low it is live only for a few seconds after the build changes (modules load and settle), then frozen.
 */
function StandShadow({ position, quality, build }: { position: [number, number, number]; quality?: Quality; build: Build }) {
  const low = quality === 'low';
  const sig = JSON.stringify(build);
  const [live, setLive] = useState(true);
  useEffect(() => {
    if (!low) return;
    setLive(true);
    const t = setTimeout(() => setLive(false), 4000);
    return () => clearTimeout(t);
  }, [sig, low]);
  return <ContactShadows position={position} opacity={0.5} scale={4} blur={2.5} far={2} resolution={low ? 256 : 512} frames={low && !live ? 0 : Infinity} />;
}

/** hq_console at mount_console_i, its M_Role stripe in that role's colour (commander, engineer, science, comms). */
function RoleConsole({ index, at: t }: { index: number; at: SlotTransform }) {
  const model: ModelInstance | null = useComponentModel('hq_console');
  const color = ROLES[index]?.color ?? '#B8A9F0';
  useEffect(() => { if (model) recolorMaterial(model.scene, 'M_Role', color); }, [model, color]);
  if (!model) return null;
  return <group {...at(t)}><primitive object={model.scene} /></group>;
}

/** Default view offset from the orbit target (craft centre); re-applied when the stand moves (hangar mount_stand). */
const CAMERA_OFFSET: [number, number, number] = [2.6, 1.45, 2.9];

function CameraRig({ target: [x, y, z] }: { target: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  // Narrow canvas (constructor column) → step back so the rotors (±1.4 m) stay in frame.
  const k = Math.min(1.6, Math.max(1, 1.2 / aspect));
  useEffect(() => {
    camera.position.set(x + CAMERA_OFFSET[0] * k, y + CAMERA_OFFSET[1] * k, z + CAMERA_OFFSET[2] * k);
    camera.lookAt(x, y, z);
  }, [camera, x, y, z, k]);
  return null;
}
