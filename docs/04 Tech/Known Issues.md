# Known issues

## Not verified yet
- **A full four-player flight on separate devices via Supabase.** Verified: 4 tabs in local mode (test F) and 2 players online on the live site (room, joining by code, sync).
- **Real phones and school laptops.** Everything was checked in Chrome emulation (iPhone SE / 14, Android, CPU slowed 4–6×, SwiftShader software rendering) — see [Device QA](Device%20QA.md). The target of ≥ 30 FPS on Low at 6× CPU slowdown is confirmed only for the Titan builder.
- **Sound by ear** on different devices. Checked by sound-event tests and in the browser.

## Graphics
- **Low has no comic outlines** — the shared outline material is hidden because outlines double the draw calls. On phones in "Auto" there is no comic contour. This is a deliberate trade-off.
- **Antialiasing** is set when the WebGL context is created: switching Low ↔ High mid-scene changes pixel density, particles, shadows and outlines at once, but antialiasing only the next time the scene opens. FPS may dip for 1–2 s during the switch.
- **"Auto"** picks Low for touch screens with a short side < 820 px, `deviceMemory` ≤ 4 GB, ≤ 2 cores, software rendering and weak GPUs (Intel HD / UHD 6xx, Mali, Adreno 2xx–5xx, PowerVR). Safety net: High < 40 FPS → Low, Low < 26 FPS → pixel density 0.75.
- **The mission replay in the report** creates a new WebGL context for every chapter (≈ 1 s of shader compilation on a weak machine).

## Interface
- On phones the "!" and settings buttons are pinned to the top-right corner and can cover content underneath while scrolling (e.g. "Autonomy" in the builder).

## Models
- `validate-glb` reports "feet at y=-1.00" for the optimized `astronaut.glb`: after meshopt quantization the skinned mesh's scale moves into the inverse bind matrices. In three.js the model is correct (1.715 m, feet at 0).
- If a mesh hangs directly on a `pivot_*` node, the optimizer moves it into `<name>_mesh`. The code finds nodes by name, so animation still works, but an extra node appears in the hierarchy.

## Other
- Two library warnings in the console (not ours): `THREE.Clock deprecated` (R3F) and `PCFSoftShadowMap has been removed` (R3F `shadows` default).
- In the original spec PDF some words rendered as ■■■ squares (pp. 5, 9, 10). The meaning was restored from context — see [Open Questions](../07%20Tasks/Open%20Questions.md).
