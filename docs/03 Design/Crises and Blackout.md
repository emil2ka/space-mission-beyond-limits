# Crises, Signal Loss, Atmosphere

## Disaster effect (a serious failure)
1. A short interface glitch of 0.5–1 s.
2. A large **CRITICAL EVENT** message.
3. A semi-transparent red-orange emergency overlay.
4. In the porthole/external camera — a 3D picture that **matches the cause** (debris only for a Debris Alert, static for Signal, sparks on the damaged unit for a Power Drop).
5. Warning indicators blink a limited number of times (3), with no strobe.
6. A short buzzer and quiet radio noise (if sound is on).
7. A decision timer of 15–30 s.
Accessibility: Reduced Motion (no camera shake and no glitch), Disable Flash, volume.

## Tactical Radio
Quick phrases on a button, 2 per role:
`ENGINEER: POWER BUS OVERLOADED` · `ENGINEER: SHUT DOWN AUXILIARY LINE` · `SCIENCE: DATA BUFFER 90% FULL` · `SCIENCE: SAMPLE CONTAINER NOT SEALED` · `COMMS: SIGNAL LOST` · `COMMS: ANTENNA MISALIGNED` · `COMMANDER: PRIORITIZE HULL` · `COMMANDER: ABORT SECONDARY OBJECTIVE`
A message → the shared log + shown large for 2 s to everyone. A short chat is optional. During a blackout, normal messages are delayed (per the scenario); emergency phrases are available if the channel is not switched off.

## Four signal states
- **Signal Delay** — a command and its confirmation travel with a delay (show both).
- **Signal Lost** — no signal.
- **Interference** — the signal is distorted (some packets are lost).
- **Data Queue Full** — the transmission queue is full.
Titan's delay is a game value, "inspired by the distances", not the exact travel time.

## Asymmetry during a blackout
- **Engineer:** red indicators, overheating, power lines, diagnostics; does not see the exact position if navigation is unavailable.
- **Scientist:** accumulated data, the measurement queue, the fact that data is not going out; chooses which measurements to continue.
- **Comms:** `NO SIGNAL`, noise, antenna direction, the packet queue, free memory.
- **Commander:** the timer, hull integrity, overall status, critical notifications — but not all the causes.
Everyone has useful information and a concrete action. This is controlled asymmetry, not confusion.

## Timer and autonomy
15–30 s only for significant crises. Not in time → the configured algorithm or the Safe Protocol runs. The consequences depend on preparation, not just on how fast you click.

## Crisis scenarios
| Crisis | Mission | Trigger (deterministic, from the build) | Engineer | Scientist | Commander | Comms |
|---|---|---|---|---|---|---|
| Power Drop | Titan | a line is overloaded (flow > bus limit) or charge < 20% | sees the specific unit, isolates/repairs it | sees the most power-hungry ones, switches them off | chooses which goals to keep | estimates how much data we can still send |
| Signal Distortion | Titan | phase 3, higher chance without a Signal Amplifier | watches power/temperature | whether to keep collecting | — | re-tunes the antenna |
| Debris Alert | Asteroid | approach phase, lower chance with a Micrometeoroid Shield | assesses the shield and hull | — | dodge or continue | may lose antenna aiming |
| Sampling Arm Jam | Asteroid | sampling, higher chance without Vibration Dampers | restarts/isolates the drive | sees the sampling problem | retry or not (time) | saves the collected data |
| Overheat | both | heat balance > threshold | switches off/cools down | loses an instrument | — | — |
| Freeze | Titan | heat balance < threshold | turns on the Heater | instruments degrade | — | — |

**Decision:** crises are not random but depend on the build (with a little noise from the room seed). See [0006 Deterministic crises](../06%20Decisions/0006%20Deterministic%20crises.md). This way the report can honestly say "it happened because of this".

## What was done (M2, 2026-11-14) — **verified** (tests + browser, demo)
Code: `src/engine/blackout.ts` (radio, commands, signal states), `panels.ts` (what a role sees), `src/ui/Radio.tsx`, `Flight.tsx`.
- **Tactical Radio:** the 8 phrases from the list above, 2 per role; emergency (SOS) ones: `POWER BUS OVERLOADED`, `DATA BUFFER 90% FULL`, `SIGNAL LOST`, `PRIORITIZE HULL`. Buttons on the flight panel → the log + shown large for 2 s to everyone. During a blackout, normal phrases wait **10 s** (`TITAN.radio.blackoutDelay`), emergency ones go out right away; if the craft has no link at all (the channel is switched off), emergency ones wait too. The sender sees "on air in N s".
- **Four signal states** — a strip in the Mission Control header: SIGNAL DELAY (a command takes 6 s there + 6 s for confirmation) · SIGNAL LOST (the reason, how long without a link, how long to wait) · INTERFERENCE (% loss) · DATA QUEUE FULL (free memory).
- **Command delay (sent → arrived → confirmed):** each role has a list of its own commands; during a blackout a command is "waiting for the link", then takes `delayTicks` each way. Crisis choices and the scientist's mode are shown too (the engine applies their effect immediately; the strip only shows the signal's path).
- **Each role's action** (`ROLE_COMMANDS`): comms — "Signal search: turn the DSN antennas" (ground-based, immediate: a storm blackout is 6 s shorter; does not help during atmospheric entry); engineer — "Switch off the auxiliary line" (sent to the craft with a delay); scientist — "Send first: <measurement>" (the transmission queue once the link is back); commander — "Hull first: stop maneuvers" (10 s of hovering).
- **Asymmetry during a blackout:** comms — NO SIGNAL, 100 % noise, the antenna dial ("?"/"folded"), the packet queue, free memory; engineer — power lines, the bus, heat, **diagnostics** (faults, overheating/cooling, battery drain "lasts ≈N s", switched-off lines); scientist — "Not sent to Earth" per measurement, the mode for the next point, what to send first; commander — the **blackout timer** (no link / link in ≈), the hull, overall status, who is flying the craft (rules / Safe Protocol), with no technical causes.
- Dev: with `?dev=1&speed=N` the clock runs at normal speed during a blackout (as in a crisis), so the screen can be played.
