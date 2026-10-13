# Приёмка: адрес сайта imdmtrv.github.io

Дата: 2026-10-13. Ветка `claude/modest-knuth-axz6jv`, база `main` `4c20e24`.
Бриф: [`docs/specs/site-address.md`](../specs/site-address.md). PR: [#10](https://github.com/imdmtrv/archipelago/pull/10).
Исполнитель — Claude в облачной сессии, а не агент `chat` (решение владельца); см. «Отклонения».

## Изменения

| Файл | Значение |
|---|---|
| `.github/workflows/deploy.yml` | `VITE_SITE_URL: https://imdmtrv.github.io/archipelago/` |
| `apps/web/.env` | `VITE_SITE_URL=https://imdmtrv.github.io/archipelago/` |
| `README.md` / `README.en.md` | `**Играть:** https://imdmtrv.github.io/archipelago/` / `**Play:** https://imdmtrv.github.io/archipelago/en/` |
| `apps/web/src/director/Director.tsx` | `director-end-url`: `imdmtrv.github.io/archipelago` (+ `/en`) |
| `STATUS.md` | ссылки `github.com/dmtrml/archipelago/…` → `github.com/imdmtrv/archipelago/…` |

## Проверки

| № | Результат | Доказательство |
|---|---|---|
| 1 | выполнен | `npm run typecheck`; `npm test` — 141/141; `npm run build`; CI PR #10 зелёный. `git diff --stat main` — только файлы из таблицы, бриф, этот документ, `docs/qa/site-address/*.jpg`, `docs/qa/trailer/draft/*` |
| 2 | выполнен | `git grep -n dmtrml` вне `docs/qa/`, `docs/specs/`, `docs/status-history.md` — пусто |
| 3 | выполнен | Сборка `VITE_BASE=/archipelago/ VITE_SITE_URL=https://imdmtrv.github.io/archipelago/`: `dist/index.html` — `og:url` `https://imdmtrv.github.io/archipelago/`, `og:image` `…/og-image.jpg`; `dist/en/index.html` — `og:url` `…/en/`, `og:image` `…/og-image-en.jpg`; `dmtrml` в `dist` — 0 файлов; адрес есть в `assets/App-*.js` (`share.ts`). `scripts/check-publish.mjs` на `vite preview`: «43 MP3, base /archipelago/, fonts local, loader 13 frames» |
| 4 | выполнен | DOM режиссёра (`?director&shot=end`, вьюпорты рендера 360×640 и 1280×720), таблица ниже; ошибок консоли 0. Встроенные проверки `render.mjs` для `end` (карточка ≥ 2,8 с, нет кириллицы в EN) прошли во всех 6 рендерах |
| 5 | выполнен | Кадры до `end` бит-в-бит прежние (PSNR `inf` на каждом кадре), звук побайтно прежний, `timeline.md` совпадает с прежним по SHA-256; таблица ниже |
| 6 | с отклонением | Технические параметры прежние (таблица ниже). Карточка отрисована на SwiftShader, а не на GPU — см. «Отклонения» |

### Адрес в финальной карточке (DOM, CSS px)

| Вариант | Текст | Прямоугольник l, t, r, b | Высота | До кнопки / до подписи |
|---|---|---|---|---|
| `v30-ru` | `imdmtrv.github.io/archipelago` | 85,5; 427,5; 274,5; 445,1 | 17,6 (одна строка 13px) | 9,8 / 9,8 |
| `v30-en` | `imdmtrv.github.io/archipelago/en` | 75,3; 416,7; 284,6; 434,3 | 17,6 | 9,8 / 9,8 |
| `h45-ru` | `imdmtrv.github.io/archipelago` | 509,2; 488,8; 770,8; 512,3 | 23,5 (одна строка 18px) | 13,8 / подписи нет |
| `h45-en` | `imdmtrv.github.io/archipelago/en` | 495,1; 488,8; 784,9; 512,3 | 23,5 | 13,8 / подписи нет |

Вырезки из новых обложек: [v30-ru](site-address/end-v30-ru.jpg), [v30-en](site-address/end-v30-en.jpg),
[h45-ru](site-address/end-h45-ru.jpg), [h45-en](site-address/end-h45-en.jpg).

## Ролики

Перерисован только кадр `end` (`render.mjs --shots end`); видео до него (кадры 0–799 `v30`, 0–1199 `h45`;
в черновиках 0–399 / 0–599) и дорожка AAC скопированы из прежних GPU-роликов без перекодирования.
Склейка — тем же `concat -c copy`, что и в `render.mjs`: ключевые кадры прежних роликов стоят ровно на начале `end`.
Обложки и листы извлечены из новых MP4 командами `render.mjs`.

| Ролик | Кадры | Длит., с | До `end` = прежние | `end` = новый сегмент | Звук = прежний | LUFS / dBTP | faststart |
|---|---|---|---|---|---|---|---|
| final `v30-ru` | 900 | 30,000 | 800/800 `inf` | 100/100 | да | −14,4 / −2,1 | да |
| final `v30-en` | 900 | 30,000 | 800/800 `inf` | 100/100 | да | −14,4 / −2,1 | да |
| final `h45-ru` | 1350 | 45,000 | 1200/1200 `inf` | 150/150 | да | −14,6 / −2,2 | да |
| final `h45-en` | 1350 | 45,000 | 1200/1200 `inf` | 150/150 | да | −14,6 / −2,1 | да |
| draft `v30-ru` | 450 | 30,000 | 400/400 `inf` | 50/50 | да | −14,3 / −1,1 | да |
| draft `h45-ru` | 675 | 45,000 | 600/600 `inf` | 75/75 | да | −14,4 / −0,9 | да |

Все: H.264 High / yuv420p, финалы 1080×1920 и 1920×1080 при 30 fps, черновики 540×960 и 960×540 при 15 fps,
AAC 48 кГц стерео, декодирование без ошибок. Черновики и листы заменены в `docs/qa/trailer/draft/`
(`timeline.md` не изменился).

### Ассеты `trailer-chat` (SHA-256)

| Файл | SHA-256 |
|---|---|
| `archipelago-v30-ru.mp4` | `7b5a7db780370742925c6649c12d9dcbc29120ea0d0a35d84bc89102583ced4d` |
| `archipelago-v30-en.mp4` | `5ecce9c8b707959c67d2b8ecbb2db5681d5f92d7db9755814d07b262a9bde5d2` |
| `archipelago-h45-ru.mp4` | `1a5d1f46c38a5a72bffe2dfaf1ca7693d89660acfad6542bdf9888dccb9ccdfa` |
| `archipelago-h45-en.mp4` | `65ee9f1f3ead3e0ddf4a4f3a7c5232e20f636a86d23c70801fad2e9bbafd7f02` |
| `cover-v30-ru.jpg` | `bdbb83fe929ced0dd1fe87c9225da6b3ecb805b057fa88aa0b5772c895e71525` |
| `cover-v30-en.jpg` | `6d57bee57339cdb4fa7f6dca772460b21d89b006ed0379ea983dcd57adccf6d2` |
| `cover-h45-ru.jpg` | `9ec557cf651b63575919bc0359532a5e4515fe1a64fb83ca5f17a10d87f97ffa` |
| `cover-h45-en.jpg` | `11566e107770ddff7484d5316ad60eaa2763dfb04e2124374bd1777e37cfaf1f` |
| `sheet-v30-ru.jpg` | `b737ab1caa90ed8f5a03a2c93862ab1478bc5d217c333bdd99a53c320cda3ae6` |
| `sheet-v30-en.jpg` | `7ccc8906a915182b96de1f04124847872f3a62c53eff590237bbf81723a67185` |
| `sheet-h45-ru.jpg` | `95c18460aacf44fa35dcca0cfbcdcccee36b5b838bcdd1fc04ee6d65890f71c5` |
| `sheet-h45-en.jpg` | `043570139234fe00254a2983c7622022a0d84e43693c4493e81c2e4f20acad0f` |
| `render-report.json` | `5074ccc131f2f0b03ea8c5274603d8a495ce7f951881cedd4b714832ef9f9675` |
| `timeline.md` | `3b0e4b9e4eae4f1ba8025e957254827a0314622d6a71e424e85c5785a32e8dd6` (без изменений) |

`render-report.json` — прежний отчёт с новыми `probe`/`faststart` и разделом `endShotUpdate`: метод, renderer,
`sourceHash` кадра `end` `90791e17d013bfde9f34d5623484de9ea155870a77584178e90f2cca6a4ae772` (посчитан на Linux;
`hashTree` берёт пути с разделителем ОС, поэтому с хэшами Windows не сравним) и результаты сверки.

## Отклонения

- **Исполнитель и ветка.** Работу сделал Claude в ветке сессии `claude/modest-knuth-axz6jv` вместо агента `chat`
  и ветки `chat/site-address`; бриф — первым коммитом, как требовалось.
- **Рендер без GPU.** В облачном контейнере нет видеокарты: WebGL — SwiftShader. Полный финальный перерендер
  на нём остановился на встроенной проверке `scam-pays` («two +213 labels not visible at beats 0.5 and 2.0»):
  непрозрачность «+213» на SwiftShader скачет (1 → 0,06 → 0,47 → 1 по соседним кадрам), то есть кадр сломался бы.
  К правке адреса это не относится. Поэтому перерисован только `end`, остальное взято из прежних GPU-роликов
  бит-в-бит (проверка 5). Карточка `end` на SwiftShader отличается от GPU-версии лишь сглаживанием краёв
  (PSNR вне строки адреса 38,7 дБ на пробном кадре; глазом не видно).
- **Проверки 4–5** выполнены сравнением с эталоном, скачанным из релиза до замены (SHA-256 14/14 с `digest`).

## Не сделано

- Загрузка ассетов в пре-релиз `trailer-chat` из облачной сессии невозможна: прокси GitHub API принимает только
  JSON-тела. Ассеты готовы (SHA-256 выше); загрузка и сверка `digest` выполняются отдельно.
