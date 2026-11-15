# Engineering Trade-offs and Chains of Consequences

Every significant part has: a **direct effect**, a **side effect**, an **impact on at least two roles**, a **possible failure consequence**, and an **explanation in the report**. In the card in `src/engine/data/components.ts` these are the fields `purpose`, `sideEffect`, `roles`, `failure` (the report explanation is TODO).

## Example 1 — several RTGs
1. The engineer adds a second RTG → generation +110 W.
2. Mass +45 kg, cost +60 M$, heat +90 units.
3. The commander sees the risk of going over budget/mass.
4. The scientist gets more power for instruments.
5. Without a radiator — overheating risk (Overheat crisis; the report says: "Two RTGs without a Thermal Radiator → electronics overheated in phase 3").

## Example 2 — High-Gain Antenna
- Pro: high data rate. Con: a narrow beam that needs precise aiming and power.
- Comms actively aims the antenna; when the orientation changes, the link can drop.
- The scientist sees a queue of data that is not being sent.

## Example 3 — solar panels
- In a suitable environment (the asteroid) extra panels raise generation; mass and cost go up.
- The launcher limit may be exceeded → the commander removes another module or accepts the risk.
- On Titan, panels do not fix the deficit because of the weak sunlight.

## How it works in code
- The engine writes every event to a **cause log** (`CauseLog`): `{tick, kind, causeIds[], text}`.
- Commander decisions are recorded too: `{kind:'approve-against-warning', warningId}`.
- The report is built from the log: each problem → the cause found → advice. See [Mission Report](Mission%20Report.md).

No complex physics is needed. What is needed is a transparent and consistent game model.
