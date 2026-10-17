# Разработка «Архипелага»: бриф исполнителям

Правила — [archipelago.md](archipelago.md) (итерация 2 — утверждена), экран — [archipelago-screen.md](archipelago-screen.md).
Контракт уже в коде (коммит «контракт в коде»): его и держитесь.

## Общие правила (всем)

- **Контракт:** `packages/engine/src/types.ts` (раздел «Архипелаг», `WorldState.archipelago`, `version: 9`, действия,
  `ChoiceKind`/`PendingChoice.expiresWeek/deferred`, `ChoiceView` partner/bankLoan/bizBuyer, `FinanceView.arch`,
  `PlayerWeekReport.arch`, `ERROR_CODES`), `packages/engine/src/archipelago/view.ts` (`archipelagoView`, `ARCH_MAP_ORDER`),
  `apps/web/src/scene/contract.ts` (`ArchSceneProps`, `ARCH_ICONS`, флаг `archCamera`), `apps/web/src/store.ts`
  (`archMode`, `archFocus`, `setArchMode`, `setArchFocus`), словарь `apps/web/src/i18n/ru.ts` → блок `arch` и ключи ошибок.
  Имена и смысл полей контракта не меняйте. Можно **добавлять** поля/ключи, если без них нельзя, — перечислите в отчёте.
- **Числа правил менять запрещено** (все — из `packages/engine/proto/archipelago/rules.ts` и `content.ts`, дословно).
- Трогайте только свои файлы (ниже). Git не трогайте вообще (никаких commit/checkout/stash/reset) — коммитит координатор.
- Читайте точечно: Grep, затем нужные строки; не печатайте код обратно. Вывод команд — короткий (`| tail`).
- Запуски идут параллельно в одной папке: ошибки typecheck в чужих файлах (например, движок у веба) — не ваши, не чините,
  упомяните в отчёте.
- Отчёт в конце ≤ 120 слов, без кода: файлы, отступления от контракта, результаты проверок, известные проблемы.

## Codex 1 — движок

**Файлы:** `packages/engine/src/**` (новые модули — в `src/archipelago/`), `packages/engine/test/**`,
`packages/engine/scripts/**`, `packages/engine/package.json` (скрипты), корневой `package.json` (только скрипт `sim:arch`).

1. **Перенос прототипа** (`proto/archipelago/*`, формулы — archipelago.md «Формулы», «Неделя прототипа», итерация 2)
   в `src/archipelago/` (rules, content, логика недели, действия, view). Своего ГПСЧ нет — вся случайность через
   `world.rng` (хелперы `src/rng.ts`). Псевдоактивов и `syncedShares`/`restoredShares` больше нет.
2. **Доход дел — настоящими строками:** у человека `PlayerWeekReport.arch` (все поля `ArchWeekLines`, входят в `net`
   и `cashAfter`), у ботов — `arch: null`, но их деньги от дел/управления/займов идут в cash. `financeView(...).arch`:
   income (доли после управляющих, билеты, ожидаемые проценты банка) входит в `passiveIncome`, expenses (содержание дел
   и паромов, страховка дел) — в `expenses.total`. **Свобода любого игрока** (freedomRatio, `freedomWeek`, уровни,
   угроза свободы, решения ботов) учитывает его доход архипелага: Тимур-управляющий может стать свободным; капитал
   (`netWorth`, leaderboard) — доли дел по `resaleRate`.
3. **Открытие:** в конце недели, когда свобода человека впервые ≥ `FREEDOM_LEVEL_RATIOS[1]` (1,5) — создать `ArchState`
   (`openWeek` = эта неделя, `seen` = false/false), `report.arch.opened = true`. Миграция **v8 → v9**: `archipelago: null`;
   если сохранение уже на 150%+ (`bestLevel ≥ 2` или текущая свобода ≥ 1,5) — открыть при загрузке. v1…v8 → v9.
   Обновите тесты, ждущие версию 8 (сейчас 11 падают только из-за этого); «чужая версия» в тесте мусора — 10.
4. **Действия** (`types.ts`, раздел «Действия»): `buildRoute`, `buyBusiness` (loan ≤ `BUSINESS_LOAN_SHARE` × цены, мимо
   лимита, обычный кредит движка), `setManager`, `repairBusiness`, `setArchInsurance`, `archSeen`, `deferChoice`;
   `resolveChoice` для partner/bankLoan/bizBuyer. Ошибки — коды `ERROR_CODES` (archClosed, routeBuilt, noRoute,
   businessTaken, businessLimit, notOwner, noDays, managerBusy, loanTooBig, cannotDefer, notEnoughCash…). Только человек.
5. **Развилки** в общем `PendingChoice` (одна за раз вместе с прежними, не чаще прежнего правила): partner
   (`expiresWeek = week + PARTNER_WAIT_WEEKS − 1`, «Подумаю» = `deferChoice`, нерешённая к концу expiresWeek = отказ →
   бот строит сам), bankLoan, bizBuyer (продажа освобождает место). Компания с материка отменяет ждущее партнёрство по
   своему делу. `choiceView` — для трёх новых видов (`crisisRumor` — надёжный слух о кризисе, если есть).
6. **События недели** человека (`GameEvent.id`, params): `archStorm` {business, island, cost}, `archStormInsured`
   {business, island}, `archLoanRepaid` {borrower, amount}, `archLoanLost` {borrower, amount}, `archNeighborBuilt`
   {botId, business}, `archMainlandBuilt` {business}, `archFinale`. Финал — `finaleWeek` и `report.arch.finale`.
7. **`archipelagoView`** — все поля контракта; острова в порядке `ARCH_MAP_ORDER`; `buy.income`, `freedomAfter`,
   `paybackWeeks` — как у карточек сделок; `attention` — по описанию в типах.
8. **Боты и материк** — как в прототипе (Мия — отель, Борис — завод, Тимур — управляющий/заёмщик; `BOT_DELAY` 20,
   `PARTNER_WAIT_WEEKS` 4, материк — `MAINLAND_*`).
9. **Симулятор:** цели и таблицы `scripts/archipelago.ts` (7 стратегий, на действиях движка через `applyAction`)
   переезжают в `npm run sim` (отдельный раздел «Архипелаг», флаг `--arch-seeds`, по умолчанию 300; общий FAIL → код 1).
   Цели — как сейчас, формулировки-запреты; **цель 3** («удача/умение < 1») проверяется у «цепочки», у «курорта» число
   только печатается (владелец принял риск отеля); цель 9 — «без NaN и ошибок действий». `sim:arch`, прототип
   (`proto/archipelago`) и его тест удалите. **Провалившуюся цель не чините и числа не подбирайте — сообщите числа.**
10. **Тесты** (`test/archipelago.test.ts`): открытие на 150% и при загрузке; четвёртое дело и партнёрство при трёх — ошибка;
    бонус набора только при всех трёх долях; материк начинает при трёх делах / через 50 недель, строит раз в 6 недель
    самое дешёвое; partner ждёт 4 недели, deferChoice; строки `arch` складываются в `net`; детерминизм по сиду;
    JSON-сохранение → `migrateWorld` без потерь.

**Проверка:** `npm run -s typecheck`, `npm test`, `npm run sim -- --seeds 100 --arch-seeds 100` (быстрый прогон;
полный делает координатор). Веб (`apps/web`) не трогайте — если тип в вебе ломается, опишите в отчёте.

## Codex 2 — интерфейс

**Файлы:** `apps/web/src/ui/**` (новое — в `ui/arch/`), `apps/web/src/App.tsx`, `apps/web/src/store.ts` (арх-часть:
окна «Архипелаг открыт»/финал, `archSeen`, открытие развилок с учётом `deferred`), `apps/web/src/i18n/index.ts`
(`eventCopy` для `arch*`-событий, ошибки), `apps/web/src/i18n/ru.ts` и `en.ts` — **только блок `arch`** (новые ключи: в
ru — русский текст, в en — та же русская строка-заглушка; перевод сделает Antigravity), `apps/web/src/styles.css`
(новый раздел в конце), `apps/web/src/analytics.ts` (если нужно). **Не трогать** `apps/web/src/scene/**`.

Экран — по archipelago-screen.md: «Путь игрока», переключатель, панель (шапка, плашки наборов, пять карточек, страховка
дел), «Числа», три окна развилок (в `ChoiceModal`, снять заглушку), «Тексты». Всё из `archipelagoView`/`choiceView`/
`financeView` — сами ничего не считайте. Строки отчёта недели и блока финансов (`t.arch.report`), эпилог «Наследие».
Сцене передайте `arch: ArchSceneProps` (готовые `label`, `tone` и т. д.) через тот же путь, что и `items`
(`SceneGuard` → `IslandScene`), `onIslandClick` → `setArchFocus` + раскрыть карточку. Без WebGL — SVG-схема 120 px
в панели (шесть кружков, линии паромов, `ARCH_ICONS`). Телефон: пилюля над ручкой шторки, раскрыта одна карточка,
360 px без горизонтальной прокрутки. Аналитика: `arch-open`, `arch-mode`, `arch-route`, `arch-business-<дело>`,
`arch-set-<набор>`, `arch-finale`. Пока движок (Codex 1, параллельно) не готов, `archipelagoView` возвращает `null` —
пишите по типам; для ручной проверки можно временно подставить данные, но в итог не включать.

**Проверка:** `npm run -s typecheck` (только он: сборку и браузер делает координатор).

## Codex 3 — сцена

**Файлы:** `apps/web/src/scene/**`, кроме `contract.ts` (контракт). Не трогать `ui/**`, `store.ts`, `App.tsx`.

По archipelago-screen.md, «Режим «Архипелаг»»: при `arch.on` — перелёт камеры 1,2 с (`CameraRig`) вверх, родной остров
в центре, пять островов горизонта по кругу, туман дальше; учитывать `sideInsets`/`bottomInset`; обратно — тем же
перелётом; `prefers-reduced-motion` — без полёта. Острова горизонта (`world/Ambient.tsx`, `NEIGHBORS`) в режиме — крупнее;
сопоставьте их с `IslandId` (Пеликан — рыбацкий, Ракушка — пляжи, Маяк — порт, Кедровый — лес, Большой — центр; имена — `ru.ts` `arch.islands`).
Паромы — пунктирная дуга по воде, лодочка раз в несколько секунд; метки над островами (как `FloatLabels`) с `label`,
цветом `tone`, красной точкой при `damaged`; острова без парома бледнее; клик по острову/метке → `onIslandClick`.
`focus` — подлёт за 0,8 с к острову. Пять простых зданий дел (таблица «Здания дел»: из деталей `builders.ts`,
`models/Smokehouse`, `Bungalow`, `Bank`, `world/Shipyard`), крыша по `tone`, участок с колышками, если `!built`,
заплата/дымок при `damaged`, причал с паромом при `route`. Флаг `document.documentElement.dataset.archCamera`
('flying' | 'home' | 'overview' | IslandId). Без `arch` сцена работает как раньше (режим «Мой остров» — без изменений).

**Проверка:** `npm run -s typecheck`.

## Antigravity — английский (после Codex 2)

`apps/web/src/i18n/en.ts`, только блок `arch`: перевести русские заглушки по смыслу `ru.ts` (тон — как остальной en.ts,
имена островов — как в `en.bots`: Seashell, Lighthouse, Pelican; Кедровый — Cedar, Большой — Big Island).
Проверка: `npm run -s typecheck`.
