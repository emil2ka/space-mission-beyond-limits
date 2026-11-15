import { describe, expect, it } from 'vitest';
import { stepEnergy } from '../energy';

describe('energy tick', () => {
  const loads = [
    { id: 'comms', watts: 20, priority: 1 },
    { id: 'spectro', watts: 40, priority: 4 },
    { id: 'heater', watts: 30, priority: 2 },
  ];
  it('charges up to capacity and reports waste', () => {
    const r = stepEnergy({ stored: 590, capacityWh: 600, generation: 200, loads, off: [], hasPdu: true }, 1);
    expect(r.stored).toBe(600);
    expect(r.wasted).toBeGreaterThan(0);
  });
  it('discharges on deficit, clamps at 0', () => {
    const r = stepEnergy({ stored: 100, capacityWh: 600, generation: 50, loads, off: [], hasPdu: true }, 1);
    expect(r.net).toBe(-40);
    expect(r.stored).toBe(60);
  });
  it('sheds by priority with PDU (5 first), never priority 1', () => {
    const r = stepEnergy({ stored: 0, capacityWh: 600, generation: 30, loads, off: [], hasPdu: true }, 1);
    expect(r.shed).toEqual(['spectro', 'heater']);
    expect(r.off).not.toContain('comms');
    expect(r.net).toBe(10); // after shedding, generation covers the critical load
    expect(r.stored).toBe(10);
  });
  it('without PDU sheds the biggest load first', () => {
    const r = stepEnergy({ stored: 0, capacityWh: 600, generation: 55, loads, off: [], hasPdu: false }, 1);
    expect(r.shed[0]).toBe('spectro');
  });
});
