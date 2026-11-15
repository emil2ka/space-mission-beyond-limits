// M3 part A: economy. TZ acceptance test E entirely in the engine, every upgrade really changes computeStats,
// preparation is shown before it is charged, the balance never goes negative, the game never soft-locks.
import { describe, expect, it } from 'vitest';
import { createRoom, reduce, type Action, type RoomState } from '../room';
import { computeStats, canAdd } from '../stats';
import { readiness } from '../readiness';
import { MISSIONS } from '../data/missions';
import { STARTER_BUILD, UPGRADES } from '../data/economy';
import { REWARDS } from '../data/titan';
import {
  applyPrep, buyUpgrade, exportAgency, importAgency, newAgency, prepCosts, recordFlight, unlockMission, type Agency,
} from '../economy';
import { startFlight, stepFlight } from '../flight';
import { rng } from '../rng';
import type { Outcome } from '../report';
import type { Build, Mods, UpgradeId } from '../types';
import {
  AST_GOOD, H, TITAN_BAD, TITAN_GOOD, apply, as, astTeam, err, fly, install, launch, roomInBuild, run, titanTeam,
} from './m3helpers';

const titan = MISSIONS.titan;
const asteroid = MISSIONS.asteroid;
const mods = (...upgrades: UpgradeId[]): Mods => ({ upgrades });

describe('TZ test E — Titan → MC → asteroid cost → unlock → upkeep/repair shown → no negative balance, no soft-lock', () => {
  it('full cycle through the reducer', () => {
    // 1) Fly Titan and earn credits.
    let s = run('titan', TITAN_GOOD, { policy: titanTeam, agency: { unlocked: ['titan'] } });
    expect(s.stage).toBe('report');
    const r1 = s.report!;
    expect(r1.mc.earned).toBeGreaterThanOrEqual(REWARDS.success);
    expect(s.agency.credits).toBe(r1.mc.earned);
    expect(s.credits).toBe(s.agency.credits); // legacy mirror for the M1/M2 screens
    expect(s.agency.history).toEqual([{ mission: 'titan', outcome: r1.outcome, earned: r1.mc.earned }]);
    expect(s.agency.pendingPrep).toBe(true);

    // 2) The asteroid's price and what is missing are known.
    const cost = MISSIONS.asteroid.unlockCost;
    expect(cost).toBe(150);
    const before = s.agency.credits;
    if (before < cost) expect(err(as(s, 'commander'), { type: 'unlockMission', playerId: H, mission: 'asteroid' })).toMatch(new RegExp(`Не хватает ${cost - before} MC`));

    // 3) Preparation is shown BEFORE anything is charged (also in the report).
    const prep = prepCosts(s.agency, false);
    expect(prep.items.map((i) => i.id)).toEqual(expect.arrayContaining(['maintenance', 'diagnostics', 'consumables']));
    expect(prep.total).toBe(prep.items.reduce((x, i) => x + i.cost, 0));
    expect(r1.mc.upkeep).toBe(prep.charge);
    expect(s.agency.credits).toBe(before); // nothing charged yet
    const withIns = prepCosts(s.agency, true);
    expect(withIns.total).toBe(prep.total + REWARDS.insurance);
    expect(withIns.items.find((i) => i.id === 'insurance')!.optional).toBe(true);

    // 4) Confirm («Ещё раз»): exactly the shown amount, then a second Titan run if the asteroid is still too expensive.
    s = apply(as(s, 'commander'), { type: 'confirmPrep', playerId: H, insurance: false, next: 'build' });
    expect(s.stage).toBe('build');
    expect(s.agency.credits).toBe(before - prep.total);
    expect(s.agency.pendingPrep).toBe(false);
    if (s.agency.credits < cost) {
      s = fly(launch(s), titanTeam);
      s = apply(as(s, 'commander'), { type: 'goStage', playerId: H, stage: 'lobby' }); // «В штаб» goes through prep too
      expect(s.agency.pendingPrep).toBe(false);
    }
    expect(s.agency.credits).toBeGreaterThanOrEqual(cost);

    // 5) Unlock at a sufficient balance.
    const bal = s.agency.credits;
    s = apply(as(s, 'commander'), { type: 'unlockMission', playerId: H, mission: 'asteroid' });
    expect(s.agency.unlocked).toContain('asteroid');
    expect(s.agency.credits).toBe(bal - cost);
    expect(s.unlocked).toContain('asteroid');

    // 6) Fly the asteroid; the next preparation is shown before the next launch; the balance never goes below zero.
    if (s.stage === 'build') s = apply(s, { type: 'goStage', playerId: H, stage: 'lobby' });
    s = apply(s, { type: 'selectMission', playerId: H, mission: 'asteroid' });
    s = apply(s, { type: 'goStage', playerId: H, stage: 'build' });
    s = install(s, AST_GOOD);
    s = fly(launch(s), astTeam('crack'));
    expect(s.report!.asteroid).toBeDefined();
    expect(s.agency.credits).toBeGreaterThanOrEqual(0);
    const p2 = prepCosts(s.agency, false);
    expect(p2.balanceAfter).toBeGreaterThanOrEqual(0);
    s = apply(s, { type: 'confirmPrep', playerId: H, insurance: false });
    expect(s.agency.credits).toBeGreaterThanOrEqual(0);
    expect(readiness(s.build, MISSIONS[s.mission], s.agency).ok).toBe(true); // can launch again
  });

  it('short of MC: free basic repair + starter craft, balance untouched, launch possible (no soft-lock)', () => {
    // Spend everything right after a bad flight, then go to prep.
    let s = run('titan', TITAN_BAD, { agency: { credits: 0, unlocked: ['titan'] } });
    s = { ...s, agency: { ...s.agency, credits: 3 } }; // e.g. spent on an upgrade/unlock before
    const p = prepCosts(s.agency, false);
    expect(p.fallback).toBe('free_basic_repair');
    expect(p.charge).toBe(0);
    expect(p.missing).toBeGreaterThan(0);
    s = apply(as(s, 'commander'), { type: 'confirmPrep', playerId: H, insurance: true });
    expect(s.agency.credits).toBe(3);
    expect(s.agency.basicRepairs).toBe(1);
    expect(s.agency.insured).toBe(false);
    expect(s.build).toEqual(STARTER_BUILD.titan);
    expect(s.stage).toBe('build');
    s = launch(s);
    expect(s.stage).toBe('flight');
  });

  it('starter crafts pass the readiness check for both missions', () => {
    for (const m of ['titan', 'asteroid'] as const) {
      const r = readiness(STARTER_BUILD[m], MISSIONS[m]);
      expect(r.ok).toBe(true);
      expect(computeStats(STARTER_BUILD[m], MISSIONS[m]).cost).toBeLessThanOrEqual(MISSIONS[m].budget);
    }
  });

  it('insurance bought at prep covers the repairs after the next flight', () => {
    let a = recordFlight({ ...newAgency(), credits: 200 }, { mission: 'titan', outcome: 'success', earned: 90, broken: ['spectrometer'], hull: 60 });
    const plain = prepCosts(a, false);
    expect(plain.items.some((i) => i.id === 'repair:spectrometer' && i.cost > 0)).toBe(true);
    expect(plain.items.some((i) => i.id === 'repair:hull' && i.cost > 0)).toBe(true);
    a = applyPrep(a, true).agency;
    expect(a.insured).toBe(true);
    a = recordFlight(a, { mission: 'titan', outcome: 'partial', earned: 50, broken: ['rtg'], hull: 50 });
    const covered = prepCosts(a, false);
    expect(covered.items.filter((i) => i.id.startsWith('repair:')).every((i) => i.cost === 0)).toBe(true);
    expect(covered.total).toBe(REWARDS.upkeep.maintenance + REWARDS.upkeep.diagnostics + REWARDS.upkeep.consumables);
  });

  it('insurance that the balance cannot cover is refused (choose without it); a missing prep cannot be confirmed', () => {
    const a = recordFlight({ ...newAgency(), credits: 0 }, { mission: 'titan', outcome: 'failed', earned: 20, broken: [], hull: 100 });
    expect(prepCosts(a, false).affordable).toBe(true); // 20 = 10 + 5 + 5
    expect(applyPrep(a, true).error).toMatch(/страховк/);
    expect(applyPrep(applyPrep(a, false).agency, false).error).toMatch(/уже/);
  });
});

describe('upgrades really change computeStats (each with a trade-off)', () => {
  const b: Build = { ...TITAN_GOOD, antenna_standard: 1, flight_computer: 1, battery_hc: 1, pdu: 1 };
  const base = computeStats(b, titan);
  it.each(UPGRADES.map((u) => [u.id, u] as const))('%s', (id, def) => {
    expect(def.tradeoff.length).toBeGreaterThan(10);
    expect(def.cost).toBeGreaterThanOrEqual(50);
    expect(def.cost).toBeLessThanOrEqual(80);
    const s = computeStats(b, titan, mods(id));
    expect(s).not.toEqual(base);
    switch (id) {
      case 'light_alloys': expect(s.mass).toBe(base.mass - Math.round(titan.frameMass * 0.1)); break;
      case 'better_antennas': expect(s.bandwidth).toBeGreaterThan(base.bandwidth); expect(s.consumption).toBeGreaterThan(base.consumption); break;
      case 'better_batteries': expect(s.capacityWh).toBe(Math.round(base.capacityWh * 1.25)); expect(s.mass).toBeGreaterThan(base.mass); break;
      case 'pdu_v2': expect(s.smartShed).toBe(true); expect(base.smartShed).toBeFalsy(); expect(s.consumption).toBe(base.consumption + 3); break;
      case 'extra_slot': expect(s.slotsTotal.science).toBe(base.slotsTotal.science + 1); expect(s.mass).toBe(base.mass + 5); break;
      case 'fc_v2': expect(s.ruleSlots).toBe(6); expect(base.ruleSlots).toBe(3); expect(s.consumption).toBe(base.consumption + 5); break;
    }
  });

  it('extra slot lets a 5th science module onto the asteroid; fc_v2 lets the planner save 6 rules', () => {
    const full: Build = { robotic_arm: 1, sample_container: 1, sample_sealer: 1, spectrometer: 1 };
    expect(canAdd(full, 'hires_camera', asteroid).ok).toBe(false);
    expect(canAdd(full, 'hires_camera', asteroid, mods('extra_slot')).ok).toBe(true);
    let s = install(roomInBuild('titan', 7, { credits: 200 }), { flight_computer: 1, transceiver: 1 });
    const six = [1, 2, 3, 4, 5, 6].map((i) => ({ id: `r${i}`, when: [{ kind: 'hull_below' as const, value: 10 * i }], then: 'stop_risky_maneuvers' as const }));
    expect(err(as(s, 'engineer'), { type: 'setRules', playerId: H, rules: six })).toMatch(/3/);
    s = apply(as(s, 'commander'), { type: 'buyUpgrade', playerId: H, id: 'fc_v2' });
    expect(s.agency.credits).toBe(140);
    s = apply(as(s, 'engineer'), { type: 'setRules', playerId: H, rules: six });
    expect(s.rules.length).toBe(6);
  });

  it('the flight uses the upgrades: bigger batteries in flight, PDU v2 switches shed loads back on', () => {
    const f = startFlight('titan', TITAN_GOOD, { mods: mods('better_batteries') });
    expect(f.stored).toBe(Math.round(300 * 1.25));
    // PDU v2: a load shed on an empty battery returns once the battery is above half.
    const build: Build = { ...TITAN_GOOD };
    const shed = (m?: Mods) => {
      let g = startFlight('titan', build, { mods: m });
      g = { ...g, off: ['spectrometer'], autoShed: ['spectrometer'] };
      return stepFlight(g, build, 7);
    };
    expect(shed(mods('pdu_v2')).off).not.toContain('spectrometer');
    expect(shed(mods('pdu_v2')).causes.some((c) => c.ref === 'pdu-restore')).toBe(true);
    expect(shed().off).toContain('spectrometer');
  });

  it('buying: commander or host, enough MC, once; never negative; refused in flight', () => {
    let s = roomInBuild('titan', 7, { credits: 55 });
    expect(err(as(s, 'engineer'), { type: 'buyUpgrade', playerId: 'x', id: 'pdu_v2' })).toBeTruthy();
    expect(err(as(s, 'commander'), { type: 'buyUpgrade', playerId: H, id: 'light_alloys' })).toMatch(/Не хватает 25 MC/);
    s = apply(as(s, 'commander'), { type: 'buyUpgrade', playerId: H, id: 'pdu_v2' });
    expect(s.agency.credits).toBe(5);
    expect(err(s, { type: 'buyUpgrade', playerId: H, id: 'pdu_v2' })).toMatch(/Уже/);
    expect(buyUpgrade(s.agency, 'fc_v2').error).toMatch(/Не хватает/);
    const fl = launch(install(s, TITAN_GOOD));
    expect(err(as(fl, 'commander'), { type: 'buyUpgrade', playerId: H, id: 'fc_v2' })).toMatch(/между попытками/);
    expect(fl.flight!.mods).toEqual({ upgrades: ['pdu_v2'], extraSlot: 'science' });
  });
});

describe('storage: exportAgency / importAgency / loadAgency', () => {
  it('round trip; junk refused; unknown ids dropped; numbers clamped', () => {
    const a: Agency = { ...newAgency(), credits: 230, unlocked: ['titan', 'asteroid'], upgrades: ['fc_v2', 'extra_slot'], extraSlot: 'comms', history: [{ mission: 'titan', outcome: 'perfect', earned: 160 }] };
    expect(importAgency(exportAgency(a))).toEqual({ ...a, lastPrep: null });
    expect(importAgency('not json')).toBeNull();
    expect(importAgency({ hello: 1 })).toBeNull();
    const dirty = importAgency({ credits: -50, unlocked: ['mars'], upgrades: ['warp_drive', 'pdu_v2'], damaged: ['rtg', 'nope'], hullLoss: 400, history: [{ mission: 'titan', outcome: 'meh', earned: 5 }] })!;
    expect(dirty.credits).toBe(0);
    expect(dirty.unlocked).toEqual(['titan']);
    expect(dirty.upgrades).toEqual(['pdu_v2']);
    expect(dirty.damaged).toEqual(['rtg']);
    expect(dirty.hullLoss).toBe(100);
    expect(dirty.history).toEqual([]);
  });
  it('loadAgency: host only, lobby only', () => {
    let s = createRoom('ABCDEF', { id: H, name: 'Host' }, 1);
    s = apply(s, { type: 'join', playerId: 'b', name: 'B' });
    const data = exportAgency({ ...newAgency(), credits: 99 });
    expect(err(s, { type: 'loadAgency', playerId: 'b', agency: data })).toMatch(/хост/);
    s = apply(s, { type: 'loadAgency', playerId: H, agency: data });
    expect(s.agency.credits).toBe(99);
    expect(s.credits).toBe(99);
  });
  it('a pre-M3 saved room (no agency) keeps its credits and unlocks', () => {
    const old = createRoom('ABCDEF', { id: H, name: 'Host' }, 1) as Partial<RoomState>;
    delete old.agency;
    const s = apply({ ...(old as RoomState), credits: 170 }, { type: 'unlockMission', playerId: H, mission: 'asteroid' });
    expect(s.agency.credits).toBe(20);
    expect(s.unlocked).toEqual(['titan', 'asteroid']);
  });
});

describe('never negative, never stuck (property-style)', () => {
  it('pure agency: 2000 random actions keep credits ≥ 0 and the prep always confirmable', () => {
    const r = rng(2026);
    const pickOne = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const outcomes: Outcome[] = ['perfect', 'success', 'partial', 'failed'];
    let a = newAgency();
    for (let i = 0; i < 2000; i++) {
      const op = Math.floor(r() * 5);
      if (op === 0 && !a.pendingPrep) {
        const o = pickOne(outcomes);
        a = recordFlight(a, { mission: pickOne(a.unlocked), outcome: o, earned: REWARDS[o] + 10 * Math.floor(r() * 4), broken: r() < 0.5 ? [pickOne(['rtg', 'heat_shield', 'robotic_arm', 'spectrometer'])] : [], hull: Math.round(r() * 100) });
      } else if (op === 1 && a.pendingPrep) {
        const p = prepCosts(a, r() < 0.5);
        const res = applyPrep(a, p.items.some((x) => x.id === 'insurance'));
        if (res.error) {
          expect(p.affordable).toBe(false);
          a = applyPrep(a, false).agency; // without insurance it always works
        } else a = res.agency;
        expect(a.pendingPrep).toBe(false);
      } else if (op === 2) a = buyUpgrade(a, pickOne(UPGRADES).id).agency;
      else if (op === 3) a = unlockMission(a, 'asteroid').agency;
      expect(a.credits).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(a.credits)).toBe(true);
    }
  });

  it('room: random attempts (good/bad crafts, purchases, insurance) — balance ≥ 0 and the next launch always possible', () => {
    const r = rng(7);
    let s: RoomState = roomInBuild('titan', 11, { unlocked: ['titan'] });
    const tryA = (st: RoomState, a: Action) => { const x = reduce(st, a); return x.error ? st : x.state; };
    for (let attempt = 0; attempt < 5; attempt++) {
      if (s.stage === 'build') {
        if (r() < 0.5) s = install({ ...s, build: {} }, r() < 0.5 ? TITAN_GOOD : TITAN_BAD);
        s = fly(launch(s), r() < 0.5 ? titanTeam : undefined);
      }
      expect(s.stage).toBe('report');
      // Spend before the prep (allowed): may leave too little for it.
      for (const u of UPGRADES) if (r() < 0.4) s = tryA(as(s, 'commander'), { type: 'buyUpgrade', playerId: H, id: u.id });
      if (r() < 0.3) s = tryA(s, { type: 'unlockMission', playerId: H, mission: 'asteroid' });
      const p = prepCosts(s.agency, r() < 0.5);
      const next = r() < 0.5 ? 'build' as const : 'lobby' as const;
      s = tryA(s, { type: 'confirmPrep', playerId: H, insurance: p.items.some((i) => i.id === 'insurance'), next });
      if (s.stage === 'report') s = apply(s, { type: 'confirmPrep', playerId: H, insurance: false, next });
      expect(s.agency.credits).toBeGreaterThanOrEqual(0);
      expect(s.credits).toBe(s.agency.credits);
      if (s.stage === 'lobby') s = apply(s, { type: 'goStage', playerId: H, stage: 'build' });
      if (!Object.keys(s.build).length || !readiness(s.build, titan, s.agency).ok) s = install({ ...s, build: {} }, STARTER_BUILD.titan);
      expect(readiness(s.build, titan, s.agency).ok).toBe(true);
    }
    expect(s.agency.history.length).toBe(5);
  });
});
