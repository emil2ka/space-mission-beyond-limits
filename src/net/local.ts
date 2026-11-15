// Local demo transport: BroadcastChannel between tabs of the same browser.
// Honest "local demo mode" (ТЗ §2) — every tab is a real separate client, no fake bots.
// Presence: each tab pings every PING_MS; a tab silent for STALE_MS (or that said 'bye') is offline.
import type { RoomState } from '../engine';
import type { NetMessage, Transport, TransportHandlers } from './transport';
import { every, type TimerHandle } from './clock';

const PING_MS = 1000;
const STALE_MS = 3500;

/** `hi` = I just opened the channel: everyone answers with a ping at once, so a new host knows who is here. */
type Wire = { k: 'msg'; m: NetMessage } | { k: 'ping'; from: string; hi?: boolean } | { k: 'bye'; from: string };

export class LocalTransport implements Transport {
  readonly mode = 'local' as const;
  private ch: BroadcastChannel | null = null;
  private code = '';
  private me = '';
  private seen = new Map<string, number>();
  private timer: TimerHandle | null = null;
  private h: TransportHandlers | null = null;
  private lastKey = '';
  private onUnload = () => this.ch?.postMessage({ k: 'bye', from: this.me } satisfies Wire);

  async open(code: string, playerId: string, h: TransportHandlers) {
    this.code = code;
    this.me = playerId;
    this.h = h;
    this.ch = new BroadcastChannel(`space-mission:${code}`);
    this.ch.onmessage = (e) => this.receive(e.data as Wire);
    const ping = () => {
      this.ch?.postMessage({ k: 'ping', from: this.me } satisfies Wire);
      const now = Date.now();
      for (const [id, at] of this.seen) if (now - at > STALE_MS) this.seen.delete(id);
      this.emitPresence();
    };
    this.timer = every(PING_MS, ping);
    addEventListener('pagehide', this.onUnload);
    this.ch.postMessage({ k: 'ping', from: this.me, hi: true } satisfies Wire);
    this.emitPresence();
  }

  private receive(w: Wire) {
    if (w.k === 'msg') { this.h?.onMessage(w.m); return; }
    if (w.from === this.me) return;
    if (w.k === 'ping') {
      const isNew = !this.seen.has(w.from);
      this.seen.set(w.from, Date.now());
      if (w.hi) this.ch?.postMessage({ k: 'ping', from: this.me } satisfies Wire);
      if (isNew) this.emitPresence();
    } else {
      this.seen.delete(w.from);
      this.emitPresence();
    }
  }

  private emitPresence() {
    const online = [this.me, ...this.seen.keys()].sort();
    const key = online.join(',');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.h?.onPresence(online);
  }

  send(m: NetMessage) {
    this.ch?.postMessage({ k: 'msg', m } satisfies Wire);
  }
  save(s: RoomState) {
    try { localStorage.setItem(`space-mission:room:${this.code}`, JSON.stringify(s)); } catch { /* storage may be blocked */ }
  }
  async load(code: string) {
    try {
      const raw = localStorage.getItem(`space-mission:room:${code}`);
      return raw ? (JSON.parse(raw) as RoomState) : null;
    } catch { return null; }
  }
  close() {
    this.onUnload();
    removeEventListener('pagehide', this.onUnload);
    this.timer?.clear();
    this.timer = null;
    this.ch?.close();
    this.ch = null;
    this.h = null;
    this.seen.clear();
  }
}
