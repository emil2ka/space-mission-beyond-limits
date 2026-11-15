# Economy and Progression

Two currencies that must not be confused:
- **Mission budget (M$)** — given for each attempt, spent in the Constructor, not carried over.
- **Mission Credits (MC)** — the team's meta-currency, earned for results, carried over between attempts.

## Rewards (starting values)
| Outcome | MC |
|---|---|
| Perfect Success | 120 |
| Success | 90 |
| Partial Success | 50 |
| Failed Mission | 20 (for experience; never 0) |
| + per delivered science goal | +10 |

## Unlocking the second mission
ASTEROID: SAMPLE RETURN = **150 MC**. Reachable in 2 Titan attempts (or 1 Perfect + bonuses). The screen shows the price, the balance and how much is missing.

## HQ upkeep (MISSION PREPARATION COSTS)
Before a new attempt: HQ maintenance (10), diagnostics (5), repair of damaged modules (as needed), consumables refill (5), insurance (optional, 15 — covers repairs).
- The total is shown **before confirmation**. No unexpected charges.
- Not enough funds → **free basic repair** and the starter configuration. The balance never goes negative, a soft-lock is impossible (acceptance test E).

## What to spend MC on
1. Unlocking the asteroid (150).
2. HQ blueprints and upgrades.
3. Light alloys: −10% hull mass (80).
4. Upgraded antennas (60).
5. More efficient batteries: +25% capacity (60).
6. Upgraded power controller (PDU v2: smart shutoff) (50).
7. Extra mounting slot for any department (70).
8. Upgraded Flight Computer: 6 rules (60).
Each upgrade is a clear trade-off (cost, mass, power, reliability or number of uses).

## Storage
MC and unlocks belong to the team (a room with a saved HQ code). P1: an `agency` table in Supabase. In local mode — the host's localStorage.

## How it is done (M3, 2026-11-14)
- Engine: `src/engine/economy.ts` (part A) — the numbers above, the rules and test E in `economy.test.ts`.
- Screens (part B): HQ and preparation — `src/ui/screens/HQ.tsx`, see [Screens](Screens.md) (M3 section). Preparation shows every item and the total before the button; exactly the amount shown is charged (verified in the browser: 20 and 26 MC).
- Storage: the host writes `exportAgency` to `localStorage` (`sm:agency`) — only when the room's HQ actually changed (reward, purchase, unlock, preparation), not on every publish: otherwise, on reload, all host tabs of this browser would overwrite each other. A new room created by the host loads it (`loadAgency`). This is the "browser's HQ" — the last team that played here. Supabase mode also stores it on the host for now (the `agency` table is P1).
- Dev: `?dev=1` unlocks all missions and does NOT read/write the save (sandbox); `?dev=1&unlock=0` — the real economy with dev speed-up (this is how test E was checked).
