# Individual Tasks (screen 10)

Decision: [0013 Roles tasks trust players language](../06%20Decisions/0013%20Roles%20tasks%20trust%20players%20language.md) §1. Code: `src/engine/tasks.ts`, numbers — `src/engine/data/tasks.ts`, screen — `src/ui/screens/Tasks.tsx`, widgets — `src/ui/tasks/`. Tests: `src/engine/__tests__/tasks.test.ts`. Browser check: `scripts/qa/tasks.mjs`.

## Where it is in the game
Constructor → **Individual Tasks** → Autonomy Planner (on the same screen, the "Open Autonomy Planner" button) → Readiness check.
- In the Constructor, the "To role tasks" button (the `openTasks` action, the room stage `tasks`). Department requests to the commander must be resolved first.
- All roles do their tasks at the same time. **There is no timer** (spec (TZ v2.0) 9.5: timers only for crises).
- At the top is the team strip: the four roles, who holds them, and their state ("working…", "Excellent / Good / Weak", "skipped", "build changed — redo").
- "To review" unlocks when **all four** roles are done (`tasksReady`). The host can send the team back to the Constructor.
- Each role has: a one-line goal, a mini-game, a live preview of the consequence ("Data quality 94 % · +30 % data · +17 heat"), an "In flight" block (what this will change), and the "Done" and "Skip" buttons.
- After "Done", the grade and the reasons are shown. The answer can be changed and sent again.
- **Skipping** = "weak". Before skipping, the screen honestly says what will happen. The host can skip a task for an offline player so the team does not get stuck.
- A player with two roles (2–3 players) switches between their tasks in the team strip. In demo mode, one player does all four.
- A task **goes stale** if something it depends on has changed (the `taskKey` key), or a new attempt has started. It then has to be redone; the previous answer is filled in automatically.
  - Commander — consumers.
  - Engineer — consumers, buses and power upgrades.
  - Scientist — calibratable instruments.
  - Comms — antennas and data sources.
  - Passive modules (shields, hull) do not invalidate anything.
- If the team never opened the screen (old saves, M1–M3 tests), there are no flight modifiers — the flight works as before.

## Grading
Each task gives a number 0..1. Grade: **≥ 0.85 — excellent**, **≥ 0.6 — good**, otherwise **weak**. Skipping — "weak", 0 %. Everything is deterministic: it depends on the answer, the build, the mission, the room seed and the attempt number.

### Commander — "Mission Priorities" (spec 3.1)
Two lists, both reordered by drag and drop (or ▲▼, or the arrow keys on the handle).
1. **Mission goals — main one on top.** Each goal has importance stars and the modules that fulfil it. If nothing can fulfil a goal, the card is marked "nothing to do it with".
   - Titan: atmosphere profile ★3, surface images ★3, chemistry ★2, route ★2, temperature ★1.
   - Asteroid: sample to Earth ★4, composition ★3, find the capsule ★3, site imaging ★1.
2. **Sacrifice order — top one goes off first.** The list has every consumer that can be switched off (power priority > 1). Those that cannot be switched off are shown in a "Never switched off" line.
   - The starting order is naive: "most power-hungry first". On Titan that is the rotors, and that is the main lesson of the task.

**Score = 0.5 × goals + 0.5 × sacrifices.**
- **Goals:** a weighted order. The higher in the list, the greater the weight. A goal that nothing can fulfil is worth 0 and belongs at the bottom. Goals of equal importance can go in any order.
- **Sacrifices:** each system has a "value for the mission" (`KEEP_VALUE`).
  - Titan: rotors 10, Heater 7, memory 6.
  - Asteroid: chemical engines 10, arm 9, sealer 9, drill 8, beacon 8.
  - An instrument's value = 1 + the rank of its goal in **your own** goal list.
  - For each "valuable before cheap" pair, the difference in values is deducted.

**Effect in flight:**
- The "main goal" in a Power Drop (the "Keep the main goal" option) = your first two science goals, not "the ones with the most progress".
- During a Power Drop, the commander gets the **"Emergency decision: sacrifice by the list"** option. It switches systems off in your order until the required watts are shed.
- With a working PDU, automation (battery discharge, bus protection, the "switch off secondary" rule) switches things off in the same order.
- **Skip:** there is no sacrifice order. The Power Drop timer is **5 s** shorter, and there is no "emergency decision".

### Engineer — "Power Routing" (spec 3.2)
A cutaway schematic: two bus lines with the consumers between them.
- How to connect: tap a consumer, then a line. Or tap the "socket" on the side. Or use the ←/→ arrows.
- Starting position: everything hangs on the main line. It is usually overloaded — that is exactly what needs fixing.
- **Main line = 60 %** of the bus limit, **secondary = 40 %**. Example: 2 × Power Bus = 300 W → 180 / 120 W. The hull's onboard systems are always on the main line.
- Tags on consumers:
  - "critical" — priority 1;
  - "important" — priority 2;
  - "needed for the main mission goal" — value ≥ 8: the arm, the drill, the engines on the Asteroid;
  - "can be switched off".

**Score** = 1 − 0.5 × (the share of important systems on the secondary line) − the overload penalty − 0.2 if the secondary line is empty.
- An important system: priority 1 weighs 1.5, priority 2 and "mission-critical" ones — 1.
- **Overload penalty** = 0.25 + overload / bus limit, but no more than 0.5. Only **excess** overload beyond the best possible one counts: if the bus is too small for the build, overload is unavoidable, and the screen says "not a routing mistake".

**Effect in flight:**
- **Secondary-line loads are switched off first** — on battery discharge, bus protection and in crises. This works without a PDU too. Within a line: with a PDU — in the commander's order, without a PDU — the most powerful first.
- Something important on the secondary line (for example, the Rotor System) will be switched off before the instruments. The report shows this as a separate chain.
- **Excess line overload or a skip** makes the Power Drop harsher: the decision timer **−6 s**, hull **−4 %** at the moment the crisis starts ("the line is sparking"). The timer is never shorter than 6 s.

### Scientist — "Calibration & Measurement Mode" (spec 3.3)
**Calibration.** For each installed instrument, a small spectrum shows two lines: the reference (dashed) and the instrument's reading (solid, noisy).
- Calibratable instruments:
  - Titan: Atmospheric Sensor, High-Res Camera, Wide-Angle Camera, Spectrometer, Temperature Sensor.
  - Asteroid: Spectrometer, High-Res Camera, Wide-Angle Camera.
- The knob is turned with the mouse or a finger: one turn of the hand = 0.5 of the scale. There is also the wheel, the "‹ ›" buttons (step 0.003) and "« »" (0.02), and the keyboard arrows (Shift — coarse).
- Each instrument has its own peak: the base (`CALIB_BASE`) ± 0.08 by the room seed and the attempt number.
- The spectra differ by mission:
  - Titan — three methane bands in a noisy haze;
  - Asteroid — two broad bands of olivine and pyroxene, with less noise.

Accuracy = 1 − |error| / 0.12. The instrument's data quality multiplier = **0.75 + 0.25 × accuracy** (without calibration ×0.75).

**Measurement mode** (until the end of the flight, for all instruments):

| Mode | Titan: data / instrument heat | Asteroid: data / instrument heat |
|---|---|---|
| Cautious | ×0.8 / ×0.5 | ×0.85 / ×0.5 |
| Normal | ×1 / ×1 | ×1 / ×1 |
| Intensive | ×1.3 / ×2 | ×1.3 / ×2.5 |

The mode card shows honest numbers: % of data, ± heat and the heat margin as computed for the build.
- **"Just enough"** = balance ≥ 95 (25 below "hot") or ≤ −20.
- The best mode is the one with the lowest heat risk; on a tie, the one with more data.
- On cold Titan, intensive mode often **heats usefully**. At the asteroid, or with an extra RTG, it leads to overheating.

**Score = 0.7 × average accuracy + 0.3 × mode.** Mode: the best one or an equally safe one — 1; one step riskier — 0.5; worse — 0.

**Effect in flight:**
- The quality of each chunk of data is multiplied by the instrument's calibration.
- The data collection speed is multiplied by the mode. So is the heat of the switched-on instruments.
- **Skip:** all instruments ×0.75, "normal" mode.

### Comms — "Antenna Aiming & Packet Queue" (spec 3.4)
**Aiming.** A round radar.
- A sweep beam passes across the sky. Where it crosses the direction to Earth, an imprecise blip flashes. Below is a noisy "Earth signal" meter.
- The player taps or drags across the radar, then fine-tunes with the arrows or the ▲▼◀▶ buttons toward the signal maximum. The circle around the crosshair is the beam width.
- The beam depends on the best antenna: High-Gain **0.16** (narrow, needs precision), Standard 0.24, Omni 0.4.
- Meter noise: Titan 0.14 (haze), Asteroid 0.07.
- Earth sits at a radius of 0.35–0.8 at a random angle (room seed + attempt).
- With Reduced Motion there is no sweep: instead, a single static coarse ring.

Accuracy = 1 − (miss / beam)², no less than 0. **Bandwidth = nominal × (0.6 + 0.4 × accuracy).**

**Packet queue — top one goes first.** The mission's science goals are reordered by drag and drop. A goal's value in the queue equals the goal's stars for the commander; a goal that nothing can collect is worth 0.

**Score = 0.6 × accuracy + 0.4 × queue.**

**Effect in flight:**
- The transmission rate is multiplied by the aiming.
- The queue sets the sending order among the goals that still need data. "Send first" from the scientist and comms still goes earlier.
- **When memory overflows**, new data for an important goal overwrites the stored data of goals at the end of the queue. Without the task, new data is simply lost.
- **Skip:** accuracy 0.4 → **76 %** of bandwidth, the default queue, no overwriting.

## In flight: the same widgets (the spec's P2 mini-games)
- **Comms — re-aiming after a blackout.**
  - When the link comes back after a blackout (Titan's atmospheric entry, a storm, losing Earth after a dodge at the Asteroid), the antenna loses Earth. Aiming drops to **0.35** (74 % of bandwidth).
  - A small "The antenna lost Earth" radar appears on the comms officer's panel. Where Earth is depends on the seed and the moment of the blackout.
  - Pressing "Aim here" restores accuracy immediately. But it is **no higher than before the flight**: the pre-flight aiming works as a pointing table.
  - If nobody re-aims, the onboard computer finds Earth by itself after **30 s** and restores the pre-flight accuracy.
- **Engineer — isolating a node during a Power Drop.** The crisis card has a schematic with the lines. Tapping a consumer makes it the "Isolate the node" choice (the `isolateNode` action). The default "Isolate the node" option (the most powerful one) remains.
- **Scientist — intensity during an Overheat.** If the mode is above "cautious", the scientist's Overheat card offers a lower mode: "normal" or "cautious". The `oh_intensity_*` options are chosen with the same switch. The mode changes until the end of the flight, and the instruments heat less.

## Report
- The "Individual Tasks" block: each role's grade (or "skipped") and what the task did in this flight.
  - Commander: the main goal, the emergency decision.
  - Engineer: what was on the secondary line, a harsh Power Drop, the isolated node.
  - Scientist: quality after calibration, the mode and ± data.
  - Comms: bandwidth, how much data did not go out in time, re-aims, overwriting in the queue.
- Chains of causes (sorted together with the others by impact):
  - `task:comms-aim` — imprecise aiming and ≈ how much data did not go out in time;
  - `task:comms-queue` — the queue saved the important data;
  - `task:science-calib` — calibration below 97 %;
  - `task:science-mode` — intensive mode and overheating, or cautious mode and a data shortfall;
  - `task:engineer-harsh` — a harsh Power Drop: line overload or a skip;
  - `task:engineer-crit` — something important was switched off because it was on the secondary line;
  - `task:commander-order` — something important was switched off first because of the sacrifice order;
  - `task:commander-emergency` — the emergency decision.

## How much this changes the flight (verified by tests)
Titan, the `TITAN_GOOD` build, seed 7, all four tasks "excellent" versus "all skipped", identical crisis answers:
- "Data volume and quality": 19.3 versus 17.0 out of 20.
- "Communications": 14.7 versus 14.4.
- Total: **97 versus 94**.
- Because of the aiming, with a skip ≈ 71 data units went out later than they could have (≈ 9 with "excellent").

The tasks do not break the mission balance, but the difference shows in the score and in the report.

More tests:
- The Rotor System on the secondary line in a power-poor build is switched off **first**; with correct routing — later.
- Without routing, the Power Drop starts with hull −4 % and a timer 11 s shorter: 6 s for the lines and 5 s for the commander's skip.

## What is not done
- A 3D close-up of the unit on the tasks screen. The spec marks it "if cheap". Not done: on a phone it would be a second 3D scene next to the widgets.
- English texts — the shared i18n pass will add them. The strings are collected in `TEXT` at the top of each file. The engine returns ids and numbers; the report chains are still in Russian, like the rest of the report.

## Retuning the strength of the consequences (2026-11-15, second iteration)
The first version barely changed the result (Titan 97 versus 94). Now each role changes the **collection speed and data quality** of every instrument. The multipliers stack, but never go below ×0.6 (`TASKS.floor`).

| Role | Collection speed | Quality | Also |
|---|---|---|---|
| Commander | the first two goals ×1.2, the last ×0.85, no plan ×0.8 | the last goal ×0.9, no plan ×0.75 | Power Drop and the emergency decision — as before |
| Engineer | on a line overloaded because of the routing: ×(limit + unavoidable overload) / load, not below 0.5; skip ×0.8 | the same multiplier (voltage sag) | a harsh Power Drop — as before |
| Scientist | usable frames 0.7 + 0.4 × accuracy (up to ×1.1) | 0.6 + 0.4 × accuracy | the mode — as before |
| Comms | bandwidth 0.5 + 0.6 × accuracy (up to 110 %); skip: accuracy 0.25 → 65 % | — | 0.3 × (1 − accuracy) of packets miss Earth and are lost (skip: 22 %) |

Measurements (seed 7, identical crisis answers). "Average" is an honest attempt with mistakes, graded "good":

| Build | All excellent | Average | All skipped | One role skipped: C / E / S / Co |
|---|---|---|---|---|
| Titan `TITAN_GOOD` | 96 Perfect | 94 Perfect | 74 Success | 94 / 94 / 90 / 90 |
| Titan starter | 88 Success | 86 Success | 65 Partial | 86 / 86 / 82 / 85 |
| Asteroid `AST_GOOD` | 97 Perfect | 95 Perfect | 83 Success | 95 / 95 / 94 / 93 |
| Asteroid weak `AST_BAD` (no sample) | 62 Partial | 60 Partial | 51 Partial | 60 / 60 / 58 / 58 |

Honest about the weak spots:
- Skipping just the commander's or the engineer's task on a good build costs about **2** points. The scientist's and comms' — 3–7.
- The tasks cannot "rescue" a Partial into a Success: with weak builds, the build itself is the problem (for example, there is no sample).
