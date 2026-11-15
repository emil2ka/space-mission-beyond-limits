# 3D Pipeline: Claude Design → GLB → game

## 1. Generation in Claude Design
- The models were generated in Claude Design from the shared style block ([Prompt Preamble](../05%20Assets/Prompt%20Preamble.md)) and the coordinate contract ([Model Contract](../05%20Assets/Model%20Contract.md)), in packs by department.
- Raw exports (`assets-src/`) are not in the repository; the game ships only the optimized `public/models/*.glb`.

## 2. Requirements for every model (put them in the prompt)
- Units are **meters**, Y axis up, front +Z.
- **Origin = the module's attachment point** (the center of its base); for a hull — the center of mass on the stand.
- Named nodes:
  - hull: `slot_<dept>_<n>` (empty slot nodes, facing outward), `cam_*` (camera points);
  - modules: `pivot_*` for everything that moves (`pivot_rotor_1`, `pivot_dish`, `pivot_arm_1..3`, `pivot_panel_l/r`, `pivot_lid`), `fx_*` for effects (`fx_nozzle`, `fx_spark`, `fx_glow`);
  - characters: a skeleton, the clips `Idle, Typing, Wave, ThumbsUp, Panic, Cheer, Shrug`.
- Materials: standard PBR, base colors from the [Style Guide](../03%20Design/Style%20Guide.md) palette, glowing parts in a separate `M_Emissive` material.
- Triangle limits: module ≤ 4k, hull ≤ 15k, character ≤ 10k, environment ≤ 40k.

## 3. Validation and optimization (done 2026-11-14)
The contract for code is `scripts/model-contract.json` (nodes, materials, clips, `kind`, triangle budgets by kind/id). The logic is pure modules in `scripts/lib/` (covered by tests).

| Command | What it does |
|---|---|
| `pnpm models:validate [file.glb …]` | Defaults to `assets-src/*.glb`. A table: id, kind, tris/budget, bounding size, KB, status; below it — a list of ERROR/warn. Exit code 1 if there is a FAIL. |
| `pnpm models [id …] [--force] [--no-join]` | Validation → `assets-src/<id>.glb` → `public/models/<id>.glb` (dedup, resample, prune with keepLeaves, weld, join of unprotected meshes only, meshopt) → re-validation of the output → `public/models/manifest.json`. A FAIL source is skipped without `--force`. A warning above 1.5 MB. |
| `pnpm models --manifest-only` | Only rebuild `manifest.json` from what is in `public/models/`. |
| `pnpm models:test-set [dir] [--optimized]` | Synthetic GLBs per the contract (frame_titan, rotor_system, antenna_high_gain, rtg, test_stand) in `$TMPDIR/space-mission-test-models` — **not** in `public/`. To see them in the game: `pnpm models:test-set /tmp/x && pnpm models --src /tmp/x`, then remove them from `public/models/` and run `pnpm models --manifest-only`. |

What the validator checks:
- required nodes / materials (`M_Role`, `M_Lake`, `M_Gold`) / astronaut clips, a skin on the character; duplicate protected names; characters that three.js strips from names;
- triangles against the budget; file size; cameras/lights in the GLB; textures; emissive outside `M_Emissive`; "outline" shells;
- bounding size: units (≥ 200 m = cm/mm), a module 0.05–1.6 m with its base at y = 0, a hull (bottom 0, top 1.2–1.8, half-width 0.85–1.45), overlays in hull coordinates (rotors at y≈1.25, skids at y = −0.45), the astronaut ~1.7 m, the rocket ~14 m, the expected environment sizes;
- `frame_titan`: for each `slot_*` — the ring height, the drum radius, **local +Y = the outward normal** (the underside points down, the deck up), +Z up for the side slots, scale 1, power at the back / science at the front, `cam_front` at the front;
- `rotor_system`: `pivot_rotor_i` on the pads (±1, 1.25, ±1), vertical axis; `test_stand`: `mount_craft` at y = 0.80.

The optimizer never removes empty `pivot_/slot_/fx_/mount_/cam_` nodes, contract nodes (`lake`, `charge_*`), bones or animated nodes. If a mesh hangs directly on a `pivot_*`, it is moved into a child `<name>_mesh`, so that meshopt quantization does not shift the axis.

## 4. In the game (done 2026-11-14)
- `src/scene/models/loader.ts`: `useComponentModel(id)` — a model is loaded **only if it is in `manifest.json`** (no 404s), without Suspense: while loading or on error it returns `null` → a primitive placeholder (`src/scene/Placeholders.tsx`, in the same contract coordinates). GLTFLoader + MeshoptDecoder; each component gets its own clone (`SkeletonUtils.clone`). Instead of drei's `useGLTF` — a small store of our own: `useGLTF` suspends rendering (Suspense), but we need a placeholder while the model loads.
- Comic look (`toon.ts`): `MeshToonMaterial` with a 3-step gradient + a black "inverted hull" outline (thickness roughly constant in pixels). No outline for: `M_Emissive`, transparent materials, `lake*`, SkinnedMesh.
- `Craft.tsx`: if `frame_titan` exists → modules attach to its `slot_<dept>_<n>` (by number within the department, `slots.ts`); no hull or not enough slots → the procedural layout `layout.ts` with the same numbers. Overlays (`rotor_system`, `landing_system`, `thermal_insulation`, `power_bus`) sit at the hull origin. Fly-in along an arc following the slot normal (0.6 s, easeOutBack), the engineer's x-ray (the hull is semi-transparent, the outline is hidden).
- Mechanics (`mechanicsRules.ts` + `mechanics.ts`): rotors, antenna (azimuth + tilt), panels, drill, radiator, wind vane, camera pan/tilt, `fx_glow` pulsing. Reduced Motion: loops stand still, one-time deployments jump straight to the final pose, the glow is steady.
- `StandScene.tsx`: `hq_hangar` (`mount_stand`, `mount_console_1..4`), `test_stand` (`mount_craft`), `hq_console` with `M_Role` in the colors of the 4 roles; the camera aims at the craft and pulls back further on a narrow canvas.
- For the future: `useEnvModel('rocket' | 'launch_pad' | 'titan_terrain')`, `useAstronautModel()` (a clone + clips for drei's `useAnimations`), `nodeTransform(scene, 'mount_payload')`.

## 5. P1: Asteroid, capsule, new modules (done 2026-11-14)
- **Validator:** `frame_asteroid` is checked as a hexagon: a side slot must lie on the panel (0.9 m along the face normal) and face **along the face normal**, not radially (slots offset by x = ±0.35 on the front/back face). 30 slots are checked, including `slot_recovery_1` in the center of the deck, plus a spacing of ≥ 0.35 m between deck slots. `heat_shield` (kind `capsule_part`): top at y = 0, bottom ≈ −0.1, Ø ~0.72. `parachute` may be up to 2.8 m (canopy open). `landing_system__asteroid`: feet at y = −0.35. `asteroid` / `earth` / `debris`: budgets from `maxTris`, and a check that the origin is at the center, not on the floor.
- **Hull per mission:** titan → `frame_titan`, asteroid → `frame_asteroid` (`layout.ts` `FRAME_BY_MISSION`). Without a GLB — a procedural hexagon and slots from the contract numbers (`SLOT_LAYOUT_ASTEROID`).
- **Overlays:** on the Asteroid, `<id>__asteroid` is used if it is in the manifest, otherwise the regular `<id>` (so until the variant exists, the hexagon gets the Titan version). `reinforced_frame` is a new overlay.
- **Capsule:** `return_capsule` always takes `slot_recovery_1` first. If it is installed, the first `heat_shield` / `parachute` / `recovery_beacon` attach to its `mount_heat_shield` / `mount_parachute` / `mount_beacon` (from the GLB, otherwise the contract numbers) and do not take up a slot; without the capsule — they go to their own `recovery` slots. The parachute canopy (`pivot_chute`) is folded by default (scale 0.001).
- **Animations:** `pivot_wheel_1..3` spin around X/Y/Z, `fx_beam` pulses (ion_engine), robotic_arm sways (only this model; the launch pad's `pivot_arm_*` do not move), `pivot_lid` opens slightly (the sign of the angle is a guess, see Known Issues), `pivot_damper_*` bounce, `pivot_clouds` rotates, `led_*` blink out of sync, the beacon blinks, the heat shield's `fx_glow` does not glow on the stand. Reduced Motion: everything stands still, the glow is steady.
- **Testing without 150 MC:** `pnpm dev`, open `http://localhost:5188/?dev=1` and create a room — all missions are unlocked. This code is not in `pnpm build` (`import.meta.env.DEV`).

## Lessons (do not repeat)
- Models arrived rotated and at the wrong scale → now there are strict axis and origin requirements in the prompt + automatic validation.
- Skeletal clips for mechanics were needless pain → mechanics are procedural.
- Do not generate models before the list and the style are locked.
