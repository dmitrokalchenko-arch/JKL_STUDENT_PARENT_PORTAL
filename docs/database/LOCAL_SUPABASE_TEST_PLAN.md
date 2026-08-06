# План локального тестирования Supabase (этап 2.1 / 2.2)

Цель — проверить миграции/RLS/RPC/Storage на **локальной эфемерной** базе
(Docker), не трогая production/`JCL_Gruppen`. Ничего из этого документа не
подключается к удалённому проекту.

**Шаг 0 выполнен (этап 2.2)** — диагностика реальной схемы прогнана в
Dashboard `JCL_Gruppen`. Реальные типы, ПОДТВЕРЖДЁННЫЕ (не предположение):

| Колонка | Реальный тип | Было предположено изначально |
|---|---|---|
| `clubs.id` | `uuid` (реальный PK) | не использовался |
| `clubs.club_id` | `text` (slug, напр. `'jcl'`), НЕ подтверждён UNIQUE | `uuid`, ошибочно считался PK |
| `students.id` | `bigint` (реальный PK, без автогенерации) | `uuid` |
| `students.club_id` | `text` | не проверялся |
| `students.kyu_grad` | `text` | ошибочно считался числом |
| `trainers.id` | `bigint` (реальный PK) | не использовался |
| `trainers.trainer_id` | `text`, НЕ PK | `uuid`, ошибочно считался PK |
| `auth.users.id` | `uuid` | `uuid` (совпало) |

Все 7 миграций, `seed.sql` и тестовые скрипты в этом плане уже переписаны
под эти типы (`club_id text` везде, `student_id bigint`,
`completed_by -> trainers.id bigint`, без hard FK на `clubs.club_id` — через
триггер `family_club_exists()`, поскольку его уникальность не подтверждена).

**Побочная находка** (не входит в эту задачу, не изменялось): на
`students`/`trainers` в `JCL_Gruppen` RLS уже включён, но политики
предельно открытые (`SELECT`/`INSERT`/`UPDATE`/`DELETE` для ролей
`public`/`anon` с `qual = true`) — фактически без ограничений. Это
существующая особенность чужой продакшн-системы, зафиксирована в
`docs/database/EXISTING_DATABASE_AUDIT.md`, не устраняется в рамках этого
портала.

## 1. Установка Supabase CLI

Не устанавливать глобально без необходимости — используем `npx` или
dev-dependency:

```bash
# вариант A: разовый запуск без установки
npx supabase --version

# вариант B: как dev-dependency проекта (npm)
npm install --save-dev supabase
npx supabase --version
```

Требуется Docker Desktop (локальный Supabase поднимает Postgres/GoTrue/
Storage/PostgREST в контейнерах).

## 2. Запуск локальной Supabase

```bash
npx supabase init          # если supabase/config.toml ещё не создан
npx supabase start
```

Команда выведет (сохранить эти значения — понадобятся ниже):

```
API URL:        http://127.0.0.1:54321
DB URL:         postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL:     http://127.0.0.1:54323
anon key:       <...>
service_role key: <...>
```

**НЕ путать с production** — `npx supabase link`/`db push` к удалённому
проекту в рамках этого плана не выполняется.

## 3. Применение миграций и seed

```bash
npx supabase db reset
```

`db reset` пересоздаёт локальную базу с нуля: применяет ВСЕ файлы
`supabase/migrations/*.sql` по порядку имён, затем автоматически применяет
`supabase/seed.sql` (создаёт Club 1 + Student A + 16 техник, 5 выполнено —
см. комментарии в файле). Затем добавить тестовые фикстуры для проверки
изоляции (Club 2, Student B, Student C, Family B — без них сценарии B/C/D/I
непроверяемы):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -f supabase/tests/local_test_fixtures.sql
```

Если `db reset` падает на `supabase/seed.sql` (insert в `students` —
известное ограничение, см. предупреждение в самом файле) — исправить
конкретную упавшую колонку по результату шага 0, не расширяя семейный/
технический слой в обход.

## 4. Создание тестовых auth-пользователей и получение JWT

`auth.users` не создаётся прямым SQL (хеширование пароля зависит от версии
GoTrue) — используется Auth Admin API локального инстанса через
`service_role` ключ.

```bash
API_URL="http://127.0.0.1:54321"
SERVICE_ROLE_KEY="<service_role key из шага 2>"
ANON_KEY="<anon key из шага 2>"

# Family A — будет привязана к Student A
# Email построен family_login_email('jkl-test-seed', 'familya') — club_id
# теперь text slug (аудит этапа 2.2), не uuid.
curl -s -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"family_jkltestseed_familya@internal.jkl","password":"test-password-A1","email_confirm":true}'
# -> сохранить .id из ответа как FAMILY_A_UID

# Family B — не будет привязана ни к одному ученику
curl -s -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"family_jkltestseed_familyb@internal.jkl","password":"test-password-B1","email_confirm":true}'
# -> сохранить .id из ответа как FAMILY_B_UID
```

Email здесь построен вручную по формату `family_login_email()`
(`family_<normalizedClubId>_<normalizedNickname>@internal.jkl` — club_id и
nickname оба проходят через `normalize_family_nickname`, поэтому дефисы в
`jkl-test-seed` исчезают) — в реальном сценарии это делает Edge Function
`create-family-account`. Для локального теста после создания
auth-пользователя нужно вручную создать `family_guardians` (и для Family A —
`family_students`), так как Edge Function здесь не запускается:

```sql
-- psql, подставить реальные FAMILY_A_UID / FAMILY_B_UID
-- club_id — text slug ('jkl-test-seed', как в seed.sql), student_id — bigint.

-- Family A нет ни в seed.sql, ни в local_test_fixtures.sql — создать явно:
insert into public.families (club_id, nickname, normalized_nickname, display_name)
values ('jkl-test-seed', 'familya', 'familya', 'Семья A (тест)');

insert into public.family_guardians (auth_user_id, family_id, club_id, display_name)
values (
  '<FAMILY_A_UID>',
  (select id from public.families where normalized_nickname = 'familya'),
  'jkl-test-seed',
  'Family A guardian (test)'
);

insert into public.family_students (family_id, student_id, club_id, is_primary)
values (
  (select id from public.families where normalized_nickname = 'familya'),
  900000000001, -- Student A (id из supabase/seed.sql)
  'jkl-test-seed',
  true
);

insert into public.family_guardians (auth_user_id, family_id, club_id, display_name)
values (
  '<FAMILY_B_UID>',
  '00000000-0000-4000-8000-000000000005', -- Family B из local_test_fixtures.sql
  'jkl-test-seed',
  'Family B guardian (test)'
);
```

Получение JWT (для API-тестов через REST, не только SQL-уровень):

```bash
curl -s -X POST "$API_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"email":"family_jkltestseed_familya@internal.jkl","password":"test-password-A1"}'
# -> .access_token = FAMILY_A_JWT
```

## 5. SQL-тесты RLS (сценарии A-J)

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  -v family_a_uid="'<FAMILY_A_UID>'" \
  -v family_b_uid="'<FAMILY_B_UID>'" \
  -f supabase/tests/rls_scenarios.sql
```

Ожидаемый вывод — построчно `PASS A`, `PASS A2`, `PASS B`, ... до `PASS G`
(сценарий H — API/Storage, см. ниже; сценарии подробно описаны в самом
файле). Любой `FAIL` останавливает скрипт исключением.

## 6. API-тест через REST/RPC (ближе к реальному фронтенду, чем чистый SQL)

```bash
# resolve_family_login_email — анонимно, как при входе
curl -s -X POST "$API_URL/rest/v1/rpc/resolve_family_login_email" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_club_short_name":"jkl-test-seed","p_nickname":"familya"}'
# -> должен вернуть JSON-строку с email, БЕЗ отличия от вызова с
#    несуществующим nickname (см. FAMILY_AUTH_AND_TECHNIQUE_PROGRESS_SCHEMA.md,
#    исправление аудита 2.1 — nickname enumeration)

# get_student_technique_progress — с JWT Family A, свой ученик
# p_student_id — bigint (students.id), а не uuid.
curl -s -X POST "$API_URL/rest/v1/rpc/get_student_technique_progress" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $FAMILY_A_JWT" \
  -H "Content-Type: application/json" \
  -d '{"p_student_id":900000000001}'
# -> 200, featureEnabled/techniques

# то же самое, но с JWT Family B (не привязана к Student A) — сценарий H-аналог для RPC
curl -s -X POST "$API_URL/rest/v1/rpc/get_student_technique_progress" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $FAMILY_B_JWT" \
  -H "Content-Type: application/json" \
  -d '{"p_student_id":900000000001}'
# -> ожидается ошибка (access_denied, HTTP 400/403 в зависимости от PostgREST)
```

### Сценарий H — signed URL видео недоступен чужой семье

Путь в bucket теперь `{club_id text}/{student_id bigint}/...` —
`jkl-test-seed/900000000001/...` (не uuid/uuid, как в более ранней версии
этого плана).

```bash
# 1. Загрузить тестовый файл в bucket от имени service_role (загрузка через
#    UI не реализована — только так можно положить файл для теста)
curl -s -X POST "$API_URL/storage/v1/object/technique-videos/jkl-test-seed/900000000001/test-progress/demo.mp4" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: video/mp4" --data-binary "@/dev/null"

# 2. Family A (реально привязана к Student A) запрашивает signed URL — должно пройти
curl -s -X POST "$API_URL/storage/v1/object/sign/technique-videos/jkl-test-seed/900000000001/test-progress/demo.mp4" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $FAMILY_A_JWT" \
  -H "Content-Type: application/json" -d '{"expiresIn":3600}'
# -> 200 + signedURL

# 3. Family B (НЕ привязана к Student A) запрашивает тот же путь — должно быть отклонено
curl -s -X POST "$API_URL/storage/v1/object/sign/technique-videos/jkl-test-seed/900000000001/test-progress/demo.mp4" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $FAMILY_B_JWT" \
  -H "Content-Type: application/json" -d '{"expiresIn":3600}'
# -> ожидается ошибка доступа (Storage RLS: can_family_access_student -> false)
```

## 7. Очистка локальной среды

```bash
npx supabase stop            # останавливает контейнеры, данные сохраняются
npx supabase stop --no-backup  # останавливает и удаляет volume полностью
```

Локальная среда полностью изолирована от production — `stop`/повторный
`db reset` никогда не затрагивает реальный Supabase-проект `JCL_Gruppen`.

## 8. Что этот план НЕ покрывает

- Реальные NOT NULL/constraints `students` за пределами того, что
  подтверждено аудитом по коду (могут проявиться только на реальной базе —
  шаг 0 обязателен).
- Нагрузочное тестирование, конкурентные вставки (`enforce_max_active_families_per_student`
  проверялся логически, не под конкурентной нагрузкой).
- Тренерский/административный доступ — RLS для этих ролей не создана (см.
  `FAMILY_AUTH_AND_TECHNIQUE_PROGRESS_SCHEMA.md`, этап 3).
