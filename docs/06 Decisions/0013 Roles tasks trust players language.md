# 0013 Individual tasks, who installs modules, Team Trust, 2–3 players, language — accepted (2026-11-15)

**Context:** open questions 3, 5, 6, 8, 9 ([Open Questions](../07%20Tasks/Open%20Questions.md)).

## 1. Individual tasks (screen 10 of the spec) are real role mini-games with consequences in flight
- The "Individual Tasks" screen sits between the Constructor and the Autonomy Planner. All four players do their task at the same time, in about 60–90 s. There is no timer (spec (TZ v2.0) 9.5: timers only for crises).
- Each task is based on the role's actions from spec §3 and gives a grade (excellent / good / weak). The grade becomes a **flight modifier** in `src/engine`, and the report shows it in the chain of causes.
- A task can be skipped: it then counts as "weak", with an honest explanation. Team readiness waits until everyone has checked in.
  - **Commander — "Mission Priorities":** ranks the mission goals by importance and sets the sacrifice order for an emergency ("what to sacrifice for the main goal", spec 3.1). During a Power Drop or Emergency Decision crisis, the engine switches systems off in this order.
  - **Engineer — "Power Routing":** a cutaway schematic; consumers are split between the "main / secondary" lines so that no line is overloaded. Autonomy and crises switch the secondary line off first (spec 3.2: "switches off secondary lines"). A routing mistake means overload and a harsher Power Drop.
  - **Scientist — "Calibration & Measurement Mode":** each installed instrument has a reference peak that is matched with a knob. Calibration accuracy multiplies data quality. The mode (cautious / normal / intensive) is a trade-off between data volume and heat or overheating risk (spec 3.3).
  - **Comms officer — "Antenna Aiming & Packet Queue":** finding Earth on a radar by noisy signal strength, and the order of sending packets after a blackout given the available memory (spec 3.4). Aiming accuracy sets the bandwidth. The queue decides which data survives when memory overflows.
- In flight, the same widgets come back as short crisis actions: re-aiming after a blackout, isolating a node during a Power Drop, lowering the intensity during overheating. These are the spec's P2 "mini-games", built on the same mechanics.

## 2. Who installs modules — your own department right away, others via the commander
- Departments are assigned to roles:
  - Engineer — power, propulsion, structure, recovery;
  - Scientist — science;
  - Comms officer — comms and navigation;
  - The commander installs anything, since they approve it themselves.
- Modules in your own department are installed and removed right away. A module from another department becomes a **request** to the commander: "Approve" installs the module, "Veto" rejects it with a reason. The department owner sees the request.
- At the start of the Constructor, the commander **splits the budget by department** (spec 3.1). If a module goes over its department's share, it also goes as a request.
- If a player has several roles (see item 4), they own all of those roles' departments. In single-player demo, everything is installed right away.

## 3. Team Trust is more than a number
- As in the spec, it drops only for a knowingly accepted critical warning if the risk fired (−15). **It rises by +10** for a flight in which no accepted warning fired. The range is 0–100, and the reason is always shown.
- Effects:
  - **≥ 80, "Tight-knit team":** crises give 5 s more time to decide. Comms during a blackout do not change, so the asymmetry is not broken.
  - **< 50, "Under watch":** approving against a critical warning requires a **second key** — confirmation from the owner of that department.
  - **< 25, "Agency audit":** before the next flight, diagnostics during preparation are mandatory. This costs MC but does not block: if there is not enough MC, the free path from 0012 applies.
- The tier badge and its effect are shown on the commander's panel, in the lobby/HQ and in the report.

## 4. 2–3 players are allowed (a deviation from the spec's "exactly 4")
- A room can be started with two, three or four players. Single-player is the existing demo mode, with a label.
- Free roles are handed out to players: the host assigns them in the lobby, evenly by default. A player with two roles gets panel tabs, both tasks, the radio phrases of both roles and the department ownership rights of both roles.
- Asymmetry is kept per role: each tab shows exactly what that role sees. The report shows contributions by role and by player.
- A new player in the lobby can take the extra role from someone who has two.

## 5. Language — Russian and English
- An RU/EN switch on the home screen and in the settings. The default is the browser language: `ru*` → Russian, otherwise English. The choice is stored per player; players in the same room can play in different languages.
- The engine returns **message keys and parameters**, not ready-made Russian prose. The UI assembles the text, so the log, crises, warnings and report are all translated.
- Module and mission names are the same in both languages: they are already English ("Rotor System", "TITAN: SKY EXPLORER"). Descriptions are translated.
- The documentation stays in Russian (0007).

**Why:** the spec requires that everyone has "useful information and a concrete action". The tasks give each role hands, not just a screen. The department rules and Trust turn the commander into a real leader rather than a button. Playing with two or three is needed at school, where there often aren't exactly 4 people. Bilingual support is needed to show the game beyond a Russian-speaking audience.

**Alternatives:**
- tasks as a slider with no consequences — rejected: the spec says "not a set of pretty screens";
- anyone installs any module without requests — rejected: the commander's role becomes empty;
- Trust only as a number — rejected: that is question 5;
- exactly 4 players — rejected: blocks play in small groups;
- Russian only — rejected: we show the project more widely.
