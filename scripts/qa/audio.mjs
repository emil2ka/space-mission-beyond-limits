// Sound QA without ears: renders every synthesized one-shot and ambience layer offline (OfflineAudioContext, the game's
// own AudioEngine from src/audio/engine.ts, including its compressor) and measures peak / RMS / loudness / clipping / DC.
// Also checks the live page: no AudioContext before a gesture, running after a click, mute / master volume reach the output.
// Needs the dev server. Usage: node scripts/qa/audio.mjs [--vol default|max] [--soft] [--out file.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { BASE, launch, newPage, sleep } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const VOL = arg('vol', 'both');
const SOFT = process.argv.includes('--soft');

const browser = await launch({ gpu: 'metal' });
const page = await newPage(browser, { width: 1280, height: 800 });
await page.goto(`${BASE}/?dev=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__smAudio, { timeout: 60_000 });
await sleep(800);

// ── 1. Live page: autoplay policy, gesture, mute, master volume ──
const live = {};
live.beforeGesture = await page.evaluate(() => window.__smAudio.state);
await page.mouse.click(5, 700);
await sleep(1500);
live.afterGesture = await page.evaluate(() => window.__smAudio.state);
live.levelHq = await page.evaluate(() => window.__smAudio.level());
await page.evaluate(() => window.__smSettings.getState().setSound({ soundOn: false }));
await sleep(800);
live.levelMuted = await page.evaluate(() => window.__smAudio.level());
await page.evaluate(() => window.__smSettings.getState().setSound({ soundOn: true, masterVolume: 0 }));
await sleep(800);
live.levelMaster0 = await page.evaluate(() => window.__smAudio.level());
await page.evaluate(() => window.__smSettings.getState().setSound({ masterVolume: 0.6, ambienceVolume: 0 }));
await sleep(2500);
live.levelAmb0 = await page.evaluate(() => window.__smAudio.level());
await page.evaluate(() => window.__smSettings.getState().setSound({ masterVolume: 0.6, ambienceVolume: 0.5, sfxVolume: 0.7 }));
live.consoleAudio = page.qaLogs.filter((l) => /audio|AudioContext/i.test(l));

// ── 2. Offline renders ──
const render = async (vol, jobs) => page.evaluate(async (vol, jobs, soft) => {
  const loaded = performance.getEntriesByType('resource').map((r) => r.name);
  const url = (p) => loaded.find((n) => new URL(n).pathname === p) ?? p;
  const { AudioEngine } = await import(url('/src/audio/engine.ts'));
  const { SILENT } = await import(url('/src/audio/events.ts'));
  const SR = 48000;

  // ITU-R BS.1770 K-weighting at 48 kHz (shelf + high-pass), then mean square per 400 ms block.
  const biquad = (x, b, a) => { const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y; };
  const kw = (x) => biquad(biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]), [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
  const db = (v) => (v > 0 ? +(10 * Math.log10(v)).toFixed(1) : -Infinity);

  function analyse(buf, from) {
    const chs = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c).subarray(Math.floor(from * SR)));
    const x = chs[0];
    let peak = 0, sum = 0, dc = 0, clip = 0, last = 0;
    for (const ch of chs) for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; if (v >= 0.999) clip++; }
    for (let i = 0; i < x.length; i++) { sum += x[i] * x[i]; dc += x[i]; if (Math.abs(x[i]) > 0.001) last = i; }
    // RMS over the audible part only (until it decays below −60 dBFS).
    let act = 0; for (let i = 0; i <= last; i++) act += x[i] * x[i];
    const k = chs.map(kw);
    const block = 0.4 * SR, hop = 0.1 * SR;
    const ms = [];
    for (let s = 0; s + block <= x.length; s += hop) { let e = 0; for (const ch of k) for (let i = s; i < s + block; i++) e += ch[i] * ch[i]; ms.push(e / block); }
    const lufs = (m) => -0.691 + 10 * Math.log10(m);
    const momentaryMax = ms.length ? lufs(Math.max(...ms)) : -Infinity;
    const abs = ms.filter((m) => lufs(m) > -70);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    let integrated = -Infinity;
    if (abs.length) { const rel = lufs(mean(abs)) - 10; const g = abs.filter((m) => lufs(m) > rel); if (g.length) integrated = lufs(mean(g)); }
    return {
      peakDb: db(peak * peak), rmsDb: db(act / Math.max(1, last + 1)), lufsI: +integrated.toFixed(1), lufsMmax: +momentaryMax.toFixed(1),
      clip, dc: +(dc / x.length).toExponential(1), durS: +((last + 1) / SR).toFixed(2),
    };
  }

  const out = [];
  const RealAC = window.AudioContext;
  for (const job of jobs) {
    let ctx;
    window.AudioContext = function () {
      ctx = new OfflineAudioContext(2, Math.ceil(SR * job.dur), SR);
      Object.defineProperty(ctx, 'state', { get: () => 'running' });
      ctx.resume = async () => {};
      return ctx;
    };
    const e = new AudioEngine();
    try {
      e.unlock();
      e.setGate({ ambience: true, sfx: true });
      e.setVolumes({ on: true, soft, ...vol });
      // Skip the 80 ms volume ramps so a one-shot at t=0.02 plays at full level.
      for (const [g, v] of [[e.master, vol.master * 0.55], [e.ambBus, vol.ambience], [e.sfxBus, vol.sfx * (soft ? 0.75 : 1)]]) { g.gain.cancelScheduledValues(0); g.gain.setValueAtTime(v, 0); }
      if (job.layers) e.setLayers({ ...SILENT, ...job.layers });
      if (job.at) {
        // One-shot on top of loops at steady state: pause the offline render at `at`, play, go on.
        void ctx.suspend(job.at).then(() => { for (const id of job.sfx ?? []) e.play(id, true); return OfflineAudioContext.prototype.resume.call(ctx); });
      } else for (const id of job.sfx ?? []) e.play(id, true);
      const buf = await ctx.startRendering();
      out.push({ name: job.name, ...analyse(buf, job.from ?? 0) });
    } catch (err) {
      out.push({ name: job.name, error: String(err) });
    } finally {
      window.AudioContext = RealAC;
    }
  }
  return out;
}, vol, jobs, SOFT);

const sfxIds = await page.evaluate(async () => {
  const loaded = performance.getEntriesByType('resource').map((r) => r.name);
  const u = loaded.find((n) => new URL(n).pathname === '/src/audio/events.ts') ?? '/src/audio/events.ts';
  return (await import(u)).ALL_SFX;
});
const LOOPS = [
  ['amb:hq', { ambience: 'hq' }], ['amb:space', { ambience: 'space' }], ['amb:titan', { ambience: 'titan' }], ['amb:earth', { ambience: 'earth' }],
  ['rain (storm)', { rain: 1 }], ['rotor', { rotor: 1 }], ['drive:ion', { drive: 'ion' }], ['drive:chem', { drive: 'chem' }],
  ['static (lost)', { static: 1 }], ['reentry', { reentry: 1 }],
  ['MIX titan storm+rotor+static', { ambience: 'titan', rain: 1, rotor: 1, static: 1 }],
];
const jobs = [
  ...sfxIds.map((id) => ({ name: id, sfx: [id], dur: id === 'launch' ? 16 : id.startsWith('outcome') ? 6 : 3 })),
  // Loops: fade-in uses setTargetAtTime(·, 0.6 s): measure from 4 s (≈ steady state).
  ...LOOPS.map(([name, layers]) => ({ name, layers, dur: 10, from: 4 })),
  { name: 'WORST: crisis over titan storm+rotor+static', layers: { ambience: 'titan', rain: 1, rotor: 1, static: 1 }, sfx: ['crisis'], at: 4, dur: 8, from: 4 },
  { name: 'WORST: outcome-perfect over hq', layers: { ambience: 'hq' }, sfx: ['outcome-perfect'], at: 4, dur: 10, from: 4 },
  { name: 'WORST: launch over earth wind', layers: { ambience: 'earth' }, sfx: ['launch'], dur: 16 },
];

const results = {};
const VOLS = { default: { master: 0.6, ambience: 0.5, sfx: 0.7 }, max: { master: 1, ambience: 1, sfx: 1 } };
for (const v of VOL === 'both' ? ['default', 'max'] : [VOL]) results[v] = await render(VOLS[v], jobs);
await browser.close();

console.log('live:', JSON.stringify(live));
const f = (x) => (x === -Infinity || x === null ? '−∞' : String(x));
for (const [v, rows] of Object.entries(results)) {
  console.log(`\n== volumes ${v}${SOFT ? ' (soft)' : ''}: name | peak dBFS | RMS dBFS | LUFS-I | LUFS-M max | clip | DC | dur s`);
  for (const r of rows) console.log(r.error ? `${r.name}: ERROR ${r.error}` : `${r.name.padEnd(44)} ${f(r.peakDb).padStart(6)} ${f(r.rmsDb).padStart(6)} ${f(r.lufsI).padStart(6)} ${f(r.lufsMmax).padStart(6)} ${String(r.clip).padStart(4)} ${String(r.dc).padStart(8)} ${r.durS}`);
}
mkdirSync('scripts/qa/out', { recursive: true });
const out = arg('out', `scripts/qa/out/audio${SOFT ? '-soft' : ''}.json`);
writeFileSync(out, JSON.stringify({ live, results }, null, 1));
console.log(`→ ${out}`);
