# Simulation Engine

Everything is pure functions in `src/engine/` (no React/three). The numbers are in `src/engine/data/*.ts`, the table is the [Balance Table](../03%20Design/Balance%20Table.md). Decisions on the flight model — [0010 M1 flight model](../06%20Decisions/0010%20M1%20flight%20model.md); on the Asteroid and the economy — [0012 M3 asteroid and economy](../06%20Decisions/0012%20M3%20asteroid%20and%20economy.md).

## Build (Constructor)
- `computeStats(build, mission, mods?)` → mass, cost, generation (by source), consumption (by consumer), capacity, heat, slots, comms, memory, problems. `mods` are HQ upgrades (`{ upgrades, extraSlot? }`; `room.agency` fits as is). Without `mods` — no upgrades.
- `canAdd(build, id, mission, mods?)` → `{ok}` or `{ok:false, reason}` with the exact reason (accounts for the extra slot).
- `readiness(build, mission, mods?)` → `{ ok, blockers, warnings, notes }` (`readiness.ts`). Blockers: a missing required system, budget, incompatibility, no generation, slots, mass overload > 10 %. Warnings (the commander can accept them): deficit, bus overload, cold/freezing, heat/overheating, overload ≤ 10 %, etc. `notes` — useless modules.

## Room (`room.ts`, `reduce(state, action)`)
Stages: `lobby → briefing → build → review → launch → flight → report`.
| Action | Who | What it does |
|---|---|---|
| `submitReview` | anyone | build → review (the build is locked) |
| `approve` | commander | in review: blockers → error; warnings present → `approve-against-warning` (`issueIds` = warning ids); review → launch |
| `veto {text}` | commander | in review: a record + review → build |
| `launchDone` | host | launch → flight, `startFlight` |
| `tick` | host | a flight step; at the end — `report`, `teamTrust`, `agency = recordFlight(...)` (MC credited, damage recorded, `pendingPrep = true`) |
| `crisisChoice {optionId}` | the option's role | a crisis choice; the crisis closes when all present roles with options have chosen (in demo — all roles), otherwise at the deadline |
| `scienceMode {waypoint, mode}` | scientist | `fast` / `precise` for the current or a future point |
| `chooseSite {site}` | scientist | Asteroid: `regolith` / `boulder` / `crack` in the "Approach" and "Site selection" phases |
| `unlockMission {mission}` | commander / host | price `unlockCost`, not during launch/flight, the balance never goes negative |
| `buyUpgrade {id, slot?}` | commander / host | an HQ upgrade (outside review/launch/flight); `extra_slot` takes the department `slot` (Science by default) |
| `confirmPrep {insurance, next?}` | commander / host | after the flight: charges `prepCosts(...)` (or free basic repair + the starter build), report → `next` (`build` by default / `lobby`) |
| `loadAgency {agency}` | host, lobby | restore HQ from `exportAgency` (a string or an object; everything is sanitized) |
- `decisions` are reset when the build changes (a new approval is needed); `decisionLog` is the whole history of the attempt (for the report).
- `goStage` is kept for compatibility with the old UI (`goStage flight` also starts the flight). **Leaving the report (`goStage build`/`lobby`) also goes through preparation** — without insurance, at the `report.mc.upkeep` price that the report showed in advance.
- `room.agency` is the source of truth for MC/unlocks; `room.credits` and `room.unlocked` are mirrors for the M1/M2 screens (updated by every action). A room without `agency` (saved before M3) restores it from the old fields.
- `statsOf(room)` = `computeStats(build, mission, agency)`.

## Flight (`flight.ts`, `crises.ts`, `sim.ts`)
`startFlight(mission, build, {teamTrust?, mods?})`, `stepFlight(flight, build, seed, rules = [])` — one tick (1 tick = 1 s of real time, 10 game minutes).

Tick order:
1. **Storm** (the source of Signal Distortion) — the moment comes from the seed; without a Signal Amplifier, always.
2. **No link?** (entry: the first 15 ticks; storm escalation; no channel) → Autonomy Planner rules; if none match — the **Safe Protocol** (the craft hovers, science is off).
3. **What is on:** rotors — in flight and while hovering (fast mode), off when landed (precise mode); science instruments — during "Entry" and "Flight between points".
4. **Power:** `stepEnergy` (charge, priority-based shutoff; without a PDU — the most powerful first).
5. **Bus protection:** after a Power Drop, an overloaded bus switches consumers off immediately.
6. **Heat** of the running units − environment losses × (1 − insulation); thresholds: ≤ −80 freezing, ≥ 120 hot, ≥ 200 overheating.
7. **Route:** dunes → lake → crater, 70 ticks of flight per point (× speed), a stop of 20 (fast) / 40 (precise).
8. **Science → memory → comms:** 4 Titan goals (`TARGET_DEFS`), memory 20 + Data Storage/Buffer; on overflow data is lost (`queueFull`); transmission is `bandwidth × 1/6` units/tick, slower and lossy during the storm.
9. **Crises:** not before tick 10, one at a time, a 25-tick pause, no more than 3 per flight, each kind once. Timer 20 ticks.
10. **Phases:** Cruise 30 → Entry 60 → Flight between points up to 360 (ends earlier if all points are passed) → Data transmission 120. Total **480–570 ticks = 8–9.5 minutes**.

### Crises (deterministic from the build, [0006 Deterministic crises](../06%20Decisions/0006%20Deterministic%20crises.md))
| Crisis | Trigger | How to fix it |
|---|---|---|
| Power Drop (bus) | load > the bus limit | shed watts (science, a unit, low-power comms); otherwise bus protection switches consumers off |
| Power Drop (battery) | deficit and charge < 20 % | remove the deficit or recharge; otherwise the batteries drain |
| Overheat | ≥ 200 for three ticks / ≥ 120 for sixty ticks | land/cool down, switch off the hot instrument, pause; otherwise hull −10 and an instrument failure |
| Freeze | ≤ −80 for three ticks | Heater / RTG heat; the scientist can put instruments to sleep; otherwise an instrument failure |
| Signal Distortion | a storm (without a Signal Amplifier, always) | comms re-tunes/re-aims the antenna; no response — signal loss for 20 ticks |
No choice by the deadline: a matching Autonomy Planner rule (`by: 'autonomy'`), otherwise the Safe Protocol (`by: 'safe'`). Everything is written to `causes` with `causeIds` (component ids and review warning ids); the outcome goes to `history`.

## Asteroid flight (`asteroid.ts`, `data/asteroid.ts`) — M3
The same `FlightState` + `flight.asteroid: AsteroidFlight` (Asteroid only). The shared Titan mechanics work as is: power, the bus, heat, data → memory → comms, blackout + Autonomy Planner / Safe Protocol, radio and commands, Power Drop / Overheat / Freeze.

Phases (`missions.ts`, ticks are maximums): **Cruise ≤ 140** (Ion Engine 140 ticks / chemical 100, ends on arrival) → **Approach ≤ 120** (80 ticks with a Navigation Camera / Radar, 110 without; ends when `approach = 1`) → **Site selection 40** → **Sampling 100** (earlier if the rule "Sample Secured → Start preparing the return" fires) → **Packing 30** → **Return cruise and landing 190** (a 10-tick burn, cruise until tick 130, capsule: separation 130 → entry 140 → parachute 155 → touchdown 170 → found at 173 with a beacon / 185 without a beacon when landing at the target point / not found if off target). Total **541–590 ticks ≈ 9–10 minutes** (up to ~620 with a slow approach).

- **What is on** (`asteroidActivity`): chemical — approach, site selection, sampling, the burn (and the cruise if there is no Ion Engine); Ion Engine (60 W) — cruises; arm/drill — only during sampling; Sample Sealing Unit — during packing; the beacon — during the return; instruments — approach…packing. The Rotor System never turns on here and does not move the craft.
- **Propellant:** `fuelMax = 100 × Propellant Tank`. Cruise: ion 0.07/tick, chemical 0.4/tick; approach 0.3/tick; holding at the surface 0.05/tick; the burn home: chemical 30, with ion 5 + 0.07/tick. Overload ×(1 + 3 × the overload fraction). Not enough for the burn → the capsule lands far away (`offTarget`). The Ion Engine switched off (power) → the cruise continues on chemical engines (`ion-lost`).
- **Sampling:** the tool = arm, drill or both (speed depends on the site, `SITE_DEFS`); `sampling: idle → reach (12 ticks) → grab → stowed / jam / failed`; by the end of the phase ≥ 40 % → a smaller sample is taken, less — no sample. The approach did not complete → no sampling.
- **Sealing:** 20 ticks of the Sample Sealing Unit during packing; without it / switched off → `not-sealed`.
- `chooseSite(flight, site)`; with no choice by the end of the phase, the computer picks regolith (`siteBy: 'auto'`).
- A Heat Shield damaged by debris → the sample overheats on entry (`heated`).
- Blackout on the Asteroid: after a dodge without a Star Tracker / Reaction Wheels, the antenna loses Earth for 8 ticks (unless comms calculated the aiming in advance).

### Asteroid crises
| Crisis | Trigger (build + seed) | Roles | No response |
|---|---|---|---|
| Debris Alert | approach, tick 15–45 from the seed; without a Micrometeoroid Shield — always, with one — 25 % of seeds. Without Radar / Navigation Camera the timer is 8 s instead of 20 (`variant: 'late'`) | commander: dodge (−12 propellant, +8 ticks) / continue; engineer: turn the shield into the stream (damage /3) or shelter the capsule (Heat Shield intact, hull −4); comms: calculate the aiming in advance | rule `debris_detected → evade` / `stop_risky_maneuvers`, otherwise Safe Protocol: freeze in place (damage ×0.5; without a shield and shelter — the Heat Shield is damaged) |
| Sampling Arm Jam | sampling, at 20–50 % collected (seed); risk = site (regolith 0.35 / rock 0.8 / crack 0.6) − 0.6 with Vibration Dampers or +0.3 without (+0.1 with a drill without dampers, +1 if the arm was bent by debris) | engineer: restart / isolate the drive; commander: retry at a nearby point / keep what we have; scientist: switch to the drill / image the jam (restart without losing speed); comms: composition first | rule `prepare_return` (keep what we have) / `stop_risky_maneuvers`; Safe Protocol — the drive stops for 25 ticks, then half speed |
Debris and Jam always get their turn (they wait while another crisis is running); general crises (Power Drop / Overheat / Freeze) on the Asteroid — no more than 2.

### Role panels
`panelFor(role, flight, build): RolePanel` (`panels.ts`) — the shared `items/alerts/hidden/crisis` + role-specific parts: `power` (engineer), `science` (scientist, with mode selection), `comms` (comms), `command` (commander: timer, hull, status; no technical causes and no units).
On the Asteroid there is also `panel.asteroid: AsteroidPanel`: engineer — `fuel` (current / max / forecast "still need ≈N"), `engines`, `protection` (shield, Heat Shield, arm); scientist — `site` (3 sites with the jam risk **for this build**, `canChoose`), `arm`, `sample`, `composition`; comms — `composition`, `capsule`; commander — `fuel`, `sample`, `capsule` + overall status/hull/timer. Always `approach`, `debris`, `phaseId` (for 3D).

## Report (`report.ts`)
`buildReport(room): MissionReport` — the outcome, points over the 7 weights from [Mission Report](../03%20Design/Mission%20Report.md) (`scoreWeightsFor(mission)`), chains of causes (the main 3 first), commander decisions, Team Trust and the reasons it changed, role contributions, MC, moments for the 3D replay, `damaged` (what to repair). Called in `tick` at the end of the flight and stored in `room.report`.
- Asteroid: weights — main goal 35 (0.6 sample on Earth + 0.4 composition data delivered), data 20, craft 10, comms 15, **sample integrity 10** (sealed 1 / not 0.5 × mass/40 g × 0.5 if overheated), **return 5** (found 1 / not found 0.3), resources 5 (½ budget + ½ remaining propellant ≥ 10 %). **Perfect only if the sample is sealed, the capsule is found and the composition data is delivered**, otherwise Success at most; no sample on Earth — Partial at most. `report.asteroid` — the site, the sample, the capsule, propellant, the Perfect flags. Chains: `debris_alert`, `arm_jam`, `no-sample`, `sample-small`, `not-sealed`, `heat-shield`, `capsule-lost`, `fuel`, `ion-lost`, `site-auto`, `composition` + the shared ones.
- `mc = { earned, upkeep, total, balance, prep }`: `upkeep` = what the next preparation will cost (0 with free repair), `prep` — its line items.

## Economy (`economy.ts`, `data/economy.ts`) — M3, test E
```ts
interface Agency { credits; unlocked; upgrades; damaged; history; extraSlot; hullLoss; insured; coveredRepairs; pendingPrep; basicRepairs; lastPrep }
newAgency(); missionReward(outcome, delivered); recordFlight(agency, {mission, outcome, earned, broken, hull})
prepCosts(agency, insurance): PrepCosts   // { items, total, affordable, fallback, charge, balanceAfter, missing } — shown BEFORE confirmation
applyPrep(agency, insurance)              // charges total; not enough even without insurance → free_basic_repair (0 MC, damaged cleared)
unlockMission(agency, mission); buyUpgrade(agency, id, slot?)
exportAgency(agency): string; importAgency(unknown): Agency | null
```
- After the flight `pendingPrep = true`: "Again" / "To HQ" always go through preparation (`confirmPrep` or `goStage` from the report). Preparation: maintenance 10 + diagnostics 5 + module repairs (20 % of the module's price each, at least 5) + hull (2 MC per 10 %) + consumables 5 + insurance 15 (optional: repairs after the **next** flight are free).
- Not enough for preparation → **free basic repair**: the balance is not touched, the craft = `STARTER_BUILD[mission]` (passes the readiness check). Spending MC on unlocks/upgrades before preparation is allowed — the same safety net applies. The balance is never below 0, a soft-lock is impossible (verified with random sequences).
- Upgrades (`UPGRADES`, 50–80 MC) change `computeStats` and the flight (via `flight.mods`): light alloys (hull −10 % mass; debris damage ×1.25), antennas (+30 % link; +20 % power), batteries (+25 % capacity; +3 kg each), PDU v2 (`smartShed`: whatever was switched off on discharge turns back on when the charge is > 50 %; the PDU uses 8 W instead of 5), extra slot (+1 department slot; +5 kg to the hull), Flight Computer v2 (6 rules; +5 W, +3 heat).

## Status
| Part | Code | Tests |
|---|---|---|
| Data (a catalog of ~50, 2 missions, the Titan flight) | ✔ | — |
| computeStats / canAdd / readiness | ✔ | ✔ tests A, B, C |
| Power (per tick) | ✔ | ✔ clamp, shutoff |
| Room reducer (review/approve/veto/launch/crises) | ✔ | ✔ |
| Autonomy | ✔ rules in blackout and at the deadline | ✔ |
| Titan flight: phases, points, science, comms, heat | ✔ | ✔ |
| Power Drop / Signal Distortion / Freeze / Overheat crises | ✔ | ✔ trigger present ↔ absent |
| Role panels | ✔ | ✔ asymmetry (test D, engine part) |
| Report | ✔ | ✔ A, C full loop, determinism |
| Asteroid flight: propellant, approach, site, sampling, packing, capsule | ✔ | ✔ `asteroid.test.ts` (27) |
| Debris Alert / Sampling Arm Jam crises | ✔ | ✔ trigger present ↔ absent, roles, autonomy/Safe |
| Asteroid report (Perfect conditions, chains) | ✔ | ✔ |
| Economy: Agency, rewards, preparation, upgrades, storage | ✔ | ✔ `economy.test.ts` (19), test E in full |
