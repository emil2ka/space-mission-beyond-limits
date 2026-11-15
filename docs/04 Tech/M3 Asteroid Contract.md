# M3 Contract: Asteroid and economy (engine ↔ screens ↔ 3D)

> 2026-11-14. Like the [M1 Flight Contract](M1%20Flight%20Contract.md): three parts, the shared names are mandatory, details are up to whoever builds them. Design: [Asteroid Sample Return](../03%20Design/Missions/Asteroid%20Sample%20Return.md), [Economy](../03%20Design/Economy.md), [Crises and Blackout](../03%20Design/Crises%20and%20Blackout.md), [Mission Report](../03%20Design/Mission%20Report.md). Acceptance test E of the spec (TZ v2.0): "complete Titan and earn credits → show the cost of the asteroid mission → unlock it when the balance is sufficient → show maintenance/repairs before the next launch → never allow a negative balance or a soft-lock".

## File ownership
| Part | Owns | Does not touch |
|---|---|---|
| **A. Engine** | `src/engine/**` | `src/ui`, `src/store`, `src/scene` |
| **B. Screens** (after A) | `src/ui/**`, `src/store/**` | `src/engine`, `src/scene` — import only |
| **C. 3D** | new files `src/scene/AsteroidScene.tsx`, `src/scene/ReturnScene.tsx`, `src/scene/asteroid/**`; additive changes to the shared parts in `src/scene/flight/**` | `src/engine`, `src/ui`, `src/store` (except wiring up the dev pages `?scene=asteroid`, `?scene=return`) |

## A. Engine

### Asteroid flight (the same `FlightState`; the new fields are optional for Titan)
```ts
type AsteroidSiteId = 'regolith' | 'boulder' | 'crack';      // soft regolith / rock / near a crack
type CapsuleStage = 'stowed' | 'separated' | 'entry' | 'chute' | 'landed' | 'found' | 'lost';
interface AsteroidFlight {
  fuel: number; fuelMax: number;                 // chemical burns it on maneuvers, ion is efficient on the cruise
  approach: number;                               // 0..1 approach (for 3D)
  site: AsteroidSiteId | null;                    // chosen by the scientist (the chooseSite action)
  sampling: 'idle' | 'reach' | 'grab' | 'jam' | 'stowed' | 'failed';
  sample: { collected: boolean; sealed: boolean; mass: number };
  capsule: CapsuleStage; capsuleProgress: number; // 0..1 within the stage (for the 3D entry/parachute)
  debris: boolean;                                // a Debris Alert is in progress (for 3D)
}
interface FlightState { /* …M1… */ asteroid?: AsteroidFlight }
```
- Phases from the design: Cruise → Approach → Site selection → Sampling → Packing → Return cruise → Capsule return. Duration ≈ 9–12 min at `TICK_SECONDS = 1`.
- The Rotor System is incompatible on the Asteroid and does not count as propulsion (test B already exists — do not break it).
- Crises (deterministic from the build + seed, decision 0006): **Debris Alert** (approach; rarer with `micrometeoroid_shield`; options: dodge/continue), **Sampling Arm Jam** (sampling; more frequent without `vibration_dampers`; restart/isolate the drive/retry), plus Overheat/Power Drop under the general rules. No choice → an Autonomy Planner rule (`debris_detected`, `sample_secured`…) or the Safe Protocol.
- Actions: `{type:'chooseSite'; site}` (scientist), the rest as in M1 (`crisisChoice`, `radio`, …). Role permissions as in M2.
- `panelFor` for the asteroid: engineer — propellant/engines/shield; scientist — the site, the arm's state, the sample; comms — signal/composition data; commander — overall status, hull, timer.
- Report: weights from Mission Report (sample integrity 10, return 5, etc.); Perfect = the sample is sealed + the capsule is found + composition data is delivered; chains of causes for the asteroid.

### Economy (test E)
```ts
interface Agency {                         // the team's meta-progress, carried over between attempts
  credits: number; unlocked: MissionId[]; upgrades: UpgradeId[];
  damaged: string[];                       // modules that need repair after the last flight
  history: { mission: MissionId; outcome: Outcome; earned: number }[];
}
type UpgradeId = 'light_alloys' | 'better_antennas' | 'better_batteries' | 'pdu_v2' | 'extra_slot' | 'fc_v2';
interface PrepCosts { items: { id: string; label: string; cost: number; optional?: boolean }[]; total: number; affordable: boolean; fallback: 'none' | 'free_basic_repair' }
prepCosts(agency, insurance: boolean): PrepCosts
```
- Rewards and prices come from [Economy](../03%20Design/Economy.md) (Perfect 120 / Success 90 / Partial 50 / Failed 20 + 10 per goal; asteroid 150; upgrades 50–80).
- Actions: `unlockMission` (exists), `{type:'buyUpgrade'; id}`, `{type:'confirmPrep'; insurance: boolean}` (charges for preparation before a new attempt; shown BEFORE confirmation); "Again" / "To HQ" go through preparation.
- Upgrades really change `computeStats` (hull mass −10 %, battery capacity +25 %, 6 rules, +1 slot, PDU v2 — smart shutoff, antennas — +bandwidth). Each is a trade-off, described in the data.
- **Never go negative and never lock the game:** not enough for preparation → free basic repair and the starter configuration. Test E is fully covered in the engine tests.
- Storage: `Agency` in `RoomState` + the functions `exportAgency/importAgency` (B puts it in the host's localStorage; the Supabase `agency` table comes later).

> **How it turned out (2026-11-14, part A done — verified by tests, 176/176, typecheck, build):** the contract names did not change, fields were added. Rules and signatures — [Simulation Engine](Simulation%20Engine.md) (the "Asteroid flight" and "Economy" sections), numbers — [Balance Table](../03%20Design/Balance%20Table.md), departures from the design — [0012 M3 asteroid and economy](../06%20Decisions/0012%20M3%20asteroid%20and%20economy.md).
> - `AsteroidFlight` (`src/engine/asteroid.ts`): the contract fields + `drive` ('ion' | 'chem'), `cruise`, `samplingProgress`, `tool`, `sealProgress`, `siteBy`, `fuelUsed`, `fuelShort`, `approachFailed`, `offTarget`, `heated`, `armDamaged`, `stageTicks`, `attempts`… `FlightState` + `asteroid?`, `mods?`, `autoShed?`, `jamPlan?`. `CrisisKind` + `'debris_alert' | 'arm_jam'`, `ActiveCrisis.variant` + `'late'` (debris spotted late).
> - Length: **541–590 ticks ≈ 9–10 min** (the cruise and the approach end on arrival). There are two science goals: "Asteroid composition" (45, for Perfect) and "Sampling site imaging" (35; the Navigation Camera also images it — there are only 4 science slots).
> - Triggers: Debris — during the approach; without a Micrometeoroid Shield always, with one on 25 % of seeds; without Radar / Navigation Camera the timer is 8 s. Arm Jam — site risk − Vibration Dampers (regolith + dampers — never, rock without dampers — always), the moment comes from the seed. Rules: `debris_detected → evade`, `sample_secured → prepare_return` (sampling ends earlier), Safe Protocol at the deadline.
> - Economy (`src/engine/economy.ts`): `Agency` + `extraSlot`, `hullLoss`, `insured`, `coveredRepairs`, `pendingPrep`, `basicRepairs`, `lastPrep`; `PrepCosts` + `charge`, `balanceAfter`, `missing`. Actions: `buyUpgrade {id, slot?}`, `confirmPrep {insurance, next?: 'build' | 'lobby'}`, `loadAgency {agency}`, `chooseSite {site}`; `goStage` from the report also goes through preparation (without insurance). `room.credits` / `room.unlocked` are mirrors of `room.agency`. `computeStats(build, mission, mods?)`, `canAdd(..., mods?)`, `readiness(..., mods?)`, `statsOf(room)`.
> - `panelFor` → `panel.asteroid` (engineer: propellant + forecast, engines, protection; scientist: 3 sites with the risk for this build, the arm, the sample, composition; comms: composition, the capsule; commander: propellant, the sample, the capsule). `MissionReport` + `damaged`, `asteroid` (Perfect flags), `mc.balance`, `mc.prep`.
> - A minimal change outside the engine: `src/store/game.ts` — `DEV_UNLOCK` also unlocks missions in `room.agency` (otherwise the mirror would be overwritten).

## C. 3D scenes — pure components driven by props
```ts
interface AsteroidSceneProps {
  build: Build; phaseId: string; approach: number; site: AsteroidSiteId | null;
  sampling: AsteroidFlight['sampling']; sampleSealed: boolean;
  crisis: { kind: CrisisKind | 'debris_alert' | 'arm_jam'; nodeIds: string[] } | null;
  debris: boolean; offIds: string[]; signal: FlightState['signal']; reducedMotion: boolean;
}
interface ReturnSceneProps { build: Build; capsule: CapsuleStage; capsuleProgress: number; beacon: boolean; reducedMotion: boolean }
```
- Models: `asteroid` (`lod0/lod1`, `mount_sample`), `frame_asteroid` + modules + `__asteroid` overlays (via `Craft`/the loader), `robotic_arm` (`pivot_arm_1..3`, `pivot_claw*`), `drill`, `chem_main_engine`/`chem_thrusters` (`fx_nozzle*`), `ion_engine` (`fx_beam`), `debris` (`debris_1..3`), `earth` (`pivot_clouds`), `return_capsule` + `heat_shield` (`fx_glow`) + `parachute` (`pivot_chute`) + `recovery_beacon`.
- AsteroidScene: black space, stars, a slowly tumbling asteroid, the craft approaching (`approach`), attitude jets, three sites on the surface (the chosen one highlighted), the arm reaching for `mount_sample`, dust during sampling, jamming (jerks + sparks) on `arm_jam`, debris flying past on `debris`.
- ReturnScene: Earth, the capsule separates, entry — a glowing shield and plasma, the parachute opening (`pivot_chute` 0→1), touchdown, a blinking beacon, the camera.
- reducedMotion — no shaking; dev pages `?scene=asteroid` and `?scene=return` with sliders.

## B. Screens (after A)
- HQ (between attempts): the MC balance, history, unlocking the asteroid (price, balance, how much is missing), the upgrade shop (trade-offs), the preparation screen (`prepCosts` before confirmation, insurance, free repair when short).
- Mission Control for the asteroid: `AsteroidScene`/`ReturnScene` by phase, site selection for the scientist, role panels, Debris/Arm Jam crises (the same crisis screen).
- The asteroid report (sample, capsule) + MC.
- Test E in the browser: Titan → MC → unlock → preparation → Asteroid → report.
