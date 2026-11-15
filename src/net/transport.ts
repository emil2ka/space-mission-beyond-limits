import type { Action, RoomState } from '../engine';

/**
 * Room protocol (both transports, decision 0004):
 * - clients send `action`, the host reduces it and broadcasts the whole `state` (with `version`);
 * - `hello` asks for the current state (join / reconnect); the host answers, and while the host is
 *   absent any client answers with its last broadcast, so a returning host or a new host can catch up;
 * - `error` goes back to the player whose action was refused.
 * Presence (who is connected right now) is the transport's job: it calls `onPresence` with the full set.
 */
export type NetMessage =
  | { t: 'hello'; from: string }
  | { t: 'action'; a: Action }
  | { t: 'state'; s: RoomState }
  | { t: 'error'; to: string; msg: string };

export interface TransportHandlers {
  onMessage(m: NetMessage): void;
  /** Ids of everyone connected to this room channel right now, including me. */
  onPresence(online: string[]): void;
}

/** A room channel. The host reduces actions and publishes state; clients only send actions. */
export interface Transport {
  readonly mode: 'local' | 'online';
  open(code: string, playerId: string, h: TransportHandlers): Promise<void>;
  send(m: NetMessage): void;
  /** Persist the latest state so reconnects (and host hand-over) can restore it. Host only. */
  save(s: RoomState): void;
  load(code: string): Promise<RoomState | null>;
  close(): void;
}

/** Host persists the room every SAVE_EVERY versions, and always on stage / player / host changes. */
export const SAVE_EVERY = 10;
export function shouldSave(prev: RoomState | null, next: RoomState): boolean {
  if (!prev || prev.code !== next.code) return true;
  if (prev.stage !== next.stage || prev.hostId !== next.hostId) return true;
  if (prev.players.length !== next.players.length) return true;
  if (prev.players.some((p, i) => p.role !== next.players[i]?.role || p.online !== next.players[i]?.online || p.ready !== next.players[i]?.ready)) return true;
  // 0013: several roles per player, build requests and the second key are worth saving at once (reconnect / host hand-over).
  if (prev.players.some((p, i) => (p.roles ?? []).join() !== (next.players[i]?.roles ?? []).join())) return true;
  if ((prev.requests ?? []).map((r) => r.status).join() !== (next.requests ?? []).map((r) => r.status).join() || !!prev.pendingKey !== !!next.pendingKey) return true;
  return Math.floor(next.version / SAVE_EVERY) !== Math.floor(prev.version / SAVE_EVERY);
}
