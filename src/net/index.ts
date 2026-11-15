import { LocalTransport } from './local';
import { SupabaseTransport } from './supabase';
import type { Transport } from './transport';

export type { Transport, NetMessage, TransportHandlers } from './transport';
export { shouldSave, SAVE_EVERY } from './transport';

/** Online as soon as both keys are in .env.local (see .env.example); otherwise the honest local demo mode. */
export function makeTransport(): Transport {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  return url && key ? new SupabaseTransport(url, key) : new LocalTransport();
}
