import { describe, expect, it } from 'vitest';
import {
  BLINK_MS, BLINKS, approachDistance, armTarget, blinkLit, chuteAltitude, chuteOpen, entryAltitude, entryHeat, lidOpen,
  returnWorld, separation, standoff, syncK,
} from '../timeline';
import { CAPSULE_STAGES, SAMPLING_STATES } from '../types';

describe('asteroid approach', () => {
  it('closes in monotonically from far out to the surface', () => {
    let prev = Infinity;
    for (let a = 0; a <= 1.0001; a += 0.05) { const d = approachDistance(a); expect(d).toBeLessThanOrEqual(prev); prev = d; }
    expect(approachDistance(0)).toBeGreaterThan(200);
    expect(approachDistance(1)).toBe(0);
    expect(approachDistance(Number.NaN)).toBeGreaterThan(200);
  });
  it('matches the tumble only when close, and always at the site / sampling / stow phases', () => {
    expect(syncK(0, 'cruise')).toBe(0);
    expect(syncK(0.3, 'approach')).toBe(0);
    expect(syncK(1, 'approach')).toBe(1);
    for (const ph of ['site', 'sampling', 'stow']) expect(syncK(0.2, ph)).toBe(1);
  });
});

describe('sampling', () => {
  it('the tool touches the surface only on grab', () => {
    const reach = 0.95;
    expect(standoff('grab', reach, true)).toBeLessThan(reach);
    for (const s of SAMPLING_STATES.filter((x) => x !== 'grab')) expect(standoff(s, reach, true)).toBeGreaterThan(reach);
    expect(standoff('grab', reach, false)).toBeGreaterThan(5); // no site yet → hold high
  });
  it('arm extends on reach/grab, half on jam, folds when stowed', () => {
    expect(armTarget('reach').reach).toBe(1);
    expect(armTarget('grab')).toEqual({ reach: 1, claw: 1 });
    expect(armTarget('jam').reach).toBeGreaterThan(0.3);
    expect(armTarget('jam').reach).toBeLessThan(1);
    expect(armTarget('stowed').reach).toBe(0);
    expect(armTarget('idle').reach).toBe(0);
  });
  it('lid opens for the sample and closes once sealed', () => {
    expect(lidOpen('idle', false)).toBe(0);
    expect(lidOpen('stowed', false)).toBe(1);
    expect(lidOpen('stowed', true)).toBe(0);
    expect(lidOpen('grab', true)).toBe(0);
  });
  it('three slow blinks (no strobe), then steady', () => {
    expect(BLINK_MS).toBeGreaterThanOrEqual(333); // ≤ 3 flashes per second
    let flips = 0;
    let prev = blinkLit(0);
    for (let ms = 0; ms < BLINKS * 2 * BLINK_MS + 2000; ms += 20) { const l = blinkLit(ms); if (l !== prev) flips++; prev = l; }
    expect(flips).toBe(BLINKS * 2); // on-off ×3, then on for good
    expect(blinkLit(10_000)).toBe(true);
  });
});

describe('capsule return', () => {
  it('splits stages between the space and sky sets', () => {
    expect(CAPSULE_STAGES.filter((s) => returnWorld(s) === 'space')).toEqual(['stowed', 'separated', 'entry']);
  });
  it('separates outward and flips the shield to Earth', () => {
    expect(separation(0).distance).toBeLessThan(separation(1).distance);
    expect(separation(0).flip).toBe(0);
    expect(separation(1).flip).toBeCloseTo(Math.PI);
  });
  it('heats up then cools during entry while descending', () => {
    expect(entryHeat(0)).toBe(0);
    expect(entryHeat(0.5)).toBe(1);
    expect(entryHeat(1)).toBe(0);
    expect(entryAltitude(1)).toBeLessThan(entryAltitude(0));
  });
  it('opens the chute 0 → 1 and comes down to the ground', () => {
    expect(chuteOpen(0)).toBe(0);
    expect(chuteOpen(0.1)).toBeGreaterThan(0.1);
    expect(chuteOpen(0.1)).toBeLessThan(0.5);
    expect(chuteOpen(1)).toBeCloseTo(1);
    let prev = Infinity;
    for (let k = 0; k <= 1.0001; k += 0.05) { const h = chuteAltitude(k); expect(h).toBeLessThanOrEqual(prev); prev = h; }
    expect(chuteAltitude(1)).toBeLessThan(1);
  });
});
