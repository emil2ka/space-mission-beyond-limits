// Synthetic contract-conforming GLBs for tests and for previewing slot placement without real models.
import { readFileSync } from 'node:fs';
import { Document } from '@gltf-transform/core';

const CONTRACT = JSON.parse(readFileSync(new URL('../model-contract.json', import.meta.url), 'utf8'));

/**
 * Hulls v2 slot tables { dept: [{ p, n }] } from model-contract.json "frames" (mirrored by src/scene/layout.ts SLOT_TABLE).
 * p = bay-floor centre, n = outward normal.
 */
function tableOf(frameId) {
  const out = {};
  for (const [name, def] of Object.entries(CONTRACT.frames[frameId].slots)) {
    const [, dept, idx] = /^slot_([a-z]+)_(\d+)$/.exec(name);
    (out[dept] ??= [])[Number(idx) - 1] = def;
  }
  return out;
}
export const FRAME_SLOT_LAYOUT = tableOf('frame_titan');
export const FRAME_ASTEROID_SLOT_LAYOUT = tableOf('frame_asteroid');
export const TITAN = CONTRACT.frames.frame_titan;
export const ASTEROID = CONTRACT.frames.frame_asteroid;

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Quaternion [x,y,z,w] from orthonormal basis columns (local X, Y, Z in parent space). */
export function quatFromBasis(X, Y, Z) {
  const m00 = X[0], m01 = Y[0], m02 = Z[0];
  const m10 = X[1], m11 = Y[1], m12 = Z[1];
  const m20 = X[2], m21 = Y[2], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}

/** Slot transform in frame coordinates: local +Y = outward normal, +Z = up (side) / world +Z (deck, belly). Overflow as in layout.ts. */
export function slotTransform(dept, index, layout = FRAME_SLOT_LAYOUT) {
  const list = layout[dept];
  const n = list.length;
  const { p, n: Y } = list[index % n];
  const Z = Math.abs(Y[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0];
  const X = cross(Y, Z);
  const k = Math.floor(index / n) * 0.12 * (index % 2 ? -1 : 1);
  return { translation: [p[0] + X[0] * k, p[1] + X[1] * k, p[2] + X[2] * k], rotation: quatFromBasis(X, Y, Z) };
}

// ---------- tiny geometry helpers (flat-shaded, indexed) ----------

function addPrim(doc, buffer, mesh, material, positions, normals, indices) {
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer))
    .setMaterial(material);
  mesh.addPrimitive(prim);
  return mesh;
}

export function boxMesh(doc, buffer, material, size, center = [0, 0, 0], name = '') {
  const [sx, sy, sz] = size.map((v) => v / 2);
  const [cx, cy, cz] = center;
  const P = [], N = [], I = [];
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of faces) {
    const base = P.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 1, 2].map((k) => n[k] + a * u[k] + b * v[k]);
      P.push(cx + p[0] * sx, cy + p[1] * sy, cz + p[2] * sz);
      N.push(...n);
    }
    // winding: u × v = n → CCW
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return addPrim(doc, buffer, doc.createMesh(name), material, P, N, I);
}

export function cylinderMesh(doc, buffer, material, r, y0, y1, seg = 24, name = '', phase = 0) {
  const P = [], N = [], I = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2 + phase, a1 = ((i + 1) / seg) * Math.PI * 2 + phase;
    const am = (a0 + a1) / 2;
    const base = P.length / 3;
    const p = (a, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    P.push(...p(a0, y0), ...p(a1, y0), ...p(a1, y1), ...p(a0, y1));
    for (let k = 0; k < 4; k++) N.push(Math.sin(am), 0, Math.cos(am));
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  for (const [y, ny] of [[y1, 1], [y0, -1]]) {
    const c = P.length / 3;
    P.push(0, y, 0); N.push(0, ny, 0);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2 + phase;
      P.push(Math.sin(a) * r, y, Math.cos(a) * r); N.push(0, ny, 0);
    }
    for (let i = 0; i < seg; i++) {
      if (ny > 0) I.push(c, c + 1 + i, c + 2 + i); else I.push(c, c + 2 + i, c + 1 + i);
    }
  }
  return addPrim(doc, buffer, doc.createMesh(name), material, P, N, I);
}

function newDoc(id) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(id);
  doc.getRoot().setDefaultScene(scene);
  const mat = (name, rgb, emissive) => {
    const m = doc.createMaterial(name).setBaseColorFactor([...rgb, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
    if (emissive) m.setEmissiveFactor(emissive);
    return m;
  };
  return { doc, buffer, scene, mat };
}

// ---------- models ----------

/** @param {{ flipSlot?: string }} [opts] flipSlot: name of a slot to point inwards (negative test) */
export function buildFrameTitan(opts = {}) {
  const { doc, buffer, scene, mat } = newDoc('frame_titan');
  const hull = mat('M_CreamHull', [0.97, 0.95, 0.9]);
  const graphite = mat('M_Graphite', [0.2, 0.2, 0.24]);
  const root = doc.createNode('frame_titan');
  scene.addChild(root);
  const { halfWidth: hw, halfLength: hl, deckY } = TITAN.body;
  root.addChild(doc.createNode('body').setMesh(boxMesh(doc, buffer, hull, [hw * 2 - 0.08, deckY - 0.04, hl * 2 - 0.08], [0, (deckY - 0.04) / 2, 0], 'body')));
  for (const [x, , z] of TITAN.pads) {
    const root0 = [Math.sign(x) * 0.5, 0.45, Math.sign(z) * 0.74];
    const len = Math.hypot(x - root0[0], z - root0[2]);
    const yaw = Math.atan2(x - root0[0], z - root0[2]);
    root.addChild(doc.createNode('arm').setMesh(boxMesh(doc, buffer, graphite, [0.12, 0.1, len], [0, 0, 0], 'arm'))
      .setTranslation([(x + root0[0]) / 2, 0.52, (z + root0[2]) / 2]).setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]));
    root.addChild(doc.createNode('pad').setMesh(cylinderMesh(doc, buffer, graphite, 0.11, 0.56, 0.62, 16, 'pad')).setTranslation([x, 0, z]));
  }
  for (const sx of [-1, 1]) root.addChild(doc.createNode('ear').setMesh(boxMesh(doc, buffer, graphite, [0.08, 0.35, 0.48], [sx * 0.34, 0.725, -0.56], 'ear')));
  for (const dept of Object.keys(FRAME_SLOT_LAYOUT)) {
    FRAME_SLOT_LAYOUT[dept].forEach(({ n }, i) => {
      const name = `slot_${dept}_${i + 1}`;
      const t = slotTransform(dept, i);
      if (opts.flipSlot === name) {
        const Y = n.map((v) => -v), Z = Math.abs(Y[1]) > 0.5 ? [0, 0, 1] : [0, 1, 0];
        t.rotation = quatFromBasis(cross(Y, Z), Y, Z); // points into the hull
      }
      root.addChild(doc.createNode(name).setTranslation(t.translation).setRotation(t.rotation));
    });
  }
  root.addChild(doc.createNode('cam_front').setTranslation([0, 0.35, 0.86]).setRotation([0, 1, 0, 0]));
  root.addChild(doc.createNode('cam_top').setTranslation([0, 2.2, 0]).setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]));
  return doc;
}

export function buildRotorSystem() {
  const { doc, buffer, scene, mat } = newDoc('rotor_system');
  const graphite = mat('M_Graphite', [0.2, 0.2, 0.24]);
  const orange = mat('M_Orange', [1, 0.6, 0.29]);
  const root = doc.createNode('rotor_system');
  scene.addChild(root);
  const [loY, hiY] = TITAN.rotorHubY;
  TITAN.pads.forEach(([x, padY, z], i) => {
    root.addChild(doc.createNode('motor').setMesh(cylinderMesh(doc, buffer, graphite, 0.08, padY, hiY, 12, 'motor')).setTranslation([x, 0, z]));
    // pivot carries the hub mesh itself + a blade child: exercises the optimizer's mesh split
    for (const [suffix, y] of [['', hiY], ['_lo', loY]]) {
      const pivot = doc.createNode(`pivot_rotor_${i + 1}${suffix}`).setTranslation([x, y, z])
        .setMesh(cylinderMesh(doc, buffer, graphite, 0.06, -0.03, 0.03, 12, 'hub'));
      pivot.addChild(doc.createNode('blades').setMesh(boxMesh(doc, buffer, orange, [0.9, 0.03, 0.12], [0, 0, 0], 'blades')));
      root.addChild(pivot);
    }
  });
  return doc;
}

/** Module with a 2-axis gimbal: pivot_dish (mesh + child) → pivot_dish_tilt → dish. */
export function buildAntennaHighGain(opts = {}) {
  const { doc, buffer, scene, mat } = newDoc('antenna_high_gain');
  const plate = mat('M_PlatePurple', [0.45, 0.42, 0.55]);
  const cream = mat('M_CreamHull', [0.97, 0.95, 0.9]);
  const pink = mat('M_Pink', [1, 0.62, 0.78]);
  const lift = opts.liftBase ?? 0;
  const root = doc.createNode('antenna_high_gain').setTranslation([0, lift, 0]);
  scene.addChild(root);
  root.addChild(doc.createNode('plate').setMesh(boxMesh(doc, buffer, plate, [0.22, 0.03, 0.22], [0, 0.015, 0], 'plate')));
  root.addChild(doc.createNode('mast').setMesh(cylinderMesh(doc, buffer, cream, 0.04, 0.03, 0.3, 12, 'mast')));
  root.addChild(doc.createNode('tab').setMesh(boxMesh(doc, buffer, pink, [0.05, 0.02, 0.02], [0.1, 0.04, 0], 'tab')));
  const az = doc.createNode('pivot_dish').setTranslation([0, 0.3, 0]).setMesh(boxMesh(doc, buffer, cream, [0.12, 0.06, 0.08], [0, 0.03, 0], 'gimbal'));
  const tilt = doc.createNode('pivot_dish_tilt').setTranslation([0, 0.08, 0]);
  tilt.addChild(doc.createNode('dish').setMesh(cylinderMesh(doc, buffer, cream, 0.35, 0.0, 0.05, 24, 'dish')));
  if (!opts.dropTilt) az.addChild(tilt);
  root.addChild(az);
  return doc;
}

/** Module with an fx_glow empty next to an M_Emissive mesh. */
export function buildRtg() {
  const { doc, buffer, scene, mat } = newDoc('rtg');
  const graphite = mat('M_Graphite', [0.2, 0.2, 0.24]);
  const glow = mat('M_Emissive', [1, 0.55, 0.2], [1, 0.55, 0.2]);
  const root = doc.createNode('rtg');
  scene.addChild(root);
  root.addChild(doc.createNode('body').setMesh(cylinderMesh(doc, buffer, graphite, 0.15, 0, 0.55, 16, 'body')));
  const ring = doc.createNode('glow_ring').setMesh(cylinderMesh(doc, buffer, glow, 0.17, 0.02, 0.06, 16, 'glow_ring'));
  root.addChild(ring);
  root.addChild(doc.createNode('fx_glow').setTranslation([0, 0.04, 0]));
  return doc;
}

export function buildTestStand() {
  const { doc, buffer, scene, mat } = newDoc('test_stand');
  const purple = mat('M_PlatePurple', [0.45, 0.42, 0.55]);
  const glow = mat('M_Emissive', [0.36, 0.88, 0.9], [0.36, 0.88, 0.9]);
  const root = doc.createNode('test_stand');
  scene.addChild(root);
  root.addChild(doc.createNode('base').setMesh(cylinderMesh(doc, buffer, purple, 1.6, 0, 0.3, 32, 'base')));
  root.addChild(doc.createNode('ring').setMesh(cylinderMesh(doc, buffer, glow, 1.62, 0.12, 0.18, 32, 'ring')));
  const turn = doc.createNode('pivot_turntable').setTranslation([0, 0.3, 0]).setMesh(cylinderMesh(doc, buffer, purple, 1.2, 0, 0.05, 32, 'top'));
  turn.addChild(doc.createNode('mount_craft').setTranslation([0, 0.5, 0]));
  root.addChild(turn);
  return doc;
}

/** Hexagonal bus with 30 slots (incl. slot_recovery_1 at the deck centre). */
export function buildFrameAsteroid(opts = {}) {
  const { doc, buffer, scene, mat } = newDoc('frame_asteroid');
  const hull = mat('M_CreamHull', [0.97, 0.95, 0.9]);
  const graphite = mat('M_Graphite', [0.2, 0.2, 0.24]);
  const root = doc.createNode('frame_asteroid');
  scene.addChild(root);
  const { apothem, height, ringTopY } = ASTEROID.body;
  const corner = apothem / Math.cos(Math.PI / 6);
  root.addChild(doc.createNode('body').setMesh(cylinderMesh(doc, buffer, hull, corner, 0, height, 6, 'body', Math.PI / 6)));
  root.addChild(doc.createNode('cradle').setMesh(cylinderMesh(doc, buffer, graphite, 0.42, height, ringTopY, 16, 'cradle')));
  for (const dept of Object.keys(FRAME_ASTEROID_SLOT_LAYOUT)) {
    FRAME_ASTEROID_SLOT_LAYOUT[dept].forEach((_, i) => {
      const name = `slot_${dept}_${i + 1}`;
      const t = slotTransform(dept, i, FRAME_ASTEROID_SLOT_LAYOUT);
      if (opts.movedSlot === name) t.translation = [t.translation[0], t.translation[1] + 0.2, t.translation[2]]; // off its bay (negative test)
      root.addChild(doc.createNode(name).setTranslation(t.translation).setRotation(t.rotation));
    });
  }
  root.addChild(doc.createNode('cam_front').setTranslation([0, 0.45, 0.75]).setRotation([0, 1, 0, 0]));
  root.addChild(doc.createNode('cam_top').setTranslation([0, 2.0, 0]).setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]));
  return doc;
}

/** Gumdrop capsule on a clamp ring with the three mounts. */
export function buildReturnCapsule() {
  const { doc, buffer, scene, mat } = newDoc('return_capsule');
  const cream = mat('M_CreamHull', [0.97, 0.95, 0.9]);
  const orange = mat('M_Orange', [1, 0.6, 0.29]);
  const root = doc.createNode('return_capsule');
  scene.addChild(root);
  root.addChild(doc.createNode('clamp').setMesh(cylinderMesh(doc, buffer, orange, 0.37, 0, 0.12, 20, 'clamp')));
  root.addChild(doc.createNode('capsule').setMesh(cylinderMesh(doc, buffer, cream, 0.35, 0.12, 0.57, 20, 'capsule')));
  root.addChild(doc.createNode('mount_heat_shield').setTranslation([0, 0.12, 0]));
  root.addChild(doc.createNode('mount_parachute').setTranslation([0, 0.57, 0]));
  root.addChild(doc.createNode('mount_beacon').setTranslation([0, 0.3, 0.33]).setRotation([Math.SQRT1_2, 0, 0, Math.SQRT1_2]));
  return doc;
}

/** Capsule part: origin on its top face, hangs down to y = -0.1, glowing M_Emissive underside. */
export function buildHeatShield() {
  const { doc, buffer, scene, mat } = newDoc('heat_shield');
  const brown = mat('M_Ablator', [0.3, 0.22, 0.18]);
  const glow = mat('M_Emissive', [1, 0.5, 0.2], [1, 0.5, 0.2]);
  const root = doc.createNode('heat_shield');
  scene.addChild(root);
  root.addChild(doc.createNode('dish').setMesh(cylinderMesh(doc, buffer, brown, 0.36, -0.09, 0, 24, 'dish')));
  root.addChild(doc.createNode('underside').setMesh(cylinderMesh(doc, buffer, glow, 0.33, -0.1, -0.09, 24, 'underside')));
  root.addChild(doc.createNode('fx_glow').setTranslation([0, -0.11, 0]));
  return doc;
}

/** Canister + pivot_chute holding the fully deployed canopy (~2 m tall). */
export function buildParachute() {
  const { doc, buffer, scene, mat } = newDoc('parachute');
  const cream = mat('M_CreamHull', [0.97, 0.95, 0.9]);
  const orange = mat('M_Orange', [1, 0.6, 0.29]);
  const root = doc.createNode('parachute');
  scene.addChild(root);
  root.addChild(doc.createNode('canister').setMesh(cylinderMesh(doc, buffer, cream, 0.1, 0, 0.18, 16, 'canister')));
  const chute = doc.createNode('pivot_chute').setTranslation([0, 0.18, 0]);
  chute.addChild(doc.createNode('canopy').setMesh(cylinderMesh(doc, buffer, orange, 1.0, 1.6, 1.9, 24, 'canopy')));
  chute.addChild(doc.createNode('risers').setMesh(boxMesh(doc, buffer, cream, [0.04, 1.6, 0.04], [0, 0.8, 0], 'risers')));
  root.addChild(chute);
  return doc;
}

/** Box with 3 flywheels; axles along X, Y, Z. */
export function buildReactionWheels() {
  const { doc, buffer, scene, mat } = newDoc('reaction_wheels');
  const plate = mat('M_PlatePurple', [0.45, 0.42, 0.55]);
  const graphite = mat('M_Graphite', [0.2, 0.2, 0.24]);
  const root = doc.createNode('reaction_wheels');
  scene.addChild(root);
  root.addChild(doc.createNode('box').setMesh(boxMesh(doc, buffer, plate, [0.3, 0.2, 0.3], [0, 0.1, 0], 'box')));
  [[-0.08, 0.12, 0], [0, 0.12, 0], [0.08, 0.12, 0]].forEach((p, i) => {
    root.addChild(doc.createNode(`pivot_wheel_${i + 1}`).setTranslation(p)
      .setMesh(cylinderMesh(doc, buffer, graphite, 0.05, -0.01, 0.01, 12, `wheel_${i + 1}`)));
  });
  return doc;
}

/** Memory block with 6 led_* meshes (M_Emissive). */
export function buildDataBuffer() {
  const { doc, buffer, scene, mat } = newDoc('data_buffer');
  const plate = mat('M_PlatePurple', [0.45, 0.42, 0.55]);
  const glow = mat('M_Emissive', [1, 0.62, 0.78], [1, 0.62, 0.78]);
  const root = doc.createNode('data_buffer');
  scene.addChild(root);
  root.addChild(doc.createNode('block').setMesh(boxMesh(doc, buffer, plate, [0.18, 0.1, 0.15], [0, 0.05, 0], 'block')));
  for (let i = 0; i < 6; i++) {
    root.addChild(doc.createNode(`led_${i + 1}`).setMesh(boxMesh(doc, buffer, glow, [0.015, 0.01, 0.015], [-0.06 + i * 0.024, 0.105, 0.05], `led_${i + 1}`)));
  }
  return doc;
}

export const SYNTHETIC = {
  frame_titan: buildFrameTitan,
  frame_asteroid: buildFrameAsteroid,
  return_capsule: buildReturnCapsule,
  heat_shield: buildHeatShield,
  parachute: buildParachute,
  reaction_wheels: buildReactionWheels,
  data_buffer: buildDataBuffer,
  rotor_system: buildRotorSystem,
  antenna_high_gain: buildAntennaHighGain,
  rtg: buildRtg,
  test_stand: buildTestStand,
};
