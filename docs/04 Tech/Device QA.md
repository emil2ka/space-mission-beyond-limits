# Device QA — weak laptops, sound, phones

> 2026-11-15. Everything below is **emulation** in headless Chrome on a Mac (M5): CPU throttling via CDP, SwiftShader software rendering instead of a graphics card, network and phone profiles. There was no real school laptop, no real phone and no ears — for what follows from this, see "What was verified only by emulation".

## How to reproduce
Scripts in `scripts/qa/` (puppeteer-core + the system Chrome; results go to `scripts/qa/out/` and are not committed to git):

| Script | What it does |
|---|---|
| `pnpm qa:perf` (`perf.mjs`) | FPS (rAF, a 10 s window after a 4 s warm-up), p95 frame time, long tasks, JS heap, draw calls / triangles (`window.__sm_fps`) on 7 screens × Low / High / Auto. `--cpu 4\|6`, `--gpu swiftshader\|metal`, `--ab before=URL,after=URL --reps 3` — before/after in alternation (machine noise hits both sides), `--fakegpu "<string>"` — spoof the graphics card name to test "Auto". |
| `pnpm qa:load` (`load.mjs`) | The home screen on "Slow 4G" / "Fast 4G" × 4 CPU, cold cache: FCP, "interactive", bytes. Needs a production build (`vite build` + `vite preview`). |
| `pnpm qa:audio` (`audio.mjs`) | Renders every sound and background with **the game's engine** in an OfflineAudioContext (together with the compressor): peak / RMS / LUFS (BS.1770, K-filter) / clipping / DC / duration; plus the live page: AudioContext before and after a gesture, "off", "Master 0", "Background 0". `--soft` — the "No harsh sounds" mode. |
| `pnpm qa:mobile` (`mobile.mjs`) | iPhone SE / iPhone 14 / Android 412×915, touch, DPR 2–3, 4× CPU: the whole loop in demo; on every screen — horizontal scroll, buttons < 44 px, overflowing elements; name + keyboard, input font size (iOS zoom), landscape, WebGL context loss. |
| `lan.mjs`, `profile.mjs`, `shot.mjs` | opening over http from another IP (an insecure context), a CPU profile of a screen, a quick screenshot. |

Servers for measurements:
- `scripts/qa/vite.qa.config.mjs` — a dev server **without HMR and without file watching** (otherwise any file edit reloads the page mid-measurement); `QA_ROOT=<folder>` — serve a different copy (for example, `git archive HEAD` as "before").
- `scripts/qa/vite.qa-build.config.mjs` — a **production build** (React/three in prod mode, the real cost of JS), but with dev hooks (`?dev=1`, the FPS counter) and a store for the driver. The FPS figures below come from it. On the dev server React adds ~10 % CPU (`jsxDEV`).

The machine was loaded with other tasks (load average up to 20 on 10 cores), so the spread of the same run is ±30–50 %. That is why before/after comparisons are done in alternating pairs; some runs were discarded (see "Honest about the numbers").

## 1. Weak laptop
Profile: a 1366×768 window, DPR 1, `deviceMemory` 4, 4 threads, CPU 4× / 6× slower, **SwiftShader** (no graphics card at all — worse than any Intel UHD; this is the lower bound) and, for comparison, the Mac's real graphics card (Metal) with the same CPU.

### FPS (6× CPU, SwiftShader, 1366×768)
**Before** (HEAD, one run each, dev server):

| Screen | Low | High | Auto → |
|---|---|---|---|
| Constructor, Titan | 22.3 (267 draw calls) | 3.5 (735) | Low |
| Constructor, Asteroid | 24.2 (352) | 3.9 (970) | Low |
| Launch | ≈ 30–50* (217) | 7.1 (398) | Low |
| Flight, Titan | 22.5, **24 long tasks / 1.6 s in 10 s** (257, 306k tris) | 6.0 | Low |
| Flight, Asteroid | 33.9, 27 long tasks / 2.3 s (314) | 13.6 (581) | Low |
| Return (capsule, entry) | 48.6 (32) | 17.3 (55) | — |
| Report, 3D replay | 19.0, 29 long tasks (217) | 7.7 | Low |

\* the launch window partly captured the flight; separate runs gave 25–29.

**Before → after** (prod build, alternating before/after pairs):

| Screen, Low | Before | After | Why |
|---|---|---|---|
| Constructor, Titan (3 + 2 clean runs) | 22.0 / 23.2 / 23.5 → **median 23.2** | 30.9 / 39.7 → **≈ 35** | the shadow is frozen |
| Constructor, Asteroid (loaded machine) | median 11.5 | median 19 | same |
| Launch (loaded machine) | median 24.8 | median 26.9 | — (not touched) |
| Flight, Titan | 13.7 FPS, **38 long tasks / 2.7 s** | rays → a heightmap: 3.3 ms → 0.006 ms per query, the terrain long tasks are gone; no clean run afterwards | heightmap |

High on SwiftShader gives 3–17 FPS: without a graphics card High is unplayable, so it matters that "Auto" falls back to Low and that the safety net catches the missed cases.

With a real graphics card (Metal) and the same 6× CPU, the bottleneck is JS: in the prod build after the fixes the flight has no long tasks; in the phone run (4× CPU) the flight on Low gives 31–58 FPS.

**Honest about the numbers.** We did not manage to capture the full matrix (all screens × 3 repeats × 4×/6× × Metal): the machine was heavily loaded by other processes, and runs with parallel load were discarded. The goal "≥ 30 FPS on Low at 6×" is **met for the Titan Constructor** under emulation; for the Asteroid Constructor, the flight and the report replay on SwiftShader it is not confirmed (19–34 before the fixes). In addition, on Low dpr 0.75 turns on if FPS < 26 — in the phone run this kicked in on all three profiles. To repeat: `node scripts/qa/perf.mjs --q low --reps 3 --ab before=…,after=…`.


### What we found (the most expensive)
1. **Titan flight: terrain height via rays over 9 tiles without a BVH.** `makeGround` cast 3 rays every 0.2 s into 9 copies of the terrain (~34k triangles each) — 3.3 ms per ray without throttling; at 6× that is an 80–170 ms long task several times a second (profile: `getVertexPosition` + `intersectTriangle` + `_computeIntersections` ≈ 15 % of the frame; in the prod build "before" — 38 long tasks / 2.7 s in 10 s).
2. **The shadow under the craft in the Constructor (drei `ContactShadows`)** redraws the whole scene every frame (all ~270–350 draw calls) into a texture + 2 blur passes — effectively doubling the stand's work.
3. **The home screen pulled in the whole 3D engine**: a single 1.7 MB chunk (470 KB gzip) — three + R3F + drei loaded before the first frame.
4. Google Fonts were included via a render-blocking `<link rel=stylesheet>`.
5. Draw calls on Low (stand 270 / 350, flight 260 / 315, report replay 220) — mostly model meshes; outlines are already hidden on Low and shadows are off. Textures are small, GLBs are up to 200 KB (3.4 MB in total), there is no loading waterfall: the next scene's models are already preloaded (M5).
6. The report replay recreates the WebGL canvas for every chapter (≈ 1 s of shader compilation on a weak machine) — left as is, see "Next".

### Fixes
| What | Where | Effect |
|---|---|---|
| Titan terrain: a **heightmap** (0.5 m grid, triangles rasterized once, 24 ms) instead of rays | `src/scene/TitanScene.tsx` (`makeHeightfield`, `makeGround`) | 3.3 ms → 0.006 ms per query; deviation from the ray ≤ 8 cm (mean 2.5 mm), checked on 400 points |
| `ContactShadows` on Low "freezes" 4 s after the build changes (the models have time to settle), resolution 256 | `src/scene/StandScene.tsx` (`StandShadow`) | one whole scene pass fewer every frame on Low |
| **Code splitting**: Constructor / Review / Flight / Report via `React.lazy`, starting to load right after joining a room | `src/ui/App.tsx` | home screen: 470 → 155 KB of JS (gzip) |
| Fonts — `preload` + `onload`, without blocking the first frame | `index.html` | |
| **Auto:** + budget Intel (`UHD Graphics 6xx` / plain `UHD Graphics`, i.e. Celeron / Pentium / i3), Mali-G31/G51/G52/G57, "Basic Render Driver"; the rule is moved into a pure `pickAuto()` and covered by a test on real ANGLE / Mesa strings | `src/ui/graphics.ts`, `src/scene/__tests__/quality.test.ts` | Iris Xe / UHD 7xx / Apple / NVIDIA stay on High |
| **FPS safety net:** on High, an average FPS < 40 over 5 s (after a 3 s warm-up) → "Auto" switches to Low by itself and remembers it on the device (`sm:autoLow`; an explicit High choice resets it). On Low < 26 FPS → 3D renders at dpr 0.75 for the rest of the session (the interface stays sharp) | `src/scene/quality.tsx` (`FpsGuard`), `src/ui/graphics.ts` | a weak machine missed by the detector still ends up on Low |
| The "Auto · Low (was N FPS)" hint updates immediately | `src/ui/components/common.tsx` (one line: `useAutoQuality`) | |

### "Auto" on a weak machine
- 4 GB of memory / 4 threads / SwiftShader → **Low** ("4 GB memory"; SwiftShader is on the weak list anyway) — both before and after.
- `Intel(R) UHD Graphics 620` with 8 GB / 8 threads: before — **High** (the rule did not know UHD), after — **Low** ("weak graphics card") — verified by the `pickAuto` test on real ANGLE strings.
- The FPS safety net (High < 40 FPS → Low) is verified by the rule test and in code; an "Iris Xe on top of SwiftShader" run is scheduled in `scripts/qa/out/matrix.sh` but has not been captured.

### Home screen loading (prod build, 4× CPU, cold cache, median of 3)
| Network | Before: FCP / interactive / bytes | After |
|---|---|---|
| Slow 4G (1.4 Mbit/s, RTT 563 ms) | 4.51 s / 4.49 s / 510 KB | **2.49 s / 2.46 s / 195 KB** |
| Fast 4G | 1.26 s / 1.23 s | **0.86 s / 0.83 s** |

The goal "interactive < ~5 s on Slow 4G" was met before too, but only just (4.5 s); now with a margin. The 3D chunk (1 MB / 276 KB gzip) finishes loading in the lobby while the team picks roles; if the network is very slow and the Constructor is opened earlier, "Loading…" is visible for a fraction of a second.

## 2. Sound (no ears — measurements)
Method: every sound and every background layer is rendered offline by **the same `AudioEngine`** (together with the master compressor), at default volumes (master 60 %, background 50 %, effects 70 %) and at 100 %. LUFS-M max is the maximum loudness over 400 ms (fairer than integrated loudness for short sounds); backgrounds are measured after 4 s (once the fade-in has finished).

Default volumes, LUFS-M max (peak dBFS). There is no clipping (|x| ≥ 1) in **any** render, even at 100 %.

| Sound | Before | After | Verdict |
|---|---|---|---|
| UI click | −62 (−43) | −62 | a quiet "tick", 30 LU quieter than alarms ✓ |
| Module installed / removed | −46 / −49 | — | ✓ |
| Approved / veto | −28 / −39 | — | ✓ |
| **Crisis (buzzer)** | **−38.1** (−22.5) | **−30.7** (−14.7) | was quieter than the "approved" chime and the HQ hum → +7.5 dB |
| Crisis over storm+rotor+static | −33.1 over a −35.9 background (+2.8 LU) | **−28.0 over a −36.2 background (+8 LU)** | now audible over the background |
| Crisis, "No harsh sounds" | — | −32.2 (−21.9) | softer, but +6 LU above the background ✓ |
| Crisis resolved / closed | −31.8 / −37 | — | ✓ |
| **Radio / SOS** | **−45.9 / −44.1** | **−38.1 / −36.4** | was quieter than the HQ background (game information!) → +8 dB |
| Signal lost / back | −38.1 / −43.2 | −34.2 / −37.6 | +4 / +6 dB |
| Capsule beacon | −44.8 | −39.1 | +6 dB |
| Grab, jam, sealing, capsule, parachute, touchdown | −36…−41 | — | ✓ |
| Launch (whole) | −22.4 (−12.2) | −23.3 (−12.8) | the loudest moment, roar −1.5 dB ✓ |
| Perfect / Success / Partial / Failed outcomes | −27…−29 | — | ✓ |
| **HQ background** | **−36.3** | **−40.0** | was louder than the buzzer → −4 dB |
| Space background | −36.7 | −40.2 | −4 dB |
| Titan / Earth wind | −41 / −45 | — | ✓ |
| Rain (storm), rotor, ion, chemical | −38 / −46 / −48 / −44 | — | ✓ |
| Static (no link) | −43 | — | ✓ |
| Entry plasma | −33.1 | −36.7 | −3 dB |
| **DC offset** (brown noise) | up to 7·10⁻⁴ (Titan background), 2.6·10⁻³ at 100 % | ≤ 1·10⁻⁴ | we subtract the noise buffer's mean |

With all sliders at 100 %: the maximum peak is −5.5 dBFS (launch), the crisis over the storm is −6.8 dBFS — there is headroom, and the compressor barely works.

Live page: before the first click the AudioContext is **not created** (`none`), after the click — `running`, no autoplay warnings in the console; "Sound off" and "Master 0" → silence (−∞), "Background 0" → −112 dBFS (silence), the HQ hum at 60 % — −42 dBFS RMS. The changes are only numbers in `src/audio/engine.ts`.


## 3. Phones
Profiles: iPhone SE 375×667 @2, iPhone 14 390×844 @3 (+ safe-area emulation 47/34 px — Chrome can do this), Android 412×915 @2.625; touch, a mobile UA, 4× CPU. The loop in demo: Home → Lobby → HQ → Briefing → Constructor → Review → Launch → Flight until the first crisis → Report.

| | iPhone SE | iPhone 14 | Android 412×915 |
|---|---|---|---|
| "Auto" | Low ("phone") | Low | Low |
| Horizontal scroll (11 screens + 2 landscape) | 0 | 0 | 0 |
| Buttons < 44 px | there were 3 (Auto/Low/High, 40 px) → **0** | 0 | 0 |
| Name + keyboard (−45 % of height) | the field is visible, 16 px (no iOS zoom) | ✓ | ✓ |
| WebGL context loss (Constructor, flight) | recovers, 60 FPS, 0 errors | ✓ | ✓ |
| Flight on Low, 4× CPU (Metal) | 31–52 FPS | 58 | 58 |
| Console errors | 0 | 0 | 0 |

The department tabs in the Constructor extend past the edge — it is a horizontally scrolling strip, by design.

**Found and fixed:**
1. **The game did not start over Wi-Fi from a phone.** Over `http://192.168…` there is no `crypto.randomUUID` (secure context only) → `claimPlayerId` crashed, the player id was empty, and all home screen buttons were disabled. Verified with `lan.mjs` using the computer's IP: before — `crypto.randomUUID is not a function`, buttons disabled; after — the demo opens. A `newId()` fallback to `getRandomValues` in `src/store/identity.ts` + the test `src/store/__tests__/identity.test.ts`.
2. The Auto/Low/High graphics switch was 40 px on touch screens → 44 px (`src/ui/styles.css`, the "Device QA" block).
3. Selects 14–15 px → 16 px on touch screens (iOS zooms the page into a field < 16 px).
4. A phone held sideways (height ≤ 500 px): a compact header, the 3D window at 78–82 % of the height (it was 46 vh ≈ 170 px, and the 3D started below the edge of the screen). Android sideways (915 px, the "desktop" grid): the flight window was ≈ 40 px tall — for short screens > 900 px the page now scrolls, 3D 80 vh (this last rule has not been re-checked in the browser).


## How to open the game on your phone (over Wi-Fi, without Supabase)
1. The phone and the computer are on the same Wi-Fi network.
2. On the computer, in the project folder: `pnpm dev:lan`. Vite prints two lines; you need **Network**, for example `http://192.168.68.116:5173/`.
3. Open this address in the phone's browser (Safari / Chrome). For a solo demo: enter a name → "Demo mode: play solo". For a quick flight: add `?dev=1&speed=10` to the address.
4. If it doesn't open: macOS may ask to "Allow incoming connections for node" — allow it; in "System Settings → Network → Firewall", node must not be blocked. Guest / school Wi-Fi networks often isolate devices from each other — then use the phone's hotspot (the computer connects to it).
5. Sound on an iPhone: turn the ringer on (the side switch); the first tap unlocks sound.
6. Limitation: over `http://192.168…` the browser treats the page as insecure — there is no `crypto.randomUUID`, no Web Locks, no clipboard. This is handled (see the fixes), but multiplayer between a phone and a computer **does not work** in local mode: the local transport is tabs of a single browser. Multiple devices — only via Supabase ([Multiplayer](Multiplayer.md)).

## What was verified only by emulation (not on hardware)
- **FPS on real school laptops.** SwiftShader is a software renderer, slower at pixel fill than any integrated graphics card, while Metal on the M5 is faster than any of them; a real Intel UHD is somewhere in between. 6× CPU throttling slows down only the page thread, not the GPU process or the driver. A check on a live Celeron / UHD 600–620 with Windows is needed.
- **Phones.** Chrome emulation: not Safari/WebKit, no real on-screen keyboard (imitated by reducing the window height), no heat / battery throttling, no real phone GPU, safe-area emulated only at the top/bottom. iOS Safari (rotation, 100dvh, sound after the screen locks) has not been tested.
- **Sound by ear.** Levels are measured and balanced, but the timbre ("does it hurt the ears", "does Failed sound punishing") can only be judged by ear, see [Sound](../03%20Design/Sound.md), "How to listen".
- **WebGL context loss** was tested artificially (`WEBGL_lose_context`): three.js restores everything by itself. A real loss (a tab minimized on an iPhone, a driver crash) may behave differently.

## Next
- Report replay: one canvas for all chapters instead of a new WebGL context for each.
- Low: remove the invisible outline shells from the scene graph (right now they are hidden by the material but still traversed every frame).
- Constructor on a phone: the fixed sound button covers content while scrolling (listed in [Known Issues](Known%20Issues.md)).
