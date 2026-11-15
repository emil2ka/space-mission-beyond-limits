# Master Model List (~70)

Priority legend: **P0** — needed for the Titan slice · **P1** — the full game · **P2** — polish.
Nodes — the required named nodes in the GLB (see [3D Pipeline](../04%20Tech/3D%20Pipeline.md)).

## Hulls and launcher
| id | Model | P | Nodes |
|---|---|---|---|
| frame_titan | Titan Sky Explorer hull: a compact drone craft, 4 rotor booms | P0 | slot_*×26 (see [Model Contract](Model%20Contract.md)), cam_* |
| frame_asteroid | Sample Return hull: a hexagonal bus, a spot for the capsule on top | P1 | slot_*×26 (see [Model Contract](Model%20Contract.md)) |
| rocket | 2-stage launch vehicle | P0 | pivot_stage2, pivot_fairing_l/r, fx_nozzle |
| fairing | Fairing (2 halves) | P0 | — (part of rocket) |
| return_capsule | see modules G | P1 | |

## A. Power
| id | Model | P |
|---|---|---|
| rtg | A cylinder with radial fins, a warm glow at the base | P0 |
| solar_array | Two folding panels on a boom | P0 |
| battery_hc | A battery block with a bar-style charge indicator | P0 |
| battery_backup | A small block with red markings | P0 |
| pdu | A box with 6 sockets and switches | P0 |
| energy_regulator | A box with a comb-shaped heat sink | P1 |
| power_bus | A cable run (a segment, repeated) | P0 |

## B. Propulsion
| id | Model | P |
|---|---|---|
| chem_main_engine | Nozzle + chamber | P1 |
| chem_thrusters | A cluster of 4 small nozzles | P1 |
| ion_engine | A flat cylinder with a grid, a blue glow | P1 |
| propellant_tank | A spherical tank | P1 |
| reaction_wheels | A box with 3 flywheels (visible through a window) | P1 |
| rotor_system | 4 rotors on booms (if not built into the hull) | P0 |
| landing_system | 4 legs with skids | P0 |

## C. Navigation
| id | Model | P |
|---|---|---|
| nav_camera | A short camera with a lens hood | P1 |
| star_tracker | A tube with a baffle | P1 |
| imu | A small cube | P0 |
| radar_altimeter | A flat patch antenna | P0 |
| flight_computer | A block with a strip display | P0 |
| gnc_unit | A block with a bundle of cables | P1 |

## D. Science
| id | Model | P |
|---|---|---|
| hires_camera | A long lens on a swivel mount | P0 |
| wide_camera | A short "fisheye" | P0 |
| spectrometer | A box with a lens and a grating | P0 |
| atmo_sensor | A mast with sensors | P0 |
| temp_sensor | A sensor "puck" (the sensor pucks pack) | P0 |
| radiation_sensor | A "puck" with a symbol (the same pack) | P1 |
| drill | A drill on a slide | P0 |
| robotic_arm | A 3-joint arm + a claw | P1 |
| sample_container | A cylinder with a lid | P1 |
| sample_sealer | A clamp ring | P1 |
| data_storage | A memory block | P0 |

## E. Comms
| id | Model | P |
|---|---|---|
| antenna_standard | A short mast | P0 |
| antenna_high_gain | A parabolic dish on a gimbal | P0 |
| antenna_omni | A thin rod/helix | P1 |
| signal_amp | A block with a heat sink | P1 |
| transceiver | A block with 2 connectors | P0 |
| data_buffer | A small memory block | P1 |
| deep_space_link | A block with a horn | P1 |

## F. Structure & thermal
| id | Model | P |
|---|---|---|
| thermal_insulation | Gold foil (a shell that wraps the hull) | P0 |
| thermal_radiator | White radiator plates | P0 |
| heater | A flat block with a "zigzag" coil | P0 |
| radiation_shield | Box-shaped plates | P1 |
| reinforced_frame | Extra beams (an overlay on the hull) | P1 |
| micrometeoroid_shield | A multilayer shield | P1 |
| vibration_dampers | Spring mounts | P1 |

## G. Recovery
| id | Model | P |
|---|---|---|
| return_capsule | A "pill" capsule | P1 |
| heat_shield | A shield (the capsule's bottom; glows on entry) | P1 |
| parachute | Canopy + lines (pivot_chute) | P1 |
| recovery_beacon | A small beacon | P1 |

## Environment
| id | Model | P |
|---|---|---|
| hq_hangar | HQ hangar: floor, window, lights | P0 |
| hq_console | Console (×4) | P0 |
| test_stand | Clean-room turntable stand | P0 |
| launch_pad | Launch pad with a gantry | P0 |
| titan_terrain | A dune tile + a methane lake | P0 |
| asteroid | Asteroid (+LOD) | P1 |
| earth | Earth (for the return) | P1 |
| debris | Debris ×3 | P1 |

## Characters
| id | Model | P |
|---|---|---|
| astronaut | Cartoon astronaut, 7 clips, 4 color variants | P0 |

**Total:** ~66 models, P0 ≈ 30.
