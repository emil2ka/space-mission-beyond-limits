# Results and Learning (Mission Report)

## Outcomes
Perfect Success · Success · Partial Success · Failed Mission.

## Scoring (weights)
| Criterion | Weight |
|---|---|
| Main science goal | 35 |
| Data volume and quality | 20 |
| Spacecraft condition | 10 |
| Communications (delivered to Earth / collected) | 15 |
| Sample integrity (asteroid) / bonus goals (Titan) | 10 |
| Capsule return (asteroid) / route completion (Titan) | 5 |
| Resource use (budget, propellant) | 5 |
≥ 90 Perfect · ≥ 70 Success · ≥ 40 Partial · otherwise Failed.

## Report structure
1. The outcome in large type + a 3D replay of the key moments (launch, main crisis, finale).
2. **Chains of causes:** "What happened → why → what you could have done". Example: "You installed a power-hungry instrument but did not increase power generation. The batteries drained during data collection."
3. Commander decisions and Team Trust.
4. Each role's contribution (what they did, what they saved).
5. MC: earned, upkeep, total.

Tone: do not shame the players and do not overload them with formulas. At most 3 main chains; the rest goes under "More".

## 3D replay (M5, done 2026-11-15)
- A player in the report header (`src/ui/components/ReportReplay.tsx`): **Launch → Main crisis → Finale**, captions from `highlights`, ⏮ ▶ ⏭, "Skip", and at the end — the outcome in large type and "Watch again".
- Launch is a short version of `LaunchScene` (from the moment the gantries open). Crisis is the flight scene built from snapshots around the start of the main crisis. Finale: Titan — arrival/landing at the last point reached; Asteroid — the capsule from separation to "found / lost" (`ReturnScene`).
- Data is `report.replay` (`src/engine/replay.ts`): compact snapshots of only what the scenes take from props, ≈ 2–3 KB per report; deterministic (seed + actions). The main crisis is the same one that is marked in highlights.
- Reduced Motion: no shaking and no card animations. An old report without snapshots has no player; the list of moments remains.

