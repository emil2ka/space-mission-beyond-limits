// Props of the M1 flight scenes (docs/04 Tech/M1 Flight Contract.md, section C).
// TODO(M1-A): once src/engine exports CrisisKind / WaypointId / FlightState['route'], import them from '../../engine'
// instead of the local copies below (the shapes are the contract ones, so the switch is a type-only change).
import type { Build, CrisisKind, FlightState, MissionId, RoleId } from '../../engine';
import type { Quality } from '../quality';

// The engine's CrisisKind (M3 added 'debris_alert' | 'arm_jam'; the Titan scene simply has no visual for those).
export type { CrisisKind } from '../../engine';
export type WaypointId = 'dunes' | 'lake' | 'crater';
export type RouteState = 'flying' | 'landed' | 'stopped';
export type SignalState = FlightState['signal'];

export interface LaunchSceneProps {
  build: Build;
  mission: MissionId;
  reducedMotion: boolean;
  /** Called once: at the end of the animation or on skip. The host then sends `launchDone`. */
  onDone: () => void;
  /** Click / key skips the animation (default true; the screen may allow it only after the first viewing). */
  skippable?: boolean;
  /** Start this many seconds into the timeline (dev page, report replays). Default 0. */
  startAt?: number;
  /** Graphics quality (M5, src/scene/quality.tsx); default 'high'. */
  quality?: Quality;
}

export interface TitanSceneProps {
  build: Build;
  phaseId: string;
  /**
   * Point the craft is flying TO: 0 dunes, 1 lake, 2 crater. waypointProgress 0..1 = from the previous point
   * (for 0 — from the entry/descent point high above the dunes) to this one; 1 = hovering at the point.
   * 3 (= waypoints.length, all reached) = at the crater.
   */
  waypointIndex: number;
  waypointProgress: number;
  /**
   * 'flying' (also hovering at a point) · 'landed' — sets down where it is, rotors spin down ·
   * 'stopped' (held by Safe Protocol / crisis) — hovers in place; sits down only if rotor_system is off or missing.
   */
  route: RouteState;
  crisis: { kind: CrisisKind; nodeIds: string[] } | null;
  /** Components switched off (load shedding / crisis): they go dark. */
  offIds: string[];
  signal: SignalState;
  role: RoleId | null;
  reducedMotion: boolean;
  /** Methane storm (engine: f.storm && f.tick < f.storm.until): denser slanted rain, closer haze, light static. */
  storm?: boolean;
  /** Graphics quality (M5, src/scene/quality.tsx); default 'high'. */
  quality?: Quality;
}
