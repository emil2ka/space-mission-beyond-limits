# Full Screen List (19)

| # | Screen | Priority | What is on it | 3D background / scene |
|---|---|---|---|---|
| 1 | Home | P0 | Logo, "Create a room", "Join by code", settings | HQ hangar, a rocket outside the window |
| 2 | Create a room | P0 | Name, the room code in large type, copy | Hangar |
| 3 | Join by code | P0 | A code field (6 characters), name | Hangar |
| 4 | Lobby | P0 | 4 slots: name, role, ONLINE/OFFLINE/Reconnecting, READY | 4 astronauts at their consoles |
| 5 | Role selection | P0 | 4 role cards, taken ones are grey with a name | The camera moves up to the role's console |
| 6 | Mission selection | P0 | Titan / Asteroid (a lock + the price in MC) | A hologram of the planet/asteroid |
| 7 | Briefing | P0 | Goal, environment, constraints, required systems | Hologram + a fly-by |
| 8 | Budget split | P1 | The commander splits the budget between departments (sliders) | — |
| 9 | Constructor | P0 | The catalog by department on the left, the craft in the center, parameters on the right | The craft on a stand in a clean room |
| 10 | Individual Tasks | P1 | Between the Constructor and the readiness check: a mini-game for each role, with no timer (commander — goal priorities and sacrifice order, engineer — power routing, scientist — calibration and measurement mode, comms — antenna aiming and packet queue), the team strip, "Done" / "Skip", Autonomy Planner. Details: [Individual Tasks](Individual%20Tasks.md) | No 3D: the unit close-up was not made |
| 11 | Autonomy Planner | P1 | Rule blocks, "Test" | — |
| 12 | Readiness check | P0 | A checklist: mass, power, heat, comms, compatibility, required systems | Problems are highlighted on the model |
| 13 | Approval / veto | P0 | Commander: Approve / Veto / send back for rework | The camera flies around the craft |
| 14 | Countdown and launch | P0 | 10…0, system status | Rocket, liftoff, stage separation |
| 15 | Mission Control | P0 | Phase, timeline, role panel, log, radio | The mission scene in real time |
| 16 | Crisis screen / blackout | P0 (crisis) · P1 (blackout) | Emergency overlay, timer, role actions | The cause of the failure in 3D |
| 17 | Mission Report | P0 | Outcome, chains of causes, role contributions | Replay of moments |
| 18 | Credits, repairs, upgrades | P1 | MC, maintenance, the upgrade shop | Hangar, the craft under repair |
| 19 | Accessibility settings | P0 | Sound, Reduced Motion, Disable Flash, graphics quality (Auto / Low / High, M5) | — |

## What was done (M1, 2026-11-14)
| # | Screen | File | State |
|---|---|---|---|
| 9 | Constructor | `src/ui/screens/Constructor.tsx` | Catalog, parameters, 3D; the "To review" button, the reason for the last veto |
| 12–13 | Readiness check + approval / veto | `src/ui/screens/Review.tsx` | An 8-item checklist, blockers / warnings / notes, unit highlighting on the stand (click — one item); commander: "Approve" (with warnings — only with an explicit checkbox), "Veto" with a reason; the others see the status. **Verified in the browser** |
| 14 | Launch | `src/ui/screens/Flight.tsx` (`Launch`) | `LaunchScene` full screen, the host sends `launchDone`, the host can skip with a click. **Verified** |
| 15 | Mission Control | `src/ui/screens/Flight.tsx` | The Titan scene, phases + route points, your role's panel (`panelFor`), the log, NO SIGNAL, mode selection for the scientist, role switching in demo. **Verified** |
| 16 | Crisis screen | `src/ui/screens/Flight.tsx` (`CrisisCard`) | A 0.7 s glitch, CRITICAL EVENT, the emergency overlay, the timer, role options, the others' choices, the crisis outcome; Reduced Motion / Disable Flash. **Verified**. Missing: sound, blackout asymmetry deeper than `panelFor` |
| 17 | Mission Report | `src/ui/screens/Report.tsx` | Outcome, points by weight, 3 chains + "More", Team Trust, decisions, role contributions, MC, "Again" / "To HQ". **Verified**. Missing: the 3D replay of moments (only their list exists) |
| 19 | Accessibility settings | `src/ui/settings.ts`, `components/common.tsx` | Only Reduced Motion and Disable Flash (toggles on the flight panel); no separate screen |
| 11 | Autonomy Planner | `src/ui/AutonomyPlanner.tsx` (the "Autonomy" tab in the Constructor; the rule list on the review screen) | M2: IF/AND/THEN rules, grayed-out blocks with a reason, the Flight Computer limit, priority, conflicts, "Test: 3 scenarios", saved by the engineer/commander. **Verified in the browser** |
| 15–16 | Tactical Radio + blackout | `src/ui/Radio.tsx`, `Flight.tsx` | M2: 2 phrases per role, shown large for 2 s, delay during a blackout; a strip with the 4 signal states; role panels during a blackout (timer, diagnostics, antenna, queue, "not sent"); the role's action and the "sent → arrived → confirmed" strip; the autonomy summary in the report. **Verified in the browser** (test D, screenshots in `m2-blackout-shots/`) |

## What was done (M3, part B, 2026-11-14)
| # | Screen | File | State |
|---|---|---|---|
| 6, 18 | HQ: MC, missions, upgrades, history | `src/ui/screens/HQ.tsx` (`HQ`), overlay `src/ui/view.ts` | Opened with the "HQ · N MC" button in the lobby and "To HQ" in the report. Balance; the Asteroid card: price, balance, "N MC short" / "after unlocking N MC", a progress bar, "Unlock for 150 MC" (`unlockMission`); a warning if, after unlocking, there won't be enough for preparation (there will be a free repair). The shop of 6 upgrades: effect, "Trade-off", price, bought/short, the extra slot — department choice (`buyUpgrade`). Attempt history, the number of free repairs, the last preparation, insurance. The commander or the host can press the buttons (as in the engine); the others see "You can watch". **Verified in the browser** |
| 18 | Launch preparation (MISSION PREPARATION COSTS) | `src/ui/screens/HQ.tsx` (`Prep`) | From "Again" in the report, from HQ, from the lobby (if preparation has not been paid for, the start is blocked). All `prepCosts` items (maintenance, diagnostics, module and hull repairs, consumables, insurance — a checkbox), the total, "will be charged", "balance after" — BEFORE the button; when short — a "free basic repair + starter configuration" block with the starter build list; "next: same mission — to the build / to the lobby — pick a mission"; `confirmPrep`. **Verified in the browser** |
| 15 | Asteroid Mission Control | `src/ui/screens/Flight.tsx` (`AsteroidView`, `AsteroidPanelView`) | `AsteroidScene` until the capsule separates, then `ReturnScene`; cruise/approach progress from `asteroid.cruise/approach`; a phase badge with details and "Debris nearby"; for the scientist, 3 sites with a hint, the jam risk for THIS build, the data value and the speed (`chooseSite`); propellant with a forecast, engines, protection (engineer/commander), sampling, sample/sealing, composition data, the capsule. The crisis timer counts from the crisis's own deadline (Debris without radar — 8 s). Titan is untouched. **Verified in the browser** (800 / 960 / 375 px — the craft is in frame) |
| 16 | Debris Alert / Arm Jam crises | `Flight.tsx` (`CrisisCard`) | The same crisis screen: CRITICAL EVENT, role options, the others' choices, the outcome. **Verified** |
| 17 | Asteroid report | `src/ui/screens/Report.tsx` | Three tiles: the sample (collected/sealed, mass, site, who chose it), the capsule (found/lost, propellant), composition data + the Perfect flags; chains; MC: earned, HQ balance, preparation (or "free repair"), what needs repair; "To HQ" and "Again — prep". **Verified** |


## 2–3 players, departments, Team Trust (0013 §2–4, 2026-11-15)
Components — `src/ui/rules/` (each file has its own `TEXT` object in Russian; the engine returns data, not prose).
| # | Screen | What was added | File |
|---|---|---|---|
| 1 | Home | "Create a room (2–4 players)"; demo — "play solo" | `screens/Home.tsx` |
| 4–5 | Lobby | Start with 2, 3 or 4 players. A slot shows all of the player's roles and a yellow "+ role (at the start)" badge for the role they will get by default. A "Free roles" card: role → who gets it by default; the host has a "Give…" drop-down; a list of extra roles with "Free up" (host) / "Give up" (the player themselves). The role card of a player with two roles — "N has two — take it" (a newcomer takes the extra one). A Team Trust card with the tier, its effect and the reasons | `screens/Lobby.tsx`, `rules/LobbyRoles.tsx`, `rules/Trust.tsx` |
| 8–9 | Budget split + Constructor | Screen 8 is a panel in the Constructor's right column: the commander first sees the share editor (−/+ 5 %, "Approve the split"), the others see the shares and spent / share per department. A module card shows a badge "your department" / "via the commander" (+ the owner), "over the share by N M$", "request waits for the commander"; "+" / "−" for another department send a request. The request queue: the commander has "Approve" / "Veto" with a reason, the department owner sees "in your department", the author has "Withdraw"; recent decisions. The commander has a Team Trust card | `screens/Constructor.tsx`, `rules/BuildRules.tsx` |
| 12–13 | Review and approval | With Team Trust < 50, the commander sees in advance that it "will require a second key". After "Approve", a "Second key" card: the department owner — "Turn the key" / "Refuse" with a reason; the commander and the others see whose key we are waiting for | `screens/Review.tsx`, `rules/SecondKey.tsx` |
| 15–16 | Mission Control | A player with several roles: role tabs above the panel (each with its own asymmetry; "!" means that role has not chosen yet in a crisis; on a new crisis the tab switches by itself to the role that needs to answer), radio blocks for all their roles. The bar at the top shows all of the player's roles. The commander's panel shows the Team Trust tier (and "+5 s to crisis timers") | `screens/Flight.tsx`, `rules/RoleTabs.tsx` |
| 17 | Report | Team Trust changes with reasons (−15 / +10), the tier and its effect on the next flight; "Commander's decisions" lists requests, request vetoes, second-key refusals and whose key was turned; a "Player contributions" card (the player's roles, modules, requests approved / vetoed, decisions, crises, radio, keys) | `screens/Report.tsx`, `rules/ReportRules.tsx` |
| 18 | HQ / preparation | A Team Trust card; at < 25 the preparation items include "Agency audit: mandatory diagnostics" | `screens/HQ.tsx` |
| — | Toasts | Bottom left (on a phone — at the top): to the author — "Request approved" / "Commander's veto" with a reason; to the commander — "New request"; to the department owner — "Request for your department"; to the owner — "Your second key is needed"; to the commander — "Second key turned / refused" | `rules/RulesToasts.tsx` (in `App.tsx`) |

Checked with 2 and 3 players in LocalTransport tabs: `node scripts/qa/rules.mjs`.

## Individual tasks (0013 §1, 2026-11-15)
Rules and numbers: [Individual Tasks](Individual%20Tasks.md).

| # | Screen | What was done | File |
|---|---|---|---|
| 9 | Constructor | The "To role tasks" button instead of "To review" (the `openTasks` action) | `screens/Constructor.tsx` |
| 10 | Individual Tasks | The team strip: 4 roles, who holds them, the state. The role card: a one-line goal, the mini-game, a live preview, "In flight", "Done" / "Send again" / "Skip" with an honest warning, the result with reasons. The "Next" block: Autonomy Planner, "To the constructor" (host), "To review" once all four are done. The host can skip a task for an offline player | `screens/Tasks.tsx`, `tasks/widgets.tsx`, `tasks/tasks.css` |
| 10 | — widgets | A drag-and-drop list (mouse, finger, ▲▼, arrows). A schematic of two power lines (tap a consumer → a line, or the "socket" on the side). A canvas spectrum + a calibration knob. A radar with a sweep and a noisy signal meter. A measurement mode picker with data and heat | `tasks/widgets.tsx` |
| 15–16 | Mission Control | Comms after a blackout — a small "The antenna lost Earth" radar. The engineer during a Power Drop — a schematic, picking the node to isolate. The scientist during an Overheat — lowering the measurement mode | `tasks/FlightTasks.tsx`, `screens/Flight.tsx` |
| 17 | Report | The "Individual Tasks" block: each role's grade and what the task did; the `task:*` chains among the causes | `tasks/FlightTasks.tsx`, `screens/Report.tsx` |

**Verified:**
- In headless Chrome at 1440×900 (Titan and Asteroid) and at 375×812 (Titan), all four tasks were played with a real mouse and keyboard: drag and drop, clicks on the schematic, turning the knob, clicking the radar.
- Then "To review". The Titan flight: re-aiming the antenna after atmospheric entry and isolating a node during a Power Drop. The report with the tasks block.
- The "everyone skipped" variant: the calibration and harsh Power Drop chains in the report.
- Check: `node scripts/qa/tasks.mjs <titan|asteroid> [width] [height] [prefix] [--fly] [--skip]`.

**Not verified:** the scientist's Overheat switch in the browser (engine test only); live play on 2–4 devices.

## Mission Control layout (desktop)
```
┌──────────────────────────────────────────────────────────────────┐
│ MISSION CONTROL · Titan      phases ▬▬▬▬ · points ○ ○ ○  T+2:20 │
├───────────────────────────────────────────────┬──────────────────┤
│                                               │ Your role panel  │
│        3D Titan (TitanScene)                  │ [demo: role ▾]   │
│   CRITICAL EVENT / NO SIGNAL over the scene   │ crisis: timer,   │
│                                               │ options, others  │
├───────────────────────────────────────────────┤ role indicators  │
│ Event log (causes)                            │ RM / Flash       │
└───────────────────────────────────────────────┴──────────────────┘
```

## Constructor layout (desktop)
```
┌───────────────┬───────────────────────────────┬────────────────┐
│ Catalog       │                               │ Parameters     │
│ [Power ▾]     │        3D craft               │ Mass 820/1100  │
│  RTG   −  2 + │     (rotate with the mouse)   │ Budget 312/420 │
│  Solar −  0 + │                               │ Power:         │
│  Battery …    │   role view mode ▸ X-ray      │  +220 / −155 W │
│ [Propulsion ▸]│                               │ Heat ●●●○○     │
│ …             │                               │ Slots 3/4 ...  │
├───────────────┴───────────────────────────────┴────────────────┤
│ Log / Tactical Radio                     players ● ● ● ●       │
└────────────────────────────────────────────────────────────────┘
```
On a phone: 3D on top, the catalog and parameters below it (see "Phone and tablet (M5)" below; there are no tabs — a single feed).

## Phone and tablet (M5, 2026-11-15)
Widths: phone 375–430 px (portrait), tablet 768 px, desktop > 900 px — unchanged. CSS only (`src/ui/styles.css`, the "M5" block) plus small markup tweaks; the look is the same.

- **General:** no horizontal scrolling (`body { overflow-x: clip }`), buttons / selects / checkboxes ≥ 44 px on a phone and on any touch screen (`pointer: coarse`), `viewport-fit=cover` + `env(safe-area-inset-*)` padding. On a phone the demo bar is in the flow (not fixed); the network status and toasts are at the bottom.
- **Lobby:** slots and roles 2 per row, the room code at 28 px.
- **Constructor / Review:** the 3D stand on top (34vh, `sticky` — the craft stays visible while you scroll the catalog), the catalog below it, then the parameters + "To review". The department tabs are a horizontal strip. At the bottom of the panel: Reduced Motion / Disable Flash / **Graphics** and "Leave room". Tablet: the stand at full width, two panels side by side.
- **Mission Control:** the top strip (phases, the 4 signal states in a 2×2 grid, points) → the scene (36vh, `sticky`) → the role panel → the log (up to 40vh). Tablet: the scene at full width, the panel and the log side by side.
- **Crisis (phone and tablet ≤ 900 px):** the crisis card becomes a **bottom sheet** (`position: fixed`, up to 64vh, with its own scrolling): "CRITICAL EVENT" + the timer are pinned at the top of the sheet, the options (≥ 52 px) are visible without scrolling the page; the scene stays visible above the sheet. The glitch on narrow screens is `clip-path` only (a transform/filter on `.mc` would shift the fixed sheet).
- **Report / HQ / Preparation:** one column (tablet — two), the shop in one column, action buttons stretch.
- **Leave room** (Briefing, Constructor, Review, Mission Control): a confirmation in a modal (a portal into `body`); mid-game the role stays with the player (OFFLINE, rejoin by code), and the host is told who will become host.


## Component card
Name · a subtitle under the name · an icon (a GLB render) · mass · cost · power (+/−) · heat · compatibility (a badge **Required / Recommended / Optional / Useless / Incompatible** + why) · the "Installed: 2 / Max: 4" counter · the **+** and **−** buttons.
