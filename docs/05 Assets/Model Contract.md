# Model Contract (Claude Design → game)

> Accepted on 2026-11-14; hulls replaced with v2 on 2026-11-15. This page holds what the code relies on.

## General
- Meters, Y up, front +Z. One GLB per model: `assets-src/<id>.glb` → optimized `public/models/<id>.glb`.
- The GLB has no outlines, lights, floor or camera. The game draws the outline and the toon shading.
- Materials `M_<what>`, flat color; lights/screens — `M_Emissive`; the recolorable role stripe — `M_Role`.
- Nodes: `pivot_<name>` — a moving part (center on the axis), `fx_<name>` — an effect point, `mount_<name>` — an attachment point.

## Modules (per slot)
- The base is centered at the origin on the plane y = 0; the module grows toward +Y (+Y = outward from the hull).
- Attached as a child of the hull's `slot_*` node with an identity transform.

## Hulls v2 (2026-11-15) — current
> Why: v1 (a barrel Ø1.85 × 1.4 m and a large hexagon) looked huge, and 0.1–0.4 m modules looked like stickers on a wall. v2 are small, low, open frames with recessed **bays** with a colored rim per department; a module sits **in** a bay.
- **Exact coordinates of all slots** (bay floor center `p` + outward normal `n`) — `scripts/model-contract.json` → `frames`; their mirror in the game is `src/scene/layout.ts` (`SLOT_TABLE`), and a test compares them. The validator checks every slot: an offset > 0.06 m — warn, > 0.12 — error; +Y against the normal — error.
- The bay floor is 0.04 m deeper than the panel; the rim is 0.035 wide and 0.02 above the panel; the rim color = `DEPT_COLOR`.
- In the game, modules sit right on the bay floor with a scale of `MODULE_SCALE` = 1.1 (`Craft.tsx`). A module whose base is wider than the opening sits on an **adapter** (`Module.tsx` → `Adapter`): a graphite block in the bay with a colored collar; its height `lift` comes from the slot table (0.08 above the floor: rim + flat overlay parts; the Titan underside 0.09, asteroid sockets 0.07, comms on the Titan deck 0.11, asteroid recovery_2..4 0.10, the capsule ring 0). In the rear underside sockets of the Titan (`maxFoot` 0.40), a module that is bigger than the space is scaled down so it doesn't touch the landing gear struts. The RTG and the capsule take `slot_<department>_1` first; on Titan the RTG **lies crosswise** in a cradle (`cradle`), and any other module in the cradle sits on an adapter 0.10 above the V-mounts.
- Low-profile rule for overlays (v2.1): within 0.15 m of any bay rim, overlay parts are no higher than 0.02 above the panel (flat strips, plugs, strip overlays); bulky parts only along edges/corners/under beams.

## Hull `frame_titan` (v2)
- A low "tub" chassis 1.1 (X) × 1.6 (Z) × 0.55; the origin is the center of the underside (y = 0), the deck is at y = 0.55.
- 4 thick outrigger beams to the motor pads; the top of the pads is at (±1.00, 0.62, ±1.05).
- v2.1 (polish): the cradle "ears" are spread to x ±0.43…±0.51 and raised to y 1.0, with a crosswise cradle between them on two V-mounts (a 0.84 × 0.51 plate) — the RTG lies crosswise, as in the concept; the bays on the ±X sides are 0.27 × 0.27 with a 0.025 rim, so the gold insulation fits between them.
- 26 slots: the ±X sides — 4 bays each (y 0.28, z −0.54/−0.18/+0.18/+0.54: power at the back, structure at the front), the +Z nose — 3 science bays, the −Z stern — power_6 and navigation_4, the deck — a 3×3 grid of sockets (science_4/5 and navigation_1 at the front, comms_1..4 and navigation_2/3), the RTG cradle at the back of the deck (`slot_power_1`, between two "ears" up to y 0.9), the underside — 3 propulsion sockets (+Y pointing down).
- `cam_front` (0, 0.35, 0.86), `cam_top` (0, 2.2, 0).

## Titan overlays (in hull coordinates, not per slot)
- `rotor_system`: coaxial pairs, 8 rotors: `pivot_rotor_1..4` (upper, hub at y 0.92) + `pivot_rotor_1..4_lo` (lower, y 0.74), span 0.9; the pairs counter-rotate (`mechanicsRules.ts`).
- `landing_system`: 4 legs from the underside lugs (±0.38, 0, ±0.50) to 2 skids at x = ±0.62, ground contact at y = −0.45, `pivot_leg_1..4`.
- `thermal_insulation` (`M_Gold`) — only between bays, does not cover modules; `power_bus` (`fx_flow`) — harnesses along the rails, plugs at the rim corners; `reinforced_frame` — corner caps, bumpers, gussets, an X-brace under the underside.

## Environment
- `test_stand`: `pivot_turntable`, `mount_craft` at y = 0.80 (the hull origin goes there).
- `hq_hangar`: 18 × 12 × 8 m, open toward +Z; `mount_stand`, `mount_console_1..4`.
- `hq_console`: `M_Role`. `launch_pad`: `mount_rocket`, `pivot_arm_1..2`.
- `rocket`: 14 m, `pivot_stage2`, `pivot_fairing_l/r`, `mount_payload`, `fx_nozzle`, `fx_nozzle_2`.
- `titan_terrain`: a 60 × 60 tile, edges at height 0, a `lake` mesh.

## Astronaut
SkinnedMesh, 1.7 m, `M_Role`, clips `Idle, Typing, Wave, ThumbsUp, Panic, Cheer, Shrug`. Skeleton: `Hips, Spine, Chest, Neck, Head, Shoulder/UpperArm/LowerArm/Hand_L/R, UpperLeg/LowerLeg/Foot_L/R` (+ optional `Thumb_L/R`, `Fingers_L/R`). The current version is v2 (2026-11-14).

## P1: Asteroid hull and capsule (2026-11-14; the hull is v2 since 2026-11-15)
- `frame_asteroid` v2: a hexagonal truss, apothem 0.65 (1.3 across, corner 0.75), y 0…0.9, a flat face toward +Z. Each face has one lower bay (y 0.27, power) and two upper ones (y 0.65, offset ±0.16: science / structure / navigation). Deck: a gold capsule-holder ring (top at y 0.95, `slot_recovery_1`), round comms sockets (r 0.56, 30°/150°/210°/330°) and recovery_2..4 (90°, 270°, 180°). Underside: the engine flange (`slot_propulsion_1`) + 3 sockets at r 0.42. Supports — 3 legs from the corners at 90°/210°/330°, ground contact at y = −0.35. 30 slots, `cam_front`, `cam_top`.
- Its overlays are separate GLBs `<id>__asteroid` (`thermal_insulation`, `power_bus`, `landing_system`, `reinforced_frame`). The game picks the variant by the mission's hull, otherwise the regular one.
- `reinforced_frame` is a new overlay (both versions).
- `return_capsule` on `slot_recovery_1` with the nodes `mount_heat_shield`, `mount_parachute`, `mount_beacon`; `heat_shield` (origin at the top of the shield, the shield extends down to −0.1), `parachute` (the canopy under `pivot_chute`, the game scales it 0→1), and `recovery_beacon` attach to them if the capsule is installed.
- `asteroid` (`lod0`, `lod1`, `mount_sample`), `earth` (`pivot_clouds`), `debris` (`debris_1..3` in one GLB).
