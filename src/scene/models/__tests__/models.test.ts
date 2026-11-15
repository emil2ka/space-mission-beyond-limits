import { describe, expect, it } from 'vitest';
import { COMPONENT_BY_ID } from '../../../engine';
import { CAPSULE_MOUNT_DEFAULT, FRAME, FRAME_BY_MISSION, HEX, SLOT_TABLE_ASTEROID, SLOT_TABLE_TITAN, slotTransform } from '../../layout';
import { parseManifest, modelUrl } from '../manifest';
import { CHUTE_STOWED, mechanicsFor, motionFor, motionValue } from '../mechanicsRules';
import { assignSlots, baseOverlayId, isOverlay, listUnits, overlayModelId, parseSlotName } from '../slots';

describe('slot names', () => {
  it('parses slot_<dept>_<n>', () => {
    expect(parseSlotName('slot_power_3')).toEqual({ dept: 'power', index: 3 });
    expect(parseSlotName('slot_comms_12')).toEqual({ dept: 'comms', index: 12 });
    expect(parseSlotName('slot_power_0')).toBeNull();
    expect(parseSlotName('slot_power')).toBeNull();
    expect(parseSlotName('pivot_dish')).toBeNull();
    expect(parseSlotName('slot_power_1_mesh')).toBeNull();
  });

  it('fills slots in numeric order, skips missing numbers, overflows to null', () => {
    const units = [
      { key: 'a#0', dept: 'power' as const },
      { key: 'b#0', dept: 'power' as const },
      { key: 'c#0', dept: 'power' as const },
      { key: 'd#0', dept: 'recovery' as const },
    ];
    const m = assignSlots(units, ['slot_power_10', 'slot_power_2', 'slot_power_1', 'cam_front']);
    expect(m.get('a#0')).toBe('slot_power_1');
    expect(m.get('b#0')).toBe('slot_power_2');
    expect(m.get('c#0')).toBe('slot_power_10');
    expect(m.get('d#0')).toBeNull();
  });

  it('splits overlays off the slot units and expands instances', () => {
    const { units, overlays } = listUnits({ rotor_system: 1, power_bus: 2, rtg: 2, transceiver: 1, nope: 3 }, COMPONENT_BY_ID);
    expect(overlays.sort()).toEqual(['power_bus', 'rotor_system']);
    expect(units.map((u) => u.key)).toEqual(['rtg#0', 'rtg#1', 'transceiver#0']);
    expect(units.map((u) => u.indexInDept)).toEqual([0, 1, 0]);
    expect(isOverlay('landing_system')).toBe(true);
    expect(isOverlay('rtg')).toBe(false);
  });
});

describe('procedural layout (frame coordinates)', () => {
  const yAxis = (q: number[]) => {
    const [x, y, z, w] = q;
    return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
  };
  it('comms on the deck point up, propulsion under the bottom points down', () => {
    expect(slotTransform('comms', 0).position[1]).toBe(0.51);
    expect(yAxis(slotTransform('comms', 1).quaternion)[1]).toBeCloseTo(1, 5);
    expect(yAxis(slotTransform('propulsion', 2).quaternion)[1]).toBeCloseTo(-1, 5);
  });
});

describe('manifest', () => {
  it('parses the optimizer format and tolerates junk', () => {
    const m = parseManifest({ version: 1, models: [{ id: 'rtg', file: 'rtg.glb', bytes: 10, tris: 5, kind: 'module' }, { id: '../evil' }, 7, null] });
    expect([...m.ids]).toEqual(['rtg']);
    expect(modelUrl('rtg', m, '/')).toBe('/models/rtg.glb');
    expect(modelUrl('frame_titan', m, '/')).toBeNull();
    expect(parseManifest(['frame_titan']).ids.has('frame_titan')).toBe(true);
    expect(parseManifest('<!doctype html>').ids.size).toBe(0);
    expect(parseManifest(null).ids.size).toBe(0);
    expect(modelUrl('rtg', m, '/game')).toBe('/game/models/rtg.glb');
  });
  it('never trusts a file name outside <id>.glb', () => {
    const m = parseManifest({ models: [{ id: 'rtg', file: '../../secret.glb' }] });
    expect(m.entries.rtg.file).toBe('rtg.glb');
  });
});

describe('mechanics rules', () => {
  it('maps pivot names to motions', () => {
    const names = mechanicsFor(['pivot_rotor_1', 'pivot_rotor_2', 'pivot_dish', 'pivot_leg_1', 'fx_glow', 'body', 'pivot_panel_l']).map((m) => m.node);
    expect(names).toEqual(['pivot_rotor_1', 'pivot_rotor_2', 'pivot_dish', 'fx_glow', 'pivot_panel_l']);
    const [r1, r2] = mechanicsFor(['pivot_rotor_1', 'pivot_rotor_2']);
    expect(r1.motion.kind === 'spin' && r2.motion.kind === 'spin' && Math.sign(r1.motion.speed) !== Math.sign(r2.motion.speed)).toBe(true);
  });
  it('respects reduced motion: rest for loops, end pose for one-shots, steady glow', () => {
    const [rotor, panel, glow] = mechanicsFor(['pivot_rotor_1', 'pivot_panel_r', 'fx_glow']).map((m) => m.motion);
    expect(motionValue(rotor, 3, true)).toBe(0);
    expect(motionValue(rotor, 1, false)).not.toBe(0);
    expect(motionValue(panel, 0, true)).toBeCloseTo(-Math.PI / 2);
    expect(motionValue(panel, 0, false)).toBeCloseTo(0);
    expect(motionValue(panel, 10, false)).toBeCloseTo(-Math.PI / 2);
    expect(motionValue(glow, 1.3, true)).toBe(1);
  });
});

describe('P1: asteroid frame, overlay variants, capsule set', () => {
  const yAxis = (q: number[]) => {
    const [x, y, z, w] = q;
    return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
  };

  it('mission picks the frame', () => {
    expect(FRAME_BY_MISSION).toEqual({ titan: 'frame_titan', asteroid: 'frame_asteroid' });
  });

  it('asteroid fallback: side slots on the hexagon bay floors, +Y = face normal (not radial)', () => {
    for (const dept of ['power', 'science', 'navigation', 'structure'] as const) {
      SLOT_TABLE_ASTEROID[dept]!.forEach(({ n }, i) => {
        const t = slotTransform(dept, i, 'frame_asteroid');
        expect(t.position[0] * n[0] + t.position[2] * n[2]).toBeCloseTo(HEX.apothem - 0.04, 3); // bay floor 4 cm in
        const y = yAxis(t.quaternion);
        expect(y[0] * n[0] + y[2] * n[2]).toBeCloseTo(1, 3);
      });
    }
    // Front face carries science 1/2 at x = ∓0.16; back face structure 1/2.
    expect(slotTransform('science', 0, 'frame_asteroid').position.map((v) => +v.toFixed(3))).toEqual([-0.16, 0.65, 0.61]);
    expect(slotTransform('structure', 0, 'frame_asteroid').position.map((v) => +v.toFixed(3))).toEqual([-0.16, 0.65, -0.61]);
    // Capsule slot = gold ring collar in the deck centre, pointing up; propulsion underneath (engine mount + 0.42 circle).
    const rec = slotTransform('recovery', 0, 'frame_asteroid');
    expect(rec.position.map((v) => +v.toFixed(3))).toEqual([0, 0.95, 0]);
    expect(yAxis(rec.quaternion)[1]).toBeCloseTo(1, 5);
    const p = slotTransform('propulsion', 3, 'frame_asteroid');
    expect(Math.hypot(p.position[0], p.position[2])).toBeCloseTo(0.42, 5);
    expect(yAxis(p.quaternion)[1]).toBeCloseTo(-1, 5);
  });

  it('slot counts per department stay as in v1 (Titan 26, Asteroid 30)', () => {
    const count = (t: typeof SLOT_TABLE_TITAN) => Object.fromEntries(Object.entries(t).map(([d, l]) => [d, l!.length]));
    expect(count(SLOT_TABLE_TITAN)).toEqual({ power: 6, structure: 4, science: 5, navigation: 4, comms: 4, propulsion: 3 });
    expect(count(SLOT_TABLE_ASTEROID)).toEqual({ power: 6, science: 4, structure: 4, navigation: 4, comms: 4, recovery: 4, propulsion: 4 });
  });

  it('titan v2: side slots on the bay floors of the 1.1 × 1.6 chassis, RTG cradle at the rear, deck sockets 4 cm down', () => {
    for (const [dept, list] of Object.entries(SLOT_TABLE_TITAN)) list!.forEach(({ p, n }, i) => {
      const t = slotTransform(dept as 'power', i, 'frame_titan');
      expect(t.position).toEqual(p);
      const y = yAxis(t.quaternion);
      for (let k = 0; k < 3; k++) expect(y[k]).toBeCloseTo(n[k], 5);
      if (n[0]) expect(Math.abs(p[0])).toBeCloseTo(FRAME.halfWidth - 0.04, 5);
      if (n[2]) expect(Math.abs(p[2])).toBeCloseTo(FRAME.halfLength - 0.04, 5);
      if (n[1] > 0 && dept !== 'power') expect(p[1]).toBeCloseTo(FRAME.deckY - 0.04, 5);
    });
    expect(slotTransform('power', 0, 'frame_titan').position).toEqual([0, 0.53, -0.56]);
  });

  it('v2.1 seats: Titan side bays 0.27, crosswise RTG saddle, adapters lift wide modules above the rim; asteroid capsule ring has none', () => {
    expect(SLOT_TABLE_TITAN.power![1].bay).toEqual([0.27, 0.27]);
    expect(SLOT_TABLE_TITAN.power![0]).toMatchObject({ bay: [0.84, 0.51], cradle: true });
    for (const t of [SLOT_TABLE_TITAN, SLOT_TABLE_ASTEROID]) for (const l of Object.values(t)) for (const d of l!) {
      if (d.bay[0] < 0.8) expect(d.lift).toBeGreaterThanOrEqual(0.06); // above the rim top (0.04 recess + 0.02 rim)
    }
    expect(SLOT_TABLE_ASTEROID.recovery![0].lift).toBe(0);
  });

  it('deck slots keep their gap (asteroid ≥ 0.27, titan ≥ 0.28)', () => {
    const gaps: [typeof SLOT_TABLE_TITAN, number][] = [[SLOT_TABLE_ASTEROID, 0.27], [SLOT_TABLE_TITAN, 0.28]];
    for (const [table, gap] of gaps) {
      const deck = Object.values(table).flatMap((l) => l!.filter((d) => d.n[1] > 0.5).map((d) => d.p));
      for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) {
        expect(Math.hypot(deck[i][0] - deck[j][0], deck[i][2] - deck[j][2])).toBeGreaterThanOrEqual(gap - 0.01);
      }
    }
  });

  it('overlay variant: <id>__asteroid only on the asteroid mission and only if the manifest has it', () => {
    const ids = new Set(['thermal_insulation', 'thermal_insulation__asteroid', 'power_bus']);
    expect(overlayModelId('thermal_insulation', 'asteroid', ids)).toBe('thermal_insulation__asteroid');
    expect(overlayModelId('thermal_insulation', 'titan', ids)).toBe('thermal_insulation');
    expect(overlayModelId('power_bus', 'asteroid', ids)).toBe('power_bus');
    expect(baseOverlayId('reinforced_frame__asteroid')).toBe('reinforced_frame');
    expect(isOverlay('reinforced_frame')).toBe(true);
    expect(listUnits({ reinforced_frame: 1 }, COMPONENT_BY_ID).overlays).toEqual(['reinforced_frame']);
  });

  it('RTG claims slot_power_1 (Titan rear cradle) whatever the build order', () => {
    const { units } = listUnits({ battery_hc: 1, pdu: 1, rtg: 1 }, COMPONENT_BY_ID);
    expect(units.find((u) => u.id === 'rtg')!.indexInDept).toBe(0);
    const m = assignSlots(units, ['slot_power_1', 'slot_power_2', 'slot_power_3']);
    expect(m.get('rtg#0')).toBe('slot_power_1');
  });

  it('capsule first on slot_recovery_1; shield / parachute / beacon go onto its mounts', () => {
    const { units } = listUnits({ heat_shield: 1, parachute: 1, return_capsule: 1, recovery_beacon: 1, rtg: 1 }, COMPONENT_BY_ID);
    const capsule = units.find((u) => u.id === 'return_capsule')!;
    expect(capsule.indexInDept).toBe(0);
    expect(units.filter((u) => u.attach).map((u) => [u.id, u.attach!.mount, u.attach!.parent])).toEqual([
      ['heat_shield', 'mount_heat_shield', 'return_capsule#0'],
      ['parachute', 'mount_parachute', 'return_capsule#0'],
      ['recovery_beacon', 'mount_beacon', 'return_capsule#0'],
    ]);
    const slots = assignSlots(units, ['slot_recovery_2', 'slot_recovery_1', 'slot_power_1']);
    expect(slots.get('return_capsule#0')).toBe('slot_recovery_1');
    expect(slots.has('heat_shield#0')).toBe(false);
    for (const m of ['mount_heat_shield', 'mount_parachute', 'mount_beacon']) expect(CAPSULE_MOUNT_DEFAULT[m]).toBeTruthy();
  });

  it('without a capsule the parts take their own recovery slots', () => {
    const { units } = listUnits({ heat_shield: 1, parachute: 1 }, COMPONENT_BY_ID);
    expect(units.every((u) => !u.attach)).toBe(true);
    const slots = assignSlots(units, ['slot_recovery_1', 'slot_recovery_2', 'slot_recovery_3']);
    expect([slots.get('heat_shield#0'), slots.get('parachute#0')]).toEqual(['slot_recovery_1', 'slot_recovery_2']);
  });
});

describe('P1 mechanics rules', () => {
  it('reaction wheels spin around X / Y / Z; dampers bob along Y; earth clouds turn', () => {
    expect(['pivot_wheel_1', 'pivot_wheel_2', 'pivot_wheel_3'].map((n) => { const m = motionFor(n); return m?.kind === 'spin' ? m.axis : null; })).toEqual(['x', 'y', 'z']);
    expect(motionFor('pivot_damper_2')).toMatchObject({ kind: 'slide', axis: 'y' });
    expect(motionFor('pivot_clouds')).toMatchObject({ kind: 'spin', axis: 'y' });
    expect(motionFor('fx_beam')).toMatchObject({ kind: 'pulse' });
    expect(motionFor('pivot_lid')).toMatchObject({ kind: 'swing', axis: 'x' });
  });

  it('parachute canopy stays stowed (scale ≈ 0), also with reduced motion', () => {
    const m = motionFor('pivot_chute')!;
    expect(motionValue(m, 0, false)).toBe(CHUTE_STOWED);
    expect(motionValue(m, 5, true)).toBe(CHUTE_STOWED);
  });

  it('robotic arm sways idly; the launch pad arms with the same names do not; heat shield does not glow on the stand', () => {
    expect(mechanicsFor(['pivot_arm_1', 'pivot_arm_2', 'pivot_arm_3', 'pivot_claw', 'pivot_claw_l', 'pivot_claw_r'], 'robotic_arm')).toHaveLength(6);
    expect(mechanicsFor(['pivot_arm_1', 'pivot_arm_2'], 'launch_pad')).toHaveLength(0);
    expect(mechanicsFor(['fx_glow'], 'heat_shield')).toHaveLength(0);
    expect(motionFor('fx_glow', 'recovery_beacon')).toMatchObject({ kind: 'blink' });
  });

  it('data_buffer LEDs blink out of step; reduced motion keeps them steady', () => {
    const leds = [1, 2, 3, 4, 5, 6].map((i) => motionFor(`led_${i}`)!);
    expect(leds.every((m) => m.kind === 'blink')).toBe(true);
    const at = (t: number) => leds.map((m) => motionValue(m, t, false));
    const frames = [0.1, 0.3, 0.5, 0.7, 0.9].map(at);
    expect(frames.some((f) => new Set(f).size > 1)).toBe(true); // not all in sync
    expect(new Set(frames.map((f) => f[0])).size).toBe(2); // led_1 goes on and off
    expect(leds.map((m) => motionValue(m, 0.42, true))).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('every new loop motion rests under reduced motion', () => {
    for (const n of ['pivot_wheel_1', 'pivot_damper_1', 'pivot_clouds', 'pivot_lid']) expect(motionValue(motionFor(n)!, 2.7, true)).toBe(0);
    expect(motionValue(motionFor('pivot_arm_2', 'robotic_arm')!, 2.7, true)).toBe(0);
    expect(motionValue(motionFor('fx_beam')!, 2.7, true)).toBe(1);
  });
});
