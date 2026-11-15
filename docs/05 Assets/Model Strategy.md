# Model Strategy

The goal is ~70 models, so that the game looks complete but generation does not become a bottleneck.

## Four layers
1. **Craft bodies and launcher (5)** — the Titan craft, the asteroid craft, the rocket, the fairing, the capsule. Hero assets, the most detailed.
2. **Catalog modules (~50)** — each card = its own model (the card icon = a render of that model).
3. **Environment (8)** — the HQ hangar, a console, the stand, the Titan surface (a tile), a lake, the asteroid (2 LOD variants), Earth.
4. **Characters (4)** — role astronauts: **one** base model + 4 chevron/helmet colors (that is 1 generation).

## How to save effort
- Variants (2 antenna sizes, 2 batteries) = one generation with two COPY buttons.
- Small sensors (Temperature, Radiation) — one pack of "sensor pucks".
- The Titan environment is a tile + a haze shader, not a huge scene.

## Priorities
- **P0 3D** (a playable vertical slice of Titan, ~22 models): the Titan craft, the rocket, a minimal hangar, the stand, ~15 Titan modules, the Titan surface, the astronaut.
- **P1** (~25): the remaining modules, the asteroid craft, the capsule, the asteroid, Earth.
- **P2**: variants, HQ decor, upgraded modules (visually different).
List: [Master Model List](Master%20Model%20List.md).
