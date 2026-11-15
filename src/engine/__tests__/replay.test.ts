// M5: report replay snapshots (src/engine/replay.ts) — small, deterministic, the main crisis is in it.
import { describe, expect, it } from 'vitest';
import { buildReport } from '../report';
import { mainCrisis, type Replay } from '../replay';
import type { FlightState } from '../flight';
import { AST_GOOD, AST_ION, TITAN_BAD, TITAN_GOOD, astTeam, run, titanTeam } from './m3helpers';

const size = (x: unknown) => JSON.stringify(x).length;

describe('report replay', () => {
  it.each([
    ['titan good', () => run('titan', TITAN_GOOD, { policy: titanTeam })],
    ['titan bad', () => run('titan', TITAN_BAD, { policy: titanTeam })],
    ['titan bad, nobody answers', () => run('titan', TITAN_BAD)],
    ['asteroid', () => run('asteroid', AST_GOOD, { policy: astTeam() })],
    ['asteroid ion, nobody answers', () => run('asteroid', AST_ION)],
  ])('%s: launch → main crisis → final, a few KB, recorder dropped from the flight', (_, go) => {
    const s = go();
    const f = s.flight!;
    const rep = s.report!.replay as Replay;
    expect(s.stage).toBe('report');
    expect(rep).toBeTruthy();
    expect(rep.mission).toBe(s.mission);
    const kinds = rep.windows.map((w) => w.kind);
    const main = mainCrisis(f.history);
    expect(kinds).toEqual(main ? ['launch', 'crisis', 'final'] : ['launch', 'final']);
    if (main) {
      const w = rep.windows[1];
      expect(w.ref).toBe(main.id);
      expect(w.tick).toBe(main.startedTick);
      // the crisis is on screen in its own window, with its kind and nodes
      expect(w.crises.map((c) => c.kind)).toContain(main.kind);
      expect(w.frames.some((fr) => fr.c && w.crises[fr.c - 1].kind === main.kind)).toBe(true);
      // the main crisis is the one the highlights call main
      expect(s.report!.highlights.find((h) => h.text.endsWith('главный кризис'))?.tick).toBe(main.startedTick);
    }
    for (const w of rep.windows) {
      expect(w.frames.length).toBeGreaterThan(0);
      expect(w.frames.length).toBeLessThanOrEqual(24);
      expect(w.left).toBeUndefined();
      expect(w.offs[0]).toEqual([]);
      for (let i = 1; i < w.frames.length; i++) expect(w.frames[i].t).toBeGreaterThan(w.frames[i - 1].t);
      for (const fr of w.frames) {
        if (fr.o !== undefined) expect(w.offs[fr.o]).toBeTruthy();
        if (fr.c !== undefined) expect(w.crises[fr.c - 1]).toBeTruthy();
      }
    }
    const fin = rep.windows.at(-1)!;
    // Titan: the last waypoint arrival (or the very end if no point was reached); asteroid: the capsule to the end
    const arrived = f.causes.filter((c) => c.ref === 'waypoint').at(-1);
    if (s.mission === 'titan' && arrived) expect(fin.tick).toBe(arrived.tick);
    else expect(fin.frames.at(-1)!.t).toBe(f.tick);
    if (s.mission === 'asteroid') expect(fin.frames.at(-1)!.cp).toBe(f.asteroid!.capsule);
    expect(f.replay).toBeUndefined();
    // ≈ 2–3 KB in the report; the recorder while flying stays small too
    expect(size(rep)).toBeLessThan(3500);
  });

  it('recorder stays small during the flight', () => {
    let peak = 0;
    const onTick = (f: FlightState) => { peak = Math.max(peak, size(f.replay ?? null)); };
    run('titan', TITAN_BAD, { onTick });
    run('asteroid', AST_ION, { onTick });
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(5000);
  });

  it('is deterministic: same seed and build → same replay; rebuilt report keeps it', () => {
    const a = run('titan', TITAN_BAD, { seed: 11, policy: titanTeam });
    const b = run('titan', TITAN_BAD, { seed: 11, policy: titanTeam });
    expect(a.report!.replay).toEqual(b.report!.replay);
    const c = run('asteroid', AST_GOOD, { seed: 5, policy: astTeam() });
    const d = run('asteroid', AST_GOOD, { seed: 5, policy: astTeam() });
    expect(c.report!.replay).toEqual(d.report!.replay);
  });

  it('old flights without a recorder: no replay, the report still builds', () => {
    const s = run('titan', TITAN_GOOD, { policy: titanTeam });
    const r = buildReport({ ...s, flight: { ...s.flight!, replay: undefined } });
    expect(r.replay).toBeUndefined();
    expect(r.highlights[0].kind).toBe('launch');
  });

  it('Titan final shows the last waypoint arrival; asteroid final shows the capsule', () => {
    const t = run('titan', TITAN_GOOD, { policy: titanTeam });
    const tf = t.report!.replay!.windows.at(-1)!;
    const reached = t.flight!.waypoints.filter((w) => w.reached).length;
    if (reached) expect(tf.frames.some((fr) => fr.wi === reached - 1 && (fr.wp ?? 0) >= 0.99)).toBe(true);
    const a = run('asteroid', AST_GOOD, { policy: astTeam() });
    const af = a.report!.replay!.windows.at(-1)!;
    expect(af.frames[0].cp).toBe('separated');
    expect(new Set(af.frames.map((fr) => fr.cp))).toEqual(new Set(['separated', 'entry', 'chute', 'landed', 'found']));
  });
});
