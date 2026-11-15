// Pure contract checks: (id, summary from inspect.mjs, model-contract.json) → issues.
// No IO here, so it is unit-tested directly (scripts/__tests__).

/**
 * Frame slot tables live in model-contract.json "frames" (hulls v2, docs/05 Assets/Batches/parts/hulls_v2_contract.txt):
 * every slot_<dept>_<n> has an exact bay-floor position `p` and outward normal `n` (= slot local +Y).
 */
export const frameSpec = (id, contract) => contract.frames?.[id] ?? null;

/** Modules allowed to be bigger than 1.6 m (parachute ships with its canopy deployed, ~2 m). */
export const MODULE_MAX_DIM = { parachute: 2.8 };
/** Environment pieces whose origin is their centre, not the floor. */
export const CENTRED_ENV = new Set(['asteroid', 'earth', 'debris']);

/** "landing_system__asteroid" → "landing_system". */
export const baseId = (id) => id.replace(/__[a-z0-9]+$/, '');

export const PROTECTED_PREFIX = /^(pivot|slot|fx|mount|cam)_/;

export function kindOf(id, contract) {
  return contract.kind?.[id] ?? 'module';
}

export function isKnownId(id, contract) {
  return id in (contract.nodes ?? {}) || id in (contract.kind ?? {});
}

export function triangleBudget(id, contract) {
  return contract.maxTris?.[id] ?? contract.maxTris?.[kindOf(id, contract)] ?? 4000;
}

/** Names three.js GLTFLoader would rewrite (PropertyBinding.sanitizeNodeName): spaces, []./: */
export function sanitizesDifferently(name) {
  return /[\s[\].:/]/.test(name);
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const f = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : String(n));
const v3 = (v) => `(${f(v[0])}, ${f(v[1])}, ${f(v[2])})`;

export function bboxSize(bbox) {
  return bbox ? [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]] : [0, 0, 0];
}

/**
 * @returns {{ level: 'error' | 'warn', msg: string }[]}
 */
export function checkModel(id, s, contract) {
  const out = [];
  const err = (msg) => out.push({ level: 'error', msg });
  const warn = (msg) => out.push({ level: 'warn', msg });
  const kind = kindOf(id, contract);

  if (!isKnownId(id, contract)) warn(`unknown id "${id}" — not in model-contract.json, checked as a module`);

  // --- named nodes
  const byName = new Map();
  for (const n of s.nodes) {
    if (!n.name) continue;
    if (!byName.has(n.name)) byName.set(n.name, []);
    byName.get(n.name).push(n);
  }
  const meshNames = new Set(s.meshNames);
  for (const req of contract.nodes?.[id] ?? []) {
    if (!byName.has(req) && !meshNames.has(req)) err(`missing node "${req}"`);
  }
  for (const [name, list] of byName) {
    if (list.length > 1 && (PROTECTED_PREFIX.test(name) || (contract.nodes?.[id] ?? []).includes(name)))
      err(`duplicate node name "${name}" ×${list.length} (three.js renames duplicates → game lookup breaks)`);
    if (PROTECTED_PREFIX.test(name) && sanitizesDifferently(name)) warn(`node "${name}" has characters three.js strips`);
  }
  for (const n of s.nodes) {
    if (/^(pivot|slot|fx|mount|cam)[A-Z.\-\s]/.test(n.name)) warn(`node "${n.name}" looks like a misspelt prefix (use "pivot_", "slot_", …)`);
  }

  // --- materials
  const matNames = new Set(s.materials.map((m) => m.name));
  for (const req of contract.materials?.[id] ?? []) if (!matNames.has(req)) err(`missing material "${req}"`);
  const unnamed = s.materials.filter((m) => !/^M_/.test(m.name)).map((m) => m.name || '(no name)');
  if (unnamed.length) warn(`materials without "M_" prefix: ${unnamed.slice(0, 5).join(', ')}${unnamed.length > 5 ? '…' : ''}`);
  if (s.materials.some((m) => m.textured)) warn('textures present (contract: flat colours, no textures unless the spec asks)');
  const emissiveNotNamed = s.materials.filter((m) => m.emissive && m.name !== 'M_Emissive').map((m) => m.name);
  if (emissiveNotNamed.length) warn(`emissive materials not named M_Emissive: ${emissiveNotNamed.join(', ')} (they will get ink outlines)`);
  if ([...s.meshNames, ...s.materials.map((m) => m.name), ...s.nodes.map((n) => n.name)].some((n) => /outline|inkshell/i.test(n)))
    warn('something is named "outline" — GLB must not contain outline shells (the game draws them)');

  // --- clips
  const clips = new Set(s.clips);
  for (const req of contract.clips?.[id] ?? []) if (!clips.has(req)) err(`missing animation clip "${req}"`);
  if (kind === 'character' && s.skins === 0) err('character has no skin (needs a SkinnedMesh + skeleton)');

  // --- extras that must not be in the GLB
  if (s.cameras) warn(`${s.cameras} camera(s) exported — remove`);
  if (s.lights) warn('lights exported — remove');
  if (s.meshes === 0) err('no meshes');

  // --- triangles
  const budget = triangleBudget(id, contract);
  if (s.triangles > budget) err(`triangles ${s.triangles} > budget ${budget} (${kind})`);

  // --- size
  if (s.bytes > 1.5 * 1024 * 1024) warn(`file ${(s.bytes / 1024 / 1024).toFixed(2)} MB > 1.5 MB`);

  // --- bounding box sanity
  const b = s.bbox;
  if (!b) {
    if (s.meshes) err('bounding box is empty / NaN');
  } else {
    const [w, h, d] = bboxSize(b);
    const maxDim = Math.max(w, h, d);
    if (maxDim > 200) err(`huge bounding box ${v3([w, h, d])} m — wrong units (cm/mm?)`);
    checkBounds(id, kind, b, [w, h, d], { err, warn }, contract);
  }

  // --- frame slots
  if (kind === 'frame') checkFrameSlots(id, byName, { err, warn }, contract);
  if (id === 'rotor_system') checkRotors(byName, { err, warn }, contract);
  if (id === 'test_stand') {
    const m = byName.get('mount_craft')?.[0];
    if (m && Math.abs(m.position[1] - 0.8) > 0.03) err(`mount_craft at y=${f(m.position[1])}, contract y=0.80`);
  }
  return out;
}

function checkBounds(id, kind, b, [w, h, d], { err, warn }, contract) {
  const minY = b.min[1], maxY = b.max[1];
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  const maxDim = Math.max(w, h, d);
  const halfXZ = Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]), Math.abs(b.min[2]), Math.abs(b.max[2]));
  if (kind === 'module') {
    const maxAllowed = MODULE_MAX_DIM[id] ?? 1.6;
    if (maxDim < 0.05 || maxDim > maxAllowed) err(`module size ${f(maxDim)} m outside 0.05–${maxAllowed} m (bbox ${f(w)}×${f(h)}×${f(d)})`);
    if (Math.abs(minY) > 0.05) err(`base not on y=0 (min y = ${f(minY, 3)}) — module must stand on the slot plane and grow to +Y`);
    if (Math.abs(cx) > 0.3 || Math.abs(cz) > 0.3) warn(`base not centred on the origin (bbox centre x=${f(cx)}, z=${f(cz)})`);
    if (maxY < 0.02) err('module has no height along +Y');
  } else if (kind === 'capsule_part') {
    // heat_shield: origin = centre of its top face (touches the capsule), the shield hangs down to y ≈ -0.1.
    if (Math.abs(maxY) > 0.03) err(`top face at y=${f(maxY, 3)}, contract: origin on the top face (max y = 0)`);
    if (minY > -0.03 || minY < -0.25) err(`shield bottom at y=${f(minY, 3)}, contract ≈ -0.1`);
    if (maxDim < 0.4 || maxDim > 1.0) err(`capsule part size ${f(maxDim)} m, contract Ø 0.72`);
    if (Math.abs(cx) > 0.05 || Math.abs(cz) > 0.05) warn(`not centred on the origin (bbox centre x=${f(cx)}, z=${f(cz)})`);
  } else if (kind === 'frame') {
    const bd = frameSpec(id, contract)?.bounds;
    if (bd) {
      if (minY < bd.minY[0] || minY > bd.minY[1]) err(`frame bottom at y=${f(minY, 3)}, contract y=0 (allowed ${bd.minY.join('…')})`);
      if (maxY < bd.maxY[0] || maxY > bd.maxY[1]) err(`frame top at y=${f(maxY)}, contract ${bd.maxY.join('…')} (deck + rails / cradle)`);
      if (halfXZ < bd.halfXZ[0] || halfXZ > bd.halfXZ[1]) err(`frame half-width ${f(halfXZ)} m, contract ${bd.halfXZ.join('…')}`);
    }
  } else if (kind === 'overlay') {
    if (halfXZ > 1.9 || minY < -0.6 || maxY > 2.0) err(`overlay bbox ${v3(b.min)}–${v3(b.max)} does not fit frame coordinates`);
    if (id === 'rotor_system' && (minY < 0.5 || minY > 0.8)) err(`rotor heads start at y=${f(minY)}, contract motor pads at y=0.62`);
    if (id === 'landing_system' && Math.abs(minY + 0.45) > 0.06) err(`skid contact at y=${f(minY)}, contract y=-0.45`);
    if (id === 'landing_system__asteroid' && Math.abs(minY + 0.35) > 0.06) err(`footpad contact at y=${f(minY)}, contract y=-0.35`);
    if (baseId(id) === 'thermal_insulation' && (halfXZ < 0.6 || halfXZ > 0.9)) warn(`insulation half-width ~${f(halfXZ)} m, contract hugs the body (Titan 0.55 × 0.80, hexagon corners 0.75)`);
  } else if (kind === 'character') {
    if (h < 1.3 || h > 2.1) err(`character height ${f(h)} m, contract ~1.7 m`);
    if (Math.abs(minY) > 0.06) warn(`feet at y=${f(minY)}, contract origin between the feet`);
  } else if (kind === 'big') {
    if (h < 11 || h > 17) err(`rocket height ${f(h)} m, contract 14 m`);
    if (Math.abs(minY) > 0.2) warn(`base at y=${f(minY)}, contract origin at the base`);
  } else if (kind === 'env') {
    if (CENTRED_ENV.has(id)) {
      if (Math.hypot((b.min[0] + b.max[0]) / 2, (minY + maxY) / 2, cz) > maxDim * 0.25) warn(`origin far from the centre (bbox centre ${v3([(b.min[0] + b.max[0]) / 2, (minY + maxY) / 2, cz])})`);
    } else if (Math.abs(minY) > 0.6 && id !== 'titan_terrain') warn(`floor at y=${f(minY)}, contract origin at floor level`);
    const expect = {
      test_stand: [3.2, null, 3.2], hq_hangar: [18, 8, 12], hq_console: [1.6, null, null], titan_terrain: [60, null, 60], launch_pad: [12, null, 12],
      asteroid: [8, 5, 6], earth: [6.2, 6.2, 6.2],
    }[id];
    if (expect) {
      const got = [w, h, d];
      expect.forEach((e, i) => {
        if (e && Math.abs(got[i] - e) / e > 0.3) warn(`${'XYZ'[i]} size ${f(got[i])} m, contract ~${e} m`);
      });
    }
  }
}

function checkFrameSlots(id, byName, { err, warn }, contract) {
  const spec = frameSpec(id, contract);
  if (!spec) { warn(`no "frames.${id}" slot table in model-contract.json`); return; }
  const tol = spec.slotTol ?? 0.06;
  const deck = [];
  for (const [name, list] of byName) {
    if (!/^slot_[a-z]+_\d+$/.test(name)) continue;
    const want = spec.slots[name];
    const n = list[0];
    if (!want) { warn(`${name}: not in the ${id} slot table`); continue; }
    if (n.hasMesh || n.children) warn(`${name}: slot should be an empty node (has mesh/children)`);
    if (n.scale.some((s) => Math.abs(s - 1) > 0.05)) warn(`${name}: world scale ${v3(n.scale)} ≠ 1 — modules under it get scaled`);
    const dist = Math.hypot(n.position[0] - want.p[0], n.position[1] - want.p[1], n.position[2] - want.p[2]);
    if (dist > tol * 2) err(`${name}: at ${v3(n.position)}, contract ${v3(want.p)} (off by ${f(dist)} m)`);
    else if (dist > tol) warn(`${name}: at ${v3(n.position)}, contract ${v3(want.p)} (off by ${f(dist)} m)`);
    const k = dot(n.yAxis, want.n);
    if (k < 0.7) err(`${name}: local +Y ${v3(n.yAxis)} is not the outward normal ${v3(want.n)} (dot ${f(k)})`);
    else if (k < 0.95) warn(`${name}: local +Y only roughly outward (dot ${f(k)})`);
    const side = Math.abs(want.n[1]) < 0.5;
    if (side && n.zAxis[1] < 0.9) warn(`${name}: local +Z ${v3(n.zAxis)} should point world-up`);
    if (want.n[1] > 0.5) deck.push({ name, x: n.position[0], z: n.position[2] });
  }
  const gap = spec.deckMinGap ?? 0.35;
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const dd = Math.hypot(deck[i].x - deck[j].x, deck[i].z - deck[j].z);
      if (dd < gap - 0.01) warn(`${deck[i].name} and ${deck[j].name} only ${f(dd)} m apart (contract ≥ ${gap})`);
    }
  }
  const cam = byName.get('cam_front')?.[0];
  if (cam && cam.position[2] < 0.3) warn('cam_front is not at the front (+Z)');
}

function checkRotors(byName, { err, warn }, contract) {
  const spec = frameSpec('frame_titan', contract);
  if (!spec?.pads) return;
  const [loY, hiY] = spec.rotorHubY;
  spec.pads.forEach(([px, , pz], k) => {
    for (const [suffix, hy] of [['', hiY], ['_lo', loY]]) {
      const name = `pivot_rotor_${k + 1}${suffix}`;
      const n = byName.get(name)?.[0];
      if (!n) continue;
      const [x, y, z] = n.position;
      if (Math.hypot(x - px, z - pz) > 0.12) err(`${name} at ${v3(n.position)}, contract pad (${px}, ${pz})`);
      if (Math.abs(y - hy) > 0.08) err(`${name} hub at y=${f(y)}, contract y=${hy}`);
      if (n.yAxis[1] < 0.95) warn(`${name} local +Y is not vertical — spin axis tilted`);
    }
  });
}

/** Short status for the table. */
export function statusOf(issues) {
  if (issues.some((i) => i.level === 'error')) return 'FAIL';
  if (issues.some((i) => i.level === 'warn')) return 'warn';
  return 'ok';
}
