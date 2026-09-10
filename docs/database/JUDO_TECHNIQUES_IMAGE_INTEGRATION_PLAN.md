# Интеграция изображений техник в public.judo_techniques — план (Этап 2)

Статус: **подготовка завершена, к production НИЧЕГО не применялось**. Этот
документ фиксирует план и mapping, подтверждённые в сессии аудита локальной
папки `C:\VSCode_Projects\100 Technics`.

## Preflight (подтверждён перед подготовкой этого плана)

```
SUPABASE TECHNIQUES: 100
IMAGES SCANNED:      100   (папка "Kihon judo" исключена — отдельный будущий раздел)
MATCHED IMAGES:      100
MISSING IMAGES:      0
AMBIGUOUS MATCHES:   0
DUPLICATE MATCHES:   0
```

Строгий matching (без автоматического fuzzy-matching) + явно подтверждённые
алиасы:
- `UDE-HISHIGI-<X>-GATAME.png` → `<x>-gatame` (8 болевых приёмов — официальное
  полное IJF-название вместо короткого, используемого в `name`)
- `UCHI-MATA-GAESHI.png` → `uchimata-gaeshi` (расхождение слитно/через дефис)

Полный mapping 100/100 — см. `JUDO_TECHNIQUES_IMAGE_PATH_LINK.sql` в этой же
папке (docs/) и `scripts/upload-judo-technique-images.mjs`.

## Архитектурные решения

| Вопрос | Решение | Почему |
|---|---|---|
| Bucket public или private+signed URL | **Public** | Изображения техник не секретны и не привязаны к клубу/студенту (в отличие от `technique-images`/`technique-videos` из club-scoped модуля «Прогресс техник»). Signed URL истекает — противоречит требованию хранить стабильный `image_path`. |
| Что хранить в `judo_techniques` | `image_path text` (путь **внутри** бакета, например `techniques/IPPON-SEOI-NAGE.png`) | Не полный URL, не signed URL — путь стабилен, публичный URL строится на клиенте через `getPublicUrl(image_path)`. |
| Структура объектов в bucket | Один плоский namespace: `judo-techniques/techniques/<ИМЯ_ФАЙЛА>.png` | Локальная структура папок (`Tachi-Waza/5 Kyu/...`) не переносится — центральный каталог не club-scoped. |
| Отдельная таблица соответствий image↔video | **Не создаётся** | `judo_techniques` остаётся единственным источником: одна строка = name + category + main_group + image_path + youtube_url + youtube_video_id. |
| RLS / policies на bucket | Никаких новых policies | Bucket публичный — объекты читаются через публичный Storage URL независимо от RLS. Запись — только `service_role` (как и у `technique-images`/`technique-videos`), insert/update/delete policies для anon/authenticated не добавляются. |

## Файлы, подготовленные в этой сессии

1. **`supabase/migrations/20260910100045_add_judo_techniques_image_path.sql`**
   — `ALTER TABLE public.judo_techniques ADD COLUMN IF NOT EXISTS image_path text`
   (nullable, без default). Не трогает существующие 100 строк.
2. **`supabase/migrations/20260910100046_create_judo_techniques_storage_bucket.sql`**
   — создаёт публичный bucket `judo-techniques`
   (`insert into storage.buckets ... on conflict (id) do nothing`).
3. **`scripts/upload-judo-technique-images.mjs`**
   — локальный Node-скрипт: сканирует `C:\VSCode_Projects\100 Technics`
   (рекурсивно, исключая `Kihon judo`), строит тот же mapping 100/100,
   загружает файлы в `judo-techniques/techniques/`, не перезаписывает
   существующие объекты без флага `--overwrite`, в конце проверяет, что в
   bucket ровно 100 ожидаемых объектов. По умолчанию — dry-run (нужен
   `--apply` для реальной загрузки). Требует `SUPABASE_SERVICE_ROLE_KEY`.
4. **`docs/JUDO_TECHNIQUES_IMAGE_PATH_LINK.sql`**
   — ручной (не миграция) SQL: `UPDATE ... SET image_path` по 100 строкам
   mapping + проверочный блок (100/100 image_path, 100/100 youtube_url,
   100 distinct image_path) + выборочный `SELECT` по обязательным техникам
   из задания. Выполняется вручную в Dashboard SQL Editor **после**
   подтверждения, что upload дал 100/100 в bucket.

## Порядок применения (когда будут credentials — см. ниже)

1. `supabase db push` (или применить вручную через Dashboard) — миграции
   `...045` и `...046`.
2. `SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-judo-technique-images.mjs --apply`
   — проверить вывод: `RESULT: 100/100 objects confirmed`.
3. Выполнить `docs/JUDO_TECHNIQUES_IMAGE_PATH_LINK.sql` в Dashboard SQL
   Editor (ЧАСТЬ 1, затем ЧАСТЬ 2 отдельным запуском) — убедиться в
   `POST_IMAGE_LINK_CHECK: GREEN`.
4. Прогнать post-upload аудит (10+ техник из разных категорий, включая
   обязательные: `ippon-seoi-nage`, `uchi-mata`, `uchimata-gaeshi`,
   `harai-makikomi`, `ashi-gatame`, `juji-gatame`) — запрос уже включён в
   ЧАСТЬ 2 файла выше.

## Что для этого нужно от владельца проекта

**Один из двух вариантов** (см. также раздел "Credentials" в отчёте сессии):

- **Вариант A** — дать `SUPABASE_SERVICE_ROLE_KEY` этого проекта (Dashboard →
  Project Settings → API → `service_role` secret). Заносится **только** в
  `.env.local` (уже в `.gitignore`, Vite не бандлит переменные без префикса
  `VITE_`), никогда не в `.env`/`.env.example`/commit. Тогда шаги 1–4 выше
  может выполнить эта сессия.
- **Вариант B** — владелец сам выполняет шаги 1–4 (миграции через
  `supabase db push` или Dashboard, `node scripts/upload-judo-technique-images.mjs --apply`
  под своей локальной сессией с service_role, SQL вручную в Dashboard).
  Эта сессия только готовит файлы (что уже сделано).

Ни один из вариантов не требует ослаблять RLS, делать bucket
publicly-writable или добавлять широкие policies — запись выполняется
исключительно через service_role, который RLS не подчиняется по
определению.

## Безопасность / что не менялось и не будет меняться

Trainer Auth, Family Auth, Super Admin, `student_technique_records`, RLS
других таблиц, `youtube_url`/`youtube_video_id`/`name`/`category`/
`main_group`/`active` в существующих 100 строках, frontend — не менялись и
не затрагиваются этим планом.
