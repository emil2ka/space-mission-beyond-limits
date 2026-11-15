# Architecture

```
             ┌──────────────── client (browser) ─────────────────┐
 action   →  │ UI (React)  ──dispatch──▶  Transport ──────────────┼──▶ host
             │   ▲                          │                     │
             │   └── store (zustand) ◀── RoomState ◀─ broadcast ──┼─── host
             │ 3D (r3f) reads store, animates on changes          │
             └────────────────────────────────────────────────────┘
 host: reduce(state, action) from src/engine → new RoomState → broadcast to all + save
```

## Layers
| Folder | Responsibility | Dependencies |
|---|---|---|
| `src/engine/` | Pure logic: data, calculations, the room reducer, the flight simulation, If–Then rules, the report | none (TS only) |
| `src/net/` | Transport: `LocalTransport` (BroadcastChannel), `SupabaseTransport` | engine |
| `src/store/` | zustand: the current RoomState, my playerId, settings | engine, net |
| `src/scene/` | 3D: HQ, the stand, the craft, missions, effects | store, three |
| `src/ui/` | Screens and role panels | store |

## Main rules
1. All logic lives in `engine` and is deterministic (the room seed drives the noise). The same actions → the same state. This makes tests, the report replay and recovery after reconnecting possible.
2. The UI never changes state directly — only via `dispatch(action)`.
3. 3D holds no game state, only visual state (fly-in animations and the like).
4. Balance numbers live only in `src/engine/data/`.

## Key types
`ComponentDef`, `MissionDef`, `Build` (id → count), `CraftStats`, `RoomState`, `Action`, `FlightState`, `AutonomyRule`, `CauseEvent`. See `src/engine/types.ts`.

## Languages (RU/EN, decision 0013 §5)
- `src/i18n/`: `format.ts` (templates `{x}`, plurals `{n|минута|минуты|минут}` / `{n|minute|minutes}`, nested messages), `index.ts` (the `useLang` store, `useT()`), `dict/*.ts` (`{ ru, en }` fragments), `data.en.ts` (English for texts from `src/engine/data/*`, keyed by the Russian string).
- Each player has their own language: `localStorage['sm:lang']`, defaulting to `navigator.language` (`ru*` → ru, otherwise en). It is not synced through the room. The `LangToggle` switch is on the home screen and in the sound panel.
- **A new UI string:** add a key with the screen prefix to your fragment `src/i18n/dict/<area>.ts`, in both `ru` and `en` at once (the `en` type requires the same keys); in the component — `const t = useT(); t('key', { params })`. Fragments contain only data, no imports.
- **Text from the engine:** the engine stores Russian text (tests and logs rely on it) and puts `i18n: { field: Msg }` next to it. Build it with `mt('key', p)` / `m()` / `join()` from `src/engine/msg.ts`; Russian is rendered by `ru(msg)` from the same dictionary. In the UI: `t.f(obj, 'field')`, `t.fl(obj, 'array')`, `t.m(msg)`.
- **New text in `src/engine/data/*`:** add the translation to `data.en.ts`. The test `src/i18n/__tests__/data.test.ts` fails if a translation is missing; `dict.test.ts` checks that the ru/en key sets match.
- Module and mission names are the same in both languages (hence `RTG / РИТЭГ` → `RTG`).
