// Pure: the launch animation as a function of time (seconds since start). ~13.5 s total.
// Countdown → arms swing → ignition → liftoff → stage separation → fairing opens → craft revealed.

export const T = {
  countdown: 0.4,      // "3" appears
  arms: 2.6,           // swing arms start opening
  ignition: 3.4,       // engines light
  liftoff: 4.0,        // rocket leaves the pad
  separation: 8.6,     // stage 1 drops
  stage2: 9.1,         // stage 2 lights
  fairing: 10.0,       // fairing halves open
  reveal: 11.2,        // camera on the craft
  end: 13.6,
} as const;

/** Liftoff acceleration (m/s²) for stage 1 and the extra push of stage 2. */
const A1 = 3.2;
const A2 = 4.5;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => { const k = clamp01(x); return k * k * (3 - 2 * k); };

export function altitude(t: number): number {
  if (t <= T.liftoff) return 0;
  const a = t - T.liftoff;
  let y = 0.5 * A1 * a * a;
  if (t > T.stage2) { const b = t - T.stage2; y += 0.5 * A2 * b * b; }
  return y;
}

export function velocity(t: number): number {
  if (t <= T.liftoff) return 0;
  return A1 * (t - T.liftoff) + (t > T.stage2 ? A2 * (t - T.stage2) : 0);
}

export interface LaunchFrame {
  /** 3, 2, 1, 0 ("СТАРТ!") or null when hidden. */
  countdown: number | null;
  arms: number;          // 0 attached → 1 swung away
  flame1: number;        // stage-1 flame strength 0..1
  flame2: number;        // stage-2 flame strength 0..1
  altitude: number;      // rocket root height above the pad mount (m)
  /** Stage 1 after separation: drop below the stage-2 pivot (m) and tumble (rad). */
  stage1Drop: number;
  stage1Tilt: number;
  fairing: number;       // 0 closed → 1 fully open and drifted away
  space: number;         // sky blend 0 (night on the ground) → 1 (black space)
  done: boolean;
}

export function launchFrame(t: number): LaunchFrame {
  const cd = t < T.countdown ? null : t < T.ignition ? 3 - Math.floor((t - T.countdown) / ((T.ignition - T.countdown) / 3)) : t < T.liftoff + 1 ? 0 : null;
  const sep = Math.max(0, t - T.separation);
  return {
    countdown: cd === null ? null : Math.max(0, Math.min(3, cd)),
    arms: ease((t - T.arms) / 1.2),
    flame1: t < T.ignition ? 0 : t < T.separation ? Math.min(1, 0.35 + (t - T.ignition) * 1.3) : Math.max(0, 1 - sep * 4),
    flame2: t < T.stage2 ? 0 : Math.min(1, (t - T.stage2) * 2.5),
    altitude: altitude(t),
    stage1Drop: sep > 0 ? 0.6 * sep + 0.5 * 9 * sep * sep : 0,
    stage1Tilt: sep * 0.35,
    fairing: ease((t - T.fairing) / 1.6),
    space: ease((t - T.liftoff - 1.5) / 6),
    done: t >= T.end,
  };
}
