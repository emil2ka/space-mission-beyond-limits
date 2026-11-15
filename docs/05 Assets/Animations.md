# Animations

## Mechanics — procedural in code (on `pivot_*` nodes)
| Module | Node | Animation | Depends on |
|---|---|---|---|
| Rotor System | `pivot_rotor_1..4` | rotation | flight power |
| High-Gain Antenna | `pivot_dish` (azimuth), `pivot_dish_tilt` | smooth aiming at Earth | aiming error (comms) |
| Solar Panel Array | `pivot_panel_l/r` | unfolding after separation | phase |
| Robotic Arm | `pivot_arm_1..3`, `pivot_claw` | IK-lite: 3 joints toward the target | sampling |
| Drill | `pivot_drill` | rotation + lowering | intensity |
| Reaction Wheels | `pivot_wheel` | rotation | maneuvers |
| Sample Container | `pivot_lid` | closing | packing |
| Parachute | `pivot_chute` (scale) | opening | return phase |
| Chemical Engine/Thrusters | `fx_nozzle*` | flame particles + light | thrust |
| RTG | `fx_glow` | soft pulsing, brighter when overheating | heat |
| Cameras/sensors | `fx_lens` | view cone (scientist mode) | — |

## Shared animations
- A module flying to its slot (0.6 s arc, easeOutBack) + sparks + a wobble of the hull.
- Flying away on removal.
- Camera shake on impacts (off with Reduced Motion).
- Static/"freezing" of the picture during a blackout (post-effect).

## Characters — skeletal clips in the GLB
`Idle`, `Typing`, `Wave`, `ThumbsUp` (READY), `Panic` (crisis), `Cheer` (success), `Shrug` (failure). 7 clips, one model for all 4 roles.
