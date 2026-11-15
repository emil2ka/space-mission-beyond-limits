// Device QA: the player id must also work over plain http on the LAN (phone → `pnpm dev:lan`), where
// crypto.randomUUID is missing (secure contexts only).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../identity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when present', () => {
    expect(newId()).toMatch(UUID);
  });

  it('falls back to getRandomValues in an insecure context (no randomUUID)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (b: Uint8Array<ArrayBuffer>) => real.getRandomValues(b) });
    const a = newId(), b = newId();
    expect(a).toMatch(UUID);
    expect(a).not.toBe(b);
  });
});
