// Shared glTF-Transform IO with meshopt + all standard extensions (reads raw and optimized GLBs).
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let ioPromise = null;

export async function createIO() {
  if (!ioPromise) {
    ioPromise = (async () => {
      await MeshoptDecoder.ready;
      await MeshoptEncoder.ready;
      return new NodeIO()
        .setLogger(new Logger(Logger.Verbosity.WARN))
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
    })();
  }
  return ioPromise;
}

export { MeshoptEncoder };

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadContract(path = join(ROOT, 'scripts', 'model-contract.json')) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
