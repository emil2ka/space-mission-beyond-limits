# Sound

> 2026-11-15, M5. Code: `src/audio/` (engine, event logic); the settings button is `src/ui/components/SoundSettings.tsx`. Status: **verified** by tests and in the browser (signal at the output, events, volume); **not verified by ear** — see "How to listen".

## Principles
- **All sounds are synthesized in code** (WebAudio: oscillators, noise, filters). No files and no licenses, zero bytes in the build.
- The mood matches the visuals ([Style Guide](Style%20Guide.md)): cozy "premium toy" sci-fi. Soft sines and triangles, a quiet background, no horror and no sirens.
- **Nothing "punishing":** the crisis buzzer is 2 short pulses (≈0.45 s), not an endless siren; a failed mission is a soft warm chord ("let's try again"), not a "fail" sound.
- Volume is limited: an overall mix ceiling + a soft limiter (compressor) at the output. Defaults: master 60 %, background 50 %, effects 70 %.
- Screens know nothing about sound: everything comes from changes in the room state (`src/store/game.ts`). A separate `playUi()` call exists, but screens don't use it. The quiet "tick" on any button is a delegated click handler (`data-no-click-sound` on a container turns it off).

## What plays when
**Background (continuous layers, smooth ~0.6 s transitions)**
| Where | Sound |
|---|---|
| Home screen, lobby, briefing, Constructor, review, HQ, report | HQ hum: 55/110 Hz mains hum + an "air conditioner" (brown noise) |
| Launch | Night wind at the launch pad + the launch sequence (below) |
| Cruise (both), Asteroid until the return | Space: a deep calm drone + a quiet shimmer |
| Titan after entry | Wind (band-pass noise with "breathing") + methane rain; heavier rain in the storm |
| Titan, the rotorcraft is flying | "Whup-whup" rotor blades (noise modulated at 17 Hz) + a motor tone |
| Asteroid, cruises | Ion engine — a quiet double tone; chemical — a low rumble |
| Asteroid: approach, site, sampling, packing | Attitude-thruster pulses — short hissing "pssh" sounds every 1–4 s |
| Atmospheric entry (Titan: the entry phase; capsule: entry, weaker under the parachute) | Plasma rumble |
| After the capsule lands | A light Earth wind |
| Comms: SIGNAL LOST / INTERFERENCE | Radio noise (full / half) — goes to the effects bus: it is information |

**One-shot sounds**
| Event (state) | Sound |
|---|---|
| Module installed / removed (Constructor) | A short "clack" going up / down |
| Commander approval | A soft major arpeggio chime |
| Veto | Two calm descending notes |
| Launch (`stage → launch`, timing = `launchTimeline.T`) | 3 countdown beeps, a high "LIFTOFF!" beep, an engine roar with an opening filter, a low liftoff rumble, a stage separation "boom", a quieter second stage, the fairing click |
| New flight phase | A quiet double chime |
| Crisis started | A **short buzzer** (2 pulses) + **quiet radio noise** for 1.4 s — per [Crises and Blackout](Crises%20and%20Blackout.md), item 6 |
| Crisis closed: cause fixed / not fixed | A rising pair of notes / a single neutral note |
| Tactical Radio delivered | A channel-open beep → noise → a channel-close beep; an emergency phrase — a double beep |
| Signal lost / back | A descending tone + noise / two rising beeps |
| Sample grabbed | A servo + a knock |
| Arm jammed | A short "grind" + a knock |
| Container sealed | A click + a hiss |
| Capsule separated / parachute / touchdown / beacon found | A pyro "thunk" / a whistle + the canopy pop / a dull thud / 3 soft beeps |
| Report: Perfect / Success / Partial / Failed | A chord + a chime arpeggio / a major chord / an open Csus2 / a soft Fmaj7 |

Intentionally absent: a sound on every tick, sounds on reload or on joining in the middle of a crisis (the first room state produces no events), sounds in the report's 3D replay.

## Settings (the speaker button, top left, on every screen)
- **Sound on/off**, **Master**, **Background** (background/music), **Effects** — 0–100 sliders, stored in `localStorage` (`sm:soundOn`, `sm:volMaster`, `sm:volAmbience`, `sm:volSfx`, `sm:softSounds`) via `src/ui/settings.ts`.
- **No harsh sounds:** the crisis buzzer is replaced with a soft two-note signal, radio beeps are lower, radio noise and static are half as loud, effects are a little quieter. Reduced Motion does not affect sound.
- "Test sound" — a short chime.
- The same panel has Reduced Motion, Disable Flash and graphics quality (the shared `A11yToggles`): this is screen 19, "Accessibility settings".
- Dev (`pnpm dev`): the "dev: audio" section — AudioContext state, active layers, a drop-down list of all sounds with a ▶ button, and a log of recent events (`▶` played, `·` skipped and why). In the console — `[audio] …` (debug); `window.__smAudio.level()` — the output level in dBFS.

## Browser and tabs
- **Autoplay:** the AudioContext is created on the first real click/key press (pointerdown/keydown); until then the game is silent.
- **Local mode** (all players are tabs of the same browser) and the home screen: **only the focused tab** plays sound (`document.hasFocus()`), both background and effects — no cacophony from 4 tabs. Switch to another tab and click — the sound moves there.
- **Online:** any visible tab plays sound (each player has their own device).

## Levels (Device QA, 2026-11-15)
Measured with an offline render of the engine (`pnpm qa:audio`); the table is in [Device QA](../04%20Tech/Device%20QA.md). Crisis buzzer +7.5 dB, radio +8 dB, "comms"/beacon +4…6 dB, HQ and space background −4 dB, plasma −3 dB, launch roar −1.5 dB, DC removed from the noise. No clipping, even at 100 %.

## How it works
- `src/audio/events.ts` — pure functions: `snapshotOf(room)` (a flat snapshot of what matters for sound), `soundEvents(prev, next)` → one-shot sounds, `layersFor(snapshot)` → background levels, `audibility(mode, focus, visible)`. Tests: `src/audio/__tests__/events.test.ts`.
- `src/audio/engine.ts` — synthesis: the `ambience` and `sfx` buses → `master` → compressor → output; loops start/stop smoothly, the launch is scheduled on `AudioContext` time.
- `src/audio/index.ts` — `startAudio()` (called once in `App.tsx`): subscribes to `useGame` and `useSettings`, focus/visibility, unlocking on a user gesture.

## How to listen (manually, ears required)
1. `pnpm dev`, open `http://localhost:5188/?dev=1&speed=10` in a regular browser, in **one** tab, headphones at medium volume.
2. Click the speaker (top left) — a quiet HQ hum should start. In "dev: audio", listen to every sound in the ▶ list. Check: the buzzer does not hurt the ears, "No harsh sounds" is noticeably softer, Failed sounds calm rather than "punishing".
3. Move the sliders: "Master" at 0 — silence; "Background" at 0 — the hum is gone, effects remain; uncheck "on" — instant silence.
4. Create a demo room, build the craft (a clack for every module), approve → launch: the countdown matches the 3-2-1 digits, the roar matches the flame, the "boom" matches the stage separation.
5. Titan: rain and wind after entry, rotor blades while the rotorcraft flies, heavier rain in the storm; signal loss — noise. Asteroid: thruster "pssh" sounds near the asteroid; the capsule — the entry rumble, the parachute, the thud, the beacon.
6. Open a second tab of the same room and click in it — the first one should go quiet.

## Next
- There is no music theme (the "Background" slider = the HQ/planet background). If needed — a generative soft theme in the same engine.
- Sound in the report's 3D replay (the replay is silent for now).
