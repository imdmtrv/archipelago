# Запасной вид без 3D и счётчики сбоев

Ветка `claude/no-webgl`. Проверка перед публикацией (2026-10-14): если в браузере нет WebGL (старый телефон,
рабочий компьютер, выключенное ускорение), `THREE.WebGLRenderer` бросает ошибку при создании контекста, React
снимает всё дерево — **игрок видит белый экран**, а мы об этом не узнаём. Интерфейс игры целиком на DOM, поэтому
без 3D играть можно: остров показываем картинкой.

## Что уже сделано (координатор)

- `apps/web/public/island-still-wide.jpg` (1600×900) и `island-still-tall.jpg` (720×1559) — стартовый остров без
  интерфейса, сняты с сайта в раскладке компьютера и телефона (на телефоне остров смещён вверх, как в игре).

## Задача — Codex

Файлы, которые можно менять: `apps/web/src/App.tsx`, `apps/web/src/analytics.ts`, `apps/web/src/i18n/ru.ts`,
`apps/web/src/i18n/en.ts`, `apps/web/src/styles.css`; новые `apps/web/src/scene/webgl.ts`,
`apps/web/src/scene/SceneGuard.tsx`. Не трогать: `IslandScene.tsx`, `director/*`, движок `packages/engine`.

1. **`scene/webgl.ts`** — `export function webglAvailable(): boolean`: пробует `canvas.getContext('webgl2')`, затем
   `'webgl'`; результат кешируется; пробный контекст освобождается (`WEBGL_lose_context`), если расширение есть.
   Любое исключение → `false`.
2. **`scene/SceneGuard.tsx`** — `export function SceneGuard(props: IslandSceneProps)`, в `App.tsx` заменяет
   `<IslandScene …/>` (пропсы те же):
   - нет WebGL → сразу `<StillIsland />`, сцену не монтировать; `track('no-webgl')` один раз за загрузку страницы;
   - иначе `<IslandScene>` внутри классовой границы ошибок (`getDerivedStateFromError` / `componentDidCatch`);
     поймана ошибка → `<StillIsland />` и `track('scene-error', сообщение до 120 символов)`. Остальной интерфейс
     (HUD, окна, обучение) продолжает работать — граница только вокруг сцены.
   - `StillIsland`: элемент на месте холста — `position: fixed; inset: 0; z-index: 0` (как `.isl-root`), `<picture>`:
     `island-still-tall.jpg` при `(max-aspect-ratio: 1/1)`, иначе `island-still-wide.jpg`; `object-fit: cover`,
     `object-position: center`, `alt=""`, пути через `asset()` из `src/asset.ts` (сайт живёт в `/archipelago/`).
     Фон под картинкой — цвет моря `#2b8a9a`, чтобы до загрузки не было белого.
   - Когда партия начата (`useGame` → `world` не `null`), один раз за загрузку показать
     `useGame.getState().showToast(t.ui.stillIslandNote)`.
3. **`analytics.ts`**: в `AnalyticsEvent` добавить `'no-webgl' | 'scene-error' | 'js-error'`. В `initAnalytics()`
   (после проверки витрин) подписаться на `window` `error` и `unhandledrejection` → `track('js-error', title)`, где
   title — `сообщение · файл:строка` (имя файла без пути и без query), обрезка до 120 символов. Не больше 3 событий
   за загрузку, одинаковые title — один раз. Ничего из ввода игрока (имя, название острова) не отправлять.
4. **Словари**: `ui.stillIslandNote` —
   RU: «В этом браузере нет 3D — остров показан картинкой. Игра работает как обычно.»
   EN: “3D isn't available in this browser, so the island is shown as a picture. The game works as usual.”
5. Карточка «Поделиться» без сцены уже рисует градиент (`captureIsland()` → `null`) — проверить, что путь не бросает.

## Проверка

Исполнитель: `npm run -s typecheck` и `npm run -s build` — без ошибок; `npm test` не должен измениться (238).
Координатор: Playwright по живому сценарию — Edge с `--disable-webgl --disable-3d-apis` (стартовый экран,
«Начать игру», три недели, картинка острова, тост) и обычный Edge на телефоне и компьютере (3D как раньше).
