// Module icon renderer (page side). Loads each module GLB with the game's own toonify() (MeshToonMaterial + ink hull),
// frames it with one fixed 3/4 front-top camera, renders on a transparent background and hands back WebP data URLs.
// Driven by scripts/render-icons.mjs over the Chrome DevTools protocol; by hand: /scripts/icon-render/?preview=rtg
import {
  ACESFilmicToneMapping, AmbientLight, Box3, DirectionalLight, MathUtils, Mesh, PerspectiveCamera, PointLight, Scene,
  SRGBColorSpace, Vector3, WebGLRenderer, type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { COMPONENTS } from '../../src/engine/data/components';
import { outlineUniform, toonify } from '../../src/scene/models/toon';

/** Render size; 256 (@2x) and 128 (1x) are box-filtered down from it. */
const R = 512;
const FOV = 22;
/** Ink outline width at R px (→ ≈ 2.4 px at 128, ≈ 4.8 px at 256). */
const INK_PX = 9.5;
/** Free margin around the projected silhouette, as a fraction of the half-frame. */
const PAD = 0.14;
/** Camera direction from the model: 3/4 front-right, from above (same side as the constructor stand camera). */
const DIR = new Vector3(2.6, 2.1, 2.9).normalize();

/**
 * Per-icon tweaks for models that read badly from the default view.
 * yaw: turn the model around +Y (deg); pitch: extra camera elevation (deg); pad: own margin; light: exposure multiplier;
 * keep: only nodes under a matching name are drawn — overlays are authored around the whole hull (4 rotors, 4 legs),
 * one representative piece reads far better at 48 px; corner: same for single-mesh overlays — only the triangles within
 * this fraction of the model's size from its corner nearest the camera are kept (whole triangles, nothing is cut open;
 * long parts that leave the radius drop out); gap: how far (× radius) a loose shell may sit from the main one and still be drawn.
 */
type View = { yaw?: number; pitch?: number; pad?: number; light?: number; keep?: RegExp; corner?: number; gap?: number };
const VIEW: Record<string, View> = {
  rotor_system: { keep: /^pivot_rotor_1(_lo)?$/, pitch: 8 },
  landing_system: { keep: /^pivot_leg_1$/, yaw: -30 },
  landing_system__asteroid: { keep: /^pivot_leg_1$/, yaw: 60 },
  reinforced_frame: { corner: 0.3, light: 1.6 },
  reinforced_frame__asteroid: { corner: 0.3, light: 1.6 },
  heat_shield: { pitch: -68, light: 1.3 }, // from below: the tiled ablative face
};

/** Preview-only overrides: ?preview=heat_shield&pitch=20&yaw=-30&light=1.4&keep=^shield */
function urlView(): View {
  const q = new URLSearchParams(location.search);
  if (!q.get('preview')) return {};
  const v: View = {};
  for (const k of ['yaw', 'pitch', 'pad', 'light', 'gap'] as const) if (q.has(k)) v[k] = Number(q.get(k));
  if (q.has('keep')) v.keep = new RegExp(q.get('keep')!);
  if (q.has('corner')) v.corner = Number(q.get('corner'));
  return v;
}

function cornerOnly(root: Object3D, frac: number, gap = 0.15) {
  root.updateMatrixWorld(true);
  const all = points(root);
  const flat = new Vector3(DIR.x, 0, DIR.z).normalize();
  const anchor = all.reduce((a, p) => (p.dot(flat) > a.dot(flat) ? p : a), all[0]);
  const r = new Box3().setFromPoints(all).getSize(new Vector3()).length() * frac;
  // 1) triangles with all three corners within r of the anchor; 2) split them into connected shells;
  // 3) keep the shell at the anchor and every shell touching it (bands, bolts on it) — loose bits far away drop out.
  type Shell = { mesh: Mesh; tris: number[]; box: Box3 };
  const shells: Shell[] = [];
  const v = [new Vector3(), new Vector3(), new Vector3()];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    const idx = o.geometry.index ? Array.from(o.geometry.index.array) : Array.from({ length: pos.count }, (_, i) => i);
    const key = (i: number) => { v[0].fromBufferAttribute(pos, i); return `${v[0].x.toFixed(4)},${v[0].y.toFixed(4)},${v[0].z.toFixed(4)}`; };
    const parent = new Map<string, string>();
    const find = (k: string): string => { let p = parent.get(k) ?? k; while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p; parent.set(k, p); return p; };
    const tris: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      for (let j = 0; j < 3; j++) v[j].fromBufferAttribute(pos, idx[i + j]).applyMatrix4(o.matrixWorld);
      if (!v.every((p) => p.distanceTo(anchor) <= r)) continue;
      tris.push(i);
      const [ka, kb, kc] = [key(idx[i]), key(idx[i + 1]), key(idx[i + 2])];
      parent.set(find(kb), find(ka));
      parent.set(find(kc), find(ka));
    }
    const groups = new Map<string, Shell>();
    for (const i of tris) {
      const root = find(key(idx[i]));
      let sh = groups.get(root);
      if (!sh) groups.set(root, (sh = { mesh: o, tris: [], box: new Box3() }));
      sh.tris.push(idx[i], idx[i + 1], idx[i + 2]);
      for (let j = 0; j < 3; j++) sh.box.expandByPoint(v[0].fromBufferAttribute(pos, idx[i + j]).applyMatrix4(o.matrixWorld));
    }
    shells.push(...groups.values());
  });
  const main = shells.reduce<Shell | null>((a, sh) => (!a || sh.box.distanceToPoint(anchor) < a.box.distanceToPoint(anchor) ? sh : a), null);
  const near = main ? main.box.clone().expandByScalar(r * gap) : new Box3();
  const keep = new Map<Mesh, number[]>();
  for (const sh of shells) if (sh.box.intersectsBox(near)) keep.set(sh.mesh, [...(keep.get(sh.mesh) ?? []), ...sh.tris]);
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const tris = keep.get(o);
    if (!tris) { o.visible = false; return; }
    const g = o.geometry.clone();
    g.setIndex(tris);
    o.geometry = g;
  });
}

function keepOnly(root: Object3D, keep: RegExp) {
  const under = (o: Object3D | null): boolean => !!o && (keep.test(o.name) || under(o.parent));
  root.traverse((o) => { if (o instanceof Mesh && !o.userData.inkOutline && !under(o)) o.visible = false; });
}

const BASE = import.meta.env.BASE_URL ?? '/';
const log = (s: string) => { const el = document.getElementById('log'); if (el) el.textContent = s; };

interface Job { key: string; model: string; department: string; name: string }

async function manifestIds(): Promise<Set<string>> {
  const json = await fetch(`${BASE}models/manifest.json`, { cache: 'no-cache' }).then((r) => r.json()) as { models: { id: string }[] };
  return new Set(json.models.map((m) => m.id));
}

/** Variants that read worse than the base icon at 48 px (power_bus__asteroid: a thin dark hexagon of rails) — the UI falls back to the base icon. */
const SKIP_VARIANT = new Set(['power_bus']);

/** Every catalog module with a GLB, plus its `__asteroid` overlay variant when the manifest has one. */
async function jobs(): Promise<Job[]> {
  const ids = await manifestIds();
  const out: Job[] = [];
  for (const c of COMPONENTS) {
    const model = c.model ?? c.id;
    if (ids.has(model)) out.push({ key: c.id, model, department: c.department, name: c.name });
    if (ids.has(`${model}__asteroid`) && !SKIP_VARIANT.has(c.id)) out.push({ key: `${c.id}__asteroid`, model: `${model}__asteroid`, department: c.department, name: `${c.name} (Астероид)` });
  }
  return out;
}

const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: true });
renderer.setPixelRatio(1);
renderer.setSize(R, R, false);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping; // R3F's default, so the colours match the stand
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function points(root: Object3D): Vector3[] {
  const pts: Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverseVisible((o) => {
    if (!(o instanceof Mesh) || o.userData.inkOutline) return;
    const pos = o.geometry.getAttribute('position');
    if (!pos) return;
    // Through the index: cornerOnly() trims the index and leaves the vertex buffer as is.
    const used = o.geometry.index ? [...new Set(Array.from(o.geometry.index.array))] : Array.from({ length: pos.count }, (_, i) => i);
    const step = Math.max(1, Math.floor(used.length / 6000));
    for (let i = 0; i < used.length; i += step) pts.push(new Vector3().fromBufferAttribute(pos, used[i]).applyMatrix4(o.matrixWorld));
  });
  return pts;
}

/** Aim the camera along `dir` and pan / dolly until the projected vertices fill the frame minus `pad`. */
function frame(cam: PerspectiveCamera, pts: Vector3[], dir: Vector3, pad: number) {
  const c = new Vector3();
  pts.forEach((p) => c.add(p));
  c.divideScalar(Math.max(1, pts.length));
  const r = Math.max(1e-3, ...pts.map((p) => p.distanceTo(c)));
  let target = c.clone();
  let dist = r / Math.sin(MathUtils.degToRad(FOV / 2));
  const tan = Math.tan(MathUtils.degToRad(FOV / 2));
  const v = new Vector3();
  for (let it = 0; it < 6; it++) {
    cam.position.copy(target).addScaledVector(dir, dist);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      v.copy(p).project(cam);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const ext = Math.max(x1 - x0, y1 - y0) / 2;
    const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    target = target.clone().addScaledVector(right, cx * dist * tan).addScaledVector(up, cy * dist * tan);
    dist *= ext / (1 - pad);
  }
  cam.position.copy(target).addScaledVector(dir, dist);
  cam.lookAt(target);
  cam.near = Math.max(0.001, dist / 100);
  cam.far = dist * 100;
  cam.updateProjectionMatrix();
  return { target, dist };
}

/** Second pass on the real pixels (ink hull and clipped faces included): pan / dolly until the alpha bbox fits. */
function refine(scene: Scene, cam: PerspectiveCamera, target: Vector3, pad: number) {
  const probe = canvas(R);
  const tan = Math.tan(MathUtils.degToRad(FOV / 2));
  for (let it = 0; it < 4; it++) {
    renderer.render(scene, cam);
    probe.ctx.clearRect(0, 0, R, R);
    probe.ctx.drawImage(renderer.domElement, 0, 0);
    const d = probe.ctx.getImageData(0, 0, R, R).data;
    let x0 = R, x1 = -1, y0 = R, y1 = -1;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 8) continue;
      const p = (i - 3) / 4, x = p % R, y = (p / R) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return;
    const cx = ((x0 + x1 + 1) / R) - 1, cy = 1 - ((y0 + y1 + 1) / R);
    const ext = Math.max(x1 - x0 + 1, y1 - y0 + 1) / R;
    const dist = cam.position.distanceTo(target);
    const right = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const dir = cam.position.clone().sub(target).normalize();
    target.addScaledVector(right, cx * dist * tan).addScaledVector(up, cy * dist * tan);
    if (Math.abs(cx) < 0.004 && Math.abs(cy) < 0.004 && Math.abs(ext - (1 - pad)) < 0.01) return;
    cam.position.copy(target).addScaledVector(dir, dist * (ext / (1 - pad)));
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
  }
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

/** Mean luminance (0..1) and coverage of the opaque pixels — the driver flags too dark / too small icons. */
function measure(ctx: CanvasRenderingContext2D, size: number) {
  const d = ctx.getImageData(0, 0, size, size).data;
  let lum = 0, n = 0, x0 = size, x1 = 0, y0 = size, y1 = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    n++;
    const p = i / 4, x = p % size, y = (p / size) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { lum: n ? lum / n : 0, cover: n / (size * size), bbox: [x0, y0, x1, y1], touchesEdge: x0 <= 0 || y0 <= 0 || x1 >= size - 1 || y1 >= size - 1 };
}

async function render(job: Job, quality = 0.86) {
  const gltf = await loader.loadAsync(`${BASE}models/${job.model}.glb`);
  const root = gltf.scene;
  const lod = root.getObjectByName('lod1');
  if (lod) lod.visible = false;
  const view: View = { ...(VIEW[job.key] ?? VIEW[job.model] ?? {}), ...urlView() };
  root.rotation.y = MathUtils.degToRad(view.yaw ?? 0);
  if (view.keep) keepOnly(root, view.keep);
  if (view.corner) cornerOnly(root, view.corner, view.gap);
  toonify(root, { castShadow: false, receiveShadow: false });

  const scene = new Scene();
  scene.add(root);
  const dir = DIR.clone();
  if (view.pitch) {
    const flat = new Vector3(dir.x, 0, dir.z).normalize();
    const el = Math.asin(dir.y) + MathUtils.degToRad(view.pitch);
    dir.copy(flat.multiplyScalar(Math.cos(el))).setY(Math.sin(el));
  }
  const cam = new PerspectiveCamera(FOV, 1, 0.01, 1000);
  let pts = points(root);
  const { target } = frame(cam, pts, dir, view.pad ?? PAD);

  // Stand lighting (StandScene: ambient 0.7 ice, key 1.6 from above-right, lavender fill from behind-left), moved with the model.
  const k = view.light ?? 1;
  scene.add(new AmbientLight('#CFE8FF', 0.7 * k));
  const key = new DirectionalLight('#ffffff', 1.6 * k);
  key.position.copy(target).add(new Vector3(4, 6, 3));
  key.target.position.copy(target);
  scene.add(key, key.target);
  const fill = new PointLight('#B8A9F0', 8 * k);
  fill.position.copy(target).add(new Vector3(-3, 1, -2));
  scene.add(fill);

  outlineUniform.value = (INK_PX / (R / 2)) * Math.tan(MathUtils.degToRad(FOV / 2));
  refine(scene, cam, target, view.pad ?? PAD);
  renderer.render(scene, cam);

  const big = canvas(R);
  big.ctx.filter = 'drop-shadow(0px 5px 4px rgba(11,13,26,0.32))';
  big.ctx.drawImage(renderer.domElement, 0, 0);
  big.ctx.filter = 'none';
  const x2 = canvas(256);
  x2.ctx.drawImage(big.c, 0, 0, 256, 256);
  const x1 = canvas(128);
  x1.ctx.drawImage(x2.c, 0, 0, 128, 128);
  const m = measure(x2.ctx, 256);
  scene.remove(root);
  return { key: job.key, model: job.model, x1: x1.c.toDataURL('image/webp', quality), x2: x2.c.toDataURL('image/webp', quality), ...m };
}

/** Contact sheet: each icon at 128 on the card cream, plus 64 / 48 px on cream and on the night panel. */
async function sheet(items: { key: string; name: string; x1: string; x2: string; flag?: string }[], cols = 8) {
  const W = 220, H = 200;
  const rows = Math.ceil(items.length / cols);
  const { c, ctx } = canvas(1);
  c.width = cols * W; c.height = rows * H + 40;
  ctx.fillStyle = '#1F1D32'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#F7F8FF'; ctx.font = '700 18px system-ui, sans-serif';
  ctx.fillText(`Module icons · ${items.length} · 128 px on cream, 64 / 48 px on cream and night (from @2x)`, 12, 26);
  const img = (src: string) => new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    const x = (n % cols) * W, y = 40 + Math.floor(n / cols) * H;
    ctx.fillStyle = '#F3EAD7'; ctx.fillRect(x + 6, y + 6, 140, 140);
    ctx.fillStyle = '#2A2840'; ctx.fillRect(x + 150, y + 6, 64, 140);
    ctx.fillStyle = '#F3EAD7'; ctx.fillRect(x + 150, y + 6, 64, 70);
    const [a, b] = await Promise.all([img(it.x1), img(it.x2)]);
    ctx.drawImage(a, x + 12, y + 12, 128, 128);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(b, x + 158, y + 10, 48, 48);
    ctx.drawImage(b, x + 150, y + 78, 64, 64);
    ctx.fillStyle = it.flag ? '#FF9A4A' : '#F7F8FF';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(it.key.length > 28 ? it.key.slice(0, 27) + '…' : it.key, x + 8, y + 166);
    ctx.fillStyle = '#B8A9F0'; ctx.font = '12px system-ui, sans-serif';
    ctx.fillText((it.flag ? `⚠ ${it.flag} · ` : '') + (it.name.length > 30 ? it.name.slice(0, 29) + '…' : it.name), x + 8, y + 184);
  }
  return c.toDataURL('image/jpeg', 0.86);
}

declare global {
  interface Window {
    __iconJobs?: () => Promise<Job[]>;
    __iconRender?: (key: string) => Promise<Awaited<ReturnType<typeof render>>>;
    __iconSheet?: typeof sheet;
    __iconReady?: boolean;
  }
}

let cache: Job[] | null = null;
window.__iconJobs = async () => (cache ??= await jobs());
window.__iconRender = async (key: string) => {
  const job = (await window.__iconJobs!()).find((j) => j.key === key);
  if (!job) throw new Error(`no job ${key}`);
  return render(job);
};
window.__iconSheet = sheet;
window.__iconReady = true;

// Manual preview: ?preview=rtg shows the 512 render and the two outputs.
const preview = new URLSearchParams(location.search).get('preview');
if (preview) {
  void window.__iconRender(preview).then((r) => {
    document.body.append(renderer.domElement);
    for (const src of [r.x2, r.x1]) { const i = new Image(); i.src = src; document.body.append(i); }
    log(`${r.key}: lum ${r.lum.toFixed(2)} cover ${r.cover.toFixed(2)}${r.touchesEdge ? ' TOUCHES EDGE' : ''}`);
  });
} else log('ready');
