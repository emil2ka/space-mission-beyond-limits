// Props of the M3 scenes (docs/04 Tech/M3 Asteroid Contract.md, section C).
// TODO(M3-A): once src/engine exports AsteroidSiteId / CapsuleStage / AsteroidFlight, import them from '../../engine'
// instead of the local copies below (same shapes as the contract, so the switch is a type-only change).
import type { Build } from '../../engine';
import type { CrisisKind, SignalState } from '../flight/types';
import type { Quality } from '../quality';

export type AsteroidSiteId = 'regolith' | 'boulder' | 'crack';
export type CapsuleStage = 'stowed' | 'separated' | 'entry' | 'chute' | 'landed' | 'found' | 'lost';
export type SamplingState = 'idle' | 'reach' | 'grab' | 'jam' | 'stowed' | 'failed';
export type AsteroidCrisisKind = CrisisKind | 'debris_alert' | 'arm_jam';

export const SITE_IDS: readonly AsteroidSiteId[] = ['regolith', 'boulder', 'crack'];
export const CAPSULE_STAGES: readonly CapsuleStage[] = ['stowed', 'separated', 'entry', 'chute', 'landed', 'found', 'lost'];
export const SAMPLING_STATES: readonly SamplingState[] = ['idle', 'reach', 'grab', 'jam', 'stowed', 'failed'];
/** Asteroid mission phases (engine/data/missions.ts). */
export const ASTEROID_PHASES = ['cruise', 'approach', 'site', 'sampling', 'stow', 'return'] as const;

export interface AsteroidSceneProps {
  build: Build;
  /** cruise · approach · site · sampling · stow · return. cruise/return → ion beam; return → the craft leaves. */
  phaseId: string;
  /** 0..1: 0 = far out on the cruise leg (asteroid a speck), 1 = holding station above the site. */
  approach: number;
  /** Chosen site (highlighted); null = still choosing (the craft holds high above all three). */
  site: AsteroidSiteId | null;
  sampling: SamplingState;
  /** Container lid closes when true. */
  sampleSealed: boolean;
  /** nodeIds[0] = component the crisis is about (arm_jam → robotic_arm / drill if empty). */
  crisis: { kind: AsteroidCrisisKind; nodeIds: string[] } | null;
  /** Debris Alert running: debris_1..3 fly past (hull hit flashes only with crisis.kind === 'debris_alert'). */
  debris: boolean;
  offIds: string[];
  signal: SignalState;
  reducedMotion: boolean;
  /** Graphics quality (M5, src/scene/quality.tsx); default 'high'. */
  quality?: Quality;
}

export interface ReturnSceneProps {
  build: Build;
  capsule: CapsuleStage;
  /** 0..1 inside the stage (separation distance, entry heat, chute opening + descent). */
  capsuleProgress: number;
  /** Recovery beacon transmitting (blinks on the ground; never in 'lost'). */
  beacon: boolean;
  reducedMotion: boolean;
  /** Where it comes down (optional, default 'steppe'). */
  landing?: 'steppe' | 'ocean';
  /** Graphics quality (M5, src/scene/quality.tsx); default 'high'. */
  quality?: Quality;
}
