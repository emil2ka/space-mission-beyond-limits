#!/usr/bin/env node
// Usage: node scripts/validate-glb.mjs [file.glb ...]      (default: assets-src/*.glb)
// Checks every GLB against scripts/model-contract.json; exits 1 if any model FAILs.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadContract, ROOT } from './lib/io.mjs';
import { formatTable, validateFile } from './lib/validate.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dir = join(ROOT, 'assets-src');
const files = args.length
  ? args
  : existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.glb')).sort().map((f) => join(dir, f)) : [];

if (!files.length) {
  console.log('validate-glb: no GLB files found (assets-src/*.glb is empty).');
  process.exit(0);
}

const contract = loadContract();
const results = [];
for (const f of files) results.push(await validateFile(f, contract));
console.log(formatTable(results, contract));
const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\n${results.length} checked · ${results.length - failed.length} pass · ${failed.length} fail`);
process.exit(failed.length ? 1 : 0);
