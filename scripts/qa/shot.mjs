// Quick screenshot of a screen: node scripts/qa/shot.mjs <scene> <out.jpg> [q] [w] [h]  (scenes as in perf.mjs; dev server)
import { hookStore, launch, newPage, presetStorage, sleep, toBuild, toLobby, BASE } from './lib.mjs';
const [, , scene = 'build-titan', out = 'scripts/qa/out/shot.jpg', q = 'low', w = '1366', h = '768'] = process.argv;
const b = await launch({ gpu: 'metal' });
const p = await newPage(b, { width: +w, height: +h });
await presetStorage(p, { 'sm:graphics': q, 'sm:soundOn': '0' });
await p.goto(`${BASE}/?dev=1`); await hookStore(p); await toLobby(p);
if (scene.startsWith('build')) await toBuild(p, scene.split('-')[1]);
await sleep(3000);
await p.screenshot({ path: out, type: 'jpeg', quality: 70 });
console.log(await p.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, stage: window.__qaGame.getState().room?.stage, probe: window.__sm_fps })), p.qaLogs.slice(0, 8));
await b.close();
