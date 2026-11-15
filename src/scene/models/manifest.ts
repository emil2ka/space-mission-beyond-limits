// Pure: parse public/models/manifest.json (written by scripts/optimize-models.mjs).
// Tolerant — anything unexpected means "no models", so the game falls back to placeholders.

export interface ManifestEntry {
  id: string;
  file: string;
  bytes: number;
  tris: number;
  kind: string;
}

export interface ModelManifest {
  ids: ReadonlySet<string>;
  entries: Readonly<Record<string, ManifestEntry>>;
}

export const EMPTY_MANIFEST: ModelManifest = { ids: new Set(), entries: {} };

const ID = /^[a-z0-9_]+$/;

export function parseManifest(json: unknown): ModelManifest {
  const list: unknown[] = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { models?: unknown }).models)
      ? (json as { models: unknown[] }).models
      : [];
  const entries: Record<string, ManifestEntry> = {};
  for (const item of list) {
    const raw = typeof item === 'string' ? { id: item } : (item as Partial<ManifestEntry> | null);
    if (!raw || typeof raw.id !== 'string' || !ID.test(raw.id)) continue;
    const file = typeof raw.file === 'string' && /^[a-z0-9_]+\.glb$/.test(raw.file) ? raw.file : `${raw.id}.glb`;
    entries[raw.id] = {
      id: raw.id,
      file,
      bytes: Number(raw.bytes) || 0,
      tris: Number(raw.tris) || 0,
      kind: typeof raw.kind === 'string' ? raw.kind : 'module',
    };
  }
  return { ids: new Set(Object.keys(entries)), entries };
}

/** URL of a model's GLB, or null when the manifest does not list it (→ placeholder, no 404). */
export function modelUrl(id: string, manifest: ModelManifest, base = '/'): string | null {
  const e = manifest.entries[id];
  if (!e) return null;
  return `${base.endsWith('/') ? base : base + '/'}models/${e.file}`;
}
