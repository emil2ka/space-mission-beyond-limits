# 0010 Titan flight model in M1 — accepted (2026-11-14)

**Context:** the M1 contract ([M1 Flight Contract](../04%20Tech/M1%20Flight%20Contract.md)) and the spec (TZ v2.0) left several flight rules open. Part A (engine) decisions:

1. **Mass overload up to +10 % is a warning; more is a blocker.** The contract called overload a blocker, but the spec's acceptance test C requires that the commander can approve an overload with a record, and that the report links it to its consequences. Overload consequences: hard entry (hull −3 % per 1 % of overload, max −25), rotors draw more power (+3 % per 1 %), slower flight (−2 % per 1 %).
2. **Bus overload, freezing and overheating are warnings, not blockers.** These are accepted risks: in flight they become the Power Drop / Freeze / Overheat crises.
3. **Team Trust** drops (−15) only for a launch approved against a warning (`approve-against-warning`), **and only if that risk actually fired** in flight (spec §3.1). A failed outcome on its own is not penalized.
4. **Overheat comes in two kinds:** critical (balance ≥ 200 for three ticks in a row) and "accumulated" (≥ 120, "hot", for 60 ticks in a row, outside the cruise) — this way two RTGs under insulation without a radiator overheat in phase 3, as in example 1 of [Consequences](../03%20Design/Consequences.md).
5. **Signal Distortion = methane storm:** without a Signal Amplifier the storm always comes; with one, only on 20 % of seeds and weaker. The storm timing is set by the room seed. If nobody responds, the interference grows into a full signal loss for 20 ticks — the Autonomy Planner takes over (test D).
6. **Atmospheric entry: no link for the first 15 ticks.** Without rules for `Signal = LOST`, the Safe Protocol kicks in (the craft hovers and turns science off) — which is exactly the reason to set up the Autonomy Planner.
7. **MC:** the engine credits earned MC right after the flight; upkeep (`mc.upkeep`) is only a calculation for the screen that prepares the next attempt (P1) and is not charged automatically.

**Why:** causality from the build (0006), transparent numbers in the report, no randomness except the seed.
