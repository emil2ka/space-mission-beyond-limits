# Open Questions (gaps in the spec)

1. **Unreadable parts of the PDF** (■■■, pp. 5, 9, 10). Reconstructed from context: the "Install / Remove" buttons, the "Installed: 2 / Max: 4" counter, the "Required / Recommended / Optional" statuses, the power breakdown line. We need the source of the spec (TZ v2.0) to check.
2. **All balance numbers** — the spec has none. Proposed in `src/engine/data/` and [Balance Table](../03%20Design/Balance%20Table.md); needs a playtest.
3. ~~**Who installs modules**~~ — resolved in [0013 Roles tasks trust players language](../06%20Decisions/0013%20Roles%20tasks%20trust%20players%20language.md). Was: any player in any department, or each in their own? Now: anyone can, but a module from "someone else's" department goes to the commander for approval.
4. **Approval:** per module or for the whole configuration? Now: both — requests for disputed modules + final approval of the configuration.
5. ~~**Team Trust**~~ — resolved in 0013. Was: **Team Trust — what does it affect besides the number?** Proposal: with low trust, the commander's veto requires confirmation from one more player.
6. ~~**Fewer than 4 players**~~ — resolved in 0013 (2–4). The spec: exactly 4. Proposal: allow 2–3; free roles are taken by someone as a second panel window (P2).
7. ~~**Host leaving**~~ — resolved: after 10 s the host role passes to the online player with the lowest joinOrder ([0011 M2 multiplayer rules](../06%20Decisions/0011%20M2%20multiplayer%20rules.md)).
8. ~~**Interface language**~~ — resolved in 0013: RU + EN. Was: **Interface language** — Russian, English or both?
9. ~~**The "Individual Tasks" screen**~~ — resolved in 0013 (role mini-games). Was: in P0 without mini-games (they are P2) — so what goes there? Proposal: simple role decisions (choosing a mode, calibrating with a slider).
10. **Target devices** — school laptops? Affects the 3D budget.
11. ~~**Palette**~~ — resolved: the comic kit (UI kit, 2026-11-15). Was: keep the UI lavender-and-cyan (the spec) or repaint it in comic colors (cream/orange/teal)?
