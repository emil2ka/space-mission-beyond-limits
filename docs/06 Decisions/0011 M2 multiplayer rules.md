# 0011 M2 multiplayer rules: presence, rejoining, host handover, demo — accepted (2026-11-14)
**Context:** spec §2 (TZ v2.0) requires 4 slots, unique roles, ONLINE/OFFLINE/READY, Reconnecting and recovery after rejoining, and an honest local demo mode. It does not say what to do when the host leaves, how long to hold a slot, or how to tell apart tabs of the same browser.
**Decision:**
- Disconnect → "Reconnecting" for 30 s; in the lobby the slot is then freed, in the game the role stays with the player for good.
- The host is silent for 10 s → the online player with the lowest `joinOrder` becomes host, on top of the last state they received; the flight clock passes to them; the old host comes back as a regular player.
- `playerId` lives in localStorage; tabs of the same browser are told apart by Web Locks (a new tab takes a free id → a player who closed their tab comes back as themselves).
- Demo mode is turned on by the host (a button on the home screen or a checkbox in the lobby). Only in demo mode can you start with fewer than four players and switch roles after the lobby.
- A crisis waits for choices only from roles whose players are online.
- Any player can install modules (not only in "their own department") — [Open Questions](../07%20Tasks/Open%20Questions.md) #3 stays open.
**Why:** the game must not get stuck because one laptop in the classroom dropped out; a local check with 4 tabs must work the same as 4 devices.
**Alternatives:** pause the game until the host returns (stuck forever if the host left); a Supabase Edge Function as a permanent authority (more complex, later).
Links: [Multiplayer](../04%20Tech/Multiplayer.md), [0004 Host authority](0004%20Host%20authority.md), `src/engine/__tests__/multiplayer.test.ts`.
