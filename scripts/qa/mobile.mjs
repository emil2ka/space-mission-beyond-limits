// Phone pass (emulated): the whole loop in demo mode on iPhone SE / iPhone 14 / a mid Android with touch, DPR and CPU throttle.
// Taps real buttons where it can (falls back to the store when a label moved), and on every screen checks:
// horizontal scroll, tap targets < 44 px, elements sticking out of the viewport; plus the name field vs the keyboard,
// landscape, and WebGL context loss / restore. Screenshots → docs/05 Assets/UI/kit/shots/qa/.
// Needs a dev server: BASE=http://localhost:5193 node scripts/qa/mobile.mjs [--device se,14,android] [--cpu 4] [--no-shots]
import { mkdirSync, writeFileSync } from 'node:fs';
import { BASE, dispatch, hookStore, launch, newPage, presetStorage, sleep, startAutopilot, fastForwardToReport, waitStage } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const CPU = Number(arg('cpu', 4));
const SHOTS = !process.argv.includes('--no-shots');
const SHOT_DIR = 'docs/05 Assets/UI/kit/shots/qa';
const DEVICES = {
  se: { label: 'iPhone SE', width: 375, height: 667, dpr: 2, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  14: { label: 'iPhone 14', width: 390, height: 844, dpr: 3, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  android: { label: 'Android 412×915', width: 412, height: 915, dpr: 2.625 },
};
const WHICH = arg('device', 'se,14,android').split(',');

/** Layout audit of what is on screen now. */
const audit = (page) => page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight;
  const sel = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="slider"], summary, label.checkbox, .check';
  const small = [], out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[aria-hidden="true"], .ss-dev')) continue;
    const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    // A native checkbox / radio inside a bigger <label> is tapped through the label: measure the label.
    let w = r.width, h = r.height;
    const lab = el.closest('label');
    if (lab && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'range')) { const lr = lab.getBoundingClientRect(); w = Math.max(w, lr.width); h = Math.max(h, lr.height); }
    if ((w < 44 || h < 44) && !seen.has(name)) { seen.add(name); small.push(`${name} ${Math.round(w)}×${Math.round(h)}`); }
    if (r.right > vw + 1 || r.left < -1) out.push(`${name} [${Math.round(r.left)}…${Math.round(r.right)}]`);
  }
  const se = document.scrollingElement;
  return { vw, vh, hscroll: se.scrollWidth > vw + 1 ? se.scrollWidth - vw : 0, small, out: [...new Set(out)].slice(0, 8), canvases: document.querySelectorAll('canvas').length };
});

/** Tap the first visible button whose text / aria-label matches. Returns false if none. */
async function tap(page, re) {
  const pt = await page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const el = [...document.querySelectorAll('button, [role="button"], [role="tab"], label')].find((b) => re.test(b.getAttribute('aria-label') || b.textContent || '') && !b.disabled && b.getBoundingClientRect().width > 0);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, re.source);
  if (!pt) return false;
  await sleep(150);
  await page.touchscreen.tap(pt.x, pt.y);
  await sleep(400);
  return true;
}

async function shot(page, dev, name) {
  if (!SHOTS) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  const vp = page.viewport();
  await page.screenshot({ path: `${SHOT_DIR}/${dev}-${name}.jpg`, type: 'jpeg', quality: 55, clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: 1.25 / vp.deviceScaleFactor } });
}

/** WebGL context loss → restore: rendering must resume (draw calls in the probe) and the page must not throw. */
const ctxLoss = (page) => page.evaluate(async () => {
  const c = document.querySelector('canvas');
  if (!c) return 'no canvas';
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const ext = gl?.getExtension('WEBGL_lose_context');
  if (!ext) return 'no WEBGL_lose_context';
  const errs = window.__qa.errors.length;
  ext.loseContext();
  await new Promise((r) => setTimeout(r, 1500));
  const lost = { isLost: gl.isContextLost(), overlay: !!document.querySelector('[data-gl-lost]') };
  window.__sm_fps = undefined;
  ext.restoreContext();
  await new Promise((r) => setTimeout(r, 3000));
  const c2 = document.querySelector('canvas');
  const g2 = c2 && (c2.getContext('webgl2') || c2.getContext('webgl'));
  const p = window.__sm_fps;
  return { ...lost, restored: !!g2 && !g2.isContextLost(), sameCanvas: c === c2, fpsAfter: p?.fps ?? 0, callsAfter: p?.calls ?? 0, newErrors: window.__qa.errors.slice(errs) };
});

const st = (page) => page.evaluate(() => window.__qaGame.getState().room?.stage ?? 'home');

const report = {};
const browser = await launch({ gpu: 'metal' });
for (const key of WHICH) {
  const d = DEVICES[key];
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx, { width: d.width, height: d.height, dpr: d.dpr, mobile: true, touch: true, cpu: CPU });
  if (d.ua) await page.setUserAgent(d.ua);
  // A notch phone: Chrome can emulate safe-area insets (newer versions); ignore if unsupported.
  const safe = key === '14' ? await page.cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } }).then(() => true, () => false) : false;
  await presetStorage(page, { 'sm:soundOn': '0', 'sm:graphics': null });
  const R = (report[d.label] = { safeAreaEmulated: safe, screens: {}, notes: [] });
  const check = async (name) => { const a = await audit(page); R.screens[name] = a; await shot(page, key, name); console.log(`${d.label.padEnd(16)} ${name.padEnd(16)} hscroll ${a.hscroll}  small ${a.small.length}${a.small.length ? ` (${a.small.slice(0, 4).join('; ')})` : ''}${a.out.length ? `  OUT ${a.out.join('; ')}` : ''}`); return a; };
  try {
    await page.goto(`${BASE}/?dev=1&speed=10`, { waitUntil: 'load' });
    await hookStore(page);
    await page.waitForSelector('.home-card input');
    // Auto on a phone must resolve to Low.
    R.auto = await page.evaluate(async () => { const l = performance.getEntriesByType('resource').map((r) => r.name); const u = l.find((n) => new URL(n).pathname === '/src/ui/graphics.ts') ?? '/src/ui/graphics.ts'; return (await import(u)).autoQuality(); });
    await check('home');

    // Name field + on-screen keyboard (≈ 45 % of the height): the field must stay above it; font ≥ 16 px (no iOS zoom).
    const inp = await page.$('.home-card input');
    const box = await inp.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.type('Аля');
    const kb = Math.round(d.height * 0.45);
    await page.setViewport({ width: d.width, height: d.height - kb, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
    await sleep(400);
    R.keyboard = await page.evaluate(() => {
      const el = document.activeElement; const r = el.getBoundingClientRect();
      return { focused: el?.tagName, fontPx: parseFloat(getComputedStyle(el).fontSize), visible: r.top >= 0 && r.bottom <= innerHeight, bottom: Math.round(r.bottom), vh: innerHeight,
        autocomplete: el.getAttribute('autocomplete'), enterkeyhint: el.getAttribute('enterkeyhint') };
    });
    await shot(page, key, 'home-keyboard');
    await page.setViewport({ width: d.width, height: d.height, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
    await sleep(300);
    // iOS zooms into any focused field with font-size < 16 px: list them on every screen we visit below.
    const smallFonts = async () => page.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea')].filter((e) => e.getBoundingClientRect().width && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => `${e.tagName.toLowerCase()}.${e.className} ${getComputedStyle(e).fontSize}`));

    if (!(await tap(page, /Демо-режим: играть одному/))) { R.notes.push('demo button not tapped'); await page.evaluate(() => window.__qaGame.getState().create({ demo: true })); }
    await page.waitForFunction(() => window.__qaGame.getState().room?.stage === 'lobby', { timeout: 20_000 });
    await sleep(800);
    await check('lobby');

    if (await tap(page, /^\s*Штаб|lobby-hq|Штаб агентства/)) { await sleep(600); await check('hq'); if (!(await tap(page, /В лобби/))) R.notes.push('HQ back not tapped'); await sleep(400); }
    else R.notes.push('HQ button not found');

    await page.evaluate(() => document.querySelector('[data-role="commander"]')?.scrollIntoView({ block: 'center' }));
    const role = await page.$('[data-role="commander"]');
    if (role) { const b = await role.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(300); } else R.notes.push('role card not found');
    if (!(await tap(page, /^\s*Готов/))) await dispatch(page, [{ type: 'setReady', ready: true }]);
    if (!(await tap(page, /Начать|К брифингу|Брифинг|Старт миссии/))) { R.notes.push('start → briefing via store'); await dispatch(page, [{ type: 'pickRole', role: 'commander' }, { type: 'setReady', ready: true }, { type: 'goStage', stage: 'briefing' }]); }
    await page.waitForFunction(() => window.__qaGame.getState().room?.stage === 'briefing', { timeout: 10_000 }).catch(() => R.notes.push('not in briefing'));
    await sleep(500);
    await check('briefing');

    if (!(await tap(page, /К сборке аппарата/))) await dispatch(page, [{ type: 'goStage', stage: 'build' }]);
    await waitStage(page, 'build', 15_000);
    await page.waitForSelector('canvas', { timeout: 30_000 }).catch(() => R.notes.push('no canvas in constructor'));
    await sleep(1500);
    const added = await tap(page, /^Добавить /);
    R.tapAddModule = added;
    const build = await page.evaluate(() => window.__qaBuilds[window.__qaGame.getState().room.mission]);
    const have = await page.evaluate(() => window.__qaGame.getState().room.build);
    const adds = Object.entries(build).flatMap(([id, n]) => Array.from({ length: Math.max(0, n - (have[id] ?? 0)) }, () => ({ type: 'addComponent', id })));
    await dispatch(page, adds, 15);
    await sleep(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    await check('constructor');
    R.contextLossConstructor = await ctxLoss(page);
    await shot(page, key, 'constructor-after-ctx-restore');
    R.fontsBelow16 = await smallFonts();

    // Landscape (phone turned): constructor.
    await page.setViewport({ width: d.height, height: d.width, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, isLandscape: true });
    await sleep(1200);
    await check('constructor-land');
    await page.setViewport({ width: d.width, height: d.height, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
    await sleep(800);

    if (!(await tap(page, /На проверку|Отправить на проверку|К проверке/))) { R.notes.push('submit via store'); await dispatch(page, [{ type: 'submitReview' }]); }
    await waitStage(page, 'review', 10_000).catch(() => R.notes.push(`stage ${'review'} not reached`));
    await sleep(1200);
    await check('review');
    await page.evaluate(() => { const c = [...document.querySelectorAll('label')].find((l) => /несмотря на предупреждения/.test(l.textContent)); c?.querySelector('input')?.click(); });
    if (!(await tap(page, /^\s*Утвердить/))) { R.notes.push('approve via store'); await dispatch(page, [{ type: 'pickRole', role: 'commander' }, { type: 'approve' }]); }
    await page.waitForFunction(() => ['launch', 'flight'].includes(window.__qaGame.getState().room?.stage), { timeout: 15_000 }).catch(() => R.notes.push('launch not reached'));
    await sleep(4000);
    await check('launch');

    await waitStage(page, 'flight', 40_000).catch(async () => { R.notes.push('launchDone via store'); await dispatch(page, [{ type: 'launchDone' }]); });
    // Wait for the first crisis (dev speed 10: the clock runs fast between crises).
    const crisis = await page.waitForFunction(() => window.__qaGame.getState().room?.flight?.crisis, { timeout: 120_000, polling: 300 }).then(() => true, () => false);
    await sleep(1500);
    await check(crisis ? 'flight-crisis' : 'flight');
    R.crisisSeen = crisis;
    await page.setViewport({ width: d.height, height: d.width, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true, isLandscape: true });
    await sleep(1200);
    await check('flight-land');
    await page.setViewport({ width: d.width, height: d.width === 375 ? 667 : d.height, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true });
    await sleep(800);

    R.contextLossFlight = await ctxLoss(page);
    await sleep(500);
    await shot(page, key, 'flight-after-ctx-restore');
    const probe = await page.evaluate(() => window.__sm_fps);
    R.flightProbe = probe;

    await startAutopilot(page);
    await page.waitForFunction(() => window.__qaGame.getState().room?.stage === 'report', { timeout: 60_000, polling: 500 }).catch(async () => { R.notes.push('report via fast-forward'); await fastForwardToReport(page); });
    await sleep(3000);
    await check('report');
  } catch (e) {
    R.error = String(e.message ?? e).slice(0, 300);
    console.log(`${d.label}: ERROR ${R.error}`);
  }
  R.consoleErrors = page.qaLogs.filter((l) => /^(error|pageerror)/.test(l)).slice(0, 10);
  console.log(`${d.label}: auto=${JSON.stringify(R.auto)} keyboard=${JSON.stringify(R.keyboard)} fonts<16=${JSON.stringify(R.fontsBelow16)} ctx(constructor)=${JSON.stringify(R.contextLossConstructor)} ctx(flight)=${JSON.stringify(R.contextLossFlight)} probe=${JSON.stringify(R.flightProbe)} notes=${R.notes.join(' | ')} errors=${R.consoleErrors.length}`);
  await ctx.close();
}
await browser.close();
mkdirSync('scripts/qa/out', { recursive: true });
writeFileSync(arg('out', 'scripts/qa/out/mobile.json'), JSON.stringify(report, null, 1));
