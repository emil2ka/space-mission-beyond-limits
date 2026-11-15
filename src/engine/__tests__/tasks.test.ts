// Individual Tasks (screen 10, decision 0013 §1): scoring, determinism, flight modifiers, room flow, and that a weak
// task measurably changes the flight compared with an excellent one.
import { describe, expect, it } from 'vitest';
import {
  commanderSetup, commsSetup, engineerSetup, flightTasks, keepValue, lineLoads, scienceSetup, scoreTask, targetValue, taskCtx,
  type CommanderAnswer, type CommsAnswer, type EngineerAnswer, type Line, type ScienceAnswer, type TaskCtx, type TasksState,
} from '../tasks';
import { reduce, type Action, type RoomState } from '../room';
import { startFlight, stepFlight, type FlightState } from '../flight';
import type { Build, MissionId, RoleId } from '../types';
import { apply, as, AST_GOOD, fly, H, install, pick, roomInBuild, TITAN_GOOD, titanTeam } from './m3helpers';

const ctxOf = (mission: MissionId, build: Build, seed = 7): TaskCtx => ({ mission, build, seed, attempt: 0 });

/** The answers a careful player would give (what the scoring calls «excellent»). */
function best(ctx: TaskCtx) {
  const c = commanderSetup(ctx);
  const goals = [...c.goals].sort((a, b) => (b.possible ? b.value : 0) - (a.possible ? a.value : 0)).map((g) => g.id);
  const sacrifice = [...c.items].sort((a, b) => keepValue(ctx, a.id, goals) - keepValue(ctx, b.id, goals)).map((i) => i.id);
  const e = engineerSetup(ctx);
  const free = e.consumers.filter((x) => !x.mustMain);
  let bestLines: Record<string, Line> = {};
  let bestOver = Infinity;
  for (let mask = 0; mask < 1 << free.length; mask++) {
    const lines: Record<string, Line> = Object.fromEntries(e.consumers.map((x) => [x.id, 'main' as Line]));
    free.forEach((x, i) => { if (mask & (1 << i)) lines[x.id] = 'secondary'; });
    const over = lineLoads(e, lines).over;
    const secCount = free.filter((x) => lines[x.id] === 'secondary').length;
    if (over < bestOver || (over === bestOver && secCount > Object.values(bestLines).filter((l) => l === 'secondary').length)) { bestOver = over; bestLines = lines; }
  }
  const s = scienceSetup(ctx);
  const m = commsSetup(ctx);
  const queue = [...m.targets].sort((a, b) => targetValue(ctx.mission, b.id, b.possible) - targetValue(ctx.mission, a.id, a.possible)).map((t) => t.id);
  return {
    commander: { goals, sacrifice } as CommanderAnswer,
    engineer: { lines: bestLines } as EngineerAnswer,
    science: { knobs: Object.fromEntries(s.instruments.map((i) => [i.id, i.peak])), mode: s.best } as ScienceAnswer,
    comms: { aim: m.earth, queue } as CommsAnswer,
  };
}

/** The opposite: reversed priorities, everything vital on the secondary line, knobs at the factory setting, antenna off Earth. */
function worst(ctx: TaskCtx) {
  const b = best(ctx);
  const e = engineerSetup(ctx);
  const s = scienceSetup(ctx);
  const m = commsSetup(ctx);
  return {
    commander: { goals: [...b.commander.goals].reverse(), sacrifice: [...b.commander.sacrifice].reverse() },
    engineer: { lines: Object.fromEntries(e.consumers.map((x) => [x.id, (x.mustMain ? 'secondary' : 'main') as Line])) },
    science: { knobs: Object.fromEntries(s.instruments.map((i) => [i.id, i.start])), mode: s.modes.find((x) => x.mode !== s.best && x.thermal !== s.modes.find((y) => y.mode === s.best)!.thermal)?.mode ?? 'cautious' } as ScienceAnswer,
    comms: { aim: { x: -m.earth.x, y: -m.earth.y }, queue: [...b.comms.queue].reverse() },
  };
}

const ROLES: RoleId[] = ['commander', 'engineer', 'science', 'comms'];

describe('task scoring', () => {
  for (const [mission, build] of [['titan', TITAN_GOOD], ['asteroid', AST_GOOD]] as const) {
    it(`${mission}: careful answers are excellent, careless ones weak`, () => {
      const ctx = ctxOf(mission, build);
      const b = best(ctx), w = worst(ctx);
      for (const role of ROLES) {
        expect(scoreTask(role, b[role], ctx).grade, `${role} best`).toBe('excellent');
        expect(scoreTask(role, w[role], ctx).grade, `${role} worst`).toBe('weak');
      }
    });
  }

  it('commander: goals the build cannot reach belong at the bottom; the rotor is not the first sacrifice on Titan', () => {
    const ctx = ctxOf('titan', TITAN_GOOD); // no hires camera needed: wide camera serves the images goal
    const s = commanderSetup(ctx);
    expect(s.goals.every((g) => g.possible)).toBe(true);
    const naive = scoreTask('commander', s.initial, ctx);
    expect(s.initial.sacrifice[0]).toBe('rotor_system'); // «biggest first» — the lesson the task teaches
    expect(naive.notes.some((n) => n.id === 'sacrifice-critical' && n.n?.node === 'rotor_system')).toBe(true);
    const noChem = ctxOf('titan', { ...TITAN_GOOD, spectrometer: 0 });
    const g = commanderSetup(noChem).goals.find((x) => x.id === 'surface_chem')!;
    expect(g.possible).toBe(false);
  });

  it('engineer: the start (everything on the main line) overloads it; critical systems on the secondary line cost points', () => {
    const ctx = ctxOf('titan', TITAN_GOOD);
    const s = engineerSetup(ctx);
    expect(s.caps.main + s.caps.secondary).toBe(300);
    const start = scoreTask('engineer', s.initial, ctx);
    expect(start.notes.some((n) => n.id === 'overload')).toBe(true);
    const b = best(ctx).engineer;
    const rotorOff = { lines: { ...b.lines, rotor_system: 'secondary' as Line } };
    const r = scoreTask('engineer', rotorOff, ctx);
    expect(r.score).toBeLessThan(scoreTask('engineer', b, ctx).score);
    expect(r.notes.some((n) => n.id === 'crit-secondary' && n.n?.node === 'rotor_system')).toBe(true);
  });

  it('science: accuracy falls off with the knob error; mode follows the thermal margin', () => {
    const ctx = ctxOf('titan', TITAN_GOOD);
    const s = scienceSetup(ctx);
    const peak = s.instruments[0];
    const at = (d: number) => scoreTask('science', { knobs: { ...best(ctx).science.knobs, [peak.id]: peak.peak + d }, mode: s.best }, ctx).score;
    expect(at(0)).toBeGreaterThan(at(0.04));
    expect(at(0.04)).toBeGreaterThan(at(0.2));
    // Titan is cold: more intensive measuring warms the craft (instrument heat ×2).
    const cold = s.modes.find((m) => m.mode === 'intensive')!;
    expect(cold.heatDelta).toBeGreaterThan(0);
    expect(s.modes.find((m) => m.mode === 'cautious')!.heatDelta).toBeLessThan(0);
  });

  it('comms: pointing accuracy sets the bandwidth; the narrow High-Gain beam is less forgiving', () => {
    const std = ctxOf('titan', TITAN_GOOD);
    const hga = ctxOf('titan', { ...TITAN_GOOD, antenna_standard: 0, antenna_high_gain: 1 });
    const e = commsSetup(std).earth;
    const off = { x: e.x + 0.12, y: e.y };
    const q = best(std).comms.queue;
    const a = scoreTask('comms', { aim: off, queue: q }, std).preview as { acc: number };
    const b = scoreTask('comms', { aim: off, queue: q }, hga).preview as { acc: number };
    expect(a.acc).toBeGreaterThan(b.acc);
  });

  it('is deterministic per room seed and attempt, and differs between seeds', () => {
    const a = ctxOf('asteroid', AST_GOOD, 11), b = ctxOf('asteroid', AST_GOOD, 11), c = ctxOf('asteroid', AST_GOOD, 12);
    expect(scienceSetup(a)).toEqual(scienceSetup(b));
    expect(commsSetup(a)).toEqual(commsSetup(b));
    expect(scoreTask('comms', best(a).comms, a)).toEqual(scoreTask('comms', best(b).comms, b));
    expect(commsSetup(a).earth).not.toEqual(commsSetup(c).earth);
    expect(scienceSetup({ ...a, attempt: 1 }).instruments).not.toEqual(scienceSetup(a).instruments);
  });
});

describe('flight modifiers', () => {
  const tasksFrom = (ctx: TaskCtx, answers: Partial<Record<RoleId, unknown>>): TasksState => ({
    results: Object.fromEntries(ROLES.map((role) => {
      const a = answers[role] ?? null;
      const s = a ? scoreTask(role, a as never, ctx) : null;
      return [role, { role, skipped: !a, answer: s?.answer ?? null, by: H, attempt: ctx.attempt, key: '', score: s?.score ?? 0, grade: s?.grade ?? 'weak', notes: [] }];
    })),
  });

  it('no task screen → no modifiers (old flights unchanged)', () => {
    expect(flightTasks(null, ctxOf('titan', TITAN_GOOD))).toBeNull();
    expect(startFlight('titan', TITAN_GOOD).tasks).toBeUndefined();
  });

  it('skip = weak with honest effects: factory calibration, antenna off Earth, unrouted grid, no sacrifice order', () => {
    const ctx = ctxOf('titan', TITAN_GOOD);
    const state = tasksFrom(ctx, {});
    for (const r of ROLES) state.results[r]!.key = keyOf(r, ctx);
    const tk = flightTasks(state, ctx)!;
    expect(tk.skipped).toEqual(ROLES);
    expect(Object.values(tk.grades).every((g) => g === 'weak')).toBe(true);
    expect(tk.calibAvg).toBe(0.6);
    expect(tk.aimBase).toBe(0.25);
    expect(tk.lines).toBeNull();
    expect(tk.sacrifice).toBeNull();
    expect(tk.harsh.why).toBe('skip');
    expect(tk.harsh.deadline).toBe(6 + 5);
  });
});

import { taskKey } from '../tasks';
const keyOf = (r: RoleId, ctx: TaskCtx) => taskKey(r, ctx);

// ── Room flow ──

const ok = (s: RoomState, a: Action) => apply(s, a);
function toTasks(mission: MissionId, build: Build, seed = 7) {
  let s = install(roomInBuild(mission, seed), build);
  s = ok(s, { type: 'openTasks', playerId: H });
  expect(s.stage).toBe('tasks');
  return s;
}
function doTasks(s: RoomState, which: 'best' | 'worst' | 'skip'): RoomState {
  const ctx = taskCtx(s);
  const ans = which === 'best' ? best(ctx) : which === 'worst' ? worst(ctx) : null;
  for (const role of ROLES) s = ok(s, { type: 'submitTask', playerId: H, role, answer: ans ? ans[role] : null });
  return s;
}
function launchFromTasks(s: RoomState) {
  s = ok(s, { type: 'submitReview', playerId: H });
  s = ok(as(s, 'commander'), { type: 'approve', playerId: H });
  return ok(s, { type: 'launchDone', playerId: H });
}

describe('room: the tasks stage', () => {
  it('sits between the constructor and the readiness check; readiness waits for all four roles', () => {
    let s = toTasks('titan', TITAN_GOOD);
    expect(reduce(s, { type: 'submitReview', playerId: H }).error).toMatch(/ждём 4/);
    const ctx = taskCtx(s);
    s = ok(s, { type: 'submitTask', playerId: H, role: 'science', answer: best(ctx).science });
    expect(s.tasks!.results.science!.grade).toBe('excellent');
    s = ok(s, { type: 'submitTask', playerId: H, role: 'comms', answer: null });
    expect(s.tasks!.results.comms).toMatchObject({ skipped: true, grade: 'weak', notes: [{ id: 'skipped' }] });
    expect(reduce(s, { type: 'submitReview', playerId: H }).error).toMatch(/ждём 2/);
    s = doTasks(s, 'best');
    s = ok(s, { type: 'submitReview', playerId: H });
    expect(s.stage).toBe('review');
  });

  it('a build change makes the affected tasks stale (redo), the others stay', () => {
    let s = doTasks(toTasks('titan', TITAN_GOOD), 'best');
    s = ok(s, { type: 'goStage', playerId: H, stage: 'build' });
    // A passive part (no power, no data) changes no task.
    s = ok(s, { type: 'removeComponent', playerId: H, id: 'landing_system' });
    s = ok(s, { type: 'openTasks', playerId: H });
    expect(reduce(s, { type: 'submitReview', playerId: H }).error).toBeUndefined();
    s = ok(s, { type: 'goStage', playerId: H, stage: 'build' });
    s = ok(s, { type: 'removeComponent', playerId: H, id: 'temp_sensor' });
    s = ok(s, { type: 'openTasks', playerId: H });
    // A removed instrument: science, comms (data source), commander and engineer (consumer) must redo.
    expect(reduce(s, { type: 'submitReview', playerId: H }).error).toMatch(/ждём 4/);
    s = doTasks(s, 'best');
    expect(reduce(s, { type: 'submitReview', playerId: H }).error).toBeUndefined();
  });

  it('outside demo a player does only his own roles; the host may skip for an offline player', () => {
    let s = toTasks('titan', TITAN_GOOD);
    s = { ...s, demo: false, players: [
      { ...s.players[0], role: 'commander', roles: ['commander'] },
      { id: 'b', name: 'B', role: 'science', roles: ['science'], ready: true, online: false, joinOrder: 1 },
    ] };
    expect(reduce(s, { type: 'submitTask', playerId: H, role: 'science', answer: null }).error).toBeUndefined();
    expect(reduce({ ...s, players: s.players.map((p) => ({ ...p, online: true })) }, { type: 'submitTask', playerId: H, role: 'science', answer: null }).error).toMatch(/другой роли/);
    expect(reduce(s, { type: 'submitTask', playerId: 'b', role: 'commander', answer: null }).error).toMatch(/другой роли/);
  });
});

// ── Weak vs excellent: the flight outcome changes measurably ──

describe('weak vs excellent tasks change the flight', () => {
  const flyWith = (mission: MissionId, build: Build, which: 'best' | 'worst' | 'skip', seed = 7) => fly(launchFromTasks(doTasks(toTasks(mission, build, seed), which)), titanTeam);

  it('Titan: better data quality, less downlink lost to pointing, higher score', () => {
    const good = flyWith('titan', TITAN_GOOD, 'best');
    const bad = flyWith('titan', TITAN_GOOD, 'skip');
    expect(good.stage).toBe('report');
    const q = (s: RoomState) => s.flight!.targets.reduce((x, t) => x + t.quality * t.collected, 0) / Math.max(1, s.flight!.targets.reduce((x, t) => x + t.collected, 0));
    expect(q(good)).toBeGreaterThan(q(bad) + 0.1);
    // Skipped pointing: the downlink ran at 76 % and data waited on board longer.
    expect(bad.flight!.tasks!.log.aimLost).toBeGreaterThan(good.flight!.tasks!.log.aimLost + 5);
    const got = (s: RoomState, key: string) => s.report!.breakdown.find((x) => x.key === key)!.got;
    expect(got(good, 'data')).toBeGreaterThan(got(bad, 'data') + 1.5);
    expect(got(good, 'comms')).toBeGreaterThan(got(bad, 'comms'));
    // Measured (seed 7): 96 Perfect vs 74 Success — a skipped set costs a grade step.
    expect(good.report!.score).toBeGreaterThanOrEqual(bad.report!.score + 15);
    expect(good.report!.outcome).toBe('perfect');
    expect(bad.report!.outcome).toBe('success');
    // The report shows every task's grade and links the weak ones to their effect.
    expect(good.report!.tasks!.map((t) => t.grade)).toEqual(['excellent', 'excellent', 'excellent', 'excellent']);
    expect(bad.report!.tasks!.every((t) => t.grade === 'weak' && t.skipped)).toBe(true);
    expect(bad.report!.chains.some((c) => c.key === 'task:science-calib')).toBe(true);
    expect(bad.report!.chains.some((c) => c.key === 'task:comms-aim')).toBe(true);
  });

  it('asteroid: the same holds for the sample-return flight', () => {
    const team = pick(['da_evade', 'da_brace', 'aj_restart', 'aj_save', 'pd_shed_hungry', 'pd_isolate', 'oh_land_cool']);
    const go = (which: 'best' | 'skip') => {
      let s = launchFromTasks(doTasks(toTasks('asteroid', AST_GOOD), which));
      s = fly(s, (st) => {
        const f = st.flight!;
        const site = f.asteroid && !f.asteroid.site && f.phaseIndex >= 1 && f.phaseIndex <= 2 ? [{ type: 'pickRole', playerId: H, role: 'science' } as Action, { type: 'chooseSite', playerId: H, site: 'crack' } as Action] : [];
        return [...site, ...team(st)];
      });
      return s;
    };
    const good = go('best'), bad = go('skip');
    // Measured (seed 7): 97 Perfect vs 83 Success.
    expect(good.report!.score).toBeGreaterThanOrEqual(bad.report!.score + 10);
    expect(bad.report!.outcome).toBe('success');
    const comp = (s: RoomState) => s.flight!.targets.find((t) => t.id === 'composition')!;
    expect(comp(good).quality).toBeGreaterThan(comp(bad).quality);
  });

  it('engineer: the rotor on the secondary line is shed first when the battery runs dry', () => {
    // Weak power: one RTG, a big spectrometer — the battery empties during the survey.
    const build: Build = { rtg: 1, battery_hc: 1, power_bus: 2, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1, spectrometer: 1, atmo_sensor: 1, thermal_insulation: 1 };
    const ctx = ctxOf('titan', build);
    const b = best(ctx);
    const run = (lines: Record<string, Line>) => {
      const tk = flightTasks({ results: Object.fromEntries(ROLES.map((r) => [r, { role: r, skipped: false, answer: r === 'engineer' ? { lines } : b[r], by: H, attempt: 0, key: taskKey(r, ctx), score: 1, grade: 'excellent' as const, notes: [] }])) }, ctx)!;
      let f: FlightState = startFlight('titan', build, { tasks: tk });
      for (let i = 0; i < 700 && !f.done; i++) f = stepFlight(f, build, 7);
      return f;
    };
    const smart = run(b.engineer.lines);
    const wrong = run({ ...b.engineer.lines, rotor_system: 'secondary', spectrometer: 'main', atmo_sensor: 'main' });
    const firstShed = (f: FlightState) => f.causes.find((c) => c.kind === 'shed')?.causeIds[0];
    const rotorOffAt = (f: FlightState) => f.causes.find((c) => c.kind === 'shed' && c.causeIds[0] === 'rotor_system')?.tick ?? Infinity;
    expect(firstShed(smart)).not.toBe('rotor_system');
    expect(firstShed(wrong)).toBe('rotor_system');
    expect(rotorOffAt(smart)).toBeGreaterThan(rotorOffAt(wrong));
  });

  it('a weak grid makes Power Drop harsher: shorter timer and a hull hit; the commander gets an Emergency Decision', () => {
    const build: Build = { ...TITAN_GOOD, power_bus: 1 };
    const ctx = ctxOf('titan', build);
    const b = best(ctx);
    const mk = (eng: EngineerAnswer | null) => flightTasks({ results: Object.fromEntries(ROLES.map((r) => [r, { role: r, skipped: r === 'engineer' && !eng, answer: r === 'engineer' ? eng : b[r], by: H, attempt: 0, key: taskKey(r, ctx), score: 1, grade: 'excellent' as const, notes: [] }])) }, ctx)!;
    const until = (tk: ReturnType<typeof mk>) => {
      let f = startFlight('titan', build, { tasks: tk });
      for (let i = 0; i < 400 && !f.crisis; i++) f = stepFlight(f, build, 7);
      return f;
    };
    const calm = until(mk(b.engineer));
    const harsh = until(mk(null));
    expect(calm.crisis?.kind).toBe('power_drop');
    expect(harsh.crisis?.kind).toBe('power_drop');
    const left = (f: FlightState) => f.crisis!.deadlineTick - f.crisis!.startedTick;
    expect(left(harsh)).toBeLessThan(left(calm));
    expect(harsh.hull).toBeLessThan(calm.hull);
    expect(calm.crisis!.options.some((o) => o.id === 'pd_emergency' && o.role === 'commander')).toBe(true);
  });
});

describe('in-flight reuse of the task widgets', () => {
  it('after the entry blackout the antenna has lost Earth; comms re-aims, otherwise the computer finds it later', () => {
    let s = launchFromTasks(doTasks(toTasks('titan', TITAN_GOOD), 'best'));
    while (!s.flight!.tasks!.reaim && s.stage === 'flight') s = ok(s, { type: 'tick', playerId: H });
    const tk = s.flight!.tasks!;
    expect(tk.aim).toBe(0.35);
    expect(s.flight!.causes.some((c) => c.ref === 'task-aim-lost')).toBe(true);
    s = ok(as(s, 'comms'), { type: 'reaimAntenna', playerId: H, x: tk.reaim!.x, y: tk.reaim!.y });
    expect(s.flight!.tasks!.aim).toBe(1);
    expect(s.flight!.tasks!.reaim).toBeNull();
    expect(reduce(s, { type: 'reaimAntenna', playerId: H, x: 0, y: 0 }).error).toMatch(/наведена/);
  });

  it('re-aiming is never more precise than the pre-flight pointing table (a skipped comms task still costs bandwidth)', () => {
    let s = launchFromTasks(doTasks(toTasks('titan', TITAN_GOOD), 'skip'));
    while (!s.flight!.tasks!.reaim && s.stage === 'flight') s = ok(s, { type: 'tick', playerId: H });
    const t = s.flight!.tasks!;
    s = ok(as(s, 'comms'), { type: 'reaimAntenna', playerId: H, x: t.reaim!.x, y: t.reaim!.y });
    expect(s.flight!.tasks!.aim).toBe(0.35); // the blackout floor: the skipped table (0.25) is no better
  });

  it('engineer isolates the node he clicked in Power Drop', () => {
    const build: Build = { ...TITAN_GOOD, power_bus: 1 };
    let s = launchFromTasks(doTasks(toTasks('titan', build), 'best'));
    while (!s.flight!.crisis && s.stage === 'flight') s = ok(s, { type: 'tick', playerId: H });
    expect(s.flight!.crisis!.kind).toBe('power_drop');
    s = ok(as(s, 'engineer'), { type: 'isolateNode', playerId: H, node: 'wide_camera' });
    expect(s.flight!.crisis!.chosen.engineer).toBe('pd_isolate');
    expect(s.flight!.crisis!.options.find((o) => o.id === 'pd_isolate')!.nodeIds).toEqual(['wide_camera']);
    expect(reduce(s, { type: 'isolateNode', playerId: H, node: 'transceiver' }).error).toMatch(/нельзя/);
  });

  it('science can lower the intensity in Overheat: instruments heat less for the rest of the flight', () => {
    const build: Build = { rtg: 3, battery_hc: 1, power_bus: 2, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1, spectrometer: 1, hires_camera: 1, thermal_insulation: 1, atmo_sensor: 1 };
    const ctx = ctxOf('titan', build);
    const b = best(ctx);
    const tk = flightTasks({ results: Object.fromEntries(ROLES.map((r) => [r, { role: r, skipped: false, answer: r === 'science' ? { ...b.science, mode: 'intensive' } : b[r], by: H, attempt: 0, key: taskKey(r, ctx), score: 1, grade: 'excellent' as const, notes: [] }])) }, ctx)!;
    let f = startFlight('titan', build, { tasks: tk });
    for (let i = 0; i < 600 && f.crisis?.kind !== 'overheat'; i++) f = stepFlight(f, build, 7);
    expect(f.crisis?.kind).toBe('overheat');
    const opts = f.crisis!.options.filter((o) => o.id.startsWith('oh_intensity_')).map((o) => o.id);
    expect(opts).toEqual(['oh_intensity_normal', 'oh_intensity_cautious']);
  });
});
