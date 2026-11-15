# ASTEROID: SAMPLE RETURN

**Goal:** approach the asteroid, collect a physical sample, preserve it and return it to Earth.
**Access:** for Mission Credits earned on Titan (see [Economy](../Economy.md)).
**Environment:** practically no atmosphere — propellers do not work; precise navigation and orientation; limited propellant; risk of damaging the sampling mechanism.

## Constraints (starting values, conventional)
| Parameter | Value |
|---|---|
| Budget | 480 M$ |
| Launcher mass limit | 740 kg (hull 280 kg, 90 M$) |
| Slots | power 6 · propulsion 4 · navigation 4 · science 4 · comms 4 · structure 4 · recovery 4 |
| Sun | ×0.6 (depends on orientation) |
| Signal delay | 3 ticks |

## Propulsion
- Chemical (Main Engine, Thruster Cluster) — sharp approach maneuvers; they use propellant.
- Ion Engine — efficient for a long cruise, but **does not replace** an engine for sharp maneuvers.
- Rotor System — **incompatible**: "Propellers make no lift in a vacuum". Does not count as propulsion (acceptance test B).

## Required systems
Chemical Main Engine or Chemical Thruster Cluster · Propellant Tank · Reaction Wheels or Thruster Cluster (orientation) · Robotic Arm or Drill · Sample Container · Return Capsule · Heat Shield · Parachute/Recovery System · Flight Computer · comms.
**Recommended:** Sample Sealing Unit, Radar/Altimeter, Navigation Camera, Star Tracker, Micrometeoroid Shield, Recovery Beacon.
**Useless:** Atmospheric Sensor, Rotor System, Heater (hardly needed).

## Flight phases
1. **Cruise** (ion or chemical — different propellant use and time).
2. **Approach** — navigation, orientation; a Debris Alert is possible.
3. **Site selection** — the scientist picks 1 of 3 sites (soft regolith / rock / near a crack).
4. **Sampling** — arm/drill; a Sampling Arm Jam is possible.
5. **Packing** — container, sealing.
6. **Return cruise** and **capsule return** — shield, parachute, beacon.

## Success
Perfect: the sample is sealed + the capsule is found + composition data is delivered. Partial: data delivered, sample lost.

## 3D scene
Black space, stars, a slowly tumbling asteroid (irregular, cratered), small attitude-thruster jets, the arm kicking up dust during sampling, the capsule's entry with a glowing shield, and the parachute opening over the ocean/steppe.
