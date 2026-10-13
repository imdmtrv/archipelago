# Адрес сайта: imdmtrv.github.io

Исполнитель: агент, сделавший ролики (`chat`). Проверяющий: Claude. Один PR из новой ветки `chat/site-address`
от свежего `main` (`4c20e24`, в нём слиты PR #8 и #9). **Режим одного прохода** из
[launch.md](launch.md#режим-одного-прохода): без остановок и вопросов, неясное — по таблице запасных вариантов
с записью в отчёт.

**Менять только то, что перечислено.** Код игры, стили, `fixtures.json`, скрипты рендера не трогать.

## Что не так сейчас

Репозиторий перенесён: `dmtrml/archipelago` → **`imdmtrv/archipelago`**. Сайт будет по адресу
**`https://imdmtrv.github.io/archipelago/`**, а в сборке, README и финальной карточке ролика вписан старый
`dmtrml.github.io/archipelago`. Pages ещё не включены.

## Подготовка

1. `git remote set-url origin https://github.com/imdmtrv/archipelago.git`; `git fetch origin`;
   ветка `chat/site-address` от `origin/main` = `4c20e24`.
2. `gh repo set-default imdmtrv/archipelago`; во всех вызовах `gh` явно `--repo imdmtrv/archipelago`.
   Права на запись: `gh api repos/imdmtrv/archipelago --jq .permissions.push` → `true`.
3. **До рендера** сохранить текущие финалы как эталон «до»: скачать 4 MP4, 4 обложки и `timeline.md`
   из пре-релиза `trailer-chat` в `.trailer/out/final-before/` и сверить SHA-256 с полем `digest` ассетов
   (`gh api repos/imdmtrv/archipelago/releases/tags/trailer-chat`). Локальную `.trailer/out/final/` эталоном не считать:
   рендер её перезапишет.

## Что поменять

| Файл | Было | Стало |
|---|---|---|
| `.github/workflows/deploy.yml` | `VITE_SITE_URL: https://dmtrml.github.io/archipelago/` | `VITE_SITE_URL: https://imdmtrv.github.io/archipelago/` |
| `apps/web/.env` | `VITE_SITE_URL=https://dmtrml.github.io/archipelago/` | `VITE_SITE_URL=https://imdmtrv.github.io/archipelago/` |
| `README.md` | `**Играть:** https://dmtrml.github.io/archipelago/` | `**Играть:** https://imdmtrv.github.io/archipelago/` |
| `README.en.md` | `**Play:** https://dmtrml.github.io/archipelago/en/` | `**Play:** https://imdmtrv.github.io/archipelago/en/` |
| `apps/web/src/director/Director.tsx`, `director-end-url` | `dmtrml.github.io/archipelago{…'/en'…}` | `imdmtrv.github.io/archipelago{…'/en'…}` — только имя, без `https://`, суффикс `/en` как есть |
| `STATUS.md` | ссылки `https://github.com/dmtrml/archipelago/…` (релиз `trailer-chat`, PR #9, #6, #7) | `https://github.com/imdmtrv/archipelago/…` |

**Не трогать:** старые отчёты в `docs/qa/` (кроме перерендеренных черновиков в `docs/qa/trailer/draft/`),
`docs/status-history.md` (совсем, даже новую запись не добавлять), остальные спецификации в `docs/specs/`,
стили карточки (`director.css`).

## Проверки (выполнить и записать в документ приёмки)

1. `npm run typecheck`, `npm test`, `npm run build` проходят. `git diff --stat main` — только файлы из таблицы,
   этот бриф, `docs/qa/site-address.md` с картинками в `docs/qa/site-address/` и `docs/qa/trailer/draft/*`.
2. `git grep -n dmtrml` — совпадения остаются только в `docs/qa/`, `docs/specs/` и `docs/status-history.md`.
3. **Сборка для Pages** с `VITE_BASE=/archipelago/` и `VITE_SITE_URL=https://imdmtrv.github.io/archipelago/`:
   - `dist/index.html`: `og:url` = `https://imdmtrv.github.io/archipelago/`,
     `og:image` = `https://imdmtrv.github.io/archipelago/og-image.jpg`;
   - `dist/en/index.html`: `og:url` = `https://imdmtrv.github.io/archipelago/en/`,
     `og:image` = `https://imdmtrv.github.io/archipelago/og-image-en.jpg`;
   - в `apps/web/dist/` нет строки `dmtrml` ни в одном файле; адрес `imdmtrv.github.io/archipelago/` есть в JS
     (ссылка «Поделиться» из `share.ts`);
   - `scripts/check-publish.mjs` на `vite preview` проходит, как в этапе 1 (43 MP3, маршруты, шрифты без 404).
   - То же для обычного `npm run build` (значение из `apps/web/.env`).
4. **Финальная карточка**, все четыре варианта (`v30`/`h45` × RU/EN): текст ровно `imdmtrv.github.io/archipelago`
   (RU) и `imdmtrv.github.io/archipelago/en` (EN); в DOM режиссёра `.director-end-url` — одна строка
   (высота = одной строке), целиком в кадре, не пересекает `.director-end-cta` и `.director-end-bio`.
   Записать прямоугольники. Проверку делать временной командой, в репозиторий её не добавлять.
5. **Остальное не изменилось.** Сравнить новые финалы с эталоном «до»:
   - границы кадров в новом `timeline.md` совпадают с прежним;
   - покадровый PSNR (`ffmpeg … psnr`) кадров до начала `end` (`v30`: 0–799, `h45`: 0–1199) — минимум ≥ 40 дБ;
     записать минимум, среднее и число кадров с `inf`;
   - на обложках разница с прежними — только в строке адреса (вычесть кадры, `blend=difference` + `bbox`,
     записать прямоугольник разницы);
   - громкость и истинный пик каждого финала отличаются от прежних (`−14,4…−14,6 LUFS`, `−2,2…−2,1 dBTP`)
     не больше чем на 0,1.
6. Технические параметры финалов и детерминированная проба — как раньше: проверки `render.mjs` проходят,
   рендер на GPU (ANGLE / NVIDIA, не SwiftShader).

## Результат

- Перерендерить все четыре финала (`npm run trailer -- --quality final`) и оба русских черновика
  (`npm run trailer`). Листы-раскадровки и обложки — из финальных MP4, как сейчас.
- Заменить черновики в `docs/qa/trailer/draft/` (2 MP4, 2 листа, `timeline.md`).
- Заменить все 14 ассетов пре-релиза `trailer-chat` в `imdmtrv/archipelago`
  (`gh release upload trailer-chat … --clobber --repo imdmtrv/archipelago`) и сверить SHA-256 локальных файлов
  с `digest` ассетов — 14/14. В описании релиза обновить `sourceHash`, ссылку на приёмку и указать новый адрес
  в финальной карточке.
- Документ приёмки `docs/qa/site-address.md`: результаты всех проверок с командами и ключевым выводом,
  окружение и время рендера, `sourceHash`, таблица SHA-256 14 ассетов, «Отклонения», «Не сделано».
  Вырезки финальной карточки из четырёх новых обложек — `docs/qa/site-address/end-<формат>-<язык>.jpg`,
  JPEG до 150 КБ каждая.
- `STATUS.md`: frontmatter, «Сейчас», «Следующие шаги», «Блокеры», «Последнее сделанное» — по новому состоянию.
  Нынешний текст «Сейчас» про аферу перенести в «Историческая запись по объединённому PR #9» (ссылки — на imdmtrv).
  Следующий шаг — владелец включает Pages, PR слит, деплой и проверка живого сайта.
- Коммиты: первым — этот бриф без изменений в `docs/specs/site-address.md`; затем один коммит на крупный шаг
  («Адрес: …»), `push` после каждого. В конце — черновой PR в `main` репозитория `imdmtrv/archipelago`
  «Адрес сайта: imdmtrv.github.io».

## Критерии приёмки (по ним проверяет Claude)

1. Всё из раздела «Проверки» выполнено и подтверждено в документе приёмки.
2. Claude сам скачивает ассеты `trailer-chat` и сверяет с эталоном «до»: в финальной карточке всех четырёх роликов
   и на обложках — `imdmtrv.github.io/archipelago` / `…/en`, в одну строку; кадры до `end` не изменились;
   SHA-256 ассетов совпадают с документом приёмки.
3. Сборка ветки с `VITE_BASE=/archipelago/` даёт полные адреса `https://imdmtrv.github.io/archipelago/…` в превью ссылок
   и не содержит `dmtrml`.
