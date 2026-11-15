# 0009 — P0 models in 3 Claude Design batches

- **Date:** 2026-11-14 · **Status:** accepted
- **Context:** the pipeline used "packs of 4–6 models" (≈9 requests for the Titan slice). We decided to do it in 3 batches, at very high quality.
- **Decision:** 3 batches of 11 GLBs: B1 — hull, overlays and environment; B2 — power, navigation, comms; B3 — science, thermal, astronaut. Every prompt includes a quality rule (a quality pass and a scale pass) and a shared coordinate contract, so models from different batches line up. The contract is [Model Contract](../05%20Assets/Model%20Contract.md).
- **Risks:** 11 models per request takes longer and raises the chance that Claude Design stops halfway (then "continue with the remaining ids"). The astronaut's skeleton and clips are the riskiest part; the fallback is Blender.
- **Also:** outlines are not baked into the GLB; the game draws them. Overlays (`rotor_system`, `landing_system`, `thermal_insulation`, `power_bus`) are made in hull coordinates, not per slot.
