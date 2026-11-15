# TITAN: SKY EXPLORER

**Goal:** explore Titan's atmosphere and surface with an autonomous rotorcraft.
**Access:** from the very start.
**Environment:** extreme cold, thick atmosphere, weak sunlight (×0.01), a long distance to Earth, signal delay, autonomous operation.

## Constraints (starting values, conventional)
| Parameter | Value |
|---|---|
| Budget | 420 M$ |
| Launcher mass limit | 560 kg (hull 250 kg, 80 M$) |
| Slots | power 6 · propulsion 3 · navigation 4 · science 5 · comms 4 · structure 4 · recovery 0 |
| Signal delay (in game) | 6 ticks |
| Heat loss to the environment | 220 units/tick (without insulation) |

## Power — required logic
- Solar panels are **not the main source**: output ×0.01 and the warning "There is very little sunlight on Titan".
- The main source is the **RTG** (several are allowed if there are enough slots, budget and mass).
- A battery stores energy and covers peaks (for example, rotor flight), but does not produce it.

## Required systems
Rotor System · Flight Computer · any antenna + Communication Transceiver · a generation source ≥ the base consumption · Thermal Insulation or Heater (otherwise a freezing risk).
**Recommended:** Atmospheric Sensor, High-Resolution or Wide-Angle Camera, Spectrometer, IMU, Radar/Altimeter.
**Useless:** Robotic Arm, Sample Container, Return Capsule, Heat Shield (no return) — the card explains why.

## Flight phases
1. **Cruise** (simplified, 30 ticks) — power and heat are checked on the way. Phase lengths and everything about the flight — [Balance Table](../Balance%20Table.md).
2. **Entry and deployment** — the rotors unfold; the first crisis is possible.
3. **Flight between points** — 3 points on the map (dunes, a methane lake, a crater); at each one the scientist picks a measurement mode.
4. **Data transmission** — comms sends the packet queue.

## Science goals
| Goal | Requires | Data |
|---|---|---|
| Atmosphere profile | Atmospheric Sensor | 40 units |
| Surface images | a camera (HiRes is better) | 60 units |
| Surface chemistry | Spectrometer + landing | 50 units |
| Ambient temperature | Temperature Sensor | 20 units |
Main goal: ≥ 2 of the 4 goals delivered to Earth.

## Crises
Power Drop, Signal Distortion (details in [Crises and Blackout](../Crises%20and%20Blackout.md)).

## 3D scene
Orange haze, a low dim sun, dunes, methane lakes with glints, light methane rain. The craft flies on its rotors between points, with the camera following from behind and to the side. See [3D Look](../3D%20Look.md).
