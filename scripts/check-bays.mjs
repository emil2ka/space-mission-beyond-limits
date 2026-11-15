#!/usr/bin/env node
// Hulls v2 fit check: does anything (the frame itself or an overlay) sit IN FRONT of a bay opening, where the module goes?
// For every slot of the frame (model-contract.json "frames"), looks at a 0.18 × 0.18 m column straight out of the
// bay floor (local y 0.01…0.35) and counts vertices of each GLB inside it. Overlays must leave every column empty;
// the frame may only touch it with its floor (y < 0.01).
//   node scripts/check-bays.mjs                 # both frames, sources in assets-src/
//   node scripts/check-bays.mjs frame_titan public/models
//   node scripts/check-bays.mjs --modules       # also: every module GLB of a department on every slot of it (×MODULE_SCALE):
//                                                # how deep the frame / overlays cut into the module (sideways and up from its base)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIO, loadContract, ROOT } from './lib/io.mjs';

const OVERLAYS = {
  frame_titan: ['frame_titan', 'rotor_system', 'landing_system', 'thermal_insulation', 'power_bus', 'reinforced_frame'],
  frame_asteroid: ['frame_asteroid', 'thermal_insulation__asteroid', 'power_bus__asteroid', 'landing_system__asteroid', 'reinforced_frame__asteroid'],
};
const HALF = 0.09, Y0 = 0.015, Y1 = 0.35;

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

async function worldVertices(path) {
  const io = await createIO();
  const doc = await io.read(path);
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        out.push([m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
      }
    }
  }
  return out;
}

const args = process.argv.slice(2);
const withModules = args.includes('--modules');
const [frameArg, dirArg] = args.filter((a) => !a.startsWith('--'));
const frames = frameArg ? [frameArg] : Object.keys(OVERLAYS);
const dir = join(ROOT, dirArg ?? 'assets-src');
const contract = loadContract();
let bad = 0;
for (const frame of frames) {
  const slots = Object.entries(contract.frames[frame].slots).map(([name, { p, n }]) => {
    const Z = Math.abs(n[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0];
    return { name, p, Y: n, X: cross(n, Z), Z };
  });
  console.log(`\n${frame}:`);
  for (const id of OVERLAYS[frame]) {
    const path = join(dir, `${id}.glb`);
    if (!existsSync(path)) { console.log(`  ${id.padEnd(30)} — missing`); continue; }
    const verts = await worldVertices(path);
    const hits = [];
    for (const s of slots) {
      let count = 0, minY = Infinity;
      for (const w of verts) {
        const d = [w[0] - s.p[0], w[1] - s.p[1], w[2] - s.p[2]];
        const x = dot(d, s.X), y = dot(d, s.Y), z = dot(d, s.Z);
        // Deck / belly sockets are round: a round column (r = HALF) there, a square one in the side bays.
        const inside = Math.abs(s.Y[1]) > 0.5 ? Math.hypot(x, z) < HALF : Math.abs(x) < HALF && Math.abs(z) < HALF;
        if (inside && y > Y0 && y < Y1) { count++; minY = Math.min(minY, y); }
      }
      if (count) hits.push(`${s.name.replace('slot_', '')} ×${count} (from ${minY.toFixed(2)} m)`);
    }
    bad += hits.length;
    console.log(`  ${id.padEnd(30)} ${hits.length ? `BLOCKS ${hits.length} bay(s): ${hits.join(', ')}` : 'all bays clear'}`);
  }
  if (withModules) await moduleFit(frame, slots);
}

/**
 * Every module of a department on every slot of it: the module's bbox (×MODULE_SCALE, in slot space) shrunk by 1 cm;
 * reports, per slot, the worst depth (along the slot normal) at which frame or overlay vertices sit inside that box.
 * Frame vertices below the bay floor (local y < 0.005) are the floor itself and are ignored.
 */
async function moduleFit(frame, slots) {
  const SCALE = 1.1, SHRINK = 0.01;
  const src = readFileSync(join(ROOT, 'src/engine/data/components.ts'), 'utf8');
  const byDept = {};
  for (const m of src.matchAll(/id: '([a-z_]+)', department: '([a-z]+)'/g)) (byDept[m[2]] ??= []).push(m[1]);
  const others = [];
  for (const id of OVERLAYS[frame]) {
    const path = join(dir, `${id}.glb`);
    if (existsSync(path)) others.push({ id, verts: await worldVertices(path) });
  }
  // Per module: its footprint (x/z extent in slot space) per 3 cm height slice, so a dish on a thin mast is not a solid box.
  const SLICE = 0.03;
  const boxes = {};
  for (const ids of Object.values(byDept)) for (const id of ids) {
    const path = join(ROOT, 'public/models', `${id}.glb`);
    if (!existsSync(path) || OVERLAYS.frame_titan.includes(id)) continue;
    const slices = [];
    for (const p of await worldVertices(path)) {
      const [x, y, z] = p.map((v) => v * SCALE);
      const k = Math.max(0, Math.floor(y / SLICE));
      const sl = (slices[k] ??= { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
      sl.x0 = Math.min(sl.x0, x); sl.x1 = Math.max(sl.x1, x); sl.z0 = Math.min(sl.z0, z); sl.z1 = Math.max(sl.z1, z);
    }
    boxes[id] = slices;
  }
  console.log(`  modules ×${SCALE} on their slots (worst intrusion into the module box, by what):`);
  for (const s of slots) {
    const dept = /^slot_([a-z]+)_/.exec(s.name)[1];
    const { bay, lift: seatLift, cradle, maxFoot } = contract.frames[frame].slots[s.name];
    const worst = [];
    for (const id of byDept[dept] ?? []) {
      let sl = boxes[id];
      if (!sl || (cradle && id === 'rtg')) continue; // lies crosswise in the saddle: checked by eye
      // Module.tsx: a module bigger than the slot's room is scaled down to fit it.
      const span = Math.max(...sl.filter(Boolean).flatMap((b) => [b.x1 - b.x0, b.z1 - b.z0]));
      if (maxFoot && span > maxFoot) {
        const f = maxFoot / span, out = [];
        sl.forEach((b, k) => { if (b) { const j = Math.floor((k * SLICE * f) / SLICE); const o = (out[j] ??= { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
          o.x0 = Math.min(o.x0, b.x0 * f); o.x1 = Math.max(o.x1, b.x1 * f); o.z0 = Math.min(o.z0, b.z0 * f); o.z1 = Math.max(o.z1, b.z1 * f); } });
        sl = out;
      }
      // Same rule as the game (Module.tsx fitsBay): a base wider than the opening sits on the rim.
      const base = sl.slice(0, 2).filter(Boolean);
      const bw = Math.max(...base.map((b) => b.x1)) - Math.min(...base.map((b) => b.x0));
      const bd = Math.max(...base.map((b) => b.z1)) - Math.min(...base.map((b) => b.z0));
      const lift = cradle ? Math.max(seatLift, 0.1) : bw <= bay[0] - 0.02 && bd <= bay[1] - 0.02 ? 0 : seatLift; // Module.tsx: adapter in the bay
      for (const o of others) {
        let depth = 0;
        for (const w of o.verts) {
          const d = [w[0] - s.p[0], w[1] - s.p[1], w[2] - s.p[2]];
          const x = dot(d, s.X), y = dot(d, s.Y) - lift, z = dot(d, s.Z);
          if (o.id === frame && y + lift < 0.005) continue;
          const b = y > 0 ? sl[Math.floor(y / SLICE)] : null;
          if (!b) continue;
          const dx = Math.min(x - b.x0, b.x1 - x) - SHRINK, dz = Math.min(z - b.z0, b.z1 - z) - SHRINK;
          // depth = how far the vertex is inside the module: sideways from the box edge AND up from the module base
          if (dx > 0 && dz > 0) depth = Math.max(depth, Math.min(dx, dz, y));
        }
        if (depth > 0.015) worst.push(`${id}${lift ? '(adapter)' : ''}←${o.id} ${depth.toFixed(2)}`);
      }
    }
    if (worst.length) console.log(`    ${s.name.padEnd(20)} ${worst.slice(0, 6).join(', ')}${worst.length > 6 ? ` … +${worst.length - 6}` : ''}`);
  }
}
process.exitCode = bad ? 1 : 0;
