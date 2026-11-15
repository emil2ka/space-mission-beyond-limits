// Turns a glTF-Transform Document into a plain-data summary that the pure contract checks consume.
import { getBounds } from '@gltf-transform/functions';

const len = (v) => Math.hypot(v[0], v[1], v[2]);
const norm = (v) => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Triangles of one primitive (TRIANGLES / STRIP / FAN), 0 for lines/points. */
export function primitiveTriangles(prim) {
  const mode = prim.getMode();
  const indices = prim.getIndices();
  const pos = prim.getAttribute('POSITION');
  const count = indices ? indices.getCount() : pos ? pos.getCount() : 0;
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {{ bytes?: number }} [extra]
 */
export function summarize(doc, extra = {}) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0] ?? null;
  const nodes = [];
  let triangles = 0;
  const visit = (node, parentName) => {
    const m = node.getWorldMatrix();
    const xAxis = [m[0], m[1], m[2]], yAxis = [m[4], m[5], m[6]], zAxis = [m[8], m[9], m[10]];
    const mesh = node.getMesh();
    if (mesh) for (const p of mesh.listPrimitives()) triangles += primitiveTriangles(p);
    nodes.push({
      name: node.getName(),
      parent: parentName,
      hasMesh: !!mesh,
      meshName: mesh?.getName() ?? null,
      skinned: !!node.getSkin(),
      children: node.listChildren().length,
      position: [m[12], m[13], m[14]],
      xAxis: norm(xAxis), yAxis: norm(yAxis), zAxis: norm(zAxis),
      scale: [len(xAxis), len(yAxis), len(zAxis)],
    });
    for (const c of node.listChildren()) visit(c, node.getName());
  };
  if (scene) for (const n of scene.listChildren()) visit(n, null);

  let bbox = null;
  if (scene && root.listMeshes().length) {
    const b = getBounds(scene);
    if (b && b.min.every(Number.isFinite) && b.max.every(Number.isFinite)) bbox = { min: [...b.min], max: [...b.max] };
  }

  const materials = root.listMaterials().map((mat) => ({
    name: mat.getName(),
    emissive: mat.getEmissiveFactor().some((c) => c > 0.001),
    textured: !!(mat.getBaseColorTexture() || mat.getEmissiveTexture() || mat.getNormalTexture()),
  }));

  return {
    nodes,
    meshNames: root.listMeshes().map((m) => m.getName()),
    materials,
    clips: root.listAnimations().map((a) => a.getName()),
    triangles,
    bbox,
    meshes: root.listMeshes().length,
    textures: root.listTextures().length,
    cameras: root.listCameras().length,
    lights: doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_lights_punctual') ? 1 : 0,
    skins: root.listSkins().length,
    bytes: extra.bytes ?? 0,
  };
}
