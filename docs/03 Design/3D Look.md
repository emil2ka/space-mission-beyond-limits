# How the Game Looks in 3D

Principle: 3D shows the mechanics. Everything that changes in the numbers is visible on the model.

## HQ (screens 1–7)
A bright space agency hangar: a high ceiling, soft lavender light, and behind a huge window a rocket on the pad and the night sky. 4 consoles in a semicircle, each with a **cartoon astronaut** for its role (colored chevron: commander — pink, engineer — orange, scientist — cyan, comms — lavender). Animations: waiting (idle), typing, waving to a new player, READY — a thumbs-up + the console lights up. When a player disconnects, their astronaut "freezes", semi-transparent, with Reconnecting above them.

## Constructor (screen 9)
A clean room: a white floor with markings, the craft on a turntable stand, soft shadows.
- **Installing a module:** the module appears above the slot, flies in along an arc in 0.6 s, a "click" + sparks from the bolts + a slight wobble of the craft. Removal — the module flies up and dissolves.
- **Multiple copies** are physically visible: 2 RTGs = two finned cylinders on booms.
- **View modes per role:**
  - Commander "Overview" — risk icons above the units.
  - Engineer "X-ray" — the hull is semi-transparent, the cable tubes glow (thickness = flow, color green → yellow → red), overheated units pulse orange.
  - Scientist "Instruments" — instruments are highlighted, with the view cones of cameras/sensors.
  - Comms "Comms" — the antenna beam and an arrow pointing to Earth.
- **A problem** (mass, heat) — the unit is highlighted, and the camera smoothly turns toward it when you click the warning.

## Launch (screen 14)
The rocket on the pad, steam, the countdown. Liftoff: flame, smoke (particles), the camera from below → from the side → from above. Stage separation, the fairing opens, and inside is **our craft** in the configuration the team built. Duration 12–15 s; can be skipped (after the first time).

## Titan (screen 15)
Orange haze (fog), a dim low sun, dunes, methane lakes with glints, light methane rain. The rotors spin (speed = power), the craft sways slightly and flies between points along a spline. At a point — hovering, a sensor beam pointing down, and a pop-up "+40 data".

## Asteroid (screen 15)
Black space, bright stars, a slowly tumbling cratered asteroid. Attitude-thruster pulses are short jets. Approach: the camera behind the craft, a rangefinder grid. Sampling: the arm unfolds (3 joints), touches down, a cloud of dust, the sample goes into the container, the lid closes. Return: the capsule separates, atmospheric entry (a glowing shield, a plasma trail), the parachute, the blinking beacon.

## Crises (screen 16)
- Debris Alert — debris flies across the frame, hits on the shield (flashes), the camera shakes (unless Reduced Motion is on).
- Power Drop — sparks on a specific unit, instrument lights go out one by one.
- Signal Distortion / blackout — the picture from the craft freezes, breaks up into static, the caption NO SIGNAL; when the link returns, frames "catch up".
- Arm Jam — the arm twitches and gets stuck, a red outline on the drive.
- Overheat — heat haze above the unit, an orange glow.

## Report (screen 17)
A replay of 3 key moments in 3D (the camera follows the recorded timeline) with captions explaining the causes.

## Technology
- three.js via react-three-fiber, drei (OrbitControls, Environment, ContactShadows), postprocessing (Bloom, Vignette).
- Models are GLB, stylized low-poly, with a shared palette (one gradient texture for all modules).
- Mechanical animation is **procedural in code** on named nodes (`pivot_*`); characters use skeletal clips in the GLB. See [Animations](../05%20Assets/Animations.md).
- Quality: High (shadows, bloom, particles), Low for phones (no shadows or bloom, fewer particles).
