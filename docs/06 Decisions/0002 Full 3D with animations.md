# 0002 Full 3D with animations — accepted (2026-11-13)
**Context:** the spec (TZ v2.0) describes a 2D interface with SVG illustrations. We want a full game with 3D models and animations.
**Decision:** the game is in 3D (three.js / react-three-fiber). Models come from Claude Design → GLB. The panel interface is 2D on top of 3D.
**Why:** 3D makes consequences visible (a module on the hull, a glowing overheated line, the arm grabbing a sample) and makes the game feel "real".
**Risks:** time spent on models, performance on phones. Mitigations: primitive placeholders (the game is playable without models), Low quality for phones, procedural mechanics, P0 3D ≈ 30 models.
**Alternatives:** 2D SVG as in the spec (rejected by the team).
