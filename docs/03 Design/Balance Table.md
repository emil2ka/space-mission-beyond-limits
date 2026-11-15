# Balance Table

All numbers are conventional game parameters, not real NASA specifications. The source of truth is the code: components `src/engine/data/components.ts`, missions `src/engine/data/missions.ts`, the Titan flight `src/engine/data/titan.ts`, the Asteroid `src/engine/data/asteroid.ts`, the economy `src/engine/data/economy.ts`. This table describes them; if they disagree, the code wins.

## Titan flight (M1)
| Parameter | Value |
|---|---|
| Tick | 1 s of real time = 10 game minutes |
| Phases | Cruise 30 · Entry and deployment 60 · Flight between points ≤ 360 · Data transmission 120 ticks |
| Flight length | 480–570 ticks = 8–9.5 min |
| No link during entry | the first 15 ticks of the "Entry" phase |
| Rotors unfold | tick 15 of the "Entry" phase |
| Flight between points | 70 ticks (× speed: overload, the Freeze crisis) |
| Stop at a point | fast mode 20 ticks (hovering, data ×1.2, quality ×0.7) · precise 40 ticks (landing, quality ×1, chemistry) |
| Chemistry without a Landing System | quality ×0.75 |
| Built-in memory | 20 units (+200 Data Storage, +80 Data Buffer) |
| Goal collection stops | at 150 % of what is needed |
| Heat loss during the cruise | ×0.5 of the losses on Titan |
| Data quality by heat | freezing ×0.3 · cold ×0.7 · overheating ×0.8 |

## Science goals
| Goal | Must be delivered | Instrument → units/tick |
|---|---|---|
| Atmosphere profile | 40 | Atmospheric Sensor: entry 0.6, flight 0.1 |
| Surface images | 60 | HiRes: flight 0.15, point 1.0 (quality 1) · Wide: flight 0.12, point 0.6 (quality 0.75) |
| Surface chemistry | 50 | Spectrometer: only when landed, 0.7 |
| Ambient temperature | 20 | Temperature Sensor: 0.07 everywhere (entry, flight, point) |
Main goal — 2 of 4 delivered.

## Crises
| Parameter | Value |
|---|---|
| Decision timer | 20 ticks (s) |
| Pause between crises | 25 ticks; the first not before tick 10 |
| Maximum per flight | 3, each kind once |
| Power Drop (battery) | charge < 20 % during a deficit |
| Freeze / Overheat (critical) | ≤ −80 / ≥ 200 for three ticks in a row |
| Overheat (accumulated) | ≥ 120 for sixty ticks in a row (except the cruise) |
| Storm | starts at tick 30–150 of "Flight between points" (seed), lasts 60 ticks; without a Signal Amplifier: transmission ×0.5, 40 % loss, camera quality ×0.5; with one: 20 % storm chance, transmission ×0.75, 15 % loss |
| Storm escalation with no response | no link for 20 ticks (6 with a "Point the antenna at Earth" rule) |
| Options | science pause 20 · stop 20 · instrument sleep 30 · line restart 15 · cooling 20 ticks; "Sacrifice no goals" hull −8; unresolved overheating hull −10 + an instrument failure; Heater to maximum +40 heat +20 W; RTG heat to the instruments +50 heat, speed ×0.7 |

## Mass overload
| Overload | Consequence |
|---|---|
| up to +10 % | a warning; on entry hull −3 % per 1 % (max −25), rotors +3 % power, speed −2 % per 1 % |
| over +10 % | a blocker: the launcher cannot lift it |

## Scoring and rewards
| Criterion | Weight | How it is computed |
|---|---|---|
| Main science goal | 35 | the delivered share of the two best goals |
| Data volume and quality | 20 | ½ volume collected + ½ quality |
| Spacecraft condition | 10 | hull %, −20 % per failed instrument |
| Communications | 15 | delivered / collected |
| Bonus goals | 10 | delivery of the other two goals |
| Route completion | 5 | points passed / 3 |
| Resource use | 5 | full score up to 85 % of the budget, half at 100 % |
≥ 90 Perfect · ≥ 70 Success · ≥ 40 Partial · otherwise Failed. MC: 120 / 90 / 50 / 20 + 10 per delivered goal. Preparation for the next attempt — see "Economy" below. Team Trust: −15 for each accepted warning whose risk fired, +10 for a clean flight (see "Team Trust" below).

## Radio and commands (M2, `TITAN.radio`, `TITAN.commands` in `src/engine/data/titan.ts`)
| Parameter | Value | What it does |
|---|---|---|
| `radio.blackoutDelay` | 10 ticks | delay of a normal phrase during a blackout (emergency ones — 0, if the channel is not switched off) |
| `radio.cooldown` | 2 ticks | one phrase per role, no more often |
| `commands.holdTicks` | 10 ticks | "Hull first": how long the craft stands still |
| `commands.searchGain` | 6 ticks | "Signal search: turn the DSN antennas" shortens the storm blackout |
| `commands.maxPending` | 2 | how many of a role's commands can wait for confirmation |
One-way command delay = the mission's `signalDelay` (Titan 6 ticks).

## Asteroid flight (M3, `ASTEROID` in `src/engine/data/asteroid.ts`)
| Parameter | Value |
|---|---|
| Phases (maximum) | Cruise ≤ 140 · Approach ≤ 120 · Site selection 40 · Sampling 100 · Packing 30 · Return 190 ticks |
| Flight length | 541–590 ticks ≈ 9–10 min (chemical is faster, ion takes longer) |
| Cruise | Ion Engine 140 ticks, 0.07 propellant/tick (uses 60 W) · chemical 100 ticks, 0.4/tick |
| Approach | 80 ticks with a Navigation Camera or Radar, 110 without; 0.3 propellant/tick |
| Propellant | 100 units per Propellant Tank; holding at the surface 0.05/tick; the burn home chemical 30 / with ion 5 + 0.07/tick; overload ×(1 + 3 × fraction) |
| Typical use | chemical ≈ 101 (2 tanks with a margin, 1 tank — just enough, not enough with a dodge) · ion ≈ 60 (1 tank) |
| Sampling | the arm reaches for 12 ticks; speed per tick: regolith arm 1/35 drill 1/45 · rock 1/80 / 1/40 · crack 1/50 / 1/45; arm + drill = the better one + ½ of the other; ≥ 40 % by the end of the phase → a partial sample |
| Sample | regolith 60 g · rock 40 g · crack 50 g; full score from 40 g; sealing 20 ticks |
| Capsule | separation 130 · entry 140 · parachute 155 · touchdown 170 (phase ticks); found +3 with a beacon, +15 without a beacon (if at the target point), otherwise not found |
| Memory / comms | as on Titan: 20 units + Storage/Buffer, `bandwidth × 1/6` units/tick, delay 3 ticks |

### Sampling sites
| Site | Jam risk (base) | Composition data | Quality |
|---|---|---|---|
| Soft regolith | 0.35 | ×0.8 | 0.8 |
| Rock | 0.8 | ×1 | 1 |
| Near a crack | 0.6 | ×1.3 | 1 |
Risk: −0.6 with Vibration Dampers, +0.3 without (+0.1 more with the drill), +1 if the arm was bent by debris. ≤ 0 — never, ≥ 1 — always; the moment at 20–50 % collected comes from the seed.

### Asteroid science goals
| Goal | Required | Instrument → units/tick |
|---|---|---|
| Asteroid composition (needed for Perfect) | 45 | Spectrometer: approach 0.05, site 0.2, sampling 0.35 (after contact), packing 0.5 (from the sample) · Drill: sampling 0.15 (quality 0.6) |
| Sampling site imaging | 35 | HiRes: 0.2 / 0.6 / 0.1 · Wide: 0.25 / 0.35 / 0.1 (quality 0.75) · Navigation Camera: 0.15 / 0.4 / 0.1 (quality 0.6) |
There are 4 science slots (arm, container, sealer, spectrometer — already 4), so the site is also imaged by the Navigation Camera (navigation department).

### Asteroid crises
| Parameter | Value |
|---|---|
| Timer | 20 ticks (Debris without Radar / Navigation Camera — 8) |
| Debris Alert | tick 15–45 of the approach (seed); without a Micrometeoroid Shield always, with one on 25 % of seeds |
| Debris damage | without a shield −18 %, with a shield −4 %; freezing in place ×0.5; shield into the stream /3; sheltering the capsule +4 % to the hull, but the Heat Shield stays intact; without a shield or shelter — the Heat Shield is damaged (+ the arm is bent if you "continue"); light alloys ×1.25 |
| Dodge | −12 propellant, approach +8 ticks; without a Star Tracker / Reaction Wheels the antenna loses Earth for 8 ticks |
| Arm Jam | restart 10 ticks (without an image — speed ×0.8) · retry 15 ticks from scratch · Safe Protocol 25 ticks, then ×0.5 |
| General crises | Power Drop / Overheat / Freeze under the Titan rules, no more than 2 on the Asteroid |

### Asteroid scoring
| Criterion | Weight | How it is computed |
|---|---|---|
| Main science goal | 35 | 0.6 — the sample on Earth (capsule found) + 0.4 — the delivered share of composition data |
| Data volume and quality | 20 | as on Titan |
| Spacecraft condition | 10 | as on Titan |
| Communications | 15 | as on Titan |
| Sample integrity | 10 | sealed 1 / not 0.5 × min(1, mass/40 g) × 0.5 if overheated |
| Capsule return | 5 | found 1 / not found 0.3 |
| Resource use | 5 | ½ budget + ½ remaining propellant (full from 10 %) |
Perfect — only with a sealed sample + a found capsule + delivered composition; without a sample on Earth — Partial at most.

## Economy (M3, `REWARDS` in `titan.ts`, `UPGRADES` in `economy.ts`)
| What | MC |
|---|---|
| Reward | Perfect 120 · Success 90 · Partial 50 · Failed 20 + 10 per delivered goal |
| Unlock the Asteroid | 150 |
| Preparation (after every flight) | maintenance 10 + diagnostics 5 + consumables 5 + module repairs (20 % of the price, ≥ 5) + hull 2 per every 10 % |
| Insurance (optional) | 15 — repairs after the next flight are free |
| Not enough for preparation | free basic repair, the balance is not touched, the craft is the starter build |

| Upgrade | MC | Gives | Trade-off |
|---|---|---|---|
| Light alloys | 80 | hull −10 % mass | debris damage ×1.25 |
| Upgraded antennas | 60 | antenna link +30 % | antennas +20 % power |
| Efficient batteries | 60 | capacity +25 % | +3 kg per battery |
| PDU v2 | 50 | whatever was switched off on discharge turns back on by itself when the charge is > 50 % (PDU needed) | the PDU uses 8 W instead of 5 |
| Extra mounting slot | 70 | +1 slot for the chosen department (Science by default) | +5 kg to the hull |
| Flight Computer v2 | 60 | 6 rules per Flight Computer | +5 W, +3 heat |

## Team Trust and budget shares (0013, `TRUST` and `DEFAULT_SPLIT` in `src/engine/data/rules.ts`)
| Parameter | Value | Where |
|---|---|---|
| Start / maximum | 100 / 100 | `TRUST.start`, `TRUST.max` |
| An accepted warning fired | −15 for each | `TRUST.penalty` (= `TITAN.trustPenalty`) |
| A clean flight (no accepted warning fired) | +10, capped at 100 | `TRUST.recovery` |
| "Tight-knit team" | ≥ 80: +5 s to each crisis timer | `TRUST.cohesive`, `TRUST.crisisBonus` |
| "Under watch" | < 50: a second key from the department owner | `TRUST.watch` |
| "Agency audit" | < 25: mandatory diagnostics for 15 MC at preparation (no MC — free repair) | `TRUST.audit`, `TRUST.auditCost` |

Default module budget shares (the mission budget minus the frame; the commander changes them in 5 % steps, totaling 100 %):
| Mission | Module budget | Engineer | Science | Comms and navigation | Starter craft by department |
|---|---|---|---|---|---|
| Titan | 420 − 80 = 340 M$ | 65 % (221) | 15 % (51) | 20 % (68) | 220 / 33 / 47 |
| Asteroid | 480 − 90 = 390 M$ | 50 % (195) | 30 % (117) | 20 % (78) | 195 / 100 / 54 |

## Individual tasks (0013 §1, `TASKS` and others in `src/engine/data/tasks.ts`)
Rules: [Individual Tasks](Individual%20Tasks.md).

Grade: ≥ 0.85 — excellent, ≥ 0.6 — good, otherwise weak (`GRADE_AT`). Skipping = weak.

| Role | Parameter | Value | Where |
|---|---|---|---|
| Commander | Score | 0.5 × goal priorities + 0.5 × sacrifice order | `TASKS.commander.goalWeight` |
| Commander | Goal importance, Titan | atmosphere 3, images 3, chemistry 2, route 2, temperature 1 | `GOALS.titan` |
| Commander | Goal importance, Asteroid | sample 4, composition 3, capsule 3, site imaging 1 | `GOALS.asteroid` |
| Commander | Value of systems for the mission | Titan: rotors 10, Heater 7, memory 6. Asteroid: chemical 10, arm 9, sealer 9, drill 8, beacon 8, ion 6. Instrument: 1 + the rank of its goal. Other: 3 | `KEEP_VALUE`, `TASKS.commander.otherKeep` |
| Commander | Skip | Power Drop timer −5 s, no "emergency decision" | `TASKS.commander.skipDeadline` |
| Engineer | Lines | main 60 % of the bus limit, secondary 40 % (2 buses: 180 / 120 W) | `TASKS.engineer.mainShare` |
| Engineer | Must be on the main line | power priority ≤ 2 or value ≥ 8 | `mustMainPriority`, `mustMainKeep` |
| Engineer | Score | 1 − 0.5 × the share of important loads on the secondary line − (0.25 + overload / limit, ≤ 0.5) − 0.2 for an empty secondary line | `critWeight`, `overloadBase`, `overloadMax`, `emptySecondary` |
| Engineer | Overload (beyond the unavoidable) or skip | Power Drop: timer −6 s (no less than 6 s), hull −4 % | `overloadDeadline`, `overloadHull` |
| Scientist | Calibration accuracy | 1 − error / 0.12 | `TASKS.science.tolerance` |
| Scientist | Instrument data quality | 0.6 + 0.4 × accuracy (skip: ×0.6) | `TASKS.science.qualityMin` |
| Scientist | Usable frames (collection speed) | 0.7 + 0.4 × accuracy (up to ×1.1) | `TASKS.science.rateMin/rateMax` |
| Scientist | Reference peak | the instrument's base ± 0.08 by seed and attempt | `CALIB_BASE`, `TASKS.science.jitter` |
| Scientist | Mode, Titan: data / instrument heat | cautious 0.8 / 0.5 · normal 1 / 1 · intensive 1.3 / 2 | `TASKS.science.modes.titan` |
| Scientist | Mode, Asteroid: data / instrument heat | cautious 0.85 / 0.5 · normal 1 / 1 · intensive 1.3 / 2.5 | `TASKS.science.modes.asteroid` |
| Scientist | "Just enough" before hot | heat balance ≥ 95 (the "hot" threshold − 25) | `TASKS.science.margin` |
| Scientist | Score | 0.7 × average accuracy + 0.3 × mode (1 / 0.5 / 0) | `TASKS.science.calibWeight` |
| Comms | Beam width | High-Gain 0.16, Standard 0.24, Omni 0.4 (radar of radius 1) | `TASKS.comms.beam` |
| Comms | Meter noise | Titan 0.14, Asteroid 0.07 | `TASKS.comms.noise` |
| Comms | Aiming accuracy | 1 − (miss / beam)² | — |
| Comms | Bandwidth | nominal × (0.5 + 0.6 × accuracy), up to 110 %; skip: accuracy 0.25 → 65 % | `bandwidthMin`, `bandwidthMax`, `skipAim` |
| Comms | Packets missing Earth | 0.3 × (1 − accuracy) | `TASKS.comms.loss` |
| Commander | Mission plan (instrument speed / quality) | the first two goals ×1.2 / ×1; the last ×0.85 / ×0.9; no plan ×0.8 / ×0.75 | `focus`, `focusQuality` |
| Engineer | Voltage sag | overload caused by routing: ×(limit + unavoidable overload) / load, not below 0.5; skip ×0.8 (speed and quality) | `sagMin`, `skipSag` |
| All | Lower bound of the product | instrument speed and quality not below ×0.6 | `TASKS.floor` |
| Comms | Score | 0.6 × accuracy + 0.4 × packet queue | `TASKS.comms.aimWeight` |
| Comms | After a blackout | accuracy drops to 0.35 (71 %); re-aiming — immediately, but no higher than before the flight; the computer does it on its own — after 30 s | `reaimDrop`, `autoReaimTicks` |

