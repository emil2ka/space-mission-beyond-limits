// Validate GLB files against scripts/model-contract.json and print a table.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { bboxSize, checkModel, kindOf, statusOf, triangleBudget } from './contract.mjs';
import { summarize } from './inspect.mjs';
import { createIO } from './io.mjs';

export const idFromPath = (p) => basename(p).replace(/\.glb$/i, '');

/** @returns {Promise<{ id, path, kind, summary, issues, status }>} */
export async function validateFile(path, contract, id = idFromPath(path)) {
  const io = await createIO();
  let summary, issues;
  try {
    const bytes = readFileSync(path);
    const doc = await io.readBinary(new Uint8Array(bytes));
    summary = summarize(doc, { bytes: bytes.byteLength });
    issues = checkModel(id, summary, contract);
  } catch (e) {
    summary = null;
    issues = [{ level: 'error', msg: `cannot read GLB: ${e.message}` }];
  }
  return { id, path, kind: kindOf(id, contract), summary, issues, status: statusOf(issues) };
}

export function formatTable(results, contract) {
  const rows = [['id', 'kind', 'tris / budget', 'size W×H×D m', 'KB', 'status', 'err', 'warn']];
  for (const r of results) {
    const s = r.summary;
    const size = s?.bbox ? bboxSize(s.bbox).map((v) => v.toFixed(2)).join('×') : '—';
    rows.push([
      r.id, r.kind,
      s ? `${s.triangles} / ${triangleBudget(r.id, contract)}` : '—',
      size,
      s ? String(Math.round(s.bytes / 1024)) : '—',
      r.status,
      String(r.issues.filter((i) => i.level === 'error').length),
      String(r.issues.filter((i) => i.level === 'warn').length),
    ]);
  }
  const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => row[c].length)));
  const line = (row) => row.map((cell, c) => cell.padEnd(widths[c])).join('  ');
  const out = [line(rows[0]), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.slice(1).map(line)];
  const details = results.filter((r) => r.issues.length);
  if (details.length) {
    out.push('');
    for (const r of details) {
      out.push(`${r.id}:`);
      for (const i of r.issues) out.push(`  ${i.level === 'error' ? 'ERROR' : 'warn '} ${i.msg}`);
    }
  }
  return out.join('\n');
}
