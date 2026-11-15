# 0008 Style: cel-shaded comic (option 5) — proposed (2026-11-13)
**Context:** the first 3 options (premium toy, low-poly, clean sci-fi) were not liked. Option 5 was picked from a board of 6 styles.
**Decision (proposed):** cel shading: thick black outlines, flat bright colors in 2–3 tones, halftone dots in the shadows, dramatic camera angles, an orange Titan.
**How in three.js:** `MeshToonMaterial` + a 3-step gradientMap; outlines — inverted hull (drei `<Outlines>`) or a depth/normals post-effect; halftone — a single post-processing shader.
**Pros:** simpler models (flat colors, no PBR textures) → more reliable generation in Claude Design; light rendering on phones; failures fit the comic language perfectly (impact frame, speed lines, a "freeze frame" during blackout).
**Risks:** thin details (rotor blades, antenna rods) must be made thicker, otherwise the outlines "break up"; inverted-hull outlines double the number of draw calls — keep an eye on phones.
**Deviates from the spec (TZ v2.0):** the spec asks for "Cute Futuristic Space Agency" with lavender/cyan. To decide: keep the spec's palette in the UI and the comic style in 3D, or repaint everything.
