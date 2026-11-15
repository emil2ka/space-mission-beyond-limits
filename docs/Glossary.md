# Glossary

- **Craft / spacecraft** — the team's single shared spacecraft. It consists of a hull (frame) and modules in slots.
- **Slot** — a mounting point on the hull that belongs to a specific department. In 3D it is an empty node `slot_<department>_<n>` in the hull GLB.
- **Module / component** — a catalog card installed in a slot. Can be installed in several copies, up to `maxInstances`.
- **Tick** — the game interval of the simulation (1 tick = 10 game minutes ≈ 1 s of real time in flight).
- **Generation / Consumption / Capacity / Charge** — four different power quantities, see [Energy Model](03%20Design/Energy%20Model.md).
- **RTG** — radioisotope thermoelectric generator. Not a reactor.
- **Team Trust** — trust in the commander. It drops only for knowingly ignoring a warning, if the risk actually fired.
- **Blackout** — loss of the link with the craft; roles see different parts of the information.
- **Tactical Radio** — quick text phrases instead of voice chat.
- **Autonomy Planner** — the screen for "IF … AND … → THEN …" rules.
- **Safe Protocol** — the basic safe protocol used if the team has not set up rules or did not decide in time.
- **MC (Mission Credits)** — the meta-currency between attempts. Not to be confused with the **mission budget** (M$), which is spent on the build.
- **Host** — the player who created the room. Their client is the state authority (see [Multiplayer](04%20Tech/Multiplayer.md)).
