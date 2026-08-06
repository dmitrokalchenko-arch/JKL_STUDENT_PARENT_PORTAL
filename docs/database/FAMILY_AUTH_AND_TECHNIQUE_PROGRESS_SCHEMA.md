# Family Auth + «Прогресс техник» — схема этапа 2

Статус: **SQL написан и адаптирован под реальные типы (этап 2.2), ни одна
миграция не применена ни к одной базе, включая локальную.** В этой сессии
нет Supabase CLI, ключей и подключения — только файлы. Перед применением
обязателен локальный прогон (`docs/database/LOCAL_SUPABASE_TEST_PLAN.md`),
затем ручное применение пользователем (`supabase db push` или Dashboard
SQL Editor) на **той же базе, что использует живой `JCL_Gruppen`** (решение
подтверждено пользователем в этой сессии).

## Аудит этапа 2.2 (реальная схема подтверждена, миграции адаптированы)

Диагностический скрипт выполнен пользователем в реальном Dashboard
`JCL_Gruppen` (20.07.2026). Главный блокер этапа 2.1 закрыт — реальные типы
подтверждены и **сильно отличаются** от предположений всех 7 миграций.
Интересный поворот: пользователь в задании на этап 2 указывал `clubs.id`
как проверяемую колонку, а `EXISTING_DATABASE_AUDIT.md` (на основе анализа
кода) утверждал, что PK — именно `clubs.club_id`. Диагностика показала, что
**прав был пользователь**: реальный PK `clubs` — это `id` (uuid), а
`club_id` — отдельная text-колонка (slug). `EXISTING_DATABASE_AUDIT.md`
исправлен (раздел 5.3 и реестр таблиц) с явной пометкой, что было не так.

### Подтверждённые реальные типы

| Колонка | Было предположено (этап 2) | Подтверждено диагностикой (этап 2.2) |
|---|---|---|
| `clubs.id` | не использовался | `uuid`, реальный PK |
| `clubs.club_id` | `uuid`, ошибочно считался PK | `text` (slug, напр. `'jcl'`), NOT NULL, UNIQUE не подтверждён |
| `students.id` | `uuid` | `bigint`, реальный PK, БЕЗ автогенерации |
| `students.club_id` | не проверялся | `text`, NOT NULL, default `'jcl'` |
| `students.kyu_grad` | считался числом | `text` |
| `students.guertelfarbe` | `text` (совпало) | `text` |
| `trainers.id` | не использовался | `bigint`, реальный PK |
| `trainers.trainer_id` | `uuid`, ошибочно считался PK | `text`, NOT NULL, НЕ PK |
| `auth.users.id` | `uuid` | `uuid` (совпало) |

### Что адаптировано во всех файлах

- `club_id` — теперь `text` везде (было `uuid`). Поскольку `clubs.club_id`
  не подтверждён как `UNIQUE`, формальный `FOREIGN KEY` на него невозможен —
  вместо этого добавлена функция `family_club_exists(p_club_id text)`
  (`SECURITY DEFINER`) и триггеры `enforce_*_club_exists` на каждой таблице
  с собственным `club_id` (`families`, `club_belts`,
  `club_technique_progress_settings`, `club_techniques`) — та же гарантия
  целостности, что давал бы `FOREIGN KEY`, без необходимости в уникальном
  индексе.
- `student_id` — теперь `bigint` везде (было `uuid`), с настоящим
  `FOREIGN KEY` на `students(id)` (это реальный PK, ссылка корректна).
- `student_technique_progress.completed_by` — теперь ссылается на
  `trainers(id)` (`bigint`), а не на `trainers(trainer_id)` (той колонки
  как PK не существует).
- Сигнатуры функций: `can_family_access_student`, `get_student_technique_progress`,
  `resolve_student_current_belt` — параметр `p_student_id` стал `bigint`.
  `family_login_email`, `is_family_in_club` — параметр `p_club_id` стал
  `text`.
- Storage RLS: путь `{club_id}/{student_id}/...` — первый сегмент больше не
  приводится к `::uuid` (остаётся `text`), второй сегмент приводится к
  `::bigint` (было `::uuid`).
- `seed.sql` — `club_id` теперь читаемый slug (`'jkl-test-seed'`, не
  выдуманный uuid), `student_id` — заведомо большая bigint-константа
  (`900000000001`), `kyu_grad` вставляется как текст (`'5'`, не число).
  `clubs.club_id` не подтверждён `UNIQUE`, поэтому `ON CONFLICT (club_id)`
  заменён на явную проверку `EXISTS` перед `INSERT`.
- `local_test_fixtures.sql` / `rls_scenarios.sql` — те же типы, plus
  переключение роли теперь через `SET LOCAL ROLE` вместо `set_config('role', ...)`.
- **Повторный аудит после адаптации** нашёл и исправил один новый пробел:
  у новой функции `family_club_exists` не было `revoke ... from public` —
  тот же класс проблемы, что раньше был у `normalize_family_nickname`/
  `family_login_email` (Postgres по умолчанию даёт `EXECUTE` роли `PUBLIC`).
  Исправлено. Остальные находки этапа 2.1 (nickname enumeration, прямой
  доступ к `resolve_student_current_belt`, mock в production) остались
  исправленными — рёфакторинг типов их не затронул и не отменил.

### Побочная находка: RLS в JCL_Gruppen существует, но крайне открыт

Диагностика показала: `rowsecurity = true` на `students`/`trainers` (на
`clubs` — `false`). Но действующие policies дают
`SELECT`/`INSERT`/`UPDATE`/`DELETE` ролям `public`/`anon` с `qual = true` —
фактически без ограничений. Это соответствует практическому выводу
исходного аудита («доступ не ограничен»), хотя формулировка «RLS не
обнаружен» была неточной — RLS технически включён, просто политики ничего
не запрещают. **Это особенность чужой продакшн-системы, не входит в задачи
этого портала и не изменяется** — зафиксировано для полноты картины в
`docs/database/EXISTING_DATABASE_AUDIT.md`.

По этой же причине несколько триггерных функций, которые проверяют
целостность через `SELECT` из `students` (например
`enforce_family_student_club_match`), теперь помечены `SECURITY DEFINER` —
чтобы гарантии целостности **не зависели** от того, насколько открыты
(или в будущем закрыты) политики `students` у `JCL_Gruppen`.

### Статус блокера

**Закрыт.** Типы подтверждены, все 7 миграций, `seed.sql` и тестовые
скрипты адаптированы. Локальный прогон (`supabase db reset` + тестовые
сценарии) по-прежнему **не выполнялся** — нет Supabase CLI/Docker в этой
сессии, это следующий шаг для пользователя.

## Аудит этапа 2.1 (безопасность и готовность к применению)

Полный статический аудит всех файлов из этапа 2. Ничего не применялось к
реальной базе — только чтение кода и SQL. Ниже: главный блокер, найденные и
исправленные проблемы безопасности, проверенные-и-безопасные места, итоговый
порядок применения, ручные действия.

### Главный блокер: типы существующих ключей не подтверждены

`docs/database/EXISTING_DATABASE_AUDIT.md` прямо пометил типы колонок
`clubs`/`students`/`trainers` как 🔴 «требует проверки в Dashboard» — аудит
подтвердил только НАЗВАНИЯ колонок по их использованию в коде `app.js`
(`.eq('id', ...)` и т.п.), никогда не подтверждал реальные Postgres-типы.
**Все 7 миграций написаны в предположении, что `clubs.club_id`,
`students.id` и `trainers.trainer_id` имеют тип `uuid`.** Если это не так
(например, `bigint`/`integer`/`serial` — обычная практика для админ-систем
такого возраста), внешние ключи в миграциях 1, 2, 4, 6, 7 не создадутся —
Postgres не позволяет FK между несовместимыми типами.

Это **не исправлено вслепую** — угадывать тип без подтверждения запрещено
прямым указанием пользователя (пункт 4 задания: «не делать предположений о
названиях и типах, если они не подтверждены аудитом»). Вместо этого создан
диагностический скрипт:
`supabase/diagnostics/check_existing_column_types.sql` (только `SELECT` из
`information_schema`/`pg_catalog`, безопасен для запуска в реальном
проекте). **Обязательно выполнить его первым**, до любой миграции — см.
`docs/database/LOCAL_SUPABASE_TEST_PLAN.md`, шаг 0.

Также обнаружено расхождение с заданием: пользователь указал `clubs.id` как
проверяемую колонку, но аудит `JCL_Gruppen` подтвердил PK именно как
`clubs.club_id` (не `clubs.id`) — все миграции используют `club_id`,
согласовано с аудитом, а не с текстом задания. Диагностический скрипт (блок
2) отдельно проверяет реальное имя PK на случай, если и это устарело.

### Найденные и исправленные проблемы

| # | Файл | Проблема | Исправление |
|---|---|---|---|
| 1 | `20260720120002_family_auth_helpers.sql` | **Nickname enumeration**: `resolve_family_login_email` проверяла существование активной семьи и возвращала `null`, если её нет — анонимный вызывающий мог перебором nickname узнавать, какие семьи существуют в клубе, без пароля. | Функция больше не проверяет существование семьи — email строится детерминированно для любого nickname; несуществующий аккаунт даёт тот же результат на следующем шаге (`signInWithPassword` → generic-ошибка), что и неверный пароль. |
| 2 | `20260720120002_family_auth_helpers.sql` | `normalize_family_nickname` и `family_login_email` не имели `revoke`/`grant` вовсе — Postgres по умолчанию даёт `EXECUTE` роли `PUBLIC` для новых функций. | Добавлен `revoke all ... from public` на обе функции — прямой вызов с `anon`/`authenticated` больше невозможен; внутренние вызовы (через `resolve_family_login_email`, через `service_role` в Edge Function) продолжают работать. |
| 3 | `20260720120006_technique_progress_rpc.sql` | `resolve_student_current_belt` была `grant`нута `authenticated` напрямую, но **не проверяла `can_family_access_student`** — любой авторизованный пользователь мог вызвать её для ЧУЖОГО `student_id` и узнать его текущий пояс. | Прямой `grant ... to authenticated` убран. Функция остаётся вызываемой только изнутри `get_student_technique_progress` (уже проверяет доступ до её вызова) — внутренний вызов работает независимо от grant'ов. |
| 4 | `src/services/supabaseClient.js` | Отсутствие `VITE_SUPABASE_*` приводило только к `console.warn` и mock-fallback — **в production-сборке без настроенного `.env` приложение молча показало бы тестовые данные (Leon/Anna) реальным пользователям.** | Добавлена проверка `import.meta.env.PROD`: в production при отсутствии переменных модуль бросает исключение при загрузке (громкий сбой конфигурации), а не тихий mock. В dev-режиме поведение не изменилось. |
| 5 | `supabase/functions/create-family-account/index.ts` | Уникальность nickname проверялась только через constraint `families` **после** создания `auth.users` — рабочее, но лишнее создание-и-откат auth-пользователя на каждую попытку с занятым nickname. | Проверка уникальности вынесена перед созданием `auth.users` (ранний `409 nickname_already_taken`); `createUser`-ошибка `already registered` тоже теперь возвращает `409`, а не общий `500`. |
| 6 | `supabase/functions/create-family-account/index.ts` | `ADMIN_FUNCTION_SECRET` — один общий секрет на все клубы; `clubId` берётся из тела запроса без проверки, что вызывающий действительно управляет именно этим клубом. | **Не устранено кодом** (требует ещё не построенной модели «администратор клуба X» — этап 4) — явно задокументировано предупреждение прямо в файле: секрет должен выдаваться только доверенным операторам уровня платформы (аналогично `JCL_Gruppen.super_admins`), не персоналу отдельных клубов. |

### Проверено — проблем не обнаружено

- **SECURITY DEFINER без search_path**: все 5 функций (`resolve_family_login_email`,
  `can_family_access_student`, `is_family_in_club`, `resolve_student_current_belt`,
  `get_student_technique_progress`) имеют `set search_path = public`, и все
  обращения к таблицам внутри них написаны с явным префиксом `public.` —
  классическая атака через `pg_temp`-подмену объектов невозможна, так как
  ничего не резолвится неявно.
- **Циклические policy**: все RLS-helper'ы (`can_family_access_student`,
  `is_family_in_club`) — `SECURITY DEFINER`, их внутренние запросы не
  проходят через RLS вызывающей policy повторно → рекурсия структурно
  исключена.
- **Отсутствие `WITH CHECK`**: не применимо — ни для одной таблицы не
  создано ни одной `INSERT`/`UPDATE` policy для `authenticated` вообще (все
  policy — только `for select`). Запись для семьи невозможна в принципе, а
  не «возможна без проверки».
- **Signed URL для чужого файла**: storage-policy проверяет
  `can_family_access_student`/`is_family_in_club` от **вызывающего**, а не
  от пути, который он подставил — угадывание чужого пути ничего не даёт,
  проверяется реальная связь семьи с учеником.
- **Публичный доступ к bucket**: оба bucket'а созданы с `public: false`.
- **Произвольная запись пути в Storage**: нет ни одной `insert`/`update`/
  `delete` storage-policy для `authenticated` — запись невозможна вообще,
  только через `service_role`.
- **Ребёнок в семьях разных клубов**: структурно исключено триггером
  `enforce_family_student_club_match` — `family_students.club_id` обязан
  совпадать и с `families.club_id`, и со `students.club_id` для каждой
  строки.
- **`bonusRequirement < 1`**: запрещено `CHECK`-constraint на обеих
  таблицах настроек.
- **completed > bonusRequirement**: `getEmptySlotCount()` использует
  `Math.max(bonusRequirement - completedCount, 0)` — не уходит в минус, UI
  не падает.
- **Удаление техники с историей**: `on delete restrict` на
  `student_technique_progress.technique_id` и `club_belt_techniques.technique_id`
  — удалить технику, у которой уже есть прогресс или которая используется в
  программе пояса, физически невозможно без явного отвязывания сначала.
- **Каскады**: пройдены построчно — удаление guardian не трогает
  семью/детей; удаление семьи каскадно чистит только её
  `family_guardians`/`family_students` (не `students`); удаление `students`/
  `club_techniques`/`club_belts` заблокировано (`restrict`), если есть
  связанные записи — осознанный консервативный выбор, не забытый каскад.
- **Password logging / service_role в браузере**: не найдено — пароль не
  логируется нигде в Edge Function; `SERVICE_ROLE_KEY` встречается только в
  Deno-коде функции, ни разу в `src/`.

### Итоговый порядок безопасного применения

1. Выполнить `supabase/diagnostics/check_existing_column_types.sql` в
   реальном проекте (только чтение). Если типы `clubs.club_id`/`students.id`/
   `trainers.trainer_id` — не `uuid`, поправить FK-колонки в миграциях 1, 2,
   4, 6, 7 под реальные типы, не запускать миграции до этого.
2. Полный локальный прогон по `docs/database/LOCAL_SUPABASE_TEST_PLAN.md` —
   `db reset`, фикстуры, тестовые auth-пользователи, `rls_scenarios.sql`
   (A-G), API/curl-тесты (nickname enumeration, H). Все сценарии должны
   пройти на локальной базе.
3. Только после этого — по отдельному подтверждению пользователя —
   `supabase link` к реальному проекту и применение миграций (`db push` или
   вручную через Dashboard SQL Editor, миграции 1→7 по порядку номеров).
4. `supabase functions deploy create-family-account` +
   `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... ADMIN_FUNCTION_SECRET=...`.
5. Настроить `.env` фронтенда (`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`)
   сначала для staging/тестового окружения, не сразу для production.

### Ручные действия пользователя в Supabase Dashboard

- Подтвердить реальные типы ключей (диагностический скрипт, шаг 1 выше).
- Storage → bucket settings: вручную задать MIME-типы и лимиты размера для
  `technique-images`/`technique-videos` (SQL их не задаёт — см.
  `20260720120007_technique_progress_storage.sql`).
- Project Settings → Edge Functions → Secrets: `supabase secrets set` для
  `SUPABASE_SERVICE_ROLE_KEY`/`ADMIN_FUNCTION_SECRET`.
- Решить, кто получает `ADMIN_FUNCTION_SECRET` — только доверенные операторы
  платформы, не персонал отдельных клубов (см. предупреждение в
  `create-family-account/index.ts`).
- Заполнить `.env` фронтенда для целевого окружения (не коммитить).

### Разбор по каждой миграции

| Миграция | Назначение | Создаёт | Зависимости | Риск для production | Обратимость | Destructive | Ручные действия |
|---|---|---|---|---|---|---|---|
| `...0001_create_family_layer` | Family-слой: семья, опекуны, связь с учеником | 3 таблицы, 6 индексов, `set_updated_at()` + `family_club_exists()` + 6 `enforce_*`/триггер-функций | `clubs.club_id` (text, без hard FK — проверка через `family_club_exists`), `students.id` (bigint, hard FK), `auth.users.id` (uuid, hard FK) — типы подтверждены этапом 2.2 | Низкий — типы подтверждены, FK корректны | Полная — `drop table families, family_guardians, family_students cascade` + `drop function`; существующие таблицы не менялись | Нет | Нет |
| `...0002_family_auth_helpers` | Nickname↔email, RLS-helper'ы | 5 функций (`family_club_exists` тоже здесь используется, определена в 0001) | Миграция 1, `clubs.club_short_name`/`active` | Устранено (было: nickname enumeration, PUBLIC-доступ на 3 функциях) | Полная — `drop function` | Нет | Нет |
| `...0003_family_layer_rls` | RLS для family-слоя | `enable row level security` x3, 3 `select`-policy | Миграции 1-2 | Низкий — read-only, запись для authenticated в принципе невозможна | Полная — `drop policy` + `disable row level security` | Нет | Нет |
| `...0004_create_technique_progress_schema` | Схема модуля техник | 6 таблиц, 10 индексов, 6 `updated_at`-триггеров, 6 `enforce_*`/`club_exists` триггер-функций | `clubs.club_id` (text, без hard FK), `students.id` (bigint, hard FK), `trainers.id` (bigint, hard FK — не `trainer_id`) — типы подтверждены этапом 2.2 | Низкий — типы подтверждены, FK корректны | Полная — `drop table ... cascade` | Нет | Нет |
| `...0005_technique_progress_rls` | RLS для модуля техник | `enable row level security` x6, `is_family_in_club()`, 6 `select`-policy | Миграции 2, 4 | Низкий — read-only; тренер/админ доступа нет вообще (осознанно, этап 3) | Полная | Нет | Нет |
| `...0006_technique_progress_rpc` | Единая точка чтения для семьи | `resolve_student_current_belt()`, `get_student_technique_progress()` | Миграции 4, 5 | Устранено (было: прямой доступ к чужому `student_id` через `resolve_student_current_belt`) | Полная | Нет | Нет |
| `...0007_technique_progress_storage` | Bucket'ы + Storage RLS | 2 записи в `storage.buckets`, `enable row level security` на `storage.objects` (обычно уже включена платформой — идемпотентно), 2 policy | Миграции 2, 5; схема `storage` управляется платформой Supabase | Низкий; MIME/размер файла не заданы SQL-ом | Policy — обратимы (`drop policy`); удаление bucket'ов — отдельное ручное решение (не включено, чтобы не задеть уже загруженные файлы) | Нет (создание bucket, не файлов) | Настроить MIME/size limit в Dashboard |
| `seed.sql` | Тестовые данные (только `db reset` локально) | 1 клуб, 1 ученик, 16 техник, 5 completed | Миграции 1-7 | Не должен попасть на production ни при каких обстоятельствах — см. предупреждения в самом файле | Полная (локальная эфемерная база) | **Может быть деструктивным, если по ошибке выполнен на реальном проекте** — записывает вымышленного клуба/ученика | Не выполнять в Dashboard реального проекта |
| `functions/create-family-account` | Создание семьи+guardian+auth.users | auth.users, families, family_guardians, (опц.) family_students | Миграции 1-2, `service_role`, `ADMIN_FUNCTION_SECRET` | `clubId` не проверяется против личности вызывающего (задокументировано, не устранено — этап 4) | Best-effort откат при частичном сбое (реализован) | Создаёт реальных пользователей — деплой и секреты только осознанно | `supabase functions deploy` + `supabase secrets set` |

Порядок применения миграций 1→7 **обязателен** (более поздние ссылаются на
объекты, созданные раньше) — Supabase CLI применяет их по алфавиту имени
файла, поэтому порядковый префикс в названии уже это гарантирует.

## 0. Почему это шире, чем «просто техники»

Первоначальное задание касалось только модуля «Прогресс техник». Аудит
(`docs/database/EXISTING_DATABASE_AUDIT.md`) показал, что family-слой
(`family_accounts`/`family_students` из
`docs/database/FAMILY_ACCOUNT_DATA_MODEL_DRAFT.md`) существует только как
концепция — ни одной таблицы, ни Supabase Auth для семьи, ни RLS-политик
нигде в системе физически нет. Пользователь подтвердил: сначала строим
family-слой (с Supabase Auth), затем на нём — RLS модуля техник. Обе части
сделаны в этой задаче.

## 1. Family-слой (первое использование Supabase Auth в проекте)

Миграции: `20260720120001_create_family_layer.sql`,
`20260720120002_family_auth_helpers.sql`,
`20260720120003_family_layer_rls.sql`.

- `families` — сама семья. `nickname` уникален **в пределах `club_id`**, не
  глобально (мультиклубная платформа).
- `family_guardians` — один `auth.users.id` = один родитель/опекун одной
  семьи. Пароль хранится и проверяется только Supabase Auth — нигде в
  `public`-схеме пароль/хэш не хранится.
- `family_students` — связь семьи с существующим `students.id`
  (`JCL_Gruppen`), не копирует данные ученика. Максимум 2 активные записи на
  `student_id` — обеспечено триггером (`BUSINESS_RULES.md`, правило 24).
- Технический вход: `family_login_email(club_id, nickname)` строит
  `family_<clubId>_<normalizedNickname>@internal.jkl` — не показывается
  пользователю. `resolve_family_login_email(club_short_name, nickname)` —
  публичный RPC, который семья вызывает, чтобы получить email для
  `signInWithPassword()`.
- `can_family_access_student(student_id)` / `is_family_in_club(club_id)` —
  единые helper-функции, переиспользуются во всех RLS-политиках этого и
  следующего модуля — не дублируем JOIN'ы в каждой policy.
- RLS: семья может только **читать** свои `families`/`family_guardians`/
  `family_students`. Создание/изменение — не входит в этот этап (делает
  клуб/сотрудник через service role, до появления административного
  интерфейса на этапе 4).

### Явное допущение, требующее отдельного решения (не архитектурный блокер)

Экран входа ещё не имеет визуального ТЗ. Вход технически требует
**клуб + ник + пароль** (клуб — через `clubs.club_short_name`), потому что
ник уникален только внутри клуба, а портал — мультиклубный. Если у продукта
на самом деле один клуб на инстанс/поддомен — это можно упростить позже без
переделки схемы (просто зашить `club_short_name` на фронтенде).

## 2. Модуль «Прогресс техник»

Миграции: `20260720120004_create_technique_progress_schema.sql`,
`20260720120005_technique_progress_rls.sql`,
`20260720120006_technique_progress_rpc.sql`,
`20260720120007_technique_progress_storage.sql`.

### Таблицы

| Таблица | Назначение |
|---|---|
| `club_belts` | **Новая** — club-scoped справочник поясов. НЕ заменяет `students.guertelfarbe/kyu_grad`. |
| `club_technique_progress_settings` | Одна запись на клуб — глобальный (для модуля) `feature_enabled` + дефолтный `bonus_requirement`. |
| `club_techniques` | Каталог техник клуба. Без UNIQUE(name) — по прямому указанию задания. |
| `club_belt_techniques` | Набор техник конкретного пояса. |
| `club_belt_technique_settings` | Опциональное переопределение bonus/feature_enabled для конкретного пояса (Вариант A из задания). |
| `student_technique_progress` | **Только `completed`.** Отсутствие строки = required. |

### Решение по нормализации (раздел 6 задания)

Выбран предпочтительный вариант из задания: хранить только подтверждённые
техники. `required` вычисляется как «есть в `club_belt_techniques` текущего
пояса, но нет строки в `student_technique_progress`». Меньше записей, не
нужно массово создавать прогресс при создании программы пояса, изменение
набора техник не расходится с уже проставленными результатами.

### Решение по истории поясов (раздел 7 задания)

`student_technique_progress` связан не только с `student_id`+`technique_id`,
но и с `belt_id` (`unique(student_id, technique_id, belt_id)`). Смена пояса
не удаляет старый прогресс — он просто перестаёт быть «текущим» (текущий
пояс определяется `resolve_student_current_belt()`), но остаётся в истории
под старым `belt_id`. Версионирование программы пояса (snapshot при
изменении набора техник) сознательно не реализовано — задание прямо
разрешило не переусложнять первую миграцию.

### Решение по `belt_id` (важное допущение, не входило в задание буквально)

В `JCL_Gruppen` пояс — свободный текст (`students.guertelfarbe`), без
стабильного id. Создана новая `club_belts` с собственным `uuid`.
`resolve_student_current_belt()` сопоставляет текущий пояс ученика с
`club_belts.name` **по тексту, регистронезависимо** — задокументированный
риск (опечатка/иное написание не совпадёт). Полноценная нормализация
`students` — отдельная задача, требует согласования с владельцем
`JCL_Gruppen` (см. аудит, раздел 11, категория B), не делается здесь.

### RLS

Только семейный read-only доступ (см. `can_family_access_student`/
`is_family_in_club`). **Тренерские и административные policies НЕ
созданы** — тренеры сейчас на PIN-авторизации, не на Supabase Auth,
`auth.uid()` для тренерской сессии не существует физически. Явно
задокументированный будущий шаг (этап 3), не забытая часть задания.

### RPC `get_student_technique_progress(p_student_id)`

Единая точка чтения для семейной страницы. Сама проверяет
`can_family_access_student` — подстановка чужого `student_id` вызывает
`access_denied` (не тихий пустой ответ, чтобы не путать «нет доступа» с
«нет данных»). `featureEnabled=false` или отсутствие программы пояса → пустой
массив техник, не ошибка. Сортировка — по `club_belt_techniques.sort_order`.

### Storage

Bucket'ы `technique-images`, `technique-videos` — оба приватные
(`public=false`). Пути **внутри бакета, без имени бакета как префикса**:

```
club_techniques.image_path            = {club_id}/{technique_id}/{filename}
student_technique_progress.video_path = {club_id}/{student_id}/{progress_id}/{filename}
```

- Изображения — читает любая семья своего клуба (`is_family_in_club`).
- Видео — читает только семья, имеющая доступ к конкретному `student_id`
  (`can_family_access_student`), через `createSignedUrl` с TTL 3600 сек,
  запрашивается фронтендом только при открытии модалки (не заранее для всех
  карточек).
- **Ограничения MIME-типа/размера файла НЕ заданы в SQL** — версия
  Supabase может не поддерживать нужные колонки `storage.buckets` на
  момент применения. Рекомендация для ручной настройки в Dashboard:
  изображения — `image/jpeg`, `image/png`, `image/webp`, до 5 МБ; видео —
  `video/mp4`, `video/webm`, до 200 МБ.
- Загрузка файлов через UI не реализована — не входила в это задание.

## 3. Edge Function `create-family-account`

`supabase/functions/create-family-account/index.ts`. Создаёт
`auth.users` + `families` + `family_guardians` (+ опционально
`family_students`) через service role. Защищена отдельным секретом
`ADMIN_FUNCTION_SECRET` (не anon-ключом) — полноценной админ-роли ещё нет
(этап 4), это ручной/скриптовый процесс сотрудника клуба. Best-effort
откат: если после создания `auth.users` следующий insert падает, функция
удаляет уже созданного auth-пользователя, чтобы не оставлять «повисший»
аккаунт без семьи.

## 4. Frontend

- `src/services/supabaseClient.js` — читает `VITE_SUPABASE_URL`/
  `VITE_SUPABASE_ANON_KEY` из `.env` (см. `.env.example`, `.env` в
  `.gitignore`). Dev mock-fallback с предупреждением в консоль, если
  переменные не заданы — **только в development**; в production-сборке
  (`import.meta.env.PROD`) отсутствие переменных бросает исключение при
  загрузке модуля (аудит этапа 2.1, исправление №4), а не тихо показывает
  mock-данные.
- `src/services/familyAuthService.js` — `signInFamily(clubShortName, nickname, password)`,
  `signOutFamily()`, `getFamilySession()`, `onFamilyAuthStateChange()`.
- `src/hooks/useFamilySession.js` — восстановление сессии при загрузке,
  `isLoading`/`isAuthenticated`.
- `src/App.jsx` — гейт: без Supabase → mock-режим напрямую в Dashboard; с
  Supabase — пока идёт проверка сессии, ничего не показываем; без сессии —
  `FamilyLogin`; с сессией — `FamilyDashboard`.
- `src/pages/family/FamilyLogin.jsx` — минимальный экран входа (клуб/ник/
  пароль). **Визуально не спроектирован** (нет ТЗ/макета) — только
  функциональная реализация по требованиям задания.
- `src/services/techniqueProgressService.js` — `getTechniqueProgress(studentId)`
  (RPC + резолв signed URL для изображений), `getTechniqueVideoUrl(videoPath)`
  (signed URL по клику). Явный mock fallback при отсутствии Supabase.
- `src/hooks/useTechniqueProgress.js` — `{data, isLoading, error, refetch}`,
  игнорирует устаревший ответ при смене ребёнка (номер запроса в `ref`),
  очищает `data` в начале новой загрузки — не показывает технику прошлого
  ребёнка поверх загрузки нового.
- `TechniqueProgressSection.jsx` — добавлены состояния loading/error/empty
  («программа пояса не настроена»), расположение блока, размеры карточек и
  сама структура трёх строк не изменены.
- `TechniqueVideoModal.jsx` — при открытии выполненной техники с видео
  показывает состояние загрузки, пока не пришёл signed URL; логика
  открытия/закрытия (кнопка/Esc/оверлей, блокировка скролла) не изменена.

## 5. Известные ограничения / что не проверено выполнением

- Ничего не применялось к реальной базе — SQL не выполнялся ни разу, даже
  локально (локальный прогон подготовлен, но не запущен — нет Supabase
  CLI/Docker в этой сессии, см. `docs/database/LOCAL_SUPABASE_TEST_PLAN.md`).
- ~~Типы `clubs.club_id`/`students.id`/`trainers.trainer_id` не
  подтверждены~~ — **закрыто этапом 2.2**: типы подтверждены диагностикой
  реальной базы, все миграции адаптированы (см. раздел «Аудит этапа 2.2»
  выше).
- Реальные NOT NULL/constraints таблицы `students` подтверждены только по
  использованию в коде `JCL_Gruppen` (см. аудит) — `supabase/seed.sql` может
  потребовать точечной правки после первой попытки применения.
- Тренерский и административный доступ к модулю техник (RLS, интерфейс) —
  не реализованы, ждут этапа 3 и решения по тренерской аутентификации.
- Визуальный экран входа семьи не спроектирован (нет ТЗ/макета) — сделана
  только функциональная версия.
- MIME/размер файлов Storage — только рекомендация в документации, не
  enforced в SQL.
- `ADMIN_FUNCTION_SECRET` в Edge Function — один секрет на все клубы,
  `clubId` не проверяется против личности вызывающего (задокументированное,
  не устранённое кодом ограничение — см. «Аудит этапа 2.1»).

## 6. Роадмап (порядок фиксированный)

- **Этап 1** — UI блока «Прогресс техник» + mock-данные. Готово.
- **Этап 2** — модель данных, Supabase Auth для семьи, RLS, сервисный слой,
  интеграция UI. SQL написан.
- **Этап 2.1** — статический аудит безопасности этапа 2, исправление
  подтверждённых проблем, подготовка безопасного применения (диагностика
  типов, локальный тест-план, SQL-тесты RLS). Готово.
- **Этап 2.2** (эта задача) — подтверждение реальной схемы (диагностика
  выполнена пользователем в Dashboard `JCL_Gruppen`), адаптация всех 7
  миграций/seed/тестов под фактические типы, повторный аудит. Готово — SQL
  по-прежнему не применён ни к одной базе, включая локальную (следующий шаг —
  локальный прогон по `LOCAL_SUPABASE_TEST_PLAN.md`, затем staging).
- **Этап 3** — интерфейс тренера (включая решение по тренерской
  аутентификации — PIN остаётся или тоже переходит на Supabase Auth).
- **Этап 4** — административные настройки клуба (управление каталогом
  техник, `bonus_requirement`, клубным `feature_enabled`, полноценная модель
  «администратор клуба X» — закроет ограничение `ADMIN_FUNCTION_SECRET`
  выше).

Не переходить к этапу 3, административной панели, production deployment,
реальной загрузке видео или изменению тренерского PIN-входа без отдельного
подтверждения пользователя.
