# Core Loop

| # | Stage | Screen | Who acts | What 3D adds |
|---|---|---|---|---|
| 1 | Create a room / join by code | Home, Create, Join | Host / everyone | HQ hangar in the background |
| 2 | Pick a role | Lobby, Role selection | Everyone | 4 astronauts at their consoles, READY = the console lights up |
| 3 | Pick a mission, briefing | Mission selection, Briefing | The host picks, everyone reads | Hologram of the target (Titan / asteroid) |
| 4 | Split the budget | Budget | Commander | — |
| 5 | Build the spacecraft | Constructor | Everyone, each in their own department | The craft on a stand, modules fly to their slots |
| 6 | Check: mass, power, heat, comms, compatibility | Readiness check | Everyone | Problem units are highlighted |
| 7 | If–Then rules | Autonomy Planner | Everyone; the engineer/commander saves | — |
| 8 | Approval / veto | Approval | Commander | The camera flies around the craft |
| 9 | Launch | Countdown | Everyone | Rocket, liftoff, stage separation |
| 10 | Science tasks, failures | Mission Control + role panels | Everyone | The mission scene in real time |
| 11 | Crises and blackout | Crisis screen | Everyone | Interference, debris, sparks |
| 12 | Report, credits, maintenance | Mission Report, Credits | Everyone / the commander pays | Replay of the key moments |

## Time
- Preparation (stages 1–8): 10–15 minutes.
- Flight (9–11): 8–12 minutes, about 3 crises.
- Report: 2 minutes.
- **Total for one attempt ≈ 25 minutes** — fits into a school lesson.

## How the flight works
The mission is split into **phases** (for example, Titan: Cruise → Entry → Deployment → Flight between points → Data transmission). Each phase is N simulation ticks. On every tick the engine computes power, heat, data and comms, checks the If–Then rules and the crisis triggers. Details in [Simulation Engine](../04%20Tech/Simulation%20Engine.md).

## Never
- Fix mistakes automatically.
- Penalize any unsuccessful outcome. The penalty (Team Trust) is only for knowingly ignoring a warning that was shown.
- Put a timer on every action. A 15–30 s timer only for significant crises.
