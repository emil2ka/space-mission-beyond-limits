# If–Then Autonomy Algorithm (AUTONOMY PLANNER)

Before launch, the team sets up how the craft behaves when the link is lost.

## Rule format
`IF [condition] AND [extra condition] → THEN [action]`
Blocks are dragged and dropped (on a phone, picked from lists).

## Conditions (sensors)
| Block | Example | Equipment needed |
|---|---|---|
| Signal = LOST / WEAK | `Signal = LOST` | — |
| Battery < X% | `Battery < 25%` | a battery |
| Temperature > Critical / < Freezing | | Temperature Sensor |
| Hull Integrity < X% | `Hull < 40%` | — |
| Data Buffer > X% | | Data Buffer or Data Storage |
| Sample Secured = TRUE | | Sample Container |
| Debris Detected | | Radar/Altimeter or Navigation Camera |

## Actions
| Block | Effect |
|---|---|
| Switch off secondary instruments | consumption ↓ |
| Switch off the overheating instrument + safe mode | heat ↓, science paused |
| Keep collecting and store data in onboard memory | data accumulates, memory ↓ |
| Stop risky maneuvers | hull risk ↓, progress ↓ |
| Start preparing the return | phase → return |
| Point the antenna at Earth | comms ↑ (needs High-Gain or Omni) |
| Evade | propellant ↓, risk ↓ |

## How it works
- The number of rules = the **Flight Computer** capacity (base 3, upgraded 6). Without a Flight Computer — Safe Protocol only.
- Some actions require equipment; without it the block is grayed out with a reason.
- **Conflicts** are highlighted (one rule turns an instrument on, another turns it off under the same conditions).
- Execution follows priority order (top to bottom); the first matching action of each type wins.
- Before launch there is a **"Test"** button: it runs 3 scenarios (signal loss + low battery, overheating, debris) and shows which rules fired.
- Not set up → **Safe Protocol**: the craft protects itself (switches science off, waits for the link), but may sacrifice science goals.

Code: `src/engine/autonomy.ts`.

## What was done (M2, 2026-11-14) — **verified** (tests + browser)
- **Where:** the "Autonomy n/slots" tab in the Constructor (screen 11, between the build and the check, Core Loop step 7) — `src/ui/AutonomyPlanner.tsx`. The readiness check shows a read-only list of rules (`RulesSummary`).
- **Form:** "IF [condition] AND [extra condition] → THEN [action]" from drop-down lists (as "on a phone"; no drag and drop). Up to 2 conditions; the X% threshold is a number (defaults: Battery 25, Hull 40, Buffer 90).
- **Grayed-out blocks:** a condition/action without the required module is unavailable in the list, with the reason "— needs module: Temperature Sensor" (`blockProblem`).
- **Number of rules ≤ `ruleSlots`** (Flight Computer: 3 each). Without a Flight Computer you cannot save — "Safe Protocol only".
- **Saved by** the engineer or the commander (`setRules`, only before the check); the others see the team's rules. A draft + "Save / Cancel"; someone else's save is pulled in if you have no edits of your own. The engine checks the same things (`validateRules`).
- Order = priority (↑/↓), conflicts are highlighted (`findConflicts`), and the **"Test: 3 scenarios"** button (`testRules`: signal loss + low battery, overheating, debris) shows which rules would fire.
- **In flight:** rules fire when the link is lost (`stepFlight`) and at a crisis deadline (`resolveCrisis`). Every firing is written to the log as "Rule 1 “IF Signal = LOST → THEN Keep collecting…” fired — no link, the craft acts on its own" (`noteRulesFired`, `flight.rulesFired`) and to the report — the "Autonomy" card (`report.autonomy`: which rules, where, how many times, Safe Protocol N times).
