# Multiplayer

## Model: host authority
- The host (the room's creator) holds the canonical state and applies `reduce()` from `src/engine/room.ts` ([0004 Host authority](../06%20Decisions/0004%20Host%20authority.md)).
- Clients send **actions**; the host validates them (room membership, role, stage, constraints) and broadcasts the **whole new state** with a `version` number (≈ 6 KB in flight).
- A rejection (`error`) goes only to whoever sent the action; the state does not change (tests in `multiplayer.test.ts`).
- The host saves the state (`transport.save`): every 10 versions and always on a change of stage / players / roles / READY / online status / host (`shouldSave` in `src/net/transport.ts`).

## Protocol (the same for both transports)
| Message | Sent by | What it does |
|---|---|---|
| `action` | any client | the host applies `reduce` and broadcasts `state` |
| `state` | the host (and clients in reply to `hello` while there is no host) | the client accepts it if the version is newer; on an equal version the host with the lower `joinOrder` wins |
| `hello` | a joining / returning client | the host replies with `state`; if the host is offline or the host itself is asking (it reloaded), the clients reply with their latest `state` |
| `error` | the host | the rejection text for player `to` |
Presence (who is connected right now) is the transport's job: `onPresence(ids)`.

## Transports
| Transport | When | Presence | Status |
|---|---|---|---|
| `LocalTransport` | no Supabase keys. BroadcastChannel between tabs of the same browser — an honest **local mode** (a banner at the top) | a ping every 1 s; 3.5 s of silence or a `bye` when the tab closes → offline; a new tab asks everyone to reply right away | **verified in 4 tabs** (test F, 2026-11-14) |
| `SupabaseTransport` | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set — turns on automatically (`src/net/index.ts`) | Realtime presence on the `room:<CODE>` channel; after the channel auto-reconnects, presence is re-tracked | written to the same contract, **not verified** (no project) |
Ping and flight-clock timers run in a Web Worker (`src/net/clock.ts`): the browser does not throttle them in a background tab (a plain `setTimeout` fires only once a minute there).
There are no fake bots pretending to be players (a requirement of the spec, TZ v2.0).

## Who am I: playerId
- `playerId` is stored in `localStorage` (`sm:pids`), the name in `sm:name:<id>`, the last room in `sm:room:<id>`.
- Tabs of the same browser share `localStorage`, so each open tab holds a **Web Lock** on its id. A new tab takes the first free id (a player who closed their tab comes back as themselves) or creates a new one. A reload keeps the id via `sessionStorage`.
- On a phone / laptop with a single tab, this is simply "the player on this device".
- On startup, the tab rejoins the last room by itself (`sm:room:<id>`). "Leave" clears this memory.

## Room (lobby)
- Code: 6 characters, without look-alikes (no 0/O/1/I/L).
- 4 slots: name, "(you)", ★ host, role, **ONLINE / Reconnecting… N s / OFFLINE**, **READY**.
- A role cannot be taken twice: checked in the engine (`pickRole` → "This role is already taken.") and the role button is disabled with the caption "Taken: <name>". Exception (0013 §4): if a player has two roles, another player in the lobby can take the extra one — the card "<name> has two — take it".
- A player can have several roles: `Player.roles` (the first is their own; `Player.role` = `roles[0]` for older screens and clients; the engine fills in `roles` for older saves by itself, `normalizeRoles`).
- READY only with a role; changing a role (your own or one assigned by the host) clears READY.
- The host picks the mission. "Start the briefing" — only the host, and only when there are **2, 3 or 4 players** (one — demo only), all online, everyone with a role, everyone READY. Until then, the screen says what we are waiting for.
- **Free roles (2–3 players):** the host hands them out in the lobby (`assignRole {target, role, give}`), evenly by default (`rolePlan`: a role goes to the player with fewer roles; on a tie, to whoever joined earlier). What each player will get by default is visible in their slot in advance; at the start, `goStage` hands out the remaining free roles and records this in the log. A player can give up an extra role themselves (`assignRole` on themselves, `give: false`).
- A fifth player gets "The room already has 4 players."; after the start, new players cannot join ("The game has already started"), but a known player can come back — with all their roles.

## Demo mode
- Turned on by the host: the "Demo mode: play solo" button on the home screen or a checkbox in the lobby (lobby only).
- Needed for playing **solo** (2–4 players can start without it, 0013). In demo mode the department rules are off — everything is installed right away, and free roles are not handed out. **Only in demo mode** can a player switch roles after the lobby (`pickRole` outside the lobby without demo → "Roles can only be changed in the lobby (or in demo mode)."). A taken role cannot be picked even in demo.
- In demo mode, a crisis waits for choices from all roles that have options (one player answers for everyone in turn).
- The "DEMO MODE" label is shown in the lobby and in the banner at the top of every screen.

## Disconnecting and rejoining
- The host matches `room.players[].online` against the transport's presence (`presence`, host only). For the first 4 s after connecting, the host marks nobody offline ("not heard yet" ≠ "gone").
- Disconnect → the others see "Reconnecting… 30 s" (`offlineAt` + `RECONNECT_MS`): in the lobby — in the slot, in the game — as a bar at the top, "Name (role): Reconnecting… N s", then OFFLINE.
- In the lobby, the slot is freed after 30 s (`dropPlayer`). In the game, the slot and the role stay with the player for good.
- Rejoining with the same `playerId` (reload or a new tab): `hello` → the full state → `join` marks them ONLINE. Role, build, stage and flight are as they were.
- A crisis waits only for the roles of players who are **online** (all roles of each such player); if a player disconnects and the others have already chosen, the crisis closes right away.

## Host leaving
- A client does not see the host in presence → a bar: "Host <name> is not responding — in N s the new host will be <name>".
- After **10 s** (`HOST_TIMEOUT_MS`) the online player with the lowest `joinOrder` becomes host (`electHost`). They take **their latest received state**, apply `claimHost` (the old host → OFFLINE), broadcast it and save it.
- **The flight clock passes to the new host** (ticks come from the `syncTicker` of whoever is host now). While there is no host, the flight stands still (up to 10 s).
- If the host died during the launch cutscene, the new host finishes the launch itself (`launchDone`).
- The old host comes back as a regular player with their role.
- The host reloaded the tab in under 10 s: it sends `hello`, the clients reply with their latest state, and it continues as host without losing versions.
- Everyone left, then someone came back: if they are the only one online, they become host on the room's saved state.
- A tie (two players claimed host at the same time): with the same version → the lower `joinOrder` wins, the other becomes a client.

## Role permissions (in `reduce`; a rejection is a clear error, the state does not change)
| Action | Who can |
|---|---|
| anything except `join` | only a player in this room ("You are not in this room.") |
| `selectMission`, `goStage`, `setDemo`, `launchDone`, `tick`, `presence`, `dropPlayer` | the host |
| `pickRole` | in the lobby — anyone (a free role); afterwards — only in demo |
| `setReady` | in the lobby, with a role |
| `approve`, `veto` | the commander ("Only the commander approves.", "Veto is the commander's right."). With Team Trust < 50, approving against a critical warning sets `pendingKey` and waits for `secondKey` |
| `scienceMode`, `chooseSite` | the Science Officer |
| `crisisChoice` | an option of any of your roles ("This option is for another role.") |
| `radio`, `command` | a phrase / command of any of your roles (the role is taken from the phrase / command) |
| `unlockMission`, `buyUpgrade`, `confirmPrep` | the commander or the host |
| `addComponent` / `removeComponent` | any player: your own department within the share — right away; another department or over the share — a **request** to the commander (`room.requests`, 0013 §2). The commander installs any module right away. In demo, everything right away |
| `setBudgetSplit` | the commander, in the Constructor (shares in %, step 5, total 100) |
| `resolveRequest` | the commander: approve (the module is installed, credited to the author) or veto with a reason |
| `cancelRequest` | the request's author (or the commander) |
| `secondKey` | players from `pendingKey.need` — owners of the warning's department (if the commander holds that department, any other online player); a refusal comes with a reason |
| `assignRole` | the host in the lobby (give a free role / hand over an extra one / free it up); a player — take a free role for themselves or give up an extra one |
| `submitReview`, `openTasks` | any player; not while requests are pending ("The commander must decide department requests first") |
Permissions for `radio` / `setRules` / blackout commands are covered by the "radio / Autonomy Planner / blackout" session.

## Flight
The host counts ticks (1 tick/s; `?dev=1&speed=N` speeds it up in dev) and broadcasts the state every tick. Each client renders the panel of **its own** role (`panelFor(myRole, …)`). Verified: 4 tabs show the same tick and different panels. A player with several roles sees a tab for each role (`panelFor` for the active one; radio — for all their roles).

## Room state for the 0013 rules (via the same `reduce`, identical for both transports)
| Field | What |
|---|---|
| `players[].roles` | all of a player's roles |
| `requests` | this attempt's requests: `kind` add/remove, the module, the owner department, the author and their role, the reasons (`foreign` / `over-share` + `overBy`), status pending / approved / vetoed / cancelled, the veto reason. A new attempt (leaving the report) resets them; the host leaving the Constructor expires the pending ones |
| `budgetSplit` | `{ split: {engineer, science, comms} %, set, by }` or null — the mission's default share (`DEFAULT_SPLIT`) |
| `pendingKey` | an approval waiting for a second key: warnings, the commander, `need` / `any`, departments, turned keys |
| `trustHistory` | the last 12 Team Trust changes with the reason, the flight number, "before → after" |
| `decisionLog` | besides approvals and vetoes — `request-approve`, `request-veto`, `key-denied`; an approval with a second key has `keys` |
| `attemptLogFrom` | the log entry where the attempt started (player contributions in the report) |
The host saves the state immediately and also on changes of roles / request status / the second key (`shouldSave`).

## How to connect Supabase (step by step)
Without keys the game runs in local mode (tabs of the same browser). To play from different devices:

1. **Account and project.** Go to https://supabase.com → Sign in (with GitHub) → **New project**. Name — `space-mission`, database password — any long one (save it in a password manager; the game does not need it), region — the nearest one (for example, Frankfurt). The free plan is enough. Wait 1–2 minutes while the project is created.
2. **Table and access rules.** On the left, **SQL Editor** → **New query** → paste the whole `supabase/schema.sql` file from the repository → **Run**. You should see "Success. No rows returned". The script can be run again.
3. **Keys.** On the left, **Project Settings → API** (in new projects — **API Keys**). Copy:
   - the **Project URL** (like `https://abcd1234.supabase.co`);
   - the **anon public** key (or the **Publishable key** `sb_publishable_…` in the new interface). Do **not** take the `service_role` / secret key — it grants full access and must never reach the browser.
4. **The `.env.local` file.** In the repository root, copy `.env.example` to `.env.local` and fill in:
   ```
   VITE_SUPABASE_URL=https://abcd1234.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon / publishable key>
   ```
   `.env.local` is in `.gitignore` — it will not get into git. Never commit keys.
5. **Restart.** Stop `pnpm dev` and start it again (Vite reads `.env.local` only at startup). The yellow "Local mode" banner should disappear — that means `SupabaseTransport` is on.
6. **Check.** Create a room on one device and join by code from another (a phone on the same or a different network). In Supabase → **Table Editor → rooms**, a row with the room code appears.
7. **For deployment** (Vercel / Netlify): add the same two variables to the hosting's environment settings and rebuild.

If it doesn't work: look in the browser console for `[supabase] save failed` / `Realtime: CHANNEL_ERROR`; check that the SQL ran without errors and that the key is anon/publishable, not secret.

## Security
An educational co-op game with no stakes — we do not build cheat protection (the host trusts client actions, apart from the rule checks).
- **RLS by room code:** the client sends the code in the `x-room-code` header; the `rooms` policies allow reading and writing only the row with that code — you cannot list rooms or delete them (`supabase/schema.sql`).
- The `rooms_keep_newest` trigger prevents writing a state older than the saved one (a slow former host cannot roll the room back).
- The Realtime channel `room:<CODE>` is public: anyone who knows the code can connect (≈ 887 million combinations). Private channels via Realtime Authorization — later, if needed.

## Live site
- https://space-mission-tau.vercel.app (Vercel) + the Supabase project `space-mission`. 2026-11-15: a room is created through Supabase, a second player joins by code, the row in `rooms` is written — **verified**.

## Not verified
- The 0013 rules through `SupabaseTransport` (the state goes through the same `reduce` and there are no new messages — it should work, but it has not been run). Through `LocalTransport` it is verified with tabs: 2 and 3 players (`node scripts/qa/rules.mjs`, 26 checks).
- The commander goes offline during the build: requests wait for them (the author can withdraw, the host can leave the Constructor, and then they expire); the commander cannot be reassigned during the game.
- `SupabaseTransport` beyond the 2-player check on the live site: presence over a long session, channel auto-reconnect, Realtime message limits (a ~6 KB state × 1–10 per second).
- Real separate devices / a mobile network, a long network outage (so far, closing a tab and reloading have been verified).
- Six or more tabs of the same browser with different rooms at the same time (ids come from a shared list of up to 8).
