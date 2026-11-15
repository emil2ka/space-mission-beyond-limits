// Pure: which named node of a model moves how (docs/05 Assets/Animations.md). Runtime is mechanics.ts.

export type Axis = 'x' | 'y' | 'z';

export type Motion =
  /** Continuous rotation, rad/s. */
  | { kind: 'spin'; axis: Axis; speed: number }
  /** Slow sinusoidal aim/idle sway around an axis, amplitude in rad. */
  | { kind: 'sway'; axis: Axis; amp: number; period: number; phase: number }
  /** Periodic one-sided rotation from the authored pose (0 → amp → 0), e.g. a lid peeking open. */
  | { kind: 'swing'; axis: Axis; amp: number; period: number; phase: number }
  /** One-shot rotation from the authored (stowed) pose by `to` rad. */
  | { kind: 'unfold'; axis: Axis; to: number; delay: number; duration: number }
  /** Back-and-forth translation along an axis, metres. */
  | { kind: 'slide'; axis: Axis; amp: number; period: number; phase?: number }
  /** Emissive pulse on the meshes next to an fx_* empty (multiplier range). */
  | { kind: 'pulse'; min: number; max: number; period: number }
  /** On/off emissive blink of the node's own meshes (activity LEDs, beacon lamp); phase/duty in cycles. */
  | { kind: 'blink'; period: number; phase: number; duty: number }
  /** Constant uniform scale of the node (parachute canopy stowed ≈ 0; deploy = 1). */
  | { kind: 'scale'; value: number };

export interface Mechanic {
  node: string;
  motion: Motion;
}

/** pivot_rotor_<n> (upper) and pivot_rotor_<n>_lo (lower rotor of the coaxial pair, counter-rotating). */
const ROTOR = /^pivot_rotor_(\d+)(_lo)?$/;
const WHEEL = /^pivot_wheel_(\d+)$/;
const DAMPER = /^pivot_damper_(\d+)$/;
const LED = /^led_(\d+)$/;
const AXES: Axis[] = ['x', 'y', 'z'];

/** Canopy scale while stowed (0 would give a singular matrix). */
export const CHUTE_STOWED = 0.001;

/** Per-model overrides: same node name, different meaning (launch_pad arms vs robotic arm), or no motion. */
const PER_MODEL: Record<string, Record<string, Motion | null>> = {
  robotic_arm: {
    pivot_arm_1: { kind: 'sway', axis: 'y', amp: 0.35, period: 11, phase: 0 },
    pivot_arm_2: { kind: 'sway', axis: 'x', amp: 0.12, period: 7, phase: 0.6 },
    pivot_arm_3: { kind: 'sway', axis: 'x', amp: 0.16, period: 6, phase: 1.4 },
    pivot_claw: { kind: 'sway', axis: 'x', amp: 0.2, period: 5, phase: 2 },
    pivot_claw_l: { kind: 'sway', axis: 'y', amp: 0.18, period: 3, phase: 0 },
    pivot_claw_r: { kind: 'sway', axis: 'y', amp: -0.18, period: 3, phase: 0 },
  },
  launch_pad: { pivot_arm_1: null, pivot_arm_2: null },
  // The heat shield only glows on re-entry (flight), not on the stand.
  heat_shield: { fx_glow: null },
  recovery_beacon: { fx_glow: { kind: 'blink', period: 1.2, phase: 0, duty: 0.25 } },
};

/** One rule set for every model id (node names are unique enough across the kit), plus PER_MODEL overrides. */
export function motionFor(name: string, modelId?: string): Motion | null {
  const own = modelId ? PER_MODEL[modelId] : undefined;
  if (own && name in own) return own[name];
  const rotor = ROTOR.exec(name);
  if (rotor) return { kind: 'spin', axis: 'y', speed: (Number(rotor[1]) % 2 ? 16 : -16) * (rotor[2] ? -1 : 1) };
  const wheel = WHEEL.exec(name);
  // reaction_wheels: wheel 1/2/3 axles along X/Y/Z.
  if (wheel) { const n = Number(wheel[1]); return { kind: 'spin', axis: AXES[(n - 1) % 3], speed: 5 + n }; }
  const damper = DAMPER.exec(name);
  if (damper) return { kind: 'slide', axis: 'y', amp: -0.012, period: 1.1, phase: Number(damper[1]) * 0.9 };
  const led = LED.exec(name);
  if (led) { const n = Number(led[1]); return { kind: 'blink', period: 0.55 + (n % 3) * 0.21, phase: (n * 0.37) % 1, duty: 0.45 }; }
  switch (name) {
    case 'pivot_dish': return { kind: 'sway', axis: 'y', amp: 0.6, period: 16, phase: 0 };
    case 'pivot_dish_tilt': return { kind: 'sway', axis: 'x', amp: 0.18, period: 11, phase: 1.3 };
    case 'pivot_panel_l': return { kind: 'unfold', axis: 'z', to: Math.PI / 2, delay: 0.7, duration: 1.4 };
    case 'pivot_panel_r': return { kind: 'unfold', axis: 'z', to: -Math.PI / 2, delay: 0.7, duration: 1.4 };
    case 'pivot_drill': return { kind: 'spin', axis: 'y', speed: 7 };
    case 'pivot_drill_slide': return { kind: 'slide', axis: 'y', amp: -0.06, period: 5 };
    case 'pivot_radiator': return { kind: 'sway', axis: 'x', amp: 0.08, period: 9, phase: 0.5 };
    case 'pivot_vane': return { kind: 'sway', axis: 'y', amp: 0.7, period: 5, phase: 0 };
    case 'pivot_pan': return { kind: 'sway', axis: 'y', amp: 0.45, period: 13, phase: 0 };
    case 'pivot_tilt': return { kind: 'sway', axis: 'x', amp: 0.12, period: 8, phase: 2 };
    case 'pivot_wheel': return { kind: 'spin', axis: 'y', speed: 5 };
    // Hinge assumed on the back edge: negative X rotation lifts the front edge. Flip the sign if the GLB disagrees.
    case 'pivot_lid': return { kind: 'swing', axis: 'x', amp: -0.6, period: 7, phase: 0 };
    case 'pivot_clouds': return { kind: 'spin', axis: 'y', speed: 0.04 };
    case 'pivot_chute': return { kind: 'scale', value: CHUTE_STOWED };
    case 'fx_glow': return { kind: 'pulse', min: 0.55, max: 1.5, period: 2.6 };
    case 'fx_beam': return { kind: 'pulse', min: 0.7, max: 1.8, period: 1.4 };
    default: return null;
  }
}

export function mechanicsFor(names: Iterable<string>, modelId?: string): Mechanic[] {
  const out: Mechanic[] = [];
  for (const node of names) {
    const motion = motionFor(node, modelId);
    if (motion) out.push({ node, motion });
  }
  return out;
}

/**
 * Offset of a motion at time t (seconds since mount). With reduced motion, continuous motion stays at rest
 * and one-shot motion jumps to its end pose; glows/blinks hold steady. Returns an angle (rad), a distance (m),
 * an intensity multiplier or a scale.
 */
export function motionValue(m: Motion, t: number, reducedMotion: boolean): number {
  switch (m.kind) {
    case 'spin': return reducedMotion ? 0 : m.speed * t;
    case 'sway': return reducedMotion ? 0 : m.amp * Math.sin((t / m.period) * Math.PI * 2 + m.phase);
    case 'unfold': {
      if (reducedMotion) return m.to;
      const k = Math.min(1, Math.max(0, (t - m.delay) / m.duration));
      return m.to * (k * k * (3 - 2 * k));
    }
    case 'swing': return reducedMotion ? 0 : m.amp * (0.5 - 0.5 * Math.cos((t / m.period) * Math.PI * 2 + m.phase));
    case 'slide': return reducedMotion ? 0 : m.amp * (0.5 - 0.5 * Math.cos((t / m.period) * Math.PI * 2 + (m.phase ?? 0)));
    case 'pulse': return reducedMotion ? 1 : m.min + (m.max - m.min) * (0.5 + 0.5 * Math.sin((t / m.period) * Math.PI * 2));
    case 'blink': {
      if (reducedMotion) return 1;
      const c = t / m.period + m.phase;
      return c - Math.floor(c) < m.duty ? 1.8 : 0.25;
    }
    case 'scale': return m.value;
  }
}
