// QA of screen 10 «Индивидуальные задачи» (decision 0013 §1) in headless Chrome against the dev server:
// plays every role's mini-game with the real mouse / keyboard, submits, then flies and checks the in-flight widgets.
//   node scripts/qa/tasks.mjs <titan|asteroid> [width] [height] [prefix] [--fly]
// Screenshots (jpg) → docs/05 Assets/UI/kit/shots/tasks/<prefix>-*.jpg
import { mkdirSync } from 'node:fs';
import { dispatch, hookStore, launch, newPage, presetStorage, sleep, toLobby, BASE } from './lib.mjs';

const [, , mission = 'titan', w = '1440', h = '900', prefix = `${mission}-${w}`, ...flags] = process.argv;
const FLY = flags.includes('--fly');
const SKIP = flags.includes('--skip');
const OUT = 'docs/05 Assets/UI/kit/shots/tasks';
mkdirSync(OUT, { recursive: true });
const phone = +w < 600;

const BUILDS = {
  // Power bus ×1 on Titan: the grid is tight (Power Drop in flight, the engineer's routing matters).
  titan: { rtg: 2, battery_hc: 1, power_bus: FLY ? 1 : 2, pdu: 1, rotor_system: 1, flight_computer: 1, transceiver: 1, antenna_standard: 1, thermal_radiator: 1, thermal_insulation: 1, atmo_sensor: 1, wide_camera: 1, temp_sensor: 1, spectrometer: 1, data_storage: 1, landing_system: 1 },
  asteroid: { solar_array: 4, battery_hc: 1, power_bus: 1, chem_thrusters: 1, propellant_tank: 2, nav_camera: 1, flight_computer: 1, robotic_arm: 1, sample_container: 1, sample_sealer: 1, spectrometer: 1, data_buffer: 1, transceiver: 1, antenna_standard: 1, return_capsule: 1, heat_shield: 1, parachute: 1, recovery_beacon: 1, micrometeoroid_shield: 1, vibration_dampers: 1 },
};

const b = await launch({ gpu: 'metal' });
const p = await newPage(b, { width: +w, height: +h, dpr: 1, mobile: phone, touch: phone });
await presetStorage(p, { 'sm:graphics': 'low', 'sm:soundOn': '0' });
await p.goto(`${BASE}/?dev=1${FLY ? '&speed=12' : ''}`);
await hookStore(p);
await toLobby(p);
await dispatch(p, [
  { type: 'pickRole', role: 'commander' }, { type: 'setReady', ready: true },
  ...(mission !== 'titan' ? [{ type: 'selectMission', mission }] : []),
  { type: 'goStage', stage: 'briefing' }, { type: 'goStage', stage: 'build' },
]);
await dispatch(p, Object.entries(BUILDS[mission]).flatMap(([id, n]) => Array.from({ length: n }, () => ({ type: 'addComponent', id }))), 10);
// Through the constructor's own button (К задачам ролей).
await p.waitForSelector('[data-testid="to-tasks"]', { timeout: 30_000 }).catch(async () => { console.log('stage', await p.evaluate(() => window.__qaGame.getState().room?.stage), p.qaLogs); });
await p.click('[data-testid="to-tasks"]');
await p.waitForSelector('.tk-screen');
await sleep(600);

const shot = async (name, full = false) => {
  await sleep(350);
  await p.screenshot({ path: `${OUT}/${prefix}-${name}.jpg`, type: 'jpeg', quality: 55, fullPage: full });
  console.log('shot', name);
};
const center = async (sel) => {
  const el = await p.$(sel);
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const r = await el.boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, r };
};
const ctx = () => p.evaluate(() => {
  const E = window.__qaEngine; const room = window.__qaGame.getState().room;
  return E.taskCtx(room);
});
const role = async (r) => { await p.click(`[data-testid="tk-team-${r}"]`); await sleep(300); };
const done = async () => { await p.click('[data-testid="tk-done"]'); await p.waitForSelector('[data-testid="tk-result"]'); };
const grade = (r) => p.evaluate((r) => window.__qaGame.getState().room.tasks?.results?.[r]?.grade, r);

/** Drag the handle of row `from` onto row `to` in a reorder list (real pointer). */
async function dragRow(listId, from, to) {
  const rows = await p.$$(`[data-testid="${listId}"] .tk-reorder__handle`);
  await rows[from].evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const a = await rows[from].boundingBox();
  const c = await rows[to].boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  const ty = c.y + (to < from ? 2 : c.height - 2);
  for (let i = 1; i <= 8; i++) { await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + ((ty - a.y - a.height / 2) * i) / 8); await sleep(16); }
  await p.mouse.up();
  await sleep(120);
}

if (SKIP) {
  // Every role skips through its own button (+ the confirmation): all four count as «слабо».
  for (const r of ['commander', 'engineer', 'science', 'comms']) {
    await role(r);
    await p.click('[data-testid="tk-skip"]');
    const sure = await p.waitForSelector('.tk-skip .btn--danger');
    if (r === 'engineer') await shot('skip-confirm');
    await sure.click();
    await p.waitForSelector('[data-testid="tk-result"]');
  }
  await shot('skipped');
} else {
// ── Commander: bring the most valuable goal up, push the vital systems to the bottom of the sacrifice list ──
await role('commander');
await shot('commander-start');
{
  const want = await p.evaluate((c) => {
    const E = window.__qaEngine; const s = E.commanderSetup(c);
    const goals = [...s.goals].sort((a, b) => (b.possible ? b.value : 0) - (a.possible ? a.value : 0)).map((g) => g.id);
    const sac = [...s.items].sort((a, b) => E.keepValue(c, a.id, goals) - E.keepValue(c, b.id, goals)).map((i) => i.id);
    return { goals, sac };
  }, await ctx());
  const order = (list) => p.evaluate((l) => window.__qaGame.getState().room && [...document.querySelectorAll(`[data-testid="${l}"] .tk-reorder__row`)].map((r) => r.querySelector('.tk-reorder__body').textContent), list);
  // Selection-sort by dragging: put the wanted item at position i.
  const names = await p.evaluate((ids) => ids.map((id) => window.__qaEngine.goalName(id)), want.goals);
  for (let i = 0; i < names.length; i++) {
    const cur = await order('tk-goals');
    const j = cur.findIndex((t) => t.startsWith(names[i]));
    if (j !== i) await dragRow('tk-goals', j, i);
  }
  const sacNames = await p.evaluate((ids) => ids.map((id) => window.__qaEngine.COMPONENT_BY_ID[id].name), want.sac);
  for (let i = 0; i < sacNames.length; i++) {
    const cur = await order('tk-sacrifice');
    const j = cur.findIndex((t) => t.startsWith(sacNames[i]));
    if (j !== i) await dragRow('tk-sacrifice', j, i);
  }
}
await shot('commander-sorted');
await done();
console.log('commander', await grade('commander'));
await shot('commander-done');

// ── Engineer: click consumer → line on the schematic ──
await role('engineer');
await shot('engineer-start');
{
  const plan = await p.evaluate((c) => {
    const E = window.__qaEngine; const s = E.engineerSetup(c);
    let sec = 0; const out = [];
    for (const x of [...s.consumers].filter((x) => !x.mustMain).sort((a, b) => b.watts - a.watts)) { if (sec + x.watts <= s.caps.secondary) { sec += x.watts; out.push(E.COMPONENT_BY_ID[x.id].name); } }
    return out;
  }, await ctx());
  for (const [i, name] of plan.entries()) {
    if (i % 2 === 0) {
      // Consumer first, then the secondary rail.
      const chip = await p.evaluateHandle((n) => [...document.querySelectorAll('.tk-node__chip')].find((b) => b.textContent.includes(n)), name);
      await chip.asElement().click();
      await (await p.$('.tk-rail--secondary')).click();
    } else {
      // Or the socket on its right side.
      await p.click(`button[aria-label="${name}: на второстепенную линию"]`);
    }
    await sleep(80);
  }
}
await shot('engineer-routed');
await done();
console.log('engineer', await grade('engineer'));

// ── Science: turn the knob onto the reference peak (mouse drag on the dial, then fine keys) for each instrument ──
await role('science');
await shot('science-start');
{
  const s = await p.evaluate((c) => window.__qaEngine.scienceSetup(c), await ctx());
  const tabs = await p.$$('.tk-sci__tabs .seg__item');
  for (let i = 0; i < s.instruments.length; i++) {
    await tabs[i].click(); await sleep(150);
    const inst = s.instruments[i];
    const dial = await center('.tk-knob__dial');
    // Drag around the dial: a quarter turn = 0.125 of the scale.
    const want = inst.peak - inst.start;
    const turns = want / 0.5;
    const R = dial.r.width * 0.4;
    await p.mouse.move(dial.x, dial.y - R); await p.mouse.down();
    const steps = 24;
    for (let k = 1; k <= steps; k++) { const a = -Math.PI / 2 + (turns * 2 * Math.PI * k) / steps; await p.mouse.move(dial.x + Math.cos(a) * R, dial.y + Math.sin(a) * R); await sleep(10); }
    await p.mouse.up();
    // Fine: arrow keys until the value matches (3 thousandths per press).
    const val = await p.$eval('.tk-knob__dial', (e) => Number(e.getAttribute('aria-valuenow')) / 100);
    const presses = Math.round((inst.peak - val) / 0.003);
    await p.focus('.tk-knob__dial');
    for (let k = 0; k < Math.abs(presses); k++) await p.keyboard.press(presses > 0 ? 'ArrowRight' : 'ArrowLeft');
    if (i === 0) await shot('science-calibrated');
  }
  await (await p.$(`.tk-mode--${s.best}`)).click();
}
await shot('science-mode');
await done();
console.log('science', await grade('science'));

// ── Comms: click the radar near Earth, nudge, reorder the packet queue ──
await role('comms');
await shot('comms-start');
{
  const s = await p.evaluate((c) => window.__qaEngine.commsSetup(c), await ctx());
  const scope = await center('.tk-radar__scope');
  const R = Math.min(scope.r.width, scope.r.height) / 2 - 6;
  // First a rough click by the blip (off by a bit), then arrow-key nudges by the meter.
  await p.mouse.click(scope.x + (s.earth.x + 0.06) * R, scope.y + (s.earth.y - 0.05) * R);
  await sleep(400);
  await shot('comms-rough');
  await p.focus('.tk-radar__scope');
  for (let k = 0; k < 6; k++) await p.keyboard.press('ArrowLeft');
  for (let k = 0; k < 5; k++) await p.keyboard.press('ArrowDown');
  const want = await p.evaluate((c) => {
    const E = window.__qaEngine; const s = E.commsSetup(c);
    return [...s.targets].sort((a, b) => E.targetValue(c.mission, b.id, b.possible) - E.targetValue(c.mission, a.id, a.possible)).map((t) => E.goalName(t.id));
  }, await ctx());
  for (let i = 0; i < want.length; i++) {
    const cur = await p.$$eval('[data-testid="tk-queue"] .tk-reorder__body', (els) => els.map((e) => e.textContent));
    const j = cur.findIndex((t) => t.startsWith(want[i]));
    if (j !== i) await dragRow('tk-queue', j, i);
  }
}
await shot('comms-aimed');
await done();
console.log('comms', await grade('comms'));
await p.evaluate(() => document.querySelector('.tk-next').scrollIntoView({ block: 'center' }));
await shot('all-done');
}
const results = await p.evaluate(() => Object.fromEntries(Object.entries(window.__qaGame.getState().room.tasks.results).map(([r, x]) => [r, `${x.grade} ${x.score}`])));
console.log('results', results);

// To the readiness check through the screen's button.
await p.click('[data-testid="tasks-to-review"]');
await sleep(400);
console.log('stage after tasks:', await p.evaluate(() => window.__qaGame.getState().room.stage));

if (FLY) {
  await dispatch(p, [{ type: 'pickRole', role: 'commander' }, { type: 'approve' }], 100);
  await p.waitForFunction(() => window.__qaGame.getState().room.stage === 'flight', { timeout: 60_000 });
  // Comms: wait for «the antenna lost Earth» after the entry blackout and re-aim on the small radar.
  await dispatch(p, [{ type: 'pickRole', role: 'comms' }]);
  let shotReaim = false, shotIso = false;
  for (let i = 0; i < 900; i++) {
    const st = await p.evaluate(() => { const r = window.__qaGame.getState().room; const f = r.flight; return { stage: r.stage, reaim: !!f?.tasks?.reaim && f.signal !== 'lost', crisis: f?.crisis?.kind ?? null, chosen: f?.crisis?.chosen ?? {}, opts: f?.crisis?.options.map((o) => [o.id, o.role]) ?? [] }; });
    if (st.stage !== 'flight') break;
    if (st.reaim && !shotReaim) {
      await dispatch(p, [{ type: 'pickRole', role: 'comms' }]);
      await p.waitForSelector('[data-testid="tk-reaim"]');
      await p.evaluate(() => document.querySelector('[data-testid="tk-reaim"]').scrollIntoView({ block: 'center' }));
      const t = await p.evaluate(() => window.__qaGame.getState().room.flight.tasks.reaim);
      const sc = await center('[data-testid="tk-reaim"] .tk-radar__scope');
      const R = Math.min(sc.r.width, sc.r.height) / 2 - 6;
      await p.mouse.click(sc.x + t.x * R, sc.y + t.y * R);
      await shot('fly-reaim');
      await p.click('[data-testid="tk-reaim"] .btn--primary');
      await sleep(300);
      console.log('re-aimed: aim', await p.evaluate(() => window.__qaGame.getState().room.flight.tasks.aim));
      shotReaim = true;
    }
    if (st.crisis === 'power_drop' && !shotIso) {
      await dispatch(p, [{ type: 'pickRole', role: 'engineer' }]);
      await p.waitForSelector('[data-testid="tk-isolate"]');
      await sleep(2800); // the CRITICAL EVENT banner
      const name = await p.evaluate(() => { const f = window.__qaGame.getState().room.flight; const E = window.__qaEngine; const c = E.isolateCandidates(f, window.__qaGame.getState().room.build).filter((x) => x.on); return E.COMPONENT_BY_ID[c[c.length - 1].id].name; });
      const chip = await p.evaluateHandle((n) => [...document.querySelectorAll('[data-testid="tk-isolate"] .tk-node__chip')].find((b) => b.textContent.includes(n)), name);
      await chip.asElement().evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await chip.asElement().click();
      await sleep(300);
      await shot('fly-isolate');
      console.log('isolate chosen:', await p.evaluate(() => JSON.stringify(window.__qaGame.getState().room.flight.crisis?.options.find((o) => o.id === 'pd_isolate'))));
      shotIso = true;
    }
    if (st.crisis) {
      // Answer the rest of the roles with their first option.
      for (const [id, r] of st.opts) if (!st.chosen[r] && !(r === 'engineer' && shotIso)) await dispatch(p, [{ type: 'pickRole', role: r }, { type: 'crisisChoice', optionId: id }], 40);
    }
    await sleep(300);
  }
  await p.waitForFunction(() => window.__qaGame.getState().room.stage === 'report', { timeout: 240_000 });
  await sleep(1200);
  await p.evaluate(() => document.querySelector('[data-testid="tk-report"]')?.scrollIntoView({ block: 'center' }));
  await shot('report');
  console.log('report tasks', await p.evaluate(() => JSON.stringify(window.__qaGame.getState().room.report.tasks)));
  console.log('task chains', await p.evaluate(() => window.__qaGame.getState().room.report.chains.filter((c) => c.key.startsWith('task:')).map((c) => c.what)));
}
console.log('console errors:', p.qaLogs.filter((l) => !/THREE|DevTools|Download the React/.test(l)).slice(0, 10));
await b.close();
