# Контракт M1: полёт Титана (движок ↔ экраны ↔ 3D)

> 2026-11-14. Общий договор для трёх частей M1, чтобы их можно было делать параллельно. Имена ниже — обязательные; детали внутри частей — на усмотрение исполнителя. Дизайн: [Titan Sky Explorer](../03%20Design/Missions/Titan%20Sky%20Explorer.md), [Crises and Blackout](../03%20Design/Crises%20and%20Blackout.md), [Mission Report](../03%20Design/Mission%20Report.md), [Core Loop](../03%20Design/Core%20Loop.md).

## Владение файлами
| Часть | Владеет | Не трогает |
|---|---|---|
| **A. Движок** | `src/engine/**` (вкл. `room.ts`, тесты) | `src/ui`, `src/scene`, `src/store` |
| **B. Экраны** | `src/ui/**`, `src/store/**` | `src/engine` (только импорт), `src/scene` (только импорт) |
| **C. 3D** | новые файлы в `src/scene/` (`LaunchScene.tsx`, `TitanScene.tsx`, `scene/flight/**`) | `src/engine`, `src/ui`, `src/store`, существующие `Craft/Module/StandScene` — только аддитивно |

## A. Движок (`src/engine`)

### Подготовка → запуск
- `readiness(build, mission): { ok: boolean; blockers: Issue[]; warnings: Issue[] }` — блокеры не дают запуск (нет обязательной системы, перегруз массы/бюджета/слотов); предупреждения можно подтвердить.
- Стадии комнаты: `build → review → launch → flight → report` (уже есть `Stage`).
- Действия `room.ts` (добавить/уточнить): `{type:'submitReview'}` (build→review), `approve` (если есть warnings — записывается `approve-against-warning`, −Team Trust только за сознательное игнорирование), `veto {text}` (review→build), `{type:'launchDone'}` (launch→flight, шлёт клиент хоста по окончании анимации запуска; движок стартует полёт), `tick`.

### Полёт (`FlightState` расширяется, старые поля остаются)
```ts
type WaypointId = 'dunes' | 'lake' | 'crater';
interface Waypoint { id: WaypointId; name: string; reached: boolean; mode: 'fast' | 'precise' | null }
type ScienceTargetId = 'atmo_profile' | 'surface_images' | 'surface_chem' | 'env_temp';
interface ScienceTarget { id: ScienceTargetId; name: string; need: string[]; required: number; collected: number; sent: number; possible: boolean }
type CrisisKind = 'power_drop' | 'signal_distortion' | 'freeze' | 'overheat';
interface CrisisOption { id: string; role: RoleId; label: string; hint: string }
interface ActiveCrisis {
  id: string; kind: CrisisKind; title: string; text: string;
  nodeIds: string[];          // компоненты-причины (для 3D-искр и отчёта)
  startedTick: number; deadlineTick: number;   // таймер 15–30 с = тиков при TICK_SECONDS = 1
  options: CrisisOption[];    // по 1–3 на роль; у роли может не быть вариантов
  chosen: Partial<Record<RoleId, string>>;
}
interface FlightState { /* …старые поля… */
  waypoints: Waypoint[]; waypointIndex: number; waypointProgress: number; // 0..1 к следующей точке (для 3D)
  targets: ScienceTarget[];
  crisis: ActiveCrisis | null; crisesSeen: CrisisKind[];
  thermal: CraftStats['thermalState'];
  route: 'flying' | 'landed' | 'stopped';
}
```
- Фазы Титана: Перелёт → Вход и развёртывание → Полёт по точкам → Передача данных (из `missions.ts`, длительности можно уточнить так, чтобы полёт шёл 8–12 минут при `TICK_SECONDS = 1`).
- Кризисы **детерминированы от сборки** + сид комнаты (решение 0006): Power Drop — шина перегружена или заряд < 20 %; Signal Distortion — фаза «Полёт по точкам», шанс выше без `signal_amp`. Freeze/Overheat — по тепловому балансу. За полёт ≈ 2–3 кризиса, не больше одного одновременно.
- Действия: `{type:'crisisChoice'; playerId; optionId}`, `{type:'scienceMode'; playerId; waypoint: WaypointId; mode}`. По дедлайну без выбора — срабатывает подходящее правило Autonomy Planner, иначе Safe Protocol. Результат пишется в `causes` с `causeIds`.
- `role`-видимость (асимметрия) — функция `panelFor(role, flight, build): RolePanel` с тем, что роль видит (инженер: узлы/питание/тепло; учёный: данные/цели; связь: сигнал/очередь/антенна; командир: таймер/корпус/общий статус).

> **Как получилось (2026-11-14, часть A готова):** сигнатуры и правила — [Simulation Engine](Simulation%20Engine.md), числа — [Balance Table](../03%20Design/Balance%20Table.md), решения — [0010 M1 flight model](../06%20Decisions/0010%20M1%20flight%20model.md). Добавлены поля (имена контракта не менялись): `room.decisionLog`, `room.report`, `readiness().notes`, `FlightState.history/storm/power/heat/queueFull/blackouts/…`, `CrisisOption.nodeIds`, `CauseChain.key/impact`, `MissionReport.trust/delivered/ticks`.

### Отчёт
```ts
interface CauseChain { what: string; why: string; couldDo: string; causeIds: string[] }
interface MissionReport {
  outcome: 'perfect' | 'success' | 'partial' | 'failed'; score: number;
  breakdown: { key: string; label: string; weight: number; got: number }[];   // веса из Mission Report.md
  chains: CauseChain[];        // главные ≤ 3 первыми, остальные дальше
  decisions: Decision[]; teamTrust: number;
  roles: { role: RoleId; did: string[] }[];
  mc: { earned: number; upkeep: number; total: number };
  highlights: { tick: number; kind: 'launch' | 'crisis' | 'final'; text: string }[];  // для 3D-повтора
}
buildReport(room: RoomState): MissionReport
```
- Тесты: приёмочные A и C из ТЗ проходят через весь цикл (сборка → review → launch → flight до конца → report); детерминированность (один сид — один исход).

## C. 3D-сцены (`src/scene`) — чистые компоненты по пропсам
```ts
<LaunchScene build mission reducedMotion onDone={() => void} />          // ~12–15 с: отсчёт, старт, отделение ступени, раскрытие обтекателя; камера; skip по клику
interface TitanSceneProps {
  build: Build; phaseId: string; waypointIndex: number; waypointProgress: number;
  route: 'flying' | 'landed' | 'stopped';
  crisis: { kind: CrisisKind; nodeIds: string[] } | null;
  offIds: string[]; signal: FlightState['signal']; role: RoleId | null; reducedMotion: boolean;
}
<TitanScene {...props} />
```
- Модели: `rocket`, `launch_pad`, `titan_terrain`, `frame_titan` + модули + накладки (переиспользовать `Craft`/загрузчик), `debris` не нужен для Титана. Сцена Титана: оранжевая дымка, тусклое солнце, дюны (тайлы), озеро с бликом, метановый дождь, аппарат летит на роторах между 3 точками (дюны → озеро → кратер), камера сзади-сбоку.
- Кризисные визуалы по причине: Power Drop — искры на узле `nodeIds[0]` + мигание (3 раза, без строба); Signal Distortion — статические помехи пост-эффектом; Freeze — иней; reducedMotion — без тряски/glitch.
- Пока движок не готов, C работает на моковых пропсах (демо-страница `?scene=titan` / `?scene=launch` только в dev).

## B. Экраны (после A)
- Проверка готовности (`review`): блокеры/предупреждения, подсветка узлов в `StandScene`, командир: «Утвердить» / «Вето с причиной»; подтверждение предупреждений записывается.
- Запуск (`launch`): `<LaunchScene>` на весь экран, по `onDone` хост шлёт `launchDone`.
- Mission Control (`flight`): `<TitanScene>` + полоса фаз/точек + панель своей роли (`panelFor`) + журнал; выбор режима измерения у учёного на точке; **кризисный экран** по «Эффекту катастрофы» (glitch 0.5–1 с, CRITICAL EVENT, аварийный слой, таймер, варианты своей роли, что выбрали другие).
- Отчёт (`report`): итог, баллы, ≤ 3 цепочки причин + «Подробнее», решения командира и Team Trust, вклад ролей, MC.
- Локальный демо-режим: один игрок может переключать роль, чтобы видеть все панели.
