// End-to-end on synthetic GLBs: validator → optimizer → manifest → three.js GLTFLoader → slot placement / mechanics / toon.
import { Mesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { describe, expect, it } from 'vitest';
import { CAPSULE_MOUNT_DEFAULT, slotDefOf, slotTransform as gameSlotTransform } from '../../src/scene/layout';
import { createMechanics } from '../../src/scene/models/mechanics';
import { collectSlots, nodeTransform } from '../../src/scene/models/nodes';
import { assignSlots, baseOverlayId, OVERLAY_IDS } from '../../src/scene/models/slots';
import { applyVariant, toonify } from '../../src/scene/models/toon';
import { checkModel, statusOf } from '../lib/contract.mjs';
import { summarize } from '../lib/inspect.mjs';
import { createIO, loadContract } from '../lib/io.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { optimizeDocument } from '../lib/optimize.mjs';
import {
  buildAntennaHighGain, buildDataBuffer, buildFrameAsteroid, buildFrameTitan, buildHeatShield, buildParachute, buildReactionWheels,
  buildReturnCapsule, buildRotorSystem, buildRtg, FRAME_ASTEROID_SLOT_LAYOUT, FRAME_SLOT_LAYOUT, slotTransform, SYNTHETIC,
} from '../lib/synthetic.mjs';

const contract = loadContract();

async function roundTrip(doc) {
  const io = await createIO();
  const bytes = await io.writeBinary(doc);
  return { bytes, doc: await io.readBinary(bytes) };
}
async function check(id, doc) {
  const { bytes, doc: d } = await roundTrip(doc);
  const issues = checkModel(id, summarize(d, { bytes: bytes.byteLength }), contract);
  return { issues, status: statusOf(issues), errors: issues.filter((i) => i.level === 'error').map((i) => i.msg) };
}
async function optimized(id, doc) {
  await optimizeDocument(doc, { id, contract });
  const io = await createIO();
  return io.writeBinary(doc);
}
async function parseInThree(bytes) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return loader.parseAsync(buf, '');
}

describe('validator on synthetic models', () => {
  it('all synthetic models pass the contract', async () => {
    for (const [id, build] of Object.entries(SYNTHETIC)) {
      const r = await check(id, build());
      expect(r.errors, id).toEqual([]);
    }
  });

  it('catches a slot pointing into the hull', async () => {
    const r = await check('frame_titan', buildFrameTitan({ flipSlot: 'slot_science_3' }));
    expect(r.status).toBe('FAIL');
    expect(r.errors.join('\n')).toMatch(/slot_science_3: local \+Y/);
  });

  it('catches a module whose base is not on y=0 and a missing pivot', async () => {
    const r = await check('antenna_high_gain', buildAntennaHighGain({ liftBase: 0.4, dropTilt: true }));
    expect(r.errors.some((e) => /base not on y=0/.test(e))).toBe(true);
    expect(r.errors).toContain('missing node "pivot_dish_tilt"');
  });

  it('catches wrong units, triangle budget and missing frame nodes', async () => {
    const doc = buildRtg();
    doc.getRoot().listNodes()[0].setScale([100, 100, 100]);
    const r = await check('rtg', doc);
    expect(r.errors.some((e) => /module size/.test(e))).toBe(true);

    const s = { nodes: [], meshNames: ['x'], materials: [{ name: 'M_A', emissive: false, textured: false }], clips: [], triangles: 20000,
      bbox: { min: [-1, 0, -1], max: [1, 1.3, 1] }, meshes: 1, textures: 0, cameras: 0, lights: 0, skins: 0, bytes: 0 };
    const issues = checkModel('frame_titan', s, contract).filter((i) => i.level === 'error').map((i) => i.msg);
    expect(issues.some((m) => /triangles 20000 > budget 15000/.test(m))).toBe(true);
    expect(issues).toContain('missing node "slot_power_1"');
  });

  it('character without astronaut clips / skin fails', () => {
    const s = { nodes: [], meshNames: ['body'], materials: [{ name: 'M_Role', emissive: false, textured: false }], clips: ['Idle'], triangles: 100,
      bbox: { min: [-0.4, 0, -0.3], max: [0.4, 1.7, 0.3] }, meshes: 1, textures: 0, cameras: 0, lights: 0, skins: 0, bytes: 0 };
    const errors = checkModel('astronaut', s, contract).filter((i) => i.level === 'error').map((i) => i.msg);
    expect(errors).toContain('missing animation clip "Wave"');
    expect(errors.some((m) => /no skin/.test(m))).toBe(true);
  });
});

describe('validator: P1 kinds', () => {
  const base = { nodes: [], meshNames: ['x'], materials: [{ name: 'M_A', emissive: false, textured: false }], clips: [], triangles: 100,
    meshes: 1, textures: 0, cameras: 0, lights: 0, skins: 0, bytes: 0 };
  const errs = (id, extra) => checkModel(id, { ...base, ...extra }, contract).filter((i) => i.level === 'error').map((i) => i.msg);

  it('heat_shield (capsule_part): origin on the top face, hanging to -0.1, is fine; a module-style base on y=0 is not', async () => {
    expect((await check('heat_shield', buildHeatShield())).errors).toEqual([]);
    const lifted = buildHeatShield();
    lifted.getRoot().listNodes()[0].setTranslation([0, 0.1, 0]);
    expect((await check('heat_shield', lifted)).errors.some((e) => /top face at y=0.100/.test(e))).toBe(true);
    expect((await check('rtg', buildHeatShield())).errors.some((e) => /base not on y=0/.test(e))).toBe(true);
  });

  it('parachute may be ~2 m with its canopy deployed; another module of that size fails', async () => {
    expect((await check('parachute', buildParachute())).errors).toEqual([]);
    expect((await check('return_capsule', buildParachute())).errors.some((e) => /module size/.test(e))).toBe(true);
  });

  it('frame_asteroid: all 30 slots pass; a slot 0.2 m off its bay fails; missing recovery slot fails', async () => {
    expect((await check('frame_asteroid', buildFrameAsteroid())).issues).toEqual([]);
    const r = await check('frame_asteroid', buildFrameAsteroid({ movedSlot: 'slot_science_2' }));
    expect(r.errors.join("\n")).toMatch(/slot_science_2: at .*off by 0.20 m/);
    const doc = buildFrameAsteroid();
    doc.getRoot().listNodes().find((n) => n.getName() === 'slot_recovery_4').dispose();
    expect((await check('frame_asteroid', doc)).errors).toContain('missing node "slot_recovery_4"');
  });

  it('__asteroid overlays: landing pads at y = -0.35; env budgets and centred origins', () => {
    const legs = ['pivot_leg_1', 'pivot_leg_2', 'pivot_leg_3', 'fx_anchor_1', 'fx_anchor_2', 'fx_anchor_3'].map((name) => ({ name, position: [0, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1], scale: [1, 1, 1] }));
    expect(errs('landing_system__asteroid', { nodes: legs, bbox: { min: [-1.2, -0.35, -1.2], max: [1.2, 0.3, 1.2] } })).toEqual([]);
    expect(errs('landing_system__asteroid', { nodes: legs, bbox: { min: [-1.2, -0.45, -1.2], max: [1.2, 0.3, 1.2] } }).join()).toMatch(/footpad contact/);
    const ast = ['lod0', 'lod1', 'mount_sample'].map((name) => ({ name, position: [0, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1], scale: [1, 1, 1] }));
    const astBox = { min: [-4, -2.5, -3], max: [4, 2.5, 3] };
    expect(checkModel('asteroid', { ...base, nodes: ast, triangles: 23000, bbox: astBox }, contract)).toEqual([]);
    expect(errs('asteroid', { nodes: ast, triangles: 25000, bbox: astBox }).join()).toMatch(/budget 24000/);
    expect(errs('debris', { nodes: [], triangles: 6500, bbox: astBox }).join()).toMatch(/budget 6000/);
    expect(errs('earth', { materials: [{ name: 'M_Land', emissive: false, textured: false }], bbox: { min: [-3, -3, -3], max: [3, 3, 3] } }))
      .toEqual(['missing node "pivot_clouds"', 'missing material "M_Ocean"']);
  });
});

describe('optimizer keeps the contract', () => {
  it('pivot/slot/fx/mount nodes survive with their exact transforms', async () => {
    for (const [id, build] of Object.entries(SYNTHETIC)) {
      const before = summarize(build());
      const io = await createIO();
      const after = summarize(await io.readBinary(await optimized(id, build())));
      for (const n of before.nodes.filter((x) => /^(pivot|slot|fx|mount|cam)_/.test(x.name))) {
        const m = after.nodes.find((x) => x.name === n.name);
        expect(m, `${id}/${n.name}`).toBeTruthy();
        for (let k = 0; k < 3; k++) {
          expect(m.position[k]).toBeCloseTo(n.position[k], 4);
          expect(m.yAxis[k]).toBeCloseTo(n.yAxis[k], 4);
          expect(m.scale[k]).toBeCloseTo(n.scale[k], 4);
        }
      }
      expect(checkModel(id, after, contract).filter((i) => i.level === 'error')).toEqual([]);
      expect(after.triangles).toBe(before.triangles);
    }
  });

  it('joins unprotected meshes (fewer meshes) but keeps M_ material names', async () => {
    const io = await createIO();
    const before = summarize(buildFrameTitan());
    const after = summarize(await io.readBinary(await optimized('frame_titan', buildFrameTitan())));
    expect(after.meshes).toBeLessThan(before.meshes);
    expect(after.materials.map((m) => m.name).sort()).toEqual(['M_CreamHull', 'M_Graphite']);
  });

  it('manifest lists valid ids sorted, one entry per id', () => {
    const m = buildManifest([{ id: 'rtg', bytes: 3 }, { id: 'frame_titan', bytes: 9, tris: 400, kind: 'frame' }, { id: 'rtg', bytes: 4 }, { id: 'Bad Id', bytes: 1 }]);
    expect(m.models.map((x) => x.id)).toEqual(['frame_titan', 'rtg']);
    expect(m.models[1]).toEqual({ id: 'rtg', file: 'rtg.glb', bytes: 4, tris: 0, kind: 'module' });
  });
});

describe('game side with the optimized synthetic GLBs (three.js GLTFLoader + meshopt)', () => {
  it('frame slots parse, all 26 get units, and module +Y is the outward normal', async () => {
    const gltf = await parseInThree(await optimized('frame_titan', buildFrameTitan()));
    const slots = collectSlots(gltf.scene);
    expect(slots.size).toBe(26);
    const units = Object.entries(FRAME_SLOT_LAYOUT).flatMap(([dept, L]) => L.map((_, i) => ({ key: `${dept}#${i}`, dept })));
    const assigned = assignSlots(units, slots.keys());
    expect([...assigned.values()].every(Boolean)).toBe(true);
    for (const [dept, L] of Object.entries(FRAME_SLOT_LAYOUT)) {
      L.forEach((def, i) => {
        const t = slots.get(`slot_${dept}_${i + 1}`);
        const want = slotTransform(dept, i);
        const n = new Vector3(0, 1, 0).applyQuaternion({ x: t.quaternion[0], y: t.quaternion[1], z: t.quaternion[2], w: t.quaternion[3], isQuaternion: true });
        expect(n.dot(new Vector3(...def.n))).toBeCloseTo(1, 4);
        // The procedural fallback lands on exactly the same spot.
        const g = gameSlotTransform(dept, i);
        for (let k = 0; k < 3; k++) {
          expect(t.position[k]).toBeCloseTo(want.translation[k], 4);
          expect(g.position[k]).toBeCloseTo(want.translation[k], 6);
        }
        for (let k = 0; k < 4; k++) expect(Math.abs(g.quaternion[k])).toBeCloseTo(Math.abs(t.quaternion[k]), 4);
      });
    }
  });

  it('rotor pivots stay on the pads and spin; glow pulses per instance', async () => {
    const rotor = await parseInThree(await optimized('rotor_system', buildRotorSystem()));
    expect(nodeTransform(rotor.scene, 'pivot_rotor_3').position.map((v) => +v.toFixed(3))).toEqual([-1, 0.92, -1.05]);
    expect(nodeTransform(rotor.scene, 'pivot_rotor_3_lo').position.map((v) => +v.toFixed(3))).toEqual([-1, 0.74, -1.05]);
    const mech = createMechanics(rotor.scene);
    expect(mech.count).toBe(8);
    const p1 = rotor.scene.getObjectByName('pivot_rotor_1');
    const q0 = p1.quaternion.clone();
    mech.update(0.05, false);
    expect(p1.quaternion.angleTo(q0)).toBeGreaterThan(0.1);
    mech.update(0.05, true);
    expect(p1.quaternion.angleTo(q0)).toBeCloseTo(0, 5);
    // Coaxial pair counter-rotates.
    const up = rotor.scene.getObjectByName('pivot_rotor_2'), lo = rotor.scene.getObjectByName('pivot_rotor_2_lo');
    mech.update(0.02, false);
    expect(Math.sign(up.rotation.y)).toBe(-Math.sign(lo.rotation.y));

    const rtg = await parseInThree(await optimized('rtg', buildRtg()));
    toonify(rtg.scene);
    const glow = createMechanics(rtg.scene);
    expect(glow.count).toBe(1);
  });

  it('toon look: toon materials, ink outlines everywhere except M_Emissive, x-ray hides outlines', async () => {
    const gltf = await parseInThree(await optimized('rtg', buildRtg()));
    toonify(gltf.scene);
    const meshes = [];
    gltf.scene.traverse((o) => { if (o instanceof Mesh) meshes.push(o); });
    const real = meshes.filter((m) => !m.userData.inkOutline);
    const outlines = meshes.filter((m) => m.userData.inkOutline);
    expect(real.every((m) => m.material.type === 'MeshToonMaterial')).toBe(true);
    const emissive = real.find((m) => m.material.name === 'M_Emissive');
    expect(emissive.children.some((c) => c.userData.inkOutline)).toBe(false);
    expect(outlines.length).toBe(real.length - 1);
    applyVariant(gltf.scene, { xray: true });
    expect(outlines.every((o) => !o.visible)).toBe(true);
    applyVariant(gltf.scene, { xray: false });
    expect(outlines.every((o) => o.visible)).toBe(true);
  });

  it('contract overlay ids match the game list (variants <id>__<mission> map onto a base id)', () => {
    const fromContract = [...new Set(Object.entries(contract.kind).filter(([, k]) => k === 'overlay').map(([id]) => baseOverlayId(id)))].sort();
    expect([...OVERLAY_IDS].sort()).toEqual(fromContract);
  });

  it('frame_asteroid: 30 slots incl. recovery, fallback lands on the same spots', async () => {
    const gltf = await parseInThree(await optimized('frame_asteroid', buildFrameAsteroid()));
    const slots = collectSlots(gltf.scene);
    expect(slots.size).toBe(30);
    expect(contract.nodes.frame_asteroid.filter((n) => n.startsWith('slot_')).sort()).toEqual([...slots.keys()].sort());
    for (const [dept, L] of Object.entries(FRAME_ASTEROID_SLOT_LAYOUT)) {
      L.forEach((_, i) => {
        const t = slots.get(`slot_${dept}_${i + 1}`);
        const g = gameSlotTransform(dept, i, 'frame_asteroid');
        for (let k = 0; k < 3; k++) expect(t.position[k]).toBeCloseTo(g.position[k], 4);
        const dotQ = t.quaternion.reduce((acc, v, k) => acc + v * g.quaternion[k], 0);
        expect(Math.abs(dotQ)).toBeCloseTo(1, 4);
      });
    }
  });

  it('model-contract.json frames and src/scene/layout.ts SLOT_TABLE agree (position, normal, bay, adapter lift, cradle)', () => {
    for (const frame of ['frame_titan', 'frame_asteroid']) {
      for (const [name, want] of Object.entries(contract.frames[frame].slots)) {
        const got = slotDefOf(frame, name);
        expect(got, name).toBeTruthy();
        for (let k = 0; k < 3; k++) { expect(got.p[k]).toBeCloseTo(want.p[k], 3); expect(got.n[k]).toBeCloseTo(want.n[k], 3); }
        expect(got.bay, name).toEqual(want.bay);
        expect(got.lift, name).toBeCloseTo(want.lift, 5);
        expect(!!got.cradle, name).toBe(!!want.cradle);
        expect(got.maxFoot, name).toBe(want.maxFoot);
      }
    }
  });

  it('capsule mounts survive optimization and match the placeholder mounts', async () => {
    const gltf = await parseInThree(await optimized('return_capsule', buildReturnCapsule()));
    for (const name of ['mount_heat_shield', 'mount_parachute', 'mount_beacon']) {
      const t = nodeTransform(gltf.scene, name);
      for (let k = 0; k < 3; k++) expect(t.position[k]).toBeCloseTo(CAPSULE_MOUNT_DEFAULT[name].position[k], 1);
      const dotQ = t.quaternion.reduce((acc, v, k) => acc + v * CAPSULE_MOUNT_DEFAULT[name].quaternion[k], 0);
      expect(Math.abs(dotQ)).toBeCloseTo(1, 4);
    }
  });

  it('parachute canopy is stowed on load; reaction wheels spin about their own axles; LEDs blink per instance', async () => {
    const chute = await parseInThree(await optimized('parachute', buildParachute()));
    const pc = chute.scene.getObjectByName('pivot_chute');
    createMechanics(chute.scene, 'parachute').update(0.016, false);
    expect(pc.scale.x).toBeLessThan(0.01);

    const rw = await parseInThree(await optimized('reaction_wheels', buildReactionWheels()));
    const mech = createMechanics(rw.scene, 'reaction_wheels');
    expect(mech.count).toBe(3);
    const w = [1, 2, 3].map((i) => rw.scene.getObjectByName(`pivot_wheel_${i}`));
    const q0 = w.map((o) => o.quaternion.clone());
    mech.update(0.1, false);
    const axisOf = (o, q) => { const d = q.clone().invert().multiply(o.quaternion); return new Vector3(d.x, d.y, d.z).normalize(); };
    expect(Math.abs(axisOf(w[0], q0[0]).x)).toBeCloseTo(1, 3);
    expect(Math.abs(axisOf(w[1], q0[1]).y)).toBeCloseTo(1, 3);
    expect(Math.abs(axisOf(w[2], q0[2]).z)).toBeCloseTo(1, 3);

    const db = await parseInThree(await optimized('data_buffer', buildDataBuffer()));
    toonify(db.scene);
    const other = db.scene.clone();
    const blink = createMechanics(db.scene, 'data_buffer');
    expect(blink.count).toBe(6);
    const led = (root, i) => { let m = null; root.getObjectByName(`led_${i}`).traverse((o) => { if (o instanceof Mesh && !m) m = o; }); return m; };
    const seen = new Set();
    for (let k = 0; k < 12; k++) { blink.update(0.1, false); seen.add(led(db.scene, 1).material.emissiveIntensity.toFixed(2)); }
    expect(seen.size).toBe(2);
    expect(led(db.scene, 1).material).not.toBe(led(other, 1).material); // per-instance material
  });
});
