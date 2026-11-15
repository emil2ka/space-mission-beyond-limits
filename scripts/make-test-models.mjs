#!/usr/bin/env node
// Writes synthetic contract-conforming GLBs (frame_titan, rotor_system overlay, antenna_high_gain with pivots,
// rtg with fx_glow, test_stand) — no astronaut. Default output: <os tmp>/space-mission-test-models (never public/).
// Usage: node scripts/make-test-models.mjs [outDir] [--optimized]
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createIO, loadContract } from './lib/io.mjs';
import { optimizeDocument } from './lib/optimize.mjs';
import { SYNTHETIC } from './lib/synthetic.mjs';

const args = process.argv.slice(2);
const out = resolve(args.find((a) => !a.startsWith('--')) ?? join(tmpdir(), 'space-mission-test-models'));
const optimized = args.includes('--optimized');
mkdirSync(out, { recursive: true });
const io = await createIO();
const contract = loadContract();
for (const [id, build] of Object.entries(SYNTHETIC)) {
  const doc = build();
  if (optimized) await optimizeDocument(doc, { id, contract });
  const bytes = await io.writeBinary(doc);
  writeFileSync(join(out, `${id}.glb`), bytes);
  console.log(`${id}.glb  ${(bytes.byteLength / 1024).toFixed(1)} KB`);
}
console.log(`→ ${out}`);
