#!/usr/bin/env node
// pnpm models [id|file.glb ...] [--force] [--no-join] [--src dir] [--out dir] [--manifest-only]
// 1) validates assets-src/<id>.glb against the contract (FAIL → skipped unless --force)
// 2) optimizes → public/models/<id>.glb (dedup, prune keepLeaves, weld, join unprotected, meshopt)
// 3) re-validates the output (contract nodes must survive), warns > 1.5 MB
// 4) rewrites public/models/manifest.json from the GLBs present in the output dir
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkModel, kindOf, statusOf } from './lib/contract.mjs';
import { summarize } from './lib/inspect.mjs';
import { createIO, loadContract, ROOT } from './lib/io.mjs';
import { buildManifest } from './lib/manifest.mjs';
import { optimizeDocument } from './lib/optimize.mjs';
import { formatTable, idFromPath, validateFile } from './lib/validate.mjs';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
const srcDir = resolve(opt('--src', join(ROOT, 'assets-src')));
const outDir = resolve(opt('--out', join(ROOT, 'public', 'models')));
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--src', '--out'].includes(argv[i - 1]));
const MAX_BYTES = 1.5 * 1024 * 1024;

const contract = loadContract();
const io = await createIO();
mkdirSync(outDir, { recursive: true });

let failed = 0;
if (!flag('--manifest-only')) {
  const files = positional.length
    ? positional.map((p) => (p.endsWith('.glb') ? resolve(p) : join(srcDir, `${p}.glb`)))
    : existsSync(srcDir) ? readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith('.glb')).sort().map((f) => join(srcDir, f)) : [];
  if (!files.length) console.log(`models: no source GLBs in ${srcDir}`);

  const pre = [];
  for (const f of files) pre.push(await validateFile(f, contract));
  if (pre.length) console.log('Source validation\n' + formatTable(pre, contract) + '\n');

  const post = [];
  for (const r of pre) {
    if (r.status === 'FAIL' && !flag('--force')) {
      console.log(`skip ${r.id}: source FAILs the contract (use --force to optimize anyway)`);
      failed++;
      continue;
    }
    try {
      const doc = await io.read(r.path);
      await optimizeDocument(doc, { id: r.id, contract, join: !flag('--no-join') });
      const bytes = await io.writeBinary(doc);
      const outPath = join(outDir, `${r.id}.glb`);
      writeFileSync(outPath, bytes);
      const before = statSync(r.path).size;
      // Re-validate the optimized file: names/pivots must have survived.
      const reread = await io.readBinary(bytes);
      const summary = summarize(reread, { bytes: bytes.byteLength });
      const issues = checkModel(r.id, summary, contract);
      if (bytes.byteLength > MAX_BYTES) issues.push({ level: 'warn', msg: `optimized file ${(bytes.byteLength / 1048576).toFixed(2)} MB > 1.5 MB` });
      post.push({ id: r.id, kind: kindOf(r.id, contract), summary, issues, status: statusOf(issues) });
      console.log(`${r.id}: ${(before / 1024).toFixed(0)} KB → ${(bytes.byteLength / 1024).toFixed(0)} KB`);
      if (statusOf(issues) === 'FAIL') failed++;
    } catch (e) {
      console.log(`ERROR ${r.id}: optimize failed: ${e.message}`);
      failed++;
    }
  }
  if (post.length) console.log('\nOptimized output\n' + formatTable(post, contract));
}

// Manifest from what is actually in the output dir (so a removed GLB disappears from it too).
const entries = [];
for (const f of readdirSync(outDir).filter((x) => x.endsWith('.glb')).sort()) {
  const id = idFromPath(f);
  const bytes = readFileSync(join(outDir, f));
  let tris = 0;
  try { tris = summarize(await io.readBinary(new Uint8Array(bytes))).triangles; } catch { /* unreadable → still listed? no */ continue; }
  entries.push({ id, bytes: bytes.byteLength, tris, kind: kindOf(id, contract) });
}
const manifest = buildManifest(entries);
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nmanifest.json: ${manifest.models.length} model(s)${manifest.models.length ? ' — ' + manifest.models.map((m) => m.id).join(', ') : ''}`);
process.exit(failed ? 1 : 0);
