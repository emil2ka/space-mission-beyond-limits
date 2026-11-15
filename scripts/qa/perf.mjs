// Weak-laptop FPS pass: every 3D screen × quality under CPU throttling (+ optional software GL).
// Needs a server with the dev hooks: `pnpm dev` (dev React, inflated JS cost) or, better, the QA production build
// (scripts/qa/vite.qa-build.config.mjs: production React/three + ?dev=1 probes). Usage:
//   node scripts/qa/perf.mjs [--cpu 6] [--gpu swiftshader|metal] [--q low,high,auto] [--only build-titan,launch]
//        [--ms 10000] [--warm 4000] [--reps 1] [--ab before=http://localhost:5196,after=http://localhost:5197] [--out file.json]
// --ab runs every screen on each server in turn (before, after, before, after…) so machine-load drift hits both sides.
// Output: one line per run, a median summary, and a JSON file (default scripts/qa/out/perf-<cpu>x-<gpu>.json).
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  BASE, dispatch, fastForwardToReport, hookStore, launch, measure, newPage, presetStorage, sleep, startAutopilot,
  toBuild, toLaunch, toLobby, waitStage,
} from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const CPU = Number(arg('cpu', 6));
const GPU = arg('gpu', 'swiftshader');
const QS = arg('q', 'low,high,auto').split(',');
const MS = Number(arg('ms', 10_000));
const WARM = Number(arg('warm', 4000));
const REPS = Number(arg('reps', 1));
const SIDES = arg('ab', `run=${BASE}`).split(',').map((s) => s.split('='));
// A weak school laptop: 4 GB, 4 threads (Auto should pick Low here).
// --fakegpu "<renderer string>" makes Auto see another GPU (e.g. Iris Xe on top of SwiftShader → tests the FPS guard).
const DEVICE = { width: 1366, height: 768, dpr: 1, cpu: CPU, mem: Number(arg('mem', 4)), cores: Number(arg('cores', 4)), fakeGpu: arg('fakegpu', undefined) };

const ALL = ['home', 'build-titan', 'build-asteroid', 'launch', 'flight-titan', 'flight-asteroid', 'return', 'report'];
const ONLY = arg('only', ALL.join(',')).split(',');

/** Opens the screen; returns when it is on screen (warm-up is separate). */
const SCENES = {
  async home(page, q, base) { await page.goto(`${base}/?dev=1`, { waitUntil: 'load' }); await hookStore(page); },
  async 'build-titan'(page, q, base) { await SCENES.home(page, q, base); await toLobby(page); await toBuild(page, 'titan'); },
  async 'build-asteroid'(page, q, base) { await SCENES.home(page, q, base); await toLobby(page); await toBuild(page, 'asteroid'); },
  async launch(page, q, base) { await SCENES['build-titan'](page, q, base); await toLaunch(page); await waitStage(page, 'launch'); },
  async 'flight-titan'(page, q, base) { await SCENES.launch(page, q, base); await dispatch(page, [{ type: 'launchDone' }]); await waitStage(page, 'flight'); await startAutopilot(page); },
  async 'flight-asteroid'(page, q, base) {
    await SCENES['build-asteroid'](page, q, base); await toLaunch(page); await waitStage(page, 'launch');
    await dispatch(page, [{ type: 'launchDone' }]); await waitStage(page, 'flight'); await startAutopilot(page);
  },
  // Dev page (no Auto there: q=auto renders High).
  async return(page, q, base) {
    await page.goto(`${base}/?scene=return&dev=1&q=${q}`, { waitUntil: 'load' });
    await page.waitForSelector('canvas', { timeout: 60_000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'entry')?.click());
  },
  async report(page, q, base) { await SCENES['flight-titan'](page, q, base); await fastForwardToReport(page); await waitStage(page, 'report'); },
};

const browser = await launch({ gpu: GPU });
const rows = [];
for (const q of QS) {
  for (const name of ONLY) {
    for (let rep = 0; rep < REPS; rep++) {
      for (const [side, base] of SIDES) {
        const ctx = await browser.createBrowserContext(); // clean localStorage: no saved room / agency from the last run
        const page = await newPage(ctx, DEVICE);
        await presetStorage(page, { 'sm:graphics': q === 'auto' ? null : q, 'sm:soundOn': '0' });
        const t0 = Date.now();
        let row;
        try {
          await SCENES[name](page, q, base);
          const ready = Date.now() - t0;
          // The launch cutscene lasts 13.6 s: short warm-up and window so we measure the launch, not the flight after it.
          await sleep(name === 'launch' ? 1000 : WARM);
          const m = await measure(page, name === 'launch' ? Math.min(MS, 9000) : MS);
          row = {
            side, name, q, cpu: CPU, gpu: GPU, readyMs: ready, ...m,
            stage: await page.evaluate(() => window.__qaGame?.getState().room?.stage ?? '-'),
            autoLow: await page.evaluate(() => localStorage.getItem('sm:autoLow')),
          };
        } catch (e) {
          row = { side, name, q, cpu: CPU, gpu: GPU, error: String(e.message ?? e).slice(0, 200) };
        }
        row.consoleErrors = page.qaLogs.filter((l) => /^(error|pageerror)/.test(l)).slice(0, 5);
        rows.push(row);
        const p = row.probe;
        console.log(row.error ? `${side.padEnd(6)} ${name.padEnd(16)} ${q.padEnd(5)} ERROR ${row.error}` :
          `${side.padEnd(6)} ${name.padEnd(16)} ${q.padEnd(5)} fps ${String(row.fps).padStart(5)}  p95 ${String(row.p95).padStart(6)} ms  worst ${String(row.worst).padStart(4)}  long ${row.longTasks}/${row.longMs}ms  heap ${row.heapMB}MB  ` +
          `${p ? `calls ${p.calls} tris ${p.triangles} q=${p.quality}` : 'no-canvas'}  stage ${row.stage}  ready ${row.readyMs}ms${row.autoLow ? `  autoLow=${row.autoLow}` : ''}${row.consoleErrors.length ? `  ERR ${row.consoleErrors[0].slice(0, 120)}` : ''}`);
        await ctx.close();
      }
    }
  }
}
await browser.close();

// Median per (screen, quality, side).
const med = (a) => { const s = a.filter((x) => !Number.isNaN(x)).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
console.log(`\n== median (${CPU}× CPU, ${GPU}, ${REPS} rep): screen | q | fps ${SIDES.map(([s]) => s).join(' / ')} | calls | long-ms`);
for (const q of QS) for (const name of ONLY) {
  const cells = SIDES.map(([side]) => rows.filter((r) => r.side === side && r.name === name && r.q === q && !r.error));
  console.log(`${name.padEnd(16)} ${q.padEnd(5)} ${cells.map((c) => String(med(c.map((r) => r.fps))).padStart(6)).join(' ')}   calls ${cells.map((c) => med(c.map((r) => r.probe?.calls ?? NaN))).join('/')}  long-ms ${cells.map((c) => med(c.map((r) => r.longMs))).join('/')}  q ${cells.map((c) => c[0]?.probe?.quality ?? '-').join('/')}`);
}
mkdirSync('scripts/qa/out', { recursive: true });
const out = arg('out', `scripts/qa/out/perf-${CPU}x-${GPU}.json`);
writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(`→ ${out}`);
