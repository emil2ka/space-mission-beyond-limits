// Model availability + loading. Never suspends and never 404s: a model is fetched only if
// public/models/manifest.json lists it; until it is loaded (or if it fails) callers get null → placeholder.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AnimationClip, Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EMPTY_MANIFEST, modelUrl, parseManifest, type ModelManifest } from './manifest';
import { toonify, type ToonOptions } from './toon';

const BASE = import.meta.env.BASE_URL ?? '/';

// ---------- tiny external store ----------
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

let manifest: ModelManifest = EMPTY_MANIFEST;
let manifestState: 'idle' | 'loading' | 'ready' = 'idle';

function ensureManifest() {
  if (manifestState !== 'idle') return;
  manifestState = 'loading';
  fetch(`${BASE}models/manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null))
    .then((json) => { manifest = parseManifest(json); })
    .catch(() => { manifest = EMPTY_MANIFEST; })
    .finally(() => {
      manifestState = 'ready';
      for (const id of [...PRELOAD, ...wanted]) if (manifest.ids.has(id)) void loadTemplate(id);
      emit();
    });
}

/** Loaded early once the manifest says they exist (the stand scene needs them first). */
const PRELOAD = ['frame_titan', 'test_stand', 'hq_hangar', 'hq_console'];

/** Per-id look settings: big environment pieces get no outlines/shadow casting. */
const LOOK: Record<string, ToonOptions> = {
  hq_hangar: { outlines: true, castShadow: false },
  titan_terrain: { outlines: false, castShadow: false },
  launch_pad: { castShadow: false },
  asteroid: { castShadow: false },
  earth: { castShadow: false, receiveShadow: false },
  debris: { castShadow: false },
};

/** Per-id fix-ups on the loaded template (before cloning). */
const PREPARE: Record<string, (root: Object3D) => void> = {
  // Two LOD children in one GLB: show the detailed one by default (callers may swap to lod1 when far away).
  asteroid: (root) => { const far = root.getObjectByName('lod1'); if (far) far.visible = false; },
};

export interface ModelTemplate {
  id: string;
  scene: Object3D;
  animations: AnimationClip[];
}

const templates = new Map<string, ModelTemplate | null>();
const pending = new Map<string, Promise<ModelTemplate | null>>();
let loader: GLTFLoader | null = null;

function loadTemplate(id: string): Promise<ModelTemplate | null> {
  const existing = pending.get(id);
  if (existing) return existing;
  const url = modelUrl(id, manifest, BASE);
  if (!url) return Promise.resolve(null);
  if (!loader) loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const p = loader.loadAsync(url)
    .then((gltf) => {
      gltf.scene.name ||= id;
      toonify(gltf.scene, LOOK[id]);
      PREPARE[id]?.(gltf.scene);
      return { id, scene: gltf.scene, animations: gltf.animations } satisfies ModelTemplate;
    })
    .catch((e: unknown) => {
      console.warn(`[models] ${id}.glb failed to load — using placeholder`, e);
      return null;
    })
    .then((t) => { templates.set(id, t); emit(); return t; });
  pending.set(id, p);
  return p;
}

// ---------- preloading (M5: the next scene's models load while the current one plays) ----------

const wanted = new Set<string>();

/**
 * Start loading these models in the background (no-op for ids the manifest does not list).
 * Safe to call before the manifest is fetched and many times (each GLB loads once).
 */
export function preloadModels(ids: readonly string[]): void {
  for (const id of ids) wanted.add(id);
  if (manifestState !== 'ready') { ensureManifest(); return; }
  for (const id of ids) if (manifest.ids.has(id)) void loadTemplate(id);
}

/** Models each scene needs first (environment + its fixed props), for preloadModels. */
export const SCENE_MODELS = {
  launch: ['launch_pad', 'rocket'],
  titan: ['titan_terrain'],
  asteroid: ['asteroid', 'debris'],
  return: ['return_capsule', 'heat_shield', 'parachute', 'recovery_beacon', 'earth'],
} as const;

/** True once every listed id is loaded (or failed / not in the manifest) — for a scene's loading placeholder. */
export function useModelsReady(ids: readonly string[]): boolean {
  useEffect(() => { preloadModels(ids); }, [ids]);
  return useSyncExternalStore(subscribe, () => manifestState === 'ready' && ids.every((id) => !manifest.ids.has(id) || templates.has(id)), () => false);
}

// ---------- hooks ----------

export function useModelManifest(): ModelManifest {
  useEffect(ensureManifest, []);
  return useSyncExternalStore(subscribe, () => manifest, () => manifest);
}

export function useModelAvailable(id: string): boolean {
  return useModelManifest().ids.has(id);
}

function useTemplate(id: string | null): ModelTemplate | null {
  const m = useModelManifest();
  const listed = !!id && m.ids.has(id);
  useEffect(() => { if (listed && id) void loadTemplate(id); }, [listed, id]);
  return useSyncExternalStore(subscribe, () => (listed && id ? templates.get(id) ?? null : null), () => null);
}

export interface ModelInstance {
  id: string;
  /** Per-instance clone (SkeletonUtils.clone — skinned meshes keep their own skeleton). */
  scene: Object3D;
  animations: AnimationClip[];
  /** First node with each name. */
  nodes: Map<string, Object3D>;
}

export function instantiate(t: ModelTemplate): ModelInstance {
  const scene = skeletonClone(t.scene);
  const nodes = new Map<string, Object3D>();
  scene.traverse((o) => { if (o.name && !nodes.has(o.name)) nodes.set(o.name, o); });
  return { id: t.id, scene, animations: t.animations, nodes };
}

/**
 * The model for a component / environment id, or null → render the placeholder.
 * Each calling component gets its own clone.
 */
export function useComponentModel(id: string | null): ModelInstance | null {
  const t = useTemplate(id);
  return useMemo(() => (t ? instantiate(t) : null), [t]);
}

/** For later screens (flight/report): rocket, launch_pad, titan_terrain, asteroid, earth, debris — same contract, same fallback. */
export const useEnvModel = useComponentModel;
/** Astronaut: clone + its 7 clips (Idle, Typing, Wave, ThumbsUp, Panic, Cheer, Shrug); drive with drei useAnimations. */
export function useAstronautModel(): ModelInstance | null {
  return useComponentModel('astronaut');
}
