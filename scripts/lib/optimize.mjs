// Lossless-ish optimization that keeps every contract node intact.
// dedup → resample → prune(keepLeaves) → weld → split meshes off protected nodes → join (unprotected only) → meshopt.
import { AnimationChannel, Logger } from '@gltf-transform/core';
import { dedup, join, meshopt, prune, resample, weld } from '@gltf-transform/functions';
import { PROTECTED_PREFIX } from './contract.mjs';
import { MeshoptEncoder } from './io.mjs';

/** Nodes whose name/transform the game relies on. */
export function protectedNames(id, contract) {
  return new Set([...(contract.nodes?.[id] ?? []), 'lake']);
}

function isProtected(node, names, joints) {
  const name = node.getName();
  return PROTECTED_PREFIX.test(name) || names.has(name) || !!node.getSkin() || joints.has(node)
    || node.listParents().some((p) => p instanceof AnimationChannel);
}

/**
 * A protected node that carries a mesh would have its TRS rewritten by quantization (pivot moves off its axle).
 * Move the mesh onto a fresh identity child so the named node keeps its exact transform.
 */
export function splitProtectedMeshes(doc, names) {
  let n = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || node.getSkin()) continue;
    const name = node.getName();
    if (!PROTECTED_PREFIX.test(name)) continue; // plain named meshes (lake, charge_*) keep their mesh
    const child = doc.createNode(`${name}_mesh`).setMesh(mesh);
    node.setMesh(null).addChild(child);
    n++;
  }
  return n;
}

/**
 * @param {import('@gltf-transform/core').Document} doc
 * @param {{ id: string, contract: object, join?: boolean }} opts
 */
export async function optimizeDocument(doc, { id, contract, join: doJoin = true }) {
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  const names = protectedNames(id, contract);
  const keep = { keepLeaves: true, keepExtras: true, keepAttributes: false, keepSolidTextures: true };
  await doc.transform(dedup({ keepUniqueNames: true }));
  if (doc.getRoot().listAnimations().length) await doc.transform(resample());
  await doc.transform(prune(keep), weld());
  splitProtectedMeshes(doc, names);

  if (doJoin) {
    const joints = new Set(doc.getRoot().listSkins().flatMap((s) => s.listJoints()));
    await doc.transform(join({ keepNamed: false, keepMeshes: false, cleanup: false, filter: (node) => !isProtected(node, names, joints) }));
    // join leaves the merged-away nodes behind with empty meshes; drop them (never protected ones).
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (mesh && mesh.listPrimitives().length === 0) node.setMesh(null);
      if (!node.getMesh() && node.listChildren().length === 0 && !isProtected(node, names, joints) && !node.getCamera()) {
        // Only drop nodes that held geometry before: a plain empty node without a protected name is meaningless to the game.
        node.dispose();
      }
    }
    await doc.transform(prune(keep));
  }

  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return doc;
}
