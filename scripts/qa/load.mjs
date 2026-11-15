// Home screen load time on a slow network (production build). Usage:
//   pnpm exec vite build --outDir /tmp/sm-dist && pnpm exec vite preview --outDir /tmp/sm-dist --port 5191
//   BASE=http://localhost:5191 node scripts/qa/load.mjs [--net "Slow 4G"] [--cpu 4] [--runs 3]
// «Interactive» = the name field is rendered and the main thread has had no long task for 500 ms after it.
import { launch, newPage, sleep, BASE } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const NETS = arg('net', 'Slow 4G,Fast 4G').split(',');
const CPU = Number(arg('cpu', 4));
const RUNS = Number(arg('runs', 3));

const browser = await launch({ gpu: 'metal' });
for (const net of NETS) {
  const res = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.createBrowserContext(); // cold cache every run
    const page = await newPage(ctx, { cpu: CPU, net, width: 1366, height: 768 });
    await page.goto(BASE, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForSelector('.home-card input', { timeout: 120_000 });
    await sleep(1500);
    const r = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
      const res = performance.getEntriesByType('resource');
      const homeAt = window.__qaHomeAt ?? 0;
      const lt = window.__qa.longTasks;
      const lastLong = lt.filter(([s]) => s < homeAt + 500).reduce((m, [s, d]) => Math.max(m, s + d), 0);
      const kb = (f) => Math.round(res.filter(f).reduce((s, x) => s + (x.transferSize || 0), 0) / 1024);
      return {
        fcp: Math.round(fcp), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd),
        interactive: Math.round(Math.max(homeAt, lastLong)), longTasks: lt.length, longMs: Math.round(lt.reduce((s, [, d]) => s + d, 0)),
        requests: res.length + 1, totalKB: kb(() => true) + Math.round((nav.transferSize || 0) / 1024),
        jsKB: kb((x) => /\.js(\?|$)/.test(x.name)), fontKB: kb((x) => /font|woff/.test(x.name)), modelKB: kb((x) => /\.glb|manifest/.test(x.name)),
        jsFiles: res.filter((x) => /\.js(\?|$)/.test(x.name)).map((x) => `${x.name.split('/').pop()} ${Math.round(x.transferSize / 1024)}KB`),
      };
    });
    res.push(r);
    console.log(`${net} run ${i + 1}: FCP ${r.fcp} ms  DCL ${r.dcl}  load ${r.load}  interactive ${r.interactive} ms  long ${r.longTasks}/${r.longMs}ms  ${r.requests} req ${r.totalKB} KB (js ${r.jsKB}, fonts ${r.fontKB}, models ${r.modelKB})`);
    if (i === 0) console.log('   js:', r.jsFiles.join(', '));
    await ctx.close();
  }
  const med = (k) => res.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(res.length / 2)];
  console.log(`== ${net} ×${CPU} CPU, median: FCP ${med('fcp')} ms, interactive ${med('interactive')} ms, ${med('totalKB')} KB\n`);
}
await browser.close();
