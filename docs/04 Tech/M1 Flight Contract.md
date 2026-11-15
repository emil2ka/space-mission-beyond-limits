# M1 Contract: Titan flight (engine ↔ screens ↔ 3D)

> 2026-11-14. A shared agreement between the three parts of M1, so they can be built in parallel. The names below are mandatory; details inside each part are up to whoever builds it. Design: [Titan Sky Explorer](../03%20Design/Missions/Titan%20Sky%20Explorer.md), [Crises and Blackout](../03%20Design/Crises%20and%20Blackout.md), [Mission Report](../03%20Design/Mission%20Report.md), [Core Loop](../03%20Design/Core%20Loop.md).

## File ownership
| Part | Owns | Does not touch |
|---|---|---|
| **A. Engine** | `src/engine/**` (incl. `room.ts`, tests) | `src/ui`, `src/scene`, `src/store` |
| **B. Screens** | `src/ui/**`, `src/store/**` | `src/engine` (import only), `src/scene` (import only) |
| **C. 3D** | new files in `src/scene/` (`LaunchScene.tsx`, `TitanScene.tsx`, `scene/flight/**`) | `src/engine`, `src/ui`, `src/store`; the existing `Craft/Module/StandScene` — additive changes only |

## A. Engine (`src/engine`)

### Preparation → launch
- `readiness(build, mission): { ok: boolean; blockers: Issue[]; warnings: Issue[] }` — blockers prevent launch (a missing required system, mass/budget/slot overload); warnings can be acknowledged.
- Room stages: `build → review → launch → flight → report` (`Stage` already exists).
- `room.ts` actions (to add/refine): `{type:'submitReview'}` (build→review), `approve` (if there are warnings, `approve-against-warning` is recorded; −Team Trust only for knowingly ignoring them), `veto {text}` (review→build), `{type:'launchDone'}` (launch→flight; sent by the host's client when the launch animation ends; the engine starts the flight), `tick`.

### Flight (`FlightState` is extended, the old fields stay)
```ts
type WaypointId = 'dunes' | 'lake' | 'crater';
interface Waypoint { id: WaypointId; name: string; reached: boolean; mode: 'fast' | 'precise' | null }
type ScienceTargetId = 'atmo_profile' | 'surface_images' | 'surface_chem' | 'env_temp';
interface ScienceTarget { id: ScienceTargetId; name: string; need: string[]; required: number; collected: number; sent: number; possible: boolean }
type CrisisKind = 'power_drop' | 'signal_distortion' | 'freeze' | 'overheat';
interface CrisisOption { id: string; role: RoleId; label: string; hint: string }
interface ActiveCrisis {
  id: string; kind: CrisisKind; title: string; text: string;
  nodeIds: string[];          // the components that caused it (for 3D sparks and the report)
  startedTick: number; deadlineTick: number;   // a 15–30 s timer = ticks at TICK_SECONDS = 1
  options: CrisisOption[];    // 1–3 per role; a role may have no options
  chosen: Partial<Record<RoleId, string>>;
}
interface FlightState { /* …old fields… */
  waypoints: Waypoint[]; waypointIndex: number; waypointProgress: number; // 0..1 toward the next point (for 3D)
  targets: ScienceTarget[];
  crisis: ActiveCrisis | null; crisesSeen: CrisisKind[];
  thermal: CraftStats['thermalState'];
  route: 'flying' | 'landed' | 'stopped';
}
```
- Titan phases: Cruise → Entry and deployment → Flight between points → Data transmission (from `missions.ts`; durations can be tuned so the flight lasts 8–12 minutes at `TICK_SECONDS = 1`).
- Crises are **deterministic from the build** + the room seed (decision 0006): Power Drop — the bus is overloaded or charge < 20 %; Signal Distortion — the "Flight between points" phase, with a higher chance without `signal_amp`. Freeze/Overheat — from the heat balance. ≈ 2–3 crises per flight, no more than one at a time.
- Actions: `{type:'crisisChoice'; playerId; optionId}`, `{type:'scienceMode'; playerId; waypoint: WaypointId; mode}`. At the deadline with no choice, a matching Autonomy Planner rule fires, otherwise the Safe Protocol. The result is written to `causes` with `causeIds`.
- `role` visibility (asymmetry) — a function `panelFor(role, flight, build): RolePanel` with what the role sees (engineer: units/power/heat; scientist: data/goals; comms: signal/queue/antenna; commander: timer/hull/overall status).

> **How it turned out (2026-11-14, part A done):** signatures and rules — [Simulation Engine](Simulation%20Engine.md), numbers — [Balance Table](../03%20Design/Balance%20Table.md), decisions — [0010 M1 flight model](../06%20Decisions/0010%20M1%20flight%20model.md). Fields added (the contract names did not change): `room.decisionLog`, `room.report`, `readiness().notes`, `FlightState.history/storm/power/heat/queueFull/blackouts/…`, `CrisisOption.nodeIds`, `CauseChain.key/impact`, `MissionReport.trust/delivered/ticks`.

### Report
```ts
interface CauseChain { what: string; why: string; couldDo: string; causeIds: string[] }
interface MissionReport {
  outcome: 'perfect' | 'success' | 'partial' | 'failed'; score: number;
  breakdown: { key: string; label: string; weight: number; got: number }[];   // weights from Mission Report.md
  chains: CauseChain[];        // the main ≤ 3 first, the rest after
  decisions: Decision[]; teamTrust: number;
  roles: { role: RoleId; did: string[] }[];
  mc: { earned: number; upkeep: number; total: number };
  highlights: { tick: number; kind: 'launch' | 'crisis' | 'final'; text: string }[];  // for the 3D replay
}
buildReport(room: RoomState): MissionReport
```
- Tests: the spec's acceptance tests A and C go through the whole loop (build → review → launch → flight to the end → report); determinism (one seed — one outcome).

## C. 3D scenes (`src/scene`) — pure components driven by props
```ts
<LaunchScene build mission reducedMotion onDone={() => void} />          // ~12–15 s: countdown, liftoff, stage separation, fairing opening; camera; skip on click
interface TitanSceneProps {
  build: Build; phaseId: string; waypointIndex: number; waypointProgress: number;
  route: 'flying' | 'landed' | 'stopped';
  crisis: { kind: CrisisKind; nodeIds: string[] } | null;
  offIds: string[]; signal: FlightState['signal']; role: RoleId | null; reducedMotion: boolean;
}
<TitanScene {...props} />
```
- Models: `rocket`, `launch_pad`, `titan_terrain`, `frame_titan` + modules + overlays (reuse `Craft`/the loader); `debris` is not needed for Titan. The Titan scene: orange haze, a dim sun, dunes (tiles), a lake with a glint, methane rain, the craft flying on its rotors between 3 points (dunes → lake → crater), the camera behind and to the side.
- Crisis visuals by cause: Power Drop — sparks on the `nodeIds[0]` unit + blinking (3 times, no strobe); Signal Distortion — static as a post-effect; Freeze — frost; reducedMotion — no shake/glitch.
- Until the engine is ready, C works on mock props (the demo page `?scene=titan` / `?scene=launch`, dev only).

## B. Screens (after A)
- Readiness check (`review`): blockers/warnings, unit highlighting in `StandScene`, commander: "Approve" / "Veto with a reason"; acknowledged warnings are recorded.
- Launch (`launch`): `<LaunchScene>` full screen; on `onDone` the host sends `launchDone`.
- Mission Control (`flight`): `<TitanScene>` + a phase/point strip + your role's panel (`panelFor`) + the log; the scientist picks the measurement mode at a point; the **crisis screen** follows the "Disaster effect" (a 0.5–1 s glitch, CRITICAL EVENT, the emergency overlay, the timer, your role's options, what the others chose).
- Report (`report`): the outcome, the points, ≤ 3 chains of causes + "More", commander decisions and Team Trust, role contributions, MC.
- Local demo mode: one player can switch roles to see all the panels.
