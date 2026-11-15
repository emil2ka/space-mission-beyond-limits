// Online transport: Supabase Realtime (broadcast + presence) + a `rooms` table for persistence.
// Same contract as LocalTransport (see transport.ts). Switched on automatically when
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set (src/net/index.ts).
// Checked on the live project (2026-11-15): two players in one room by code, the row lands in public.rooms.
// Not yet checked: a full four-device flight. Setup guide: docs/04 Tech/Multiplayer.md.
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { RoomState } from '../engine';
import type { NetMessage, Transport, TransportHandlers } from './transport';

/** RLS in supabase/schema.sql only shows a row whose code matches this header: rooms can't be listed. */
const ROOM_HEADER = 'x-room-code';

export class SupabaseTransport implements Transport {
  readonly mode = 'online' as const;
  private db: SupabaseClient | null = null;
  private ch: RealtimeChannel | null = null;
  private code = '';

  constructor(private url: string, private key: string) {}

  /** One client per room code: the code travels as a header that the RLS policies check. */
  private client(code: string): SupabaseClient {
    if (this.db && this.code === code) return this.db;
    this.code = code;
    this.db = createClient(this.url, this.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { [ROOM_HEADER]: code } },
    });
    return this.db;
  }

  async open(code: string, playerId: string, h: TransportHandlers) {
    const db = this.client(code);
    const ch = db.channel(`room:${code}`, { config: { broadcast: { self: false, ack: false }, presence: { key: playerId } } });
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => h.onMessage(payload as NetMessage));
    ch.on('presence', { event: 'sync' }, () => h.onPresence(Object.keys(ch.presenceState())));
    await new Promise<void>((resolve, reject) => {
      let first = true;
      ch.subscribe(async (status, err) => {
        // SUBSCRIBED also fires after an automatic rejoin (network drop): track presence again each time.
        if (status === 'SUBSCRIBED') {
          await ch.track({ at: Date.now() });
          if (first) { first = false; resolve(); }
        }
        if (first && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) { first = false; reject(new Error(`Realtime: ${status}${err ? ` ${err.message}` : ''}`)); }
      });
    });
    this.ch = ch;
  }

  send(m: NetMessage) {
    void this.ch?.send({ type: 'broadcast', event: 'msg', payload: m });
  }

  save(s: RoomState) {
    // A trigger in schema.sql ignores writes with an older version (a slow former host can't roll the room back).
    void this.client(s.code).from('rooms')
      .upsert({ code: s.code, state: s, version: s.version, host_id: s.hostId, updated_at: new Date().toISOString() })
      .then(({ error }) => { if (error) console.warn('[supabase] save failed:', error.message); });
  }

  async load(code: string) {
    const { data, error } = await this.client(code).from('rooms').select('state').eq('code', code).maybeSingle();
    if (error) console.warn('[supabase] load failed:', error.message);
    return (data?.state as RoomState | undefined) ?? null;
  }

  close() {
    const ch = this.ch;
    this.ch = null;
    if (ch && this.db) void ch.untrack().finally(() => this.db?.removeChannel(ch));
  }
}
