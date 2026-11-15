// The asteroid: GLB (lod0 near / lod1 far) or a lumpy toon placeholder, scaled to RADIUS, plus the three sampling
// sites found on its surface by raycasting around mount_sample (regolith patch, boulder, crack) with ground rings.
// Everything here lives in the tumbling group's space (the caller rotates it).
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  Box3, Color, DoubleSide, Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, Quaternion, Raycaster, Vector3,
  type Object3D,
} from 'three';
import { useEnvModel } from '../models/loader';
import { toonify } from '../models/toon';
import { useQuality } from '../quality';
import type { AsteroidSiteId } from './types';

/** Scene radius of the asteroid (m). The craft is ≈ 2 m across. */
export const RADIUS = 12;
/** Low quality: lod1 everywhere except the close sampling hold (camera within 1.6 R of the centre). */
const LOW_LOD_SWAP = 1.6;

export interface Site { id: AsteroidSiteId; p: Vector3; n: Vector3 }
export type Sites = Record<AsteroidSiteId, Site>;

const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

/** Lumpy grey rock (no GLB yet / failed): displaced icosahedron, toon + ink outline. */
function placeholderRock(): Object3D {
  const geo = new IcosahedronGeometry(4, 3);
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 1 + 0.16 * Math.sin(v.x * 1.3) * Math.cos(v.y * 1.1) + 0.1 * Math.sin(v.z * 2.1 + v.x);
    v.multiplyScalar(k * (v.y > 0 ? 0.92 : 1));
    pos.setXYZ(i, v.x, v.y * 0.82, v.z);
  }
  geo.computeVertexNormals();
  const root = new Group();
  const lod0 = new Group(); lod0.name = 'lod0';
  lod0.add(new Mesh(geo, new MeshStandardMaterial({ color: '#7D7486', flatShading: true })));
  root.add(lod0);
  toonify(root, { castShadow: false });
  return root;
}

export function useAsteroid() {
  const model = useEnvModel('asteroid');
  return useMemo(() => {
    const rock = model ? model.scene : placeholderRock();
    rock.updateMatrixWorld(true);
    const near = rock.getObjectByName('lod0') ?? rock;
    const far = rock.getObjectByName('lod1');
    const box = new Box3().setFromObject(near);
    const size = box.getSize(new Vector3());
    const scale = RADIUS / (Math.max(size.x, size.y, size.z) / 2 || 4);
    const centre = box.getCenter(new Vector3());

    // Sites: rays toward the centre from directions around mount_sample.
    const mount = rock.getObjectByName('mount_sample');
    const base = (mount ? mount.getWorldPosition(new Vector3()) : new Vector3(0.14, 0.06, 0.99)).sub(centre).normalize();
    const dirs: Record<AsteroidSiteId, Vector3> = {
      regolith: base.clone(),
      boulder: base.clone().applyAxisAngle(Y, 0.62).applyAxisAngle(Z, 0.12).normalize(),
      crack: base.clone().applyAxisAngle(Y, -0.58).add(new Vector3(0, 0.2, 0)).normalize(),
    };
    const ray = new Raycaster();
    const sites = {} as Sites;
    for (const id of Object.keys(dirs) as AsteroidSiteId[]) {
      const d = dirs[id];
      ray.set(centre.clone().addScaledVector(d, 50), d.clone().negate());
      const hit = ray.intersectObject(near, true)[0];
      const p = hit ? hit.point.clone() : centre.clone().addScaledVector(d, size.length() / 3.4);
      // normal: the face normal blended with the radial direction (stable on a lumpy surface)
      const fn = hit?.normal ? hit.normal.clone() : d.clone();
      const n = fn.multiplyScalar(0.55).addScaledVector(d, 0.45).normalize();
      sites[id] = { id, p: p.sub(centre).multiplyScalar(scale), n };
    }
    return { rock, near, far, scale, centre, sites };
  }, [model]);
}

/** The rock itself, centred on the group origin; swaps lod0 ↔ lod1 by camera distance (Low quality: lod1 unless very close). */
export function AsteroidRock({ a }: { a: ReturnType<typeof useAsteroid> }) {
  const tmp = useMemo(() => new Vector3(), []);
  const swapAt = RADIUS * (useQuality() === 'low' ? LOW_LOD_SWAP : 6);
  useFrame(({ camera }) => {
    if (!a.far) return;
    const far = camera.position.distanceTo(tmp.set(0, 0, 0)) > swapAt;
    a.far.visible = far;
    a.near.visible = !far;
  });
  return (
    <group scale={a.scale}>
      <group position={a.centre.clone().negate()}>
        <primitive object={a.rock} />
      </group>
    </group>
  );
}

/** Three site props + ground rings. `chosen` pulses cyan; `collected` turns it green. */
export function SiteMarkers({ sites, chosen, collected, visible, reducedMotion }: {
  sites: Sites; chosen: AsteroidSiteId | null; collected: boolean; visible: boolean; reducedMotion: boolean;
}) {
  const ring = useRef<Record<string, Mesh | null>>({});
  const props = useMemo(() => makeSiteProps(), []);
  useFrame(({ clock }) => {
    for (const s of Object.values(sites)) {
      const m = ring.current[s.id];
      if (!m) continue;
      const on = s.id === chosen;
      const mat = m.material as MeshStandardMaterial;
      const pulse = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(clock.elapsedTime * 3);
      mat.opacity = on ? 0.9 * pulse : chosen ? 0.22 : 0.55;
      m.scale.setScalar(on && !reducedMotion && !collected ? 1 + 0.06 * Math.sin(clock.elapsedTime * 3) : 1);
    }
  });
  return (
    <>
      {Object.values(sites).map((s) => {
        const q = new Quaternion().setFromUnitVectors(Z, s.n);
        const qy = new Quaternion().setFromUnitVectors(Y, s.n);
        const color = s.id === chosen ? (collected ? '#4CD69A' : '#5BE0E6') : '#F7F8FF';
        return (
          <group key={s.id}>
            <primitive object={props[s.id]} position={s.p.toArray()} quaternion={qy} />
            <mesh visible={visible} ref={(m: Mesh | null) => { ring.current[s.id] = m; }} position={s.p.clone().addScaledVector(s.n, 0.12).toArray()} quaternion={q} renderOrder={3}>
              <ringGeometry args={[1.15, 1.38, 40]} />
              <meshBasicMaterial color={new Color(color)} transparent opacity={0.5} depthWrite={false} side={DoubleSide} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

/** Regolith: light smooth patch with pebbles · boulder: a big dark rock · crack: a dark zig-zag fissure. */
function makeSiteProps(): Record<AsteroidSiteId, Object3D> {
  const mat = (c: string) => new MeshStandardMaterial({ color: c, flatShading: true });

  const regolith = new Group();
  const patch = new Mesh(new IcosahedronGeometry(1.5, 1), mat('#BFAF96'));
  patch.scale.set(1, 0.08, 1);
  regolith.add(patch);
  for (let i = 0; i < 6; i++) {
    const p = new Mesh(new IcosahedronGeometry(0.1 + (i % 3) * 0.05, 0), mat('#9C8F7E'));
    const a = i * 1.9;
    p.position.set(Math.cos(a) * (0.5 + (i % 2) * 0.6), 0.08, Math.sin(a) * (0.5 + (i % 2) * 0.6));
    regolith.add(p);
  }

  const boulder = new Group();
  // off-centre: the tool samples the ground right next to it
  const b = new Mesh(new IcosahedronGeometry(0.62, 0), mat('#5E5666'));
  b.scale.set(1.1, 0.8, 0.95);
  b.position.set(-0.75, 0.3, -0.35);
  b.rotation.set(0.4, 0.7, 0.2);
  boulder.add(b);
  const b2 = new Mesh(new IcosahedronGeometry(0.24, 0), mat('#6E6577'));
  b2.position.set(0.55, 0.1, 0.55);
  boulder.add(b2);

  const crack = new Group();
  const pts = [[-1.5, -0.3], [-0.8, 0.25], [-0.1, -0.2], [0.6, 0.3], [1.4, -0.15]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const seg = new Mesh(new IcosahedronGeometry(0.5, 0), mat('#17131F'));
    seg.scale.set(len / 1.0, 0.06, 0.16 + (i % 2) * 0.06);
    seg.position.set((x0 + x1) / 2, 0.02, (z0 + z1) / 2);
    seg.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    crack.add(seg);
  }
  for (const g of [regolith, boulder, crack]) toonify(g, { castShadow: false });
  return { regolith, boulder, crack };
}
