// Comic look for loaded GLBs: MeshToonMaterial with a 3-step gradient + inverted-hull ink outlines.
// Converted once per loaded template; clones share materials/geometry (cheap). No outlines on M_Emissive / lake / skinned.
import {
  BackSide, BufferAttribute, BufferGeometry, Color, DataTexture, Material, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, MeshToonMaterial, NearestFilter, RedFormat, SkinnedMesh,
  type Object3D,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const INK = '#0B0D1A';
/** Outline width as a fraction of view distance (≈ constant pixel width). */
export const outlineUniform = { value: 0.0042 };

let gradient: DataTexture | null = null;
export function toonGradient(): DataTexture {
  if (!gradient) {
    gradient = new DataTexture(new Uint8Array([88, 170, 255]), 3, 1, RedFormat);
    gradient.minFilter = NearestFilter;
    gradient.magFilter = NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

let outlineMat: MeshBasicMaterial | null = null;
export function outlineMaterial(): MeshBasicMaterial {
  if (!outlineMat) {
    const m = new MeshBasicMaterial({ color: INK, side: BackSide });
    m.name = 'InkOutline';
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uOutline = outlineUniform;
      shader.vertexShader = 'uniform float uOutline;\n' + shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec3 inkN = normalize( normalMatrix * normal );
        mvPosition.xyz += inkN * uOutline * max( -mvPosition.z, 0.5 );
        gl_Position = projectionMatrix * mvPosition;`,
      );
    };
    m.customProgramCacheKey = () => 'ink-outline-v1';
    outlineMat = m;
  }
  return outlineMat;
}

const toonCache = new Map<string, Material>();

export function toToon(src: Material): Material {
  if (!(src instanceof MeshStandardMaterial) && !(src instanceof MeshPhysicalMaterial)) return src;
  const hit = toonCache.get(src.uuid);
  if (hit) return hit;
  const m = new MeshToonMaterial({
    color: src.color.clone(),
    map: src.map,
    emissive: src.emissive.clone(),
    emissiveIntensity: src.emissiveIntensity,
    emissiveMap: src.emissiveMap,
    gradientMap: toonGradient(),
    transparent: src.transparent,
    opacity: src.opacity,
    alphaTest: src.alphaTest,
    side: src.side,
    vertexColors: src.vertexColors,
  });
  m.name = src.name;
  toonCache.set(src.uuid, m);
  return m;
}

const mats = (m: Material | Material[]) => (Array.isArray(m) ? m : [m]);

/** Smooth-normal copy of the geometry so the hull has no cracks at hard edges. Cached per source geometry. */
const outlineGeoCache = new WeakMap<BufferGeometry, BufferGeometry>();
function outlineGeometry(src: BufferGeometry): BufferGeometry {
  let g = outlineGeoCache.get(src);
  if (!g) {
    const pos = src.getAttribute('position');
    const tmp = new BufferGeometry();
    tmp.setAttribute('position', pos as BufferAttribute);
    if (src.index) tmp.setIndex(src.index);
    g = mergeVertices(tmp, 1e-4);
    g.computeVertexNormals();
    outlineGeoCache.set(src, g);
  }
  return g;
}

export interface ToonOptions {
  outlines?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

function insideLake(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (/^lake/.test(p.name)) return true;
  return false;
}

/** Convert a loaded template in place (call once per GLB, before cloning). */
export function toonify(root: Object3D, opts: ToonOptions = {}): void {
  const { outlines = true, castShadow = true, receiveShadow = true } = opts;
  const meshes: Mesh[] = [];
  root.traverse((o) => { if (o instanceof Mesh && !o.userData.inkOutline) meshes.push(o); });
  for (const mesh of meshes) {
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toToon) : toToon(mesh.material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    if (!outlines || mesh instanceof SkinnedMesh || !mesh.geometry.getAttribute('position')) continue;
    const list = mats(mesh.material);
    if (list.every((m) => m.name === 'M_Emissive' || m.transparent) || insideLake(mesh)) continue;
    const hull = new Mesh(outlineGeometry(mesh.geometry), outlineMaterial());
    hull.name = '';
    hull.userData.inkOutline = true;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.raycast = () => {};
    mesh.add(hull);
  }
}

// ---------- per-instance variants (highlight / x-ray / role colour) ----------

const ownMaterial = new WeakSet<Mesh>();
const baseMaterial = new WeakMap<Mesh, Material | Material[]>();
const variantCache = new WeakMap<Material, Map<string, Material>>();

/** Mesh got its own material (glow pulse, role colour) — variants leave it alone. */
export function markOwnMaterial(mesh: Mesh): void {
  ownMaterial.add(mesh);
}

/** Flight-scene tints (additive): 'dim' = module switched off, 'frost' = iced hull. */
export type Tint = 'dim' | 'frost' | null;
const ICE = new Color('#E6F6FF');
const ICE_GLOW = new Color('#7CC4FF');

/** True if the mesh carries a per-instance material (mechanics glow, role colour). */
export function isOwnMaterial(mesh: Mesh): boolean {
  return ownMaterial.has(mesh);
}

function variantOf(m: Material, highlight: string | null, xray: boolean, tint: Tint = null): Material {
  const key = `${highlight ?? ''}|${xray ? 1 : 0}|${tint ?? ''}`;
  let byKey = variantCache.get(m);
  if (!byKey) variantCache.set(m, (byKey = new Map()));
  let v = byKey.get(key);
  if (!v) {
    v = m.clone();
    if (highlight && m.name !== 'M_Emissive' && 'emissive' in v) {
      (v as MeshToonMaterial).emissive = new Color(highlight);
      (v as MeshToonMaterial).emissiveIntensity = 0.55;
    }
    if (xray) {
      v.transparent = true;
      v.opacity = 0.22;
      v.depthWrite = false;
    }
    if (tint && 'color' in v) {
      const t = v as MeshToonMaterial;
      t.color = t.color.clone();
      if (tint === 'dim') {
        t.color.multiplyScalar(0.32);
        if ('emissive' in t) t.emissiveIntensity = 0;
      } else {
        t.color.lerp(ICE, 0.62);
        if ('emissive' in t && m.name !== 'M_Emissive' && !highlight) { t.emissive = ICE_GLOW.clone(); t.emissiveIntensity = 0.16; }
      }
    }
    byKey.set(key, v);
  }
  return v;
}

export function applyVariant(
  root: Object3D,
  { highlight = null, xray = false, tint = null }: { highlight?: string | null; xray?: boolean; tint?: Tint },
): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (o.userData.inkOutline) { o.visible = !xray; return; }
    if (ownMaterial.has(o)) return;
    let base = baseMaterial.get(o);
    if (!base) baseMaterial.set(o, (base = o.material as Material | Material[]));
    if (!highlight && !xray && !tint) { o.material = base; return; }
    o.material = Array.isArray(base) ? base.map((m) => variantOf(m, highlight, xray, tint)) : variantOf(base, highlight, xray, tint);
  });
}

/** Recolour one named material (e.g. M_Role) on this instance only. */
export function recolorMaterial(root: Object3D, name: string, color: string): number {
  let n = 0;
  root.traverse((o) => {
    if (!(o instanceof Mesh) || o.userData.inkOutline) return;
    const list = mats(o.material);
    if (!list.some((m) => m.name === name)) return;
    const swap = (m: Material) => {
      if (m.name !== name || !('color' in m)) return m;
      const c = m.clone();
      (c as MeshToonMaterial).color = new Color(color);
      n++;
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    markOwnMaterial(o);
  });
  return n;
}
