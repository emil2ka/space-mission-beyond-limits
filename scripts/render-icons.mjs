#!/usr/bin/env node
// pnpm icons:modules [id ...] [--url http://localhost:5188] [--sheet-only] [--chrome /path/to/chrome]
// Renders catalog card icons from the real module GLBs in the game's toon look (scripts/icon-render/), via headless Chrome:
//   public/icons/modules/<componentId>.webp (128 px) + <componentId>@2x.webp (256 px) + index.json
//   docs/05 Assets/UI/kit/shots/module-icons-sheet.jpg (contact sheet of every icon)
// No extra dependencies: a Vite dev server (own cache dir, so a running `pnpm dev` is not disturbed) + system Chrome over CDP.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'public', 'icons', 'modules');
const SHEET = join(ROOT, 'docs', '05 Assets', 'UI', 'kit', 'shots', 'module-icons-sheet.jpg');
const argv = process.argv.slice(2);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const only = argv.filter((a, i) => !a.startsWith('--') && !['--url', '--chrome'].includes(argv[i - 1]));
const sheetOnly = argv.includes('--sheet-only');
const CHROME = opt('--chrome') ?? process.env.CHROME_PATH ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => existsSync(p));
if (!CHROME) { console.error('Chrome not found: pass --chrome <path> or CHROME_PATH'); process.exit(1); }

// ---------- page server ----------
let server = null;
let base = opt('--url');
if (!base) {
  const { createServer } = await import('vite');
  server = await createServer({
    root: ROOT, configFile: join(ROOT, 'vite.config.ts'), cacheDir: join(ROOT, 'node_modules', '.vite-icons'),
    server: { port: 0, host: '127.0.0.1', hmr: false }, logLevel: 'warn', clearScreen: false,
  });
  await server.listen();
  const addr = server.httpServer.address();
  base = `http://127.0.0.1:${addr.port}`;
}
const pageUrl = `${base.replace(/\/$/, '')}/scripts/icon-render/index.html`;

// ---------- headless Chrome + minimal CDP client ----------
const profile = mkdtempSync(join(tmpdir(), 'sm-icons-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--mute-audio', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
  '--window-size=800,800', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((ok, bad) => {
  let buf = '';
  const t = setTimeout(() => bad(new Error('Chrome did not start')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) { clearTimeout(t); ok(m[1]); }
  });
  chrome.on('exit', (c) => bad(new Error(`Chrome exited ${c}`)));
});

const ws = new WebSocket(wsUrl);
await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
let seq = 0;
const waiting = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && waiting.has(msg.id)) {
    const { ok, bad } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? bad(new Error(msg.error.message)) : ok(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') console.warn('[page]', msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
  else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) console.warn('[page]', msg.params.args.map((a) => a.value ?? a.description).join(' '));
};
const send = (method, params = {}, sessionId) => new Promise((ok, bad) => {
  const id = ++seq;
  waiting.set(id, { ok, bad });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

async function cleanup() {
  try { ws.close(); } catch { /* closed */ }
  chrome.kill();
  if (server) await server.close();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(profile, { recursive: true, force: true });
}

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: pageUrl }, sessionId);
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  for (let i = 0; i < 200 && !(await evaluate('window.__iconReady === true')); i++) await new Promise((r) => setTimeout(r, 250));
  const jobs = await evaluate('window.__iconJobs()');
  console.log(`${jobs.length} icons (${jobs.filter((j) => j.key.includes('__')).length} mission variants)`);
  mkdirSync(OUT, { recursive: true });

  const indexPath = join(OUT, 'index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
  const flags = {};
  for (const job of jobs) {
    if (sheetOnly || (only.length && !only.includes(job.key) && !only.includes(job.model))) continue;
    const r = await evaluate(`window.__iconRender(${JSON.stringify(job.key)})`);
    const b1 = Buffer.from(r.x1.split(',')[1], 'base64');
    const b2 = Buffer.from(r.x2.split(',')[1], 'base64');
    writeFileSync(join(OUT, `${job.key}.webp`), b1);
    writeFileSync(join(OUT, `${job.key}@2x.webp`), b2);
    const flag = r.touchesEdge ? 'cropped' : r.lum < 0.12 ? 'dark' : r.cover < 0.08 ? 'small' : '';
    if (flag) flags[job.key] = flag;
    index[job.key] = {
      '1x': `${job.key}.webp`, '2x': `${job.key}@2x.webp`, size: [128, 128],
      source: `public/models/${job.model}.glb`, department: job.department,
      lum: Math.round(r.lum * 100) / 100, cover: Math.round(r.cover * 100) / 100,
    };
    console.log(`${job.key.padEnd(30)} ${String(b1.length).padStart(6)} + ${String(b2.length).padStart(6)} B  lum ${r.lum.toFixed(2)} cover ${r.cover.toFixed(2)}${flag ? `  ⚠ ${flag}` : ''}`);
  }
  // Keep index order = catalog order; drop entries for modules that no longer exist.
  const ordered = Object.fromEntries(jobs.filter((j) => index[j.key]).map((j) => [j.key, index[j.key]]));
  writeFileSync(indexPath, JSON.stringify(ordered, null, 1) + '\n');
  // The UI's list of ids that have a file (so it never requests a missing one; a 404 still falls back to the department icon).
  writeFileSync(join(ROOT, 'src', 'ui', 'kit', 'moduleIconIds.ts'), [
    '// Generated by scripts/render-icons.mjs (pnpm icons:modules) — do not edit by hand.',
    '// Component ids (and `<id>__<mission>` variants) with an icon in public/icons/modules/.',
    `export const MODULE_ICON_IDS: ReadonlySet<string> = new Set([`,
    ...Object.keys(ordered).map((k) => `  '${k}',`),
    ']);',
    '',
  ].join('\n'));

  // Contact sheet from the files on disk (so it shows exactly what ships).
  const items = jobs.filter((j) => ordered[j.key]).map((j) => ({
    key: j.key, name: j.name,
    x1: `data:image/webp;base64,${readFileSync(join(OUT, `${j.key}.webp`)).toString('base64')}`,
    x2: `data:image/webp;base64,${readFileSync(join(OUT, `${j.key}@2x.webp`)).toString('base64')}`,
    flag: flags[j.key],
  }));
  const jpg = await evaluate(`window.__iconSheet(${JSON.stringify(items)})`);
  mkdirSync(join(SHEET, '..'), { recursive: true });
  writeFileSync(SHEET, Buffer.from(jpg.split(',')[1], 'base64'));

  let total = 0;
  for (const j of jobs) for (const f of [`${j.key}.webp`, `${j.key}@2x.webp`]) if (existsSync(join(OUT, f))) total += statSync(join(OUT, f)).size;
  console.log(`total ${(total / 1024).toFixed(0)} KB in ${OUT}`);
  console.log(`sheet ${SHEET}`);
  if (Object.keys(flags).length) console.log('check:', flags);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await cleanup();
}
