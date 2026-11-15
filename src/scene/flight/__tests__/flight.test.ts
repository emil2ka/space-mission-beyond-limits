import { describe, expect, it } from 'vitest';
import { altitude, launchFrame, T } from '../launchTimeline';
import { noiseLevel, pointAltitude, routeParam, segmentAltitude } from '../route';

describe('launch timeline', () => {
  it('counts down 3-2-1 before ignition, then lifts off and ends', () => {
    expect(launchFrame(0).countdown).toBeNull();
    expect(launchFrame(T.countdown + 0.1).countdown).toBe(3);
    expect(launchFrame(T.ignition - 0.1).countdown).toBe(1);
    expect(launchFrame(T.liftoff).countdown).toBe(0);
    expect(altitude(T.liftoff)).toBe(0);
    expect(altitude(T.separation)).toBeGreaterThan(20);
    expect(launchFrame(T.end).done).toBe(true);
    expect(launchFrame(T.end - 0.1).done).toBe(false);
  });
  it('altitude never decreases; flames hand over at separation', () => {
    let prev = 0;
    for (let t = 0; t < T.end; t += 0.1) { const a = altitude(t); expect(a).toBeGreaterThanOrEqual(prev); prev = a; }
    expect(launchFrame(T.separation + 0.5).flame1).toBe(0);
    expect(launchFrame(T.stage2 + 0.5).flame2).toBe(1);
    expect(launchFrame(T.fairing + 2).fairing).toBe(1);
  });
});

describe('titan route', () => {
  it('maps waypoint index/progress onto segments and clamps junk', () => {
    expect(routeParam(0, 0)).toBe(0);
    expect(routeParam(1, 0.5)).toBe(1.5);
    expect(routeParam(2, 1)).toBe(3);
    expect(routeParam(7, 2)).toBe(3);
    expect(routeParam(3, 0)).toBe(3); // engine: index = waypoints.length after the crater
    expect(routeParam(Number.NaN, Number.NaN)).toBe(0);
  });
  it('altitude hits both ends and clears the ground in between', () => {
    const a0 = pointAltitude(1, 2), a1 = pointAltitude(2, 0);
    expect(segmentAltitude(0, a0, a1, 6)).toBeCloseTo(a0);
    expect(segmentAltitude(1, a0, a1, 6)).toBeCloseTo(a1);
    expect(segmentAltitude(0.5, a0, a1, 6)).toBeGreaterThan(6);
  });
  it('noise grows as the signal degrades and is softer with reduced motion', () => {
    expect(noiseLevel('ok', false, false)).toBe(0);
    expect(noiseLevel('lost', true, false)).toBeGreaterThan(noiseLevel('delay', true, false));
    expect(noiseLevel('lost', true, true)).toBeLessThan(noiseLevel('lost', true, false));
  });
});
