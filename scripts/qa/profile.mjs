// CPU profile of one screen (top self-time functions). node scripts/qa/profile.mjs <scene> [q] [cpu]   (scenes as in perf.mjs)
import { BASE, dispatch, hookStore, launch, newPage, presetStorage, sleep, startAutopilot, toBuild, toLaunch, toLobby, waitStage } from './lib.mjs';
const [, , scene = 'flight-titan', q = 'low', cpu = '6'] = process.argv;
const b = await launch({ gpu: 'metal' });
const ctx = await b.createBrowserContext();
const p = await newPage(ctx, { cpu: +cpu });
await presetStorage(p, { 'sm:graphics': q, 'sm:soundOn': '0' });
await p.goto(`${BASE}/?dev=1`); await hookStore(p); await toLobby(p);
const mission = scene.endsWith('asteroid') ? 'asteroid' : 'titan';
await toBuild(p, mission);
if (scene.startsWith('flight') || scene === 'launch') { await toLaunch(p); await waitStage(p, 'launch'); }
if (scene.startsWith('flight')) { await dispatch(p, [{ type: 'launchDone' }]); await waitStage(p, 'flight'); await startAutopilot(p); }
await sleep(4000);
await p.cdp.send('Profiler.enable'); await p.cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await p.cdp.send('Profiler.start'); await sleep(6000);
const { profile } = await p.cdp.send('Profiler.stop');
const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; let total = 0;
profile.samples.forEach((id, i) => { const n = byId.get(id); const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/').split('?')[0]}:${f.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + dt[i]); total += dt[i]; });
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [k, v] of top) console.log(`${(v / 1000).toFixed(0).padStart(6)} ms ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
console.log('stage', await p.evaluate(() => window.__qaGame.getState().room?.stage), 'probe', await p.evaluate(() => JSON.stringify(window.__sm_fps)));
await b.close();
