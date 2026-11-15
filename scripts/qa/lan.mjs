// LAN check: the game opened over plain http from another device (insecure context) must still get a player id
// and let you start the demo. node scripts/qa/lan.mjs http://<LAN-IP>:<port>
import { launch, newPage, sleep } from './lib.mjs';
const url = process.argv[2];
const b = await launch(); const ctx = await b.createBrowserContext();
const p = await newPage(ctx, { width: 390, height: 844, dpr: 3, mobile: true, touch: true });
await p.goto(url, { waitUntil: 'load' });
await p.waitForSelector('.home-card input', { timeout: 60_000 });
await p.type('.home-card input', 'Аля');
await sleep(800);
const r = await p.evaluate(() => ({
  secure: isSecureContext, randomUUID: typeof crypto.randomUUID,
  demoEnabled: [...document.querySelectorAll('button')].some((x) => /Демо-режим/.test(x.textContent) && !x.disabled),
}));
let lobby = false;
if (r.demoEnabled) {
  await p.evaluate(() => [...document.querySelectorAll('button')].find((x) => /Демо-режим/.test(x.textContent)).click());
  lobby = await p.waitForFunction(() => document.querySelector('.app')?.getAttribute('data-stage') === 'lobby', { timeout: 10_000 }).then(() => true, () => false);
}
console.log(url, JSON.stringify({ ...r, lobby, errors: p.qaLogs.filter((l) => /error/.test(l)).slice(0, 3) }));
await b.close();
