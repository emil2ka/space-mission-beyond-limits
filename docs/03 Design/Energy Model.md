# Energy Model (a critical point of the spec)

## Four different quantities
1. **Generation** — how much energy is produced per tick (W). Sources: RTG, Solar Panel Array.
2. **Consumption** — how much the **switched-on** systems need (W).
3. **Battery capacity** — how much can be stored (Wh). Sources: High-Capacity Battery, Backup Battery.
4. **Current charge** — how much is actually left (Wh).

## Formulas
```
Net Power = Total Generation − Active Consumption
Stored(next) = clamp(Stored + Net Power × Δt, 0, Total Battery Capacity)
```
- **1 tick = 10 game minutes**, Δt = 1/6 h, so in Wh: `Net × 1/6`. In flight, 1 tick ≈ 1 second of real time. Configured in `src/engine/constants.ts` ([0005 Tick length](../06%20Decisions/0005%20Tick%20length.md)).
- If Net < 0, the charge is consumed. When the charge = 0, secondary systems are switched off **by power priority** (PDU), starting from the lowest: science (optional) → instrument heating → secondary navigation → … Comms and control are switched off last. The Backup Battery powers only critical systems.
- If Net > 0, the batteries charge up to the limit, and the surplus is lost (show "surplus: 30 W unused").

## A battery is NOT a generator
Several batteries increase **capacity**; several generators increase **generation**. In the UI, batteries never appear in the "Generation" line (acceptance test A, step 5).

## Efficiency by mission
| Source | Titan | Asteroid |
|---|---|---|
| RTG | 110 W, steady | 110 W, steady |
| Solar Panel Array | 1 W (×0.01) + a warning | 60 W × orientation (0.5–1.0) |
| Backup Battery | critical systems only | same |

## Numeric breakdown (always visible to the engineer)
```
Generation: 120 W | Consumption: 155 W | Deficit: 35 W | Battery capacity: 600 Wh | Charge lasts: 17 h
```
Below it — a list of consumers in descending order, with toggles.
The numbers are conventional game parameters, not real NASA specifications.

## Multiple copies
Each component has a `maxInstances`, a slot and constraints. After adding/removing, mass, cost, generation, consumption, heat and slots are recalculated **immediately**. If the next module cannot be installed, the exact reason is shown: "No free Power slot (4/4)", "Mass limit exceeded by 45 kg", "Not enough budget: needs 30 M$, 12 M$ left", "At most 2 copies".

Code: `src/engine/stats.ts`, `src/engine/energy.ts`. Tests: `src/engine/__tests__/acceptance.test.ts`. Numbers: `src/engine/data/components.ts`.
