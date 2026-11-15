// Player identity that survives reloads and coming back after closing the tab.
// The playerId lives in localStorage (ТЗ: «после возврата восстановить состояние»). Tabs of one
// browser share localStorage, so each open tab holds a Web Lock on the id it uses: a new tab takes
// the first id nobody holds (= the player who closed their tab comes back as themselves) or makes
// a new one. A reload keeps the same id via sessionStorage. On a phone/PC with one tab it is simply
// "this device's player".

const LIST = 'sm:pids';
const MAX_IDS = 8;

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string | null) => {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ }
};

function tryLock(id: string): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void locks.request(`sm:pid:${id}`, { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return; }
      resolve(true);
      return new Promise<void>(() => { /* held until the tab closes */ });
    });
  });
}

/**
 * crypto.randomUUID exists only in secure contexts (https / localhost). Opened over Wi-Fi from a phone
 * (`pnpm dev:lan`, http://192.168.…) it is undefined — fall back to getRandomValues, which works everywhere.
 */
export function newId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 v4 layout
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function claimPlayerId(): Promise<string> {
  // Same document (e.g. a module re-run): keep the id this tab already holds.
  const w = typeof window !== 'undefined' ? (window as unknown as { __smPid?: Promise<string> }) : null;
  if (w?.__smPid) return w.__smPid;
  const p = claim();
  if (w) w.__smPid = p;
  return p;
}

async function claim(): Promise<string> {
  let own: string | null = null;
  try { own = sessionStorage.getItem('sm:pid'); } catch { /* ignore */ }
  let list: string[] = [];
  try { list = JSON.parse(lsGet(LIST) ?? '[]') as string[]; } catch { list = []; }
  const candidates = [...new Set([own, ...list].filter((x): x is string => !!x))];
  let id: string | null = null;
  for (const c of candidates) if (await tryLock(c)) { id = c; break; }
  if (!id) {
    id = newId();
    await tryLock(id);
  }
  lsSet(LIST, JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, MAX_IDS)));
  try { sessionStorage.setItem('sm:pid', id); } catch { /* ignore */ }
  return id;
}

export const savedName = (id: string) => lsGet(`sm:name:${id}`) ?? '';
export const saveName = (id: string, name: string) => lsSet(`sm:name:${id}`, name);
/** The room this player was in, for automatic reconnect after a reload / coming back. */
export const savedRoom = (id: string) => lsGet(`sm:room:${id}`);
export const saveRoom = (id: string, code: string | null) => lsSet(`sm:room:${id}`, code);
