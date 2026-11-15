# 0004 Host authority on top of Supabase Realtime — accepted (2026-11-13)
**Decision:** game logic runs on the host (a pure `reduce` from the engine); Supabase is only the channel and the state store. When the host leaves, authority passes to the next player.
**Why:** no server of our own is needed; the logic is the same for local and online modes; determinism makes testing easier.
**Alternatives:** Supabase Edge Functions as the authority (latency, harder development) — possible later.
