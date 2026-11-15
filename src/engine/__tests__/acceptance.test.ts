// Acceptance tests from ТЗ §15 that the engine alone can verify (A, B, C, E-part).
import { describe, expect, it } from 'vitest';
import { addComponent, canAdd, computeStats } from '../stats';
import { MISSIONS } from '../data/missions';
import { COMPONENTS } from '../data/components';
import type { Build } from '../types';

const titan = MISSIONS.titan;
const asteroid = MISSIONS.asteroid;
const with_ = (b: Build, id: string, n = 1) => { for (let i = 0; i < n; i++) b = addComponent(b, id); return b; };

describe('Test A — Titan energy', () => {
  it('solar panel gives very low generation and a warning', () => {
    const s = computeStats(with_({}, 'solar_array'), titan);
    expect(s.generation).toBeLessThan(1);
    expect(s.issues.some((i) => i.id === 'solar-weak')).toBe(true);
  });
  it('one RTG raises generation, a second raises it again with mass/cost/heat', () => {
    const s0 = computeStats(with_({}, 'solar_array'), titan);
    const s1 = computeStats(with_(with_({}, 'solar_array'), 'rtg'), titan);
    const s2 = computeStats(with_(with_({}, 'solar_array'), 'rtg', 2), titan);
    expect(s1.generation).toBeGreaterThan(s0.generation);
    expect(s2.generation).toBeGreaterThan(s1.generation);
    expect(s2.mass).toBeGreaterThan(s1.mass);
    expect(s2.cost).toBeGreaterThan(s1.cost);
    expect(s2.heatBalance).toBeGreaterThan(s1.heatBalance);
  });
  it('two batteries raise capacity but not generation', () => {
    const base = with_({}, 'rtg');
    const a = computeStats(base, titan);
    const b = computeStats(with_(base, 'battery_hc', 2), titan);
    expect(b.capacityWh).toBe(a.capacityWh + 600);
    expect(b.generation).toBe(a.generation);
    expect(b.generationBySource.some((l) => l.id === 'battery_hc')).toBe(false);
  });
  it('instruments raise consumption; deficit shows numbers and the exact sources', () => {
    let b = with_({}, 'rtg');
    b = with_(b, 'rotor_system');
    b = with_(b, 'spectrometer');
    b = with_(b, 'battery_hc', 2);
    const s = computeStats(b, titan);
    expect(s.consumption).toBe(20 + 70 + 40);
    expect(s.netPower).toBe(110 - 130);
    const d = s.issues.find((i) => i.id === 'deficit')!;
    expect(d.text).toContain('Rotor System 70 W');
    expect(d.text).toContain('Spectrometer 40 W');
    expect(d.text).toMatch(/30 ч/); // 600 Wh / 20 W
  });
});

describe('Test B — incompatibility', () => {
  it('rotor cannot be installed on the asteroid mission and explains why', () => {
    const r = canAdd({}, 'rotor_system', asteroid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/вакуум/);
  });
  it('rotor does not count as propulsion for the asteroid', () => {
    const s = computeStats({ rotor_system: 1 }, asteroid);
    expect(s.issues.some((i) => i.id.startsWith('req:chem_main_engine'))).toBe(true);
    expect(s.issues.some((i) => i.id === 'incompat:rotor_system')).toBe(true);
  });
});

describe('Test C — consequence chain (mass)', () => {
  it('heavy module changes mass and cost; over the limit gives a warning but is not blocked', () => {
    let b: Build = { rtg: 3, battery_hc: 4, rotor_system: 1 };
    const before = computeStats(b, titan);
    expect(canAdd(b, 'reinforced_frame', titan).ok).toBe(true);
    b = with_(b, 'reinforced_frame');
    const after = computeStats(b, titan);
    expect(after.mass).toBe(before.mass + 30);
    expect(after.cost).toBe(before.cost + 20);
    expect(after.mass).toBeGreaterThan(titan.massLimit);
    expect(after.issues.find((i) => i.id === 'mass')?.severity).toBe('critical');
  });
});

describe('Instances, slots, budget', () => {
  it('respects maxInstances with an exact reason', () => {
    const r = canAdd({ rtg: 3 }, 'rtg', titan);
    expect(r).toEqual({ ok: false, reason: 'Максимум 3 шт. этого модуля.' });
  });
  it('no recovery slots on Titan', () => {
    const r = canAdd({}, 'return_capsule', titan);
    expect(r.ok).toBe(false);
  });
  it('budget is a hard limit', () => {
    const t = canAdd({ rtg: 3, rotor_system: 1, spectrometer: 1, antenna_high_gain: 1, hires_camera: 2, drill: 1 }, 'deep_space_link', titan);
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.reason).toMatch(/Не хватает бюджета/);
  });
});

describe('Catalog sanity', () => {
  it('every component has the consequence fields and a fit for both missions', () => {
    for (const c of COMPONENTS) {
      expect(c.caption.length).toBeGreaterThan(5);
      expect(c.roles.length).toBeGreaterThan(0);
      expect(c.fit.titan && c.fit.asteroid).toBeTruthy();
      expect(c.maxInstances).toBeGreaterThan(0);
    }
    expect(COMPONENTS.length).toBeGreaterThanOrEqual(45);
  });
  it('a sensible Titan build fits budget and mass', () => {
    const b: Build = { rtg: 2, battery_hc: 2, power_bus: 2, pdu: 1, rotor_system: 1, flight_computer: 1, imu: 1,
      atmo_sensor: 1, wide_camera: 1, transceiver: 1, antenna_high_gain: 1, thermal_insulation: 1, data_storage: 1 };
    const s = computeStats(b, titan);
    expect(s.cost).toBeLessThanOrEqual(titan.budget);
    expect(s.mass).toBeLessThanOrEqual(titan.massLimit);
    expect(s.issues.filter((i) => i.severity === 'critical')).toEqual([]);
  });
});
