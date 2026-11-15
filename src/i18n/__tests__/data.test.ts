// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as E from '../../engine';
import * as T from '../../engine/data/tasks';
import * as R from '../../engine/data/rules';
import { DATA_EN } from '../data.en';

const CYR = /[А-Яа-яЁё]/;

function collect(): string[] {
  const out = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') { if (CYR.test(v)) out.add(v); return; }
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    for (const x of Object.values(v)) walk(x);
  };
  for (const mod of [E, T, R] as Record<string, unknown>[]) {
    for (const [k, v] of Object.entries(mod)) {
      if (typeof v !== 'function' && k === k.toUpperCase()) walk(v);
    }
  }
  return [...out];
}

describe('DATA_EN', () => {
  const strings = collect();

  it('finds engine data strings', () => {
    expect(strings.length).toBeGreaterThan(100);
  });

  it('has an English translation for every Russian data string', () => {
    const missing = strings.filter((s) => !DATA_EN[s]?.trim());
    expect(missing).toEqual([]);
  });

  it('translations contain no Cyrillic', () => {
    const bad = Object.entries(DATA_EN).filter(([, en]) => CYR.test(en));
    expect(bad).toEqual([]);
  });
});
