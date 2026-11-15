# Style: cel-shaded comic (option 5)

> 2026-11-13: a cel-shaded comic style was chosen for 3D ([0008 Cel-shaded comic style](../06%20Decisions/0008%20Cel-shaded%20comic%20style.md)). The UI palette below comes from the spec (TZ v2.0); it still has to be reconciled with 3D (open question).

## The spec's original style: Cute Futuristic Space Agency

Stylish modern sci-fi, cozy but not childish.

## Palette
| Token | Color | Where |
|---|---|---|
| navy-900 | `#0E1330` | background, space |
| navy-700 | `#1C2452` | panels |
| lavender | `#B8A9F0` | main accent, HQ lighting |
| ice | `#CFE8FF` | secondary text, Titan ice |
| cyan | `#5BE0E6` | interactive elements, data |
| white | `#F7F8FF` | main text, hull |
| pink | `#FF9EC7` | small accents, commander |
| ok / warn / risk / crit | `#4CD69A` / `#FFD25C` / `#FF9A4A` / `#FF5A6A` | statuses only |

## Interface
Neat cards with 14–18 px rounded corners, readable typography (Inter / Manrope, monospaced numbers — JetBrains Mono), soft glow and shadows, semi-transparent (glass) panels, smooth 150–250 ms transitions, an atmospheric space background, a responsive layout.

## 3D models (updated: style 5)
- Thick black outlines, flat colors in 2–3 tones, halftone in the shadows, no thin details. Details in [Prompt Preamble](../05%20Assets/Prompt%20Preamble.md).
- (old) Rounded shapes, large readable details, bevels. Low-poly (a module 1–4k triangles, the hull up to 15k, a character up to 10k).
- Materials: matte white hull, lavender/cyan details, muted gold foil (thermal insulation), glowing indicator strips.
- Not NASA realism but a "premium toy" style — like an expensive desk model.

## Emergency screen
Contrasts with the calm interface but causes no discomfort: a red-orange overlay at 25% opacity, no strobe.

Prompt block for generators: [Prompt Preamble](../05%20Assets/Prompt%20Preamble.md).

## Sound
Everything is synthesized in code, soft and cozy, with no sirens and no "punishing" sounds. Details in [Sound](Sound.md).
