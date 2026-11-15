// Pure: the numbers behind the asteroid + capsule-return scenes (no React / three), unit-tested.
import type { CapsuleStage, SamplingState } from './types';

const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));
export const smooth = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k); };

// ---------- approach ----------

/** Distance from the asteroid surface on the far leg (m): ~240 out at approach 0 → 0 at 1. */
export const FAR = 240;
export function approachDistance(approach: number): number {
  return FAR * Math.pow(1 - clamp01(approach), 2.2);
}

/**
 * 0 → the craft flies its inertial approach line; 1 → it holds station above the site and has matched the
 * asteroid's tumble (the asteroid stops turning relative to it; the stars turn instead).
 */
export function syncK(approach: number, phaseId = ''): number {
  if (phaseId === 'site' || phaseId === 'sampling' || phaseId === 'stow') return 1;
  return smooth((clamp01(approach) - 0.45) / 0.4);
}

/**
 * Stand-off of the sampling tool's slot from the surface along the site normal (m).
 * `reach` = how far the tool tip sticks out when fully extended.
 */
export function standoff(sampling: SamplingState, reach: number, siteChosen: boolean): number {
  if (!siteChosen) return 7;
  switch (sampling) {
    case 'reach': return reach + 0.3;
    case 'grab': return reach - 0.03;
    case 'jam': return reach + 0.22;
    case 'failed': return reach + 0.6;
    case 'stowed': return 3.4;
    default: return 3.2;
  }
}

/** Arm extension 0 (folded) … 1 (touching), and claw 0 open … 1 closed. */
export function armTarget(sampling: SamplingState): { reach: number; claw: number } {
  switch (sampling) {
    case 'reach': return { reach: 1, claw: 0 };
    case 'grab': return { reach: 1, claw: 1 };
    case 'jam': return { reach: 0.55, claw: 0.3 };
    case 'failed': return { reach: 0.35, claw: 0 };
    default: return { reach: 0, claw: 1 };
  }
}

/** Container lid: 0 closed … 1 open. Opens while the sample goes in, closes once sealed. */
export function lidOpen(sampling: SamplingState, sealed: boolean): number {
  if (sealed) return 0;
  return sampling === 'grab' || sampling === 'stowed' ? 1 : 0;
}

/** Warning blinks: 3 slow blinks (≈1.4 Hz, no strobe), then steady. ms since the crisis started. */
export const BLINKS = 3;
export const BLINK_MS = 360;
export function blinkLit(ms: number): boolean {
  if (ms >= BLINKS * 2 * BLINK_MS) return true;
  return Math.floor(ms / BLINK_MS) % 2 === 0;
}

// ---------- capsule return ----------

/** Which set the return scene shows: in orbit (Earth below, stars) or in the sky / on the ground. */
export function returnWorld(stage: CapsuleStage): 'space' | 'sky' {
  return stage === 'stowed' || stage === 'separated' || stage === 'entry' ? 'space' : 'sky';
}

/** Capsule distance from the mothership during 'separated' (m) and its flip (0 → π: shield turns to Earth). */
export function separation(progress: number): { distance: number; flip: number } {
  const k = clamp01(progress);
  return { distance: 0.2 + 7 * smooth(k), flip: Math.PI * smooth((k - 0.15) / 0.75) };
}

/** Re-entry heat 0..1: ramps up, holds, fades as the capsule slows down. */
export function entryHeat(progress: number): number {
  const k = clamp01(progress);
  return smooth(k / 0.25) * (1 - smooth((k - 0.78) / 0.22));
}

/** Altitude above the Earth's surface during entry (m in scene units). */
export function entryAltitude(progress: number): number {
  return 16 - 14.5 * smooth(clamp01(progress));
}

/** Canopy scale during 'chute': snaps open in two steps (reefed, then full) in the first ~40 %. */
export function chuteOpen(progress: number): number {
  const k = clamp01(progress);
  return 0.18 * smooth(k / 0.08) + 0.82 * smooth((k - 0.14) / 0.24);
}

/** Capsule height above the ground during 'chute' (m). */
export function chuteAltitude(progress: number): number {
  const k = clamp01(progress);
  return 0.62 + 52 * (1 - k) * (1 - 0.35 * k);
}
