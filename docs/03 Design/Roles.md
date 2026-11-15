# Roles

A role cannot be taken twice. Each role has **its own panel** and **its own 3D view mode** of the same spacecraft. With four players, one role = one player; with two or three, someone holds two roles ([0013 Roles tasks trust players language](../06%20Decisions/0013%20Roles%20tasks%20trust%20players%20language.md) §4, see "2–3 players" below).

## Commander
- **Focus:** strategy, budget, risks, responsibility.
- **Panel:** overall readiness, budget, mass, hull integrity, timer, event log, module approval requests, the Approve / Veto / Emergency Decision buttons, the Team Trust indicator and the reason it changed.
- **Actions:** splits the budget between departments, approves the configuration, approves or vetoes department requests, sends the build back for rework, and in an emergency chooses what to sacrifice. Installs any module right away.
- **3D mode "Overview":** the whole craft, with risk icons above problem units (yellow / orange / red).
- **Veto and trust:** approving against a *shown critical* warning is recorded. If the risk actually happens, Team Trust drops and the reason is shown.

## Chief Engineer
- **Focus:** power, mass, thrust, temperature, reliability, repair.
- **Panel:** a cutaway schematic, batteries/generators/engines/cables/distributors, a graph of generation and consumption, mass and the launcher limit, heat load, diagnostics of units and lines.
- **Actions:** builds the craft, checks compatibility, distributes power (priorities), switches off secondary lines, repairs or isolates a unit.
- **3D mode "X-ray":** the hull is semi-transparent, power lines glow as tubes (thickness = flow, color = load), a heat map of the units.
- **Spec rule:** the engineer sees the **exact source** of a deficit ("Spectrometer 40 W + Drill 60 W > generation"), not just "low power".

## Science Officer
- **Focus:** instruments, data quality, experiment time and risks.
- **Panel:** instruments and goals, research progress, data volume/quality, the measurement queue, sample condition.
- **Actions:** chooses instruments, calibrates, picks the measurement mode, adjusts the intensity of collection/drilling, and decides "more data at the risk of overheating, or play it safe".
- **3D mode "Instruments":** instruments are highlighted, cameras and sensors show their view cones, the measurement target is marked on the surface.
- Titan: atmosphere, images, surface chemistry. Asteroid: composition, properties, a physical sample.

## Communications Officer
- **Focus:** radio comms, delay, antenna aiming, bandwidth, memory.
- **Panel:** an aiming radar/compass, the direction to Earth, signal and noise, bandwidth, the packet queue, free memory.
- **Actions:** aims the antenna, chooses the send priority, saves important packets, restores the link, and decides what to send first after a blackout. Memory is limited — the team chooses what to overwrite.
- **3D mode "Comms":** the antenna beam (a cone), an arrow pointing to Earth; when misaligned, the beam misses Earth and turns red.

## "Who sees what" matrix (normal mode / blackout)
| Data | Commander | Engineer | Scientist | Comms |
|---|---|---|---|---|
| Budget, mass | ✔ / ✔ | ✔ / ✔ | – | – |
| Power by source | total / – | ✔ / ✔ | own consumption / – | own / – |
| Unit heat | icons / – | ✔ / ✔ | instruments / – | – |
| Data and measurement queue | total / – | – | ✔ / ✔ | packets / packets |
| Signal, antenna, memory | total / NO SIGNAL | – | – | ✔ / ✔ |
| Craft position | ✔ / ✔ | ✔ / – | ✔ / – | ✔ / direction |
| Hull integrity, timer | ✔ / ✔ | ✔ / – | – | – |
More: [Crises and Blackout](Crises%20and%20Blackout.md).

## Who installs modules (0013 §2, verified by tests and in the browser)
| Constructor department | Owner |
|---|---|
| Power, Propulsion, Structure & thermal, Recovery | Chief Engineer |
| Science | Science Officer |
| Comms, Navigation | Communications Officer |
| any | Commander (installs right away — they are the one who approves) |

- **Your own department** — the module is installed and removed right away.
- **Another department** — the "+"/"−" button sends a **request** to the commander (`addComponent` / `removeComponent` → `room.requests`). The commander sees the queue on their Constructor panel: "Approve" installs the module (the log credits it to whoever asked), "Veto" rejects it with a reason. The department owner sees the request marked "in your department", and the author can withdraw it.
- **Budget share.** At the start of the Constructor, the commander splits the module budget (the mission budget minus the frame) between the three owner departments, in 5 % steps, totaling 100 % (`setBudgetSplit`). Until they confirm, a default share applies that fits the mission's starter craft. A module that pushes a department over its share also goes as a request (even within its own department). The commander can install over the share right away — the panel will show a negative balance.
- While there are unresolved requests, the craft cannot be sent to review ("The commander must decide department requests first"). If the host leaves the Constructor, the requests expire.
- A catalog card shows a badge: "your department" (green) or "via the commander" (yellow, with the owner), "over the share by N M$", "request waits for the commander".
- A player with several roles owns the departments of all their roles. In single-player demo, everything is installed right away.
- Every step is written to the log; in the report, "Commander's decisions" lists "Department request approved" / "Department request vetoed", and the roles get the line "Request to the commander: … — approved / vetoed".

## Team Trust (0013 §3)
- Starts at 100, range 0–100. **−15** for each knowingly accepted warning whose risk fired (as in the spec). **+10** for a flight in which no accepted warning fired (capped at 100). Every change has a reason: in the report, at HQ, in the lobby and on the commander's panel (`room.trustHistory`).
- Tiers:
  - **≥ 80 "Tight-knit team"** — each crisis gives 5 s more time (based on the trust at the start of the flight). Comms during a blackout do not change.
  - **50–79 "Working trust"** — no special rules.
  - **< 50 "Under watch"** — approving against a *critical* warning (bus overload, freezing, overheating, mass overload) requires a **second key**: confirmation from the owner of the department that warning belongs to. The commander presses "Approve" → the check waits for the key. The owner turns the key — launch; refuses with a reason — nothing is approved, and the refusal is recorded in the decisions. If the commander holds that department themselves (with two players), any other online player gives the key: the second key is always a second person.
  - **< 25 "Agency audit"** — a second key and mandatory diagnostics at the next preparation (15 MC). This does not block: if there is not enough MC, the free basic repair from [0012 M3 asteroid and economy](../06%20Decisions/0012%20M3%20asteroid%20and%20economy.md) applies.

## 2–3 players (0013 §4)
- A room is started by 2, 3 or 4 players (all online and READY). One player — the existing demo mode, with a label.
- Each player picks their own role. Free roles go to players: the host hands them out in the lobby, evenly by default (a free role goes to whoever has fewer roles; on a tie, to whoever joined first). The "+ role (at the start)" badge shows this in advance; the assigned player presses READY again.
- A new player in the lobby can take the extra role from someone who has two (a player's only role cannot be taken). A player can give up an extra role themselves.
- A player with two roles gets: panel tabs in flight (each shows exactly what its role sees; "!" means that role has not chosen yet in a crisis), the radio phrases of both roles, the commands of both roles, and the department ownership rights of both roles. A crisis waits for a choice from each role of an online player.
- The report shows contributions by role and by player (modules, requests, decisions, crisis choices, radio, second keys).
