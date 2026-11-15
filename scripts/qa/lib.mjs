// Device QA helpers (headless system Chrome via puppeteer-core): launch, throttle, FPS window, store driver.
// Used by scripts/qa/perf.mjs, load.mjs, audio.mjs, mobile.mjs. See docs/04 Tech/Device QA.md.
import puppeteer, { PredefinedNetworkConditions } from 'puppeteer-core';

export const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const BASE = process.env.BASE ?? 'http://localhost:5188';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const NET = PredefinedNetworkConditions;

/** gpu: 'metal' (real GPU) | 'swiftshader' (software GL ≈ weak integrated graphics). */
export async function launch({ gpu = 'metal', headless = true, args = [] } = {}) {
  const extra = gpu === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal'];
  return puppeteer.launch({
    executablePath: CHROME, headless, protocolTimeout: 240_000,
    args: [...extra, '--autoplay-policy=user-gesture-required', '--disable-background-timer-throttling', ...args],
  });
}

/** In-page probes, installed before any page script: rAF timestamps, long tasks, console errors. */
const PROBE = () => {
  const qa = (window.__qa = { frames: [], longTasks: [], errors: [], lost: 0 });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) qa.longTasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  } catch { /* no longtask API */ }
  const loop = (t) => { qa.frames.push(t); if (qa.frames.length > 20000) qa.frames.splice(0, 10000); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  addEventListener('error', (e) => qa.errors.push(String(e.message)));
  addEventListener('webglcontextlost', () => { qa.lost++; }, true);
  // Home screen rendered (load.mjs «interactive»).
  const mo = new MutationObserver(() => { if (document.querySelector('.home-card input')) { window.__qaHomeAt = performance.now(); mo.disconnect(); } });
  addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true, subtree: true }));
};

/**
 * New page with a device profile.
 * opts: { width, height, dpr, mobile, touch, cpu (throttle ×), net ('Slow 4G' …), mem (navigator.deviceMemory), cores }
 */
export async function newPage(browser, o = {}) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await page.setViewport({ width: o.width ?? 1366, height: o.height ?? 768, deviceScaleFactor: o.dpr ?? 1, isMobile: !!o.mobile, hasTouch: !!o.touch, isLandscape: (o.width ?? 1366) > (o.height ?? 768) });
  if (o.mobile) await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36');
  if (o.cpu && o.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: o.cpu });
  if (o.cores) await cdp.send('Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: o.cores });
  if (o.net) await page.emulateNetworkConditions(NET[o.net]);
  if (o.mem) await page.evaluateOnNewDocument((m) => Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => m, configurable: true }), o.mem);
  // Pretend to be another GPU (Auto detection test): WEBGL_debug_renderer_info answers this string.
  if (o.fakeGpu) await page.evaluateOnNewDocument((name) => {
    for (const C of [WebGLRenderingContext, typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext : null]) {
      if (!C) continue;
      const get = C.prototype.getParameter;
      C.prototype.getParameter = function (p) { return p === 0x9246 ? name : get.call(this, p); };
    }
  }, o.fakeGpu);
  await page.evaluateOnNewDocument(PROBE);
  await cdp.send('Performance.enable');
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.qaLogs = logs;
  page.cdp = cdp;
  return page;
}

/** Set localStorage keys before the app boots (graphics quality, name). */
export async function presetStorage(page, kv) {
  await page.evaluateOnNewDocument((kv) => { for (const [k, v] of Object.entries(kv)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } }, kv);
}

/** FPS over a window: mean fps, p95 frame ms, worst frame, long tasks (count / total ms), heap MB, renderer info. */
export async function measure(page, ms = 10_000) {
  const t0 = await page.evaluate(() => performance.now());
  await sleep(ms);
  const r = await page.evaluate((t0) => {
    const qa = window.__qa;
    const f = qa.frames.filter((t) => t >= t0);
    const d = [];
    for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
    d.sort((a, b) => a - b);
    const span = f.length > 1 ? f[f.length - 1] - f[0] : 1;
    const lt = qa.longTasks.filter(([s]) => s >= t0);
    return {
      fps: f.length > 1 ? +(((f.length - 1) * 1000) / span).toFixed(1) : 0,
      p95: +(d[Math.floor(d.length * 0.95)] ?? 0).toFixed(1),
      worst: +(d[d.length - 1] ?? 0).toFixed(0),
      longTasks: lt.length, longMs: Math.round(lt.reduce((s, [, x]) => s + x, 0)),
      probe: window.__sm_fps ?? null,
      errors: qa.errors.slice(), lost: qa.lost,
    };
  }, t0);
  const mm = await page.cdp.send('Performance.getMetrics');
  const heap = mm.metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0;
  return { ...r, heapMB: +(heap / 1048576).toFixed(1) };
}

// ───────── store driver (dev server only: the page imports the same module instances as the app) ─────────

/** Expose useGame / engine / starter builds on window.__qaGame etc. */
export async function hookStore(page) {
  await page.waitForFunction(() => document.querySelector('#root')?.children.length, { timeout: 60_000 });
  await page.evaluate(async () => {
    // QA production build (scripts/qa/vite.qa-build.config.mjs) exposes the store itself.
    if (window.__qaGameExport) {
      const e = window.__qaEngineExport;
      Object.assign(window, { __qaGame: window.__qaGameExport, __qaEngine: e, __qaBuilds: e.STARTER_BUILD });
      return;
    }
    // Import the exact URLs the app loaded (Vite adds ?t=… / ?v=… after HMR) so we get the same module instances.
    const loaded = performance.getEntriesByType('resource').map((r) => r.name);
    const url = (path) => loaded.find((n) => new URL(n).pathname === path) ?? path;
    const g = await import(url('/src/store/game.ts'));
    const e = await import(url('/src/engine/index.ts'));
    // STARTER_BUILD: the engine's own valid build per mission (passes review, fits the budget).
    Object.assign(window, { __qaGame: g.useGame, __qaEngine: e, __qaBuilds: e.STARTER_BUILD });
  });
}

/** Demo room → lobby (one player, commander). */
export async function toLobby(page) {
  await page.evaluate(async () => {
    const G = window.__qaGame;
    for (let i = 0; i < 100 && !G.getState().me.id; i++) await new Promise((r) => setTimeout(r, 50));
    if (!G.getState().me.name) G.getState().setName('QA');
    await G.getState().create({ demo: true });
  });
  await page.waitForFunction(() => window.__qaGame.getState().room?.stage === 'lobby', { timeout: 30_000 });
}

/** Dispatch a list of actions (playerId is filled by the store), waiting between them. */
export async function dispatch(page, actions, gap = 30) {
  await page.evaluate(async (actions, gap) => {
    const G = window.__qaGame;
    for (const a of actions) { G.getState().dispatch(a); await new Promise((r) => setTimeout(r, gap)); }
  }, actions, gap);
}

export const stage = (page) => page.evaluate(() => window.__qaGame.getState().room?.stage ?? 'home');

/** Lobby → build stage of `mission` with the full demo build installed. */
export async function toBuild(page, mission) {
  await dispatch(page, [
    { type: 'pickRole', role: 'commander' }, { type: 'setReady', ready: true },
    ...(mission !== 'titan' ? [{ type: 'selectMission', mission }] : []),
    { type: 'goStage', stage: 'briefing' }, { type: 'goStage', stage: 'build' },
  ]);
  const build = await page.evaluate((m) => window.__qaBuilds[m], mission);
  const adds = Object.entries(build).flatMap(([id, n]) => Array.from({ length: n }, () => ({ type: 'addComponent', id })));
  await dispatch(page, adds, 15);
}

/** Build → review → (approve) launch. */
export async function toLaunch(page) {
  await dispatch(page, [{ type: 'submitReview' }, { type: 'pickRole', role: 'commander' }, { type: 'approve' }], 80);
}

/** Answer any open crisis with the first option of each role; choose the asteroid site. Runs in the page until stopped. */
export async function startAutopilot(page) {
  await page.evaluate(() => {
    const G = window.__qaGame;
    window.__qaAuto = setInterval(() => {
      const s = G.getState().room;
      const f = s?.flight;
      if (!f) return;
      const d = G.getState().dispatch;
      if (f.crisis) {
        for (const role of ['commander', 'engineer', 'science', 'comms']) {
          if (f.crisis.chosen?.[role]) continue;
          const o = f.crisis.options.find((x) => x.role === role);
          if (o) { d({ type: 'pickRole', role }); d({ type: 'crisisChoice', optionId: o.id }); }
        }
      }
      if (f.asteroid && !f.asteroid.site) { d({ type: 'pickRole', role: 'science' }); d({ type: 'chooseSite', site: 'regolith' }); }
    }, 400);
  });
}

export async function waitStage(page, st, timeout = 120_000) {
  await page.waitForFunction((st) => window.__qaGame.getState().room?.stage === st, { timeout, polling: 200 }, st);
}

/** Fast-forward the current flight through the engine reducer (same rules) and show the result: → report. */
export async function fastForwardToReport(page) {
  await page.evaluate(() => {
    const G = window.__qaGame, E = window.__qaEngine;
    let s = G.getState().room;
    const me = G.getState().me.id;
    const ap = (a) => { const r = E.reduce(s, { ...a, playerId: me }, Date.now()); if (!r.error) s = r.state; };
    for (let i = 0; i < 4000 && s.stage === 'flight'; i++) {
      const c = s.flight.crisis;
      if (c) for (const role of ['commander', 'engineer', 'science', 'comms']) { const o = !c.chosen?.[role] && c.options.find((x) => x.role === role); if (o) { ap({ type: 'pickRole', role }); ap({ type: 'crisisChoice', optionId: o.id }); } }
      if (s.flight?.asteroid && !s.flight.asteroid.site) { ap({ type: 'pickRole', role: 'science' }); ap({ type: 'chooseSite', site: 'regolith' }); }
      ap({ type: 'tick' });
    }
    G.setState({ room: s });
  });
}
