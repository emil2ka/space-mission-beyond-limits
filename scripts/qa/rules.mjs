// Decision 0013 in a real browser: several tabs of one Chrome (LocalTransport / BroadcastChannel), 2 and 3 players.
// Checks: free roles in the lobby, a foreign-department request approved and vetoed (toasts), the budget split,
// the second key at low Team Trust, role tabs for a two-role player, the report's per-player card.
// node scripts/qa/rules.mjs   (dev server on BASE, default http://localhost:5188; screenshots → docs/05 Assets/UI/kit/shots/rules/)
import { mkdirSync } from 'node:fs';
import { hookStore, launch, newPage, presetStorage, sleep, BASE } from './lib.mjs';

const OUT = 'docs/05 Assets/UI/kit/shots/rules';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`); };
const shot = async (p, name) => { await p.bringToFront(); await sleep(300); return p.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 55 }); };
const room = (p) => p.evaluate(() => window.__qaGame.getState().room);
const act = (p, a) => p.evaluate((a) => window.__qaGame.getState().dispatch(a), a);
const until = async (p, fn, arg, timeout = 15_000) => p.waitForFunction(fn, { timeout, polling: 100 }, arg);
// Input events only reach the front tab (a background headless tab gets no frames): bring it forward first.
const click = async (p, sel) => { await p.bringToFront(); await p.waitForSelector(sel, { visible: true, timeout: 10_000 }); await p.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await p.click(sel); };

const OVER = { heater: 1, rtg: 2, battery_hc: 2, power_bus: 1, pdu: 1, rotor_system: 1, flight_computer: 1, imu: 1, wide_camera: 1, transceiver: 1, antenna_high_gain: 1, thermal_insulation: 1, data_storage: 1 };

async function tab(browser, name) {
  const p = await newPage(browser, { width: 1366, height: 860 });
  await presetStorage(p, { 'sm:graphics': 'low', 'sm:soundOn': '0' });
  await p.goto(`${BASE}/?dev=1&speed=8`);
  await hookStore(p);
  await p.evaluate(async (name) => {
    const G = window.__qaGame;
    for (let i = 0; i < 100 && !G.getState().me.id; i++) await new Promise((r) => setTimeout(r, 50));
    G.getState().setName(name);
  }, name);
  return p;
}

/** Host creates a real (non-demo) room, the others join by code. */
async function team(browser, names) {
  const pages = [];
  for (const n of names) pages.push(await tab(browser, n));
  await pages[0].evaluate(() => window.__qaGame.getState().create());
  await until(pages[0], () => window.__qaGame.getState().room?.stage === 'lobby');
  const code = (await room(pages[0])).code;
  for (const p of pages.slice(1)) {
    await p.evaluate((c) => window.__qaGame.getState().join(c), code);
    await until(p, () => !!window.__qaGame.getState().room);
  }
  await until(pages[0], (n) => window.__qaGame.getState().room.players.length === n, names.length);
  return pages;
}

async function installAs(p, build) {
  await p.evaluate(async (build) => {
    const d = window.__qaGame.getState().dispatch;
    for (const [id, n] of Object.entries(build)) for (let i = 0; i < n; i++) { d({ type: 'addComponent', id }); await new Promise((r) => setTimeout(r, 25)); }
  }, build);
}

/** Launch cutscene on the host's front tab; if it has not ended in 20 s (headless GPU), the host skips it as a player can. */
async function toFlight(host) {
  try { await until(host, () => window.__qaGame.getState().room?.stage === 'flight', undefined, 20_000); }
  catch { await act(host, { type: 'launchDone' }); await until(host, () => window.__qaGame.getState().room?.stage === 'flight'); }
}

/** QA only: lower Team Trust on the host (the next action publishes it to everyone). Real play gets there by −15 per risk that came true. */
async function setTrust(host, v) {
  await host.evaluate((v) => { const G = window.__qaGame; G.setState({ room: { ...G.getState().room, teamTrust: v } }); }, v);
}

// ───────────── 3 players: A commander, B engineer (+comms from the host), C science ─────────────
{
  const browser = await launch({ gpu: 'metal' });
  const [A, B, C] = await team(browser, ['Аля', 'Борис', 'Вера']);
  await act(A, { type: 'pickRole', role: 'commander' }); await act(B, { type: 'pickRole', role: 'engineer' }); await act(C, { type: 'pickRole', role: 'science' });
  for (const p of [A, B, C]) await act(p, { type: 'setReady', ready: true });
  await until(A, () => window.__qaGame.getState().room.players.every((p) => p.ready));
  await sleep(400);
  const lobbyText = await A.evaluate(() => document.querySelector('[data-testid="lobby-free-roles"]')?.textContent ?? '');
  check('3p lobby: free role «Специалист связи» with a default owner', /Специалист связи/.test(lobbyText) && /по умолчанию/.test(lobbyText), lobbyText.slice(0, 90));
  // The host gives comms to Борис through the lobby control.
  await A.bringToFront(); await A.select('[data-testid="assign-comms"]', (await room(A)).players.find((p) => p.name === 'Борис').id);
  await until(A, () => window.__qaGame.getState().room.players.find((p) => p.name === 'Борис').roles.length === 2);
  check('3p lobby: host assigned comms to Борис, his READY reset', !(await room(A)).players.find((p) => p.name === 'Борис').ready);
  await act(B, { type: 'setReady', ready: true });
  await sleep(500);
  await shot(A, '3p-lobby-host');
  await act(A, { type: 'goStage', stage: 'briefing' });
  await act(A, { type: 'goStage', stage: 'build' });
  await until(B, () => window.__qaGame.getState().room?.stage === 'build');
  await sleep(1500);

  // Commander: budget split at the start of the constructor.
  const splitOpen = await A.$('[data-testid="split-confirm"]');
  check('3p build: the commander sees the budget split editor at the start', !!splitOpen);
  await A.evaluate(() => document.querySelector('[data-testid="rules-panel"]')?.scrollIntoView({ block: 'start' }));
  await shot(A, '3p-build-commander-split');
  await click(A, '[data-testid="split-confirm"]');
  await until(A, () => window.__qaGame.getState().room.budgetSplit?.set === true);
  check('3p build: split confirmed by the commander', (await room(A)).budgetSplit?.set === true);

  // Борис (engineer + comms) opens «Наука» — badges say «через командира».
  await B.evaluate(() => [...document.querySelectorAll('.tabs--rail .tab')].find((t) => /Наука/.test(t.textContent))?.click());
  await sleep(300);
  const badge = await B.evaluate(() => document.querySelector('[data-testid="own-atmo_sensor"]')?.textContent ?? '');
  check('3p build: Борис sees «через командира» on a science card', /через командира/.test(badge), badge);
  await B.evaluate(() => document.querySelector('[aria-label^="Запросить у командира: поставить Atmospheric Sensor"]')?.click());
  await until(A, () => (window.__qaGame.getState().room.requests ?? []).some((r) => r.status === 'pending'));
  await sleep(600);
  await shot(B, '3p-build-engineer-request-badges');
  await A.evaluate(() => document.querySelector('[data-testid="request-queue"]')?.scrollIntoView({ block: 'center' }));
  await shot(A, '3p-build-commander-queue');
  // Commander approves in the queue.
  await click(A, '[data-testid="req-approve"]');
  await until(B, () => (window.__qaGame.getState().room.requests ?? []).some((r) => r.status === 'approved'));
  await sleep(500);
  const bToast = await B.evaluate(() => document.querySelector('[data-testid="rules-toasts"]')?.textContent ?? '');
  check('3p build: approved request → toast for Борис, module installed', /Запрос одобрен/.test(bToast) && (await room(B)).build.atmo_sensor === 1, bToast.slice(0, 80));
  await shot(B, '3p-build-engineer-toast-approved');

  // Вера (science) asks for a heater (structure = engineer's department); the commander vetoes with a reason.
  await act(C, { type: 'addComponent', id: 'heater' });
  await until(A, () => (window.__qaGame.getState().room.requests ?? []).some((r) => r.status === 'pending'));
  await sleep(400);
  const engSees = await B.evaluate(() => document.querySelector('[data-testid="request-queue"]')?.textContent ?? '');
  check('3p build: the department owner (Борис) sees the request in his department', /в вашем отделе/.test(engSees));
  await click(A, '[data-testid="req-veto"]');
  await A.bringToFront(); await A.type('[data-testid="veto-reason"]', 'Тепла хватает — бережём энергию');
  await click(A, '[data-testid="veto-send"]');
  await until(C, () => (window.__qaGame.getState().room.requests ?? []).some((r) => r.status === 'vetoed'));
  await sleep(500);
  const cToast = await C.evaluate(() => document.querySelector('[data-testid="rules-toasts"]')?.textContent ?? '');
  check('3p build: veto with reason → toast for Вера', /Вето командира/.test(cToast) && /бережём энергию/.test(cToast), cToast.slice(0, 90));
  await shot(C, '3p-build-science-toast-veto');

  // The commander installs a risky craft (bus overload), Team Trust 40 → the second key of the engineer.
  await installAs(A, OVER);
  await setTrust(A, 40);
  await act(A, { type: 'submitReview' });
  await until(B, () => window.__qaGame.getState().room?.stage === 'review');
  await sleep(1200);
  const hint = await A.$('[data-testid="key-hint"]');
  check('3p review: commander warned that a second key will be needed (trust 40)', !!hint);
  await A.evaluate(() => document.querySelector('.decision .checkbox input')?.click());
  await sleep(200);
  await A.evaluate(() => [...document.querySelectorAll('.decision .btn--primary')].find((b) => /Утвердить/.test(b.textContent))?.click());
  await until(B, () => !!window.__qaGame.getState().room?.pendingKey);
  await sleep(600);
  const keyCard = await B.evaluate(() => document.querySelector('[data-testid="second-key"]')?.textContent ?? '');
  check('3p review: Борис (engineer) is asked for the second key', /Повернуть ключ/.test(keyCard));
  await shot(B, '3p-review-second-key-owner');
  await shot(A, '3p-review-second-key-commander');
  await click(B, '[data-testid="key-give"]');
  await until(A, () => ['launch', 'flight'].includes(window.__qaGame.getState().room?.stage), undefined, 20_000);
  const dl = (await room(A)).decisionLog.at(-1);
  check('3p review: the key launched it; decision records the key', dl?.kind === 'approve-against-warning' && dl.keys?.length === 1);

  // Flight: Борис has two roles → tabs. The launch cutscene runs on the host's front tab (rAF), then the host sends launchDone.
  await A.bringToFront();
  await toFlight(A);
  await until(B, () => window.__qaGame.getState().room?.stage === 'flight', undefined, 40_000);
  await sleep(2500);
  const tabs = await B.evaluate(() => [...document.querySelectorAll('[data-testid^="role-tab-"]')].map((t) => t.getAttribute('data-testid')));
  check('3p flight: Борис sees role tabs engineer + comms', tabs.join() === 'role-tab-engineer,role-tab-comms', tabs.join());
  await shot(B, '3p-flight-two-roles-engineer-tab');
  await click(B, '[data-testid="role-tab-comms"]');
  await sleep(500);
  const commsPanel = await B.evaluate(() => document.querySelector('.mc-panel .card__title')?.textContent ?? '');
  check('3p flight: the comms tab shows the comms panel', /связи/i.test(commsPanel), commsPanel);
  const radios = await B.evaluate(() => document.querySelectorAll('.radio').length);
  check('3p flight: radio phrases of both roles', radios === 2, `${radios} radio blocks`);
  await shot(B, '3p-flight-two-roles-comms-tab');
  // Wait for a crisis: the tab of a role that must answer gets «!».
  try {
    await until(B, () => !!window.__qaGame.getState().room?.flight?.crisis, undefined, 90_000);
    await sleep(1200);
    const alert = await B.evaluate(() => document.querySelectorAll('.role-tabs__alert').length);
    check('3p flight: crisis → «!» on the tab(s) that must answer', alert > 0, `${alert} tab(s)`);
    await shot(B, '3p-flight-crisis-tabs');
  } catch { check('3p flight: crisis reached', false, 'no crisis within 90 s'); }
  const aTrust = await A.evaluate(() => document.querySelector('[data-testid="flight-trust"]')?.textContent ?? '');
  check('3p flight: commander panel shows the Team Trust tier', /Под наблюдением/.test(aTrust), aTrust);
  await shot(A, '3p-flight-commander-trust');
  console.log('logs A', A.qaLogs.slice(0, 5), 'B', B.qaLogs.slice(0, 5));
  await browser.close();
}

// ───────────── 2 players: A commander (+engineer by default), B science (+comms) ─────────────
{
  const browser = await launch({ gpu: 'metal' });
  const [A, B] = await team(browser, ['Аля', 'Борис']);
  await act(A, { type: 'pickRole', role: 'commander' }); await act(B, { type: 'pickRole', role: 'science' });
  for (const p of [A, B]) await act(p, { type: 'setReady', ready: true });
  await until(A, () => window.__qaGame.getState().room.players.every((p) => p.ready));
  await sleep(500);
  const startOk = await A.evaluate(() => !document.querySelector('.action-bar .btn--primary')?.disabled);
  check('2p lobby: the host can start with 2 ready players', startOk);
  await shot(A, '2p-lobby-host');
  await act(A, { type: 'goStage', stage: 'briefing' });
  await act(A, { type: 'goStage', stage: 'build' });
  await until(B, () => window.__qaGame.getState().room?.stage === 'build');
  const roles = (await room(A)).players.map((p) => `${p.name}:${p.roles.join('+')}`).join(' ');
  check('2p start: balanced default — Аля commander+engineer, Борис science+comms', roles === 'Аля:commander+engineer Борис:science+comms', roles);
  await sleep(1200);
  await click(A, '[data-testid="split-confirm"]');
  // Борис asks for an RTG (engineer's department, held by the commander) → veto.
  await act(B, { type: 'addComponent', id: 'rtg' });
  await until(A, () => (window.__qaGame.getState().room.requests ?? []).some((r) => r.status === 'pending'));
  await sleep(500);
  await click(A, '[data-testid="req-veto"]');
  await A.bringToFront(); await A.type('[data-testid="veto-reason"]', 'Питание ставит инженер');
  await click(A, '[data-testid="veto-send"]');
  await until(B, () => (window.__qaGame.getState().room.requests ?? []).some((r) => r.status === 'vetoed'));
  await sleep(400);
  const bt = await B.evaluate(() => document.querySelector('[data-testid="rules-toasts"]')?.textContent ?? '');
  check('2p build: foreign request vetoed → toast', /Вето командира/.test(bt));
  // Own department (comms) at once.
  await act(B, { type: 'addComponent', id: 'transceiver' });
  await until(A, () => (window.__qaGame.getState().room.build.transceiver ?? 0) === 1);
  check('2p build: Борис installs his own comms module at once', true);
  // Second request, approved this time.
  await act(B, { type: 'addComponent', id: 'thermal_radiator' });
  await until(A, () => (window.__qaGame.getState().room.requests ?? []).some((r) => r.status === 'pending'));
  await sleep(400);
  await click(A, '[data-testid="req-approve"]');
  await until(B, () => (window.__qaGame.getState().room.build.thermal_radiator ?? 0) === 1);
  check('2p build: second request approved → installed', true);
  // Phone width: the commander's rules panel (queue + split) on Борис's next request.
  await act(B, { type: 'addComponent', id: 'heater' });
  await until(A, () => (window.__qaGame.getState().room.requests ?? []).some((r) => r.status === 'pending'));
  await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 }); // isMobile would reload the page
  await sleep(1200);
  await A.evaluate(() => document.querySelector('[data-testid="request-queue"]')?.scrollIntoView({ block: 'center' }));
  await shot(A, '2p-build-commander-phone');
  await A.setViewport({ width: 1366, height: 860, deviceScaleFactor: 1 });
  await act(A, { type: 'resolveRequest', requestId: (await room(A)).requests.find((r) => r.status === 'pending').id, approve: false, reason: 'Хватит тепла' });
  await sleep(600);
  await installAs(A, OVER);
  await setTrust(A, 30);
  await act(A, { type: 'submitReview' });
  await until(B, () => window.__qaGame.getState().room?.stage === 'review');
  await sleep(1000);
  await A.evaluate(() => document.querySelector('.decision .checkbox input')?.click());
  await sleep(200);
  await A.evaluate(() => [...document.querySelectorAll('.decision .btn--primary')].find((b) => /Утвердить/.test(b.textContent))?.click());
  await until(B, () => !!window.__qaGame.getState().room?.pendingKey);
  const pk = (await room(A)).pendingKey;
  check('2p review: the commander holds the engineer role himself → any other player turns the key', pk?.any === true && pk.need.length === 1);
  await sleep(500);
  await click(B, '[data-testid="key-deny"]');
  await B.bringToFront(); await B.type('[data-testid="key-reason"]', 'Шина сгорит в шторм');
  await click(B, '[data-testid="key-deny-send"]');
  await until(A, () => !window.__qaGame.getState().room?.pendingKey);
  await sleep(500);
  const at = await A.evaluate(() => document.querySelector('[data-testid="rules-toasts"]')?.textContent ?? '');
  check('2p review: key refused → commander toast with the reason; still in review', /Второй ключ не дан/.test(at) && (await room(A)).stage === 'review', at.slice(0, 80));
  await shot(A, '2p-review-key-denied-commander');
  // Second attempt: Борис gives the key.
  const again = await A.evaluate(() => {
    const b = [...document.querySelectorAll('.decision .btn--primary')].find((x) => /Утвердить/.test(x.textContent));
    const info = { found: !!b, disabled: b?.disabled, ack: document.querySelector('.decision .checkbox input')?.checked };
    b?.click();
    return info;
  });
  try { await until(B, () => !!window.__qaGame.getState().room?.pendingKey, undefined, 5000); }
  catch {
    console.log('second approve click did not reach the engine', again, await A.evaluate(() => window.__qaGame.getState().error));
    await act(A, { type: 'approve' });
    await until(B, () => !!window.__qaGame.getState().room?.pendingKey);
  }
  await sleep(300);
  await click(B, '[data-testid="key-give"]');
  await A.bringToFront();
  await toFlight(A);
  await sleep(2500);
  const tabsA = await A.evaluate(() => [...document.querySelectorAll('[data-testid^="role-tab-"]')].map((t) => t.getAttribute('data-testid')).join());
  check('2p flight: Аля has tabs commander + engineer', tabsA === 'role-tab-commander,role-tab-engineer', tabsA);
  await shot(A, '2p-flight-commander-tab');
  await click(A, '[data-testid="role-tab-engineer"]');
  await sleep(500);
  await shot(A, '2p-flight-engineer-tab');
  // Fly to the end through the engine on the host (same reducer), then read the report on the host tab.
  await A.evaluate(() => {
    const G = window.__qaGame, E = window.__qaEngine;
    let s = G.getState().room;
    const ids = s.players.map((p) => p.id);
    const ap = (a) => { const r = E.reduce(s, a, Date.now()); if (!r.error) s = r.state; };
    for (let i = 0; i < 4000 && s.stage === 'flight'; i++) {
      const c = s.flight.crisis;
      if (c) for (const id of ids) for (const role of s.players.find((p) => p.id === id).roles) { const o = !c.chosen?.[role] && c.options.find((x) => x.role === role); if (o) ap({ type: 'crisisChoice', playerId: id, optionId: o.id }); }
      ap({ type: 'tick', playerId: s.hostId });
    }
    G.setState({ room: s });
  });
  await sleep(2500);
  const players = await A.evaluate(() => document.querySelector('[data-testid="report-players"]')?.textContent ?? '');
  check('2p report: contribution per player with both roles', /Аля/.test(players) && /Борис/.test(players) && /запросов командиру: 3/.test(players), players.slice(0, 120));
  const decisions = await A.evaluate(() => document.querySelector('.report-left')?.textContent ?? '');
  check('2p report: decisions list the request veto and the refused key', /Вето на запрос отдела/.test(decisions) && /Второй ключ не дан/.test(decisions));
  await A.evaluate(() => document.querySelector('[data-testid="report-players"]')?.scrollIntoView({ block: 'center' }));
  await shot(A, '2p-report-players');
  await A.evaluate(() => document.querySelector('.report-left')?.scrollIntoView({ block: 'start' }));
  await shot(A, '2p-report-trust-decisions');
  console.log('logs A', A.qaLogs.slice(0, 5), 'B', B.qaLogs.slice(0, 5));
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
