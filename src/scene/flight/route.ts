// Pure: the Titan route (entry → dunes → lake → crater) in world XZ and the craft's altitude profile.
// Points are on the centre titan_terrain tile (60 × 60, lake mesh at x ≈ −17).
import type { WaypointId } from './types';

export interface RoutePoint { id: 'entry' | WaypointId; x: number; z: number }

export const ROUTE: readonly RoutePoint[] = [
  { id: 'entry', x: 30, z: 34 },
  { id: 'dunes', x: 12, z: 12 },
  { id: 'lake', x: -15, z: 3 },
  { id: 'crater', x: -2, z: -19 },
];

/** Hover height above the ground at a waypoint, entry altitude, cruise clearance over dunes (m). */
export const HOVER = 4.2;
export const ENTRY_ALT = 30;
export const CLEARANCE = 3;

const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
export const smooth = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k); };

/**
 * Route parameter s ∈ [0, 3]: segment k = waypointIndex runs from ROUTE[k] to ROUTE[k + 1].
 * The engine moves waypointIndex past the last point (= waypoints.length) once the crater is reached → s = 3.
 */
export function routeParam(waypointIndex: number, waypointProgress: number): number {
  if (waypointIndex >= 3) return 3;
  const i = Math.min(2, Math.max(0, Math.round(Number.isFinite(waypointIndex) ? waypointIndex : 0)));
  return i + clamp01(waypointProgress);
}

/**
 * Altitude on segment k at local u ∈ [0, 1]: eases from the start altitude to the end altitude and lifts in the
 * middle so the craft clears the highest ground sampled along the segment (`groundMax`).
 */
export function segmentAltitude(u: number, a0: number, a1: number, groundMax: number): number {
  const k = clamp01(u);
  const base = a0 + (a1 - a0) * smooth(k);
  const lift = Math.max(0, groundMax + CLEARANCE - Math.min(a0, a1));
  return base + lift * Math.sin(Math.PI * k);
}

/** Altitude of route point i given its ground height (entry is a fixed altitude). */
export function pointAltitude(i: number, ground: number): number {
  return i === 0 ? Math.max(ENTRY_ALT, ground + ENTRY_ALT * 0.5) : ground + HOVER;
}

/** Signal state → static noise strength 0..1. During a signal crisis it is stronger and never zero. */
export function noiseLevel(signal: 'ok' | 'delay' | 'interference' | 'lost', crisis: boolean, reducedMotion: boolean): number {
  const base = crisis
    ? { ok: 0.3, delay: 0.38, interference: 0.6, lost: 0.85 }[signal]
    : { ok: 0, delay: 0, interference: 0.14, lost: 0.5 }[signal];
  return reducedMotion ? base * 0.5 : base;
}
