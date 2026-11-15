# Контракт M3: Астероид и экономика (движок ↔ экраны ↔ 3D)

> 2026-11-14. Как [M1 Flight Contract](M1%20Flight%20Contract.md): три части, общие имена обязательны, детали — на усмотрение исполнителя. Дизайн: [Asteroid Sample Return](../03%20Design/Missions/Asteroid%20Sample%20Return.md), [Economy](../03%20Design/Economy.md), [Crises and Blackout](../03%20Design/Crises%20and%20Blackout.md), [Mission Report](../03%20Design/Mission%20Report.md). Приёмочный тест E ТЗ: «пройти Титан и получить кредиты → показать стоимость астероидной миссии → разблокировать при достаточном балансе → показать обслуживание/ремонт до следующего запуска → не допустить отрицательного баланса и soft-lock».

## Владение файлами
| Часть | Владеет | Не трогает |
|---|---|---|
| **A. Движок** | `src/engine/**` | `src/ui`, `src/store`, `src/scene` |
| **B. Экраны** (после A) | `src/ui/**`, `src/store/**` | `src/engine`, `src/scene` — только импорт |
| **C. 3D** | новые файлы `src/scene/AsteroidScene.tsx`, `src/scene/ReturnScene.tsx`, `src/scene/asteroid/**`; аддитивно — общие части `src/scene/flight/**` | `src/engine`, `src/ui`, `src/store` (кроме подключения dev-страниц `?scene=asteroid`, `?scene=return`) |

## A. Движок

### Полёт Астероида (тот же `FlightState`, новые поля — необязательные для Титана)
```ts
type AsteroidSiteId = 'regolith' | 'boulder' | 'crack';      // мягкий реголит / камень / рядом с трещиной
type CapsuleStage = 'stowed' | 'separated' | 'entry' | 'chute' | 'landed' | 'found' | 'lost';
interface AsteroidFlight {
  fuel: number; fuelMax: number;                 // химия расходует на манёврах, ион — эффективно на перелёте
  approach: number;                               // 0..1 сближение (для 3D)
  site: AsteroidSiteId | null;                    // выбирает учёный (действие chooseSite)
  sampling: 'idle' | 'reach' | 'grab' | 'jam' | 'stowed' | 'failed';
  sample: { collected: boolean; sealed: boolean; mass: number };
  capsule: CapsuleStage; capsuleProgress: number; // 0..1 внутри стадии (для 3D входа/парашюта)
  debris: boolean;                                // идёт Debris Alert (для 3D)
}
interface FlightState { /* …М1… */ asteroid?: AsteroidFlight }
```
- Фазы из дизайна: Перелёт → Сближение → Выбор места → Отбор → Упаковка → Обратный перелёт → Возвращение капсулы. Длительность ≈ 9–12 мин при `TICK_SECONDS = 1`.
- Rotor System на Астероиде несовместим и не считается двигателем (тест B уже есть — не ломать).
- Кризисы (детерминированы от сборки + сид, решение 0006): **Debris Alert** (сближение; реже с `micrometeoroid_shield`; варианты: уклониться/продолжить), **Sampling Arm Jam** (отбор; чаще без `vibration_dampers`; перезапуск/изоляция привода/повтор), плюс Overheat/Power Drop по общим правилам. Без выбора → правило Autonomy Planner (`debris_detected`, `sample_secured`…) или Safe Protocol.
- Действия: `{type:'chooseSite'; site}` (учёный), остальное как в M1 (`crisisChoice`, `radio`, …). Права ролей — как в M2.
- `panelFor` для астероида: инженер — топливо/двигатели/щит; учёный — место, состояние руки, образец; связь — сигнал/данные состава; командир — общий статус, корпус, таймер.
- Отчёт: веса из Mission Report (сохранность образца 10, возвращение 5 и т. д.), Perfect = образец герметичен + капсула найдена + данные состава доставлены; цепочки причин для астероида.

### Экономика (тест E)
```ts
interface Agency {                         // мета-прогресс команды, переносится между попытками
  credits: number; unlocked: MissionId[]; upgrades: UpgradeId[];
  damaged: string[];                       // модули, требующие ремонта после прошлого полёта
  history: { mission: MissionId; outcome: Outcome; earned: number }[];
}
type UpgradeId = 'light_alloys' | 'better_antennas' | 'better_batteries' | 'pdu_v2' | 'extra_slot' | 'fc_v2';
interface PrepCosts { items: { id: string; label: string; cost: number; optional?: boolean }[]; total: number; affordable: boolean; fallback: 'none' | 'free_basic_repair' }
prepCosts(agency, insurance: boolean): PrepCosts
```
- Награды и цены — из [Economy](../03%20Design/Economy.md) (Perfect 120 / Success 90 / Partial 50 / Failed 20 + 10 за цель; астероид 150; улучшения 50–80).
- Действия: `unlockMission` (есть), `{type:'buyUpgrade'; id}`, `{type:'confirmPrep'; insurance: boolean}` (списывает подготовку перед новой попыткой; показывается ДО подтверждения), «Ещё раз» / «В штаб» идут через подготовку.
- Улучшения реально меняют `computeStats` (масса корпуса −10 %, ёмкость батарей +25 %, правила 6, +1 слот, PDU v2 — умное отключение, антенны — +пропускная способность). Каждое — компромисс, описание в данных.
- **Никогда не уходить в минус и не запирать игру:** не хватает на подготовку → бесплатный базовый ремонт и стартовая конфигурация. Тест E целиком в тестах движка.
- Хранение: `Agency` в `RoomState` + функции `exportAgency/importAgency` (B положит в localStorage хоста; Supabase-таблица `agency` — позже).

> **Как получилось (2026-11-14, часть A готова — проверено тестами, 176/176, typecheck, build):** имена контракта не менялись, поля добавлены. Правила и сигнатуры — [Simulation Engine](Simulation%20Engine.md) (разделы «Полёт Астероида», «Экономика»), числа — [Balance Table](../03%20Design/Balance%20Table.md), отступления от дизайна — [0012 M3 asteroid and economy](../06%20Decisions/0012%20M3%20asteroid%20and%20economy.md).
> - `AsteroidFlight` (`src/engine/asteroid.ts`): поля контракта + `drive` ('ion' | 'chem'), `cruise`, `samplingProgress`, `tool`, `sealProgress`, `siteBy`, `fuelUsed`, `fuelShort`, `approachFailed`, `offTarget`, `heated`, `armDamaged`, `stageTicks`, `attempts`… `FlightState` + `asteroid?`, `mods?`, `autoShed?`, `jamPlan?`. `CrisisKind` + `'debris_alert' | 'arm_jam'`, `ActiveCrisis.variant` + `'late'` (обломки замечены поздно).
> - Длина: **541–590 тиков ≈ 9–10 мин** (перелёт и сближение кончаются по прибытии). Научных целей две: «Состав астероида» (45, для Perfect) и «Съёмка места отбора» (35; снимает и Navigation Camera — слотов науки всего 4).
> - Триггеры: Debris — сближение, без Micrometeoroid Shield всегда, с ним 25 % сидов; без Radar / Navigation Camera таймер 8 с. Arm Jam — риск места − Vibration Dampers (реголит + гасители — никогда, камень без гасителей — всегда), момент из сида. Правила: `debris_detected → evade`, `sample_secured → prepare_return` (отбор кончается раньше), Safe Protocol на дедлайне.
> - Экономика (`src/engine/economy.ts`): `Agency` + `extraSlot`, `hullLoss`, `insured`, `coveredRepairs`, `pendingPrep`, `basicRepairs`, `lastPrep`; `PrepCosts` + `charge`, `balanceAfter`, `missing`. Действия: `buyUpgrade {id, slot?}`, `confirmPrep {insurance, next?: 'build' | 'lobby'}`, `loadAgency {agency}`, `chooseSite {site}`; `goStage` из отчёта тоже проходит подготовку (без страховки). `room.credits` / `room.unlocked` — зеркала `room.agency`. `computeStats(build, mission, mods?)`, `canAdd(..., mods?)`, `readiness(..., mods?)`, `statsOf(room)`.
> - `panelFor` → `panel.asteroid` (инженер: топливо + прогноз, двигатели, защита; учёный: 3 места с риском для этой сборки, рука, образец, состав; связь: состав, капсула; командир: топливо, образец, капсула). `MissionReport` + `damaged`, `asteroid` (флаги Perfect), `mc.balance`, `mc.prep`.
> - Минимальная правка вне движка: `src/store/game.ts` — `DEV_UNLOCK` открывает миссии и в `room.agency` (иначе зеркало перезаписалось бы).

## C. 3D-сцены — чистые компоненты по пропсам
```ts
interface AsteroidSceneProps {
  build: Build; phaseId: string; approach: number; site: AsteroidSiteId | null;
  sampling: AsteroidFlight['sampling']; sampleSealed: boolean;
  crisis: { kind: CrisisKind | 'debris_alert' | 'arm_jam'; nodeIds: string[] } | null;
  debris: boolean; offIds: string[]; signal: FlightState['signal']; reducedMotion: boolean;
}
interface ReturnSceneProps { build: Build; capsule: CapsuleStage; capsuleProgress: number; beacon: boolean; reducedMotion: boolean }
```
- Модели: `asteroid` (`lod0/lod1`, `mount_sample`), `frame_asteroid` + модули + `__asteroid`-накладки (через `Craft`/загрузчик), `robotic_arm` (`pivot_arm_1..3`, `pivot_claw*`), `drill`, `chem_main_engine`/`chem_thrusters` (`fx_nozzle*`), `ion_engine` (`fx_beam`), `debris` (`debris_1..3`), `earth` (`pivot_clouds`), `return_capsule` + `heat_shield` (`fx_glow`) + `parachute` (`pivot_chute`) + `recovery_beacon`.
- AsteroidScene: чёрный космос, звёзды, медленно кувыркающийся астероид, аппарат подходит (`approach`), струи ориентации, три места на поверхности (подсветка выбранного), рука тянется к `mount_sample`, пыль при отборе, заклинивание (рывки + искры) при `arm_jam`, обломки летят мимо при `debris`.
- ReturnScene: Земля, капсула отделяется, вход — раскалённый щит и плазма, раскрытие парашюта (`pivot_chute` 0→1), посадка, мигающий маяк, камера.
- reducedMotion — без тряски; dev-страницы `?scene=asteroid` и `?scene=return` с ползунками.

## B. Экраны (после A)
- Штаб (между попытками): баланс MC, история, разблокировка астероида (цена, баланс, сколько не хватает), магазин улучшений (компромиссы), экран подготовки (`prepCosts` до подтверждения, страховка, бесплатный ремонт при нехватке).
- Mission Control для астероида: `AsteroidScene`/`ReturnScene` по фазе, выбор места у учёного, панели ролей, кризисы Debris/Arm Jam (тот же кризисный экран).
- Отчёт астероида (образец, капсула) + MC.
- Тест E в браузере: Титан → MC → разблокировка → подготовка → Астероид → отчёт.
