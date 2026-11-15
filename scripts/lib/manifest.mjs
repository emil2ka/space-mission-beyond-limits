// public/models/manifest.json — tells the client which <id>.glb exist (no 404 probing).
// Format (read by src/scene/models/manifest.ts): { version: 1, models: [{ id, file, bytes, tris, kind }] }

export const MANIFEST_VERSION = 1;

/** @param {{ id: string, bytes: number, tris?: number, kind?: string }[]} entries */
export function buildManifest(entries) {
  const seen = new Map();
  for (const e of entries) {
    if (!/^[a-z0-9_]+$/.test(e.id)) continue;
    seen.set(e.id, { id: e.id, file: `${e.id}.glb`, bytes: e.bytes, tris: e.tris ?? 0, kind: e.kind ?? 'module' });
  }
  return { version: MANIFEST_VERSION, models: [...seen.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
