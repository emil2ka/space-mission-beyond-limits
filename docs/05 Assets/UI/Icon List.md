# Список иконок UI (общий для макетов Claude Design и генерации в ChatGPT)

> 2026-11-15. Имена — обязательные: макеты UI ставят их как плейсхолдеры, ChatGPT-сессия режет иконки в `public/icons/ui/<name>.png` (прозрачный фон, 128×128, плюс `@2x` 256×256), код подключает по имени.
> Стиль: cel-shaded комикс как в 3D ([Style Guide](../../03%20Design/Style%20Guide.md), [Prompt Preamble](../Prompt%20Preamble.md)) — толстый тёмный контур, плоские цвета палитры (кремовый, фиолетово-серый, графит, бирюзовый, тёплый оранжевый, приглушённое золото, глубокий синий), 2 тона тени, без текста, читается на 24–32 px, вид спереди, одинаковая толщина контура и масштаб.

## Отделы (7)
`dept_power` (молния в батарее) · `dept_propulsion` (сопло с пламенем) · `dept_navigation` (компас/гироскоп) · `dept_science` (колба/линза) · `dept_comms` (тарелка с волнами) · `dept_structure` (щит/рама) · `dept_recovery` (капсула с парашютом)

## Ресурсы и параметры (10)
`res_mass` (гиря) · `res_budget` (купюра М$) · `res_credits` (монета MC) · `res_power_gen` (молния вверх) · `res_power_use` (молния вниз) · `res_battery` · `res_heat` (термометр) · `res_signal` (антенна с дугами) · `res_data` (стопка дискет/чип) · `res_fuel` (канистра/бак)

## Роли (4)
`role_commander` (звезда/шеврон, розовый) · `role_engineer` (гаечный ключ, оранжевый) · `role_science` (атом/колба, бирюзовый) · `role_comms` (наушники, лавандовый)

## Статусы (9)
`st_ok` (галочка) · `st_warn` (треугольник) · `st_crit` (молния в круге) · `st_info` (i) · `st_locked` (замок) · `need_required` · `need_recommended` · `need_optional` · `need_useless`

## Действия (14)
`act_add` (+) · `act_remove` (−) · `act_approve` (печать «одобрено»/галочка в круге) · `act_veto` (крестик в круге) · `act_launch` (ракета) · `act_radio` (рация) · `act_settings` (шестерёнка) · `act_sound` (динамик) · `act_sound_off` · `act_exit` (дверь со стрелкой) · `act_replay` (круговая стрелка) · `act_play` · `act_pause` · `act_skip`

## Полёт (12)
`fl_phase` (флажок) · `fl_waypoint` (метка на карте) · `fl_crisis` (мигалка) · `fl_blackout` (перечёркнутая антенна) · `fl_rule` (блок «если→то») · `fl_timer` (секундомер) · `fl_hull` (корпус-щит с трещиной) · `fl_sample` (контейнер с камнем) · `fl_capsule` · `fl_storm` (облако с молнией) · `fl_debris` (обломки) · `fl_log` (журнал)

## Миссии и штаб (6)
`mis_titan` (оранжевая планета в дымке) · `mis_asteroid` (серый астероид) · `hq_upgrade` (стрелка вверх на детали) · `hq_history` (папка) · `hq_repair` (ключ + отвёртка) · `hq_insurance` (щит с галочкой)

**Итого: 62 иконки.**
