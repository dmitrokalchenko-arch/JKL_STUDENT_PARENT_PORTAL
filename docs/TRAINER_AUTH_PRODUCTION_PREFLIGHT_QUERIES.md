# Production Preflight — read-only запросы для владельца

⚠️ Этот файл подготовлен вместо фактического выполнения preflight, потому
что в текущей рабочей среде **нет ни одного безопасного способа
подключиться к production read-only** (см. отчёт, Часть 1). Ни одна из
команд ниже не была выполнена против `whorwleydkziejjafsea`.

Все запросы — строго `SELECT`/`WITH`. Ничего не создаёт, не изменяет и не
удаляет. Выполнять через **Supabase Dashboard → SQL Editor** проекта
`whorwleydkziejjafsea` (Dashboard → SQL Editor уже сам по себе read-only
по своей природе для этих запросов — обычный `SELECT` не может ничего
изменить).

Владельцу: выполните блоки по порядку, результаты (числа/таблицы, БЕЗ
реальных email/PIN/имён, если запрос случайно их вернёт — не публикуйте)
можно вставить обратно в чат для завершения Частей 8–10 отчёта.

---

## Блок 2.1 — зарегистрированные миграции

```sql
select version, name
from supabase_migrations.schema_migrations
where version like '20260720120%'
order by version;
```
Ожидание: список версий, которые УЖЕ применены. Сравнить построчно со
списком файлов в `supabase/migrations/` (011–026).

## Блок 2.2 / 3 — объекты, структура, constraints, triggers (trainer_accounts)

```sql
-- Существование таблицы
select table_name, table_type
from information_schema.tables
where table_schema = 'public' and table_name = 'trainer_accounts';

-- Колонки, типы, nullable, default, generated
select column_name, data_type, is_nullable, column_default,
       is_generated, generation_expression
from information_schema.columns
where table_schema = 'public' and table_name = 'trainer_accounts'
order by ordinal_position;

-- Все constraints разом (PK/UNIQUE/FK/CHECK) — включая проверку,
-- нет ли уже UNIQUE(trainer_row_id) под другим именем
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.trainer_accounts'::regclass
order by contype, conname;

-- Триггеры
select trigger_name, action_timing, event_manipulation, action_statement
from information_schema.triggers
where event_object_schema = 'public' and event_object_table = 'trainer_accounts'
order by trigger_name;
```

## Блок 3 — структура `trainers` и `clubs`

```sql
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('trainers', 'clubs')
order by table_name, ordinal_position;

select conrelid::regclass as table_name, conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.trainers'::regclass, 'public.clubs'::regclass)
order by table_name, contype;

select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where event_object_schema = 'public' and event_object_table in ('trainers', 'clubs')
order by event_object_table, trigger_name;
```

**На что смотреть вручную по результату:**
1. `trainers.id` — тип (ожидается bigint/integer, совместимый с `trainer_accounts.trainer_row_id`).
2. `trainers.club_id` / `clubs.club_id` (или `clubs.id` — свериться, как называется PK) — тип text, совпадающий с `trainer_accounts.club_id`.
3. Если появится `auth_user_id` в выводе (после блока 2.2) — тип должен быть `uuid`.
4. `login_name`/`normalized_login_name` — оба `text`.
5. `is_active` — `boolean`, default обычно `false`.

## Блок 2.3 — существование объектов 019–026

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name = 'trainer_account_audit_log';

select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('trainer_has_active_account','trainer_has_any_account','log_trainer_account_operation');

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.trainer_accounts'::regclass and contype = 'u';
```
Пустой результат первых двух запросов = объекты ещё не созданы (ожидаемо,
если 019–026 ещё не применялись). Третий запрос показывает все UNIQUE —
если среди них уже есть `unique (trainer_row_id)` — миграция 026 уже
применена или конфликтует.

## Блок 4 — агрегатные проверки конфликтов (без PII)

```sql
-- 1. Дубликаты trainer_row_id
select count(*) as duplicate_trainer_row_id_groups from (
  select trainer_row_id from public.trainer_accounts
  group by trainer_row_id having count(*) > 1
) x;

-- 2. Дубликаты normalized_login_name (в рамках клуба)
select count(*) as duplicate_login_name_groups from (
  select club_id, normalized_login_name from public.trainer_accounts
  group by club_id, normalized_login_name having count(*) > 1
) x;

-- 3. Дубликаты auth_user_id
select count(*) as duplicate_auth_user_id_groups from (
  select auth_user_id from public.trainer_accounts
  group by auth_user_id having count(*) > 1
) x;

-- 4. trainer_accounts без соответствующего trainers
select count(*) as orphaned_without_trainer
from public.trainer_accounts ta
left join public.trainers t on t.id = ta.trainer_row_id
where t.id is null;

-- 5. trainer_accounts без соответствующего auth.users
select count(*) as orphaned_without_auth_user
from public.trainer_accounts ta
left join auth.users u on u.id = ta.auth_user_id
where u.id is null;

-- 6. club_id не совпадает между trainer_accounts и trainers
select count(*) as club_id_mismatch
from public.trainer_accounts ta
join public.trainers t on t.id = ta.trainer_row_id
where ta.club_id is distinct from t.club_id;

-- 7. Пустой/NULL login_name
select count(*) as empty_or_null_login_name
from public.trainer_accounts
where login_name is null or btrim(login_name) = '';

-- 8. login_name длиннее 100 символов
select count(*) as login_name_over_100
from public.trainer_accounts
where length(login_name) > 100;

-- 9. trainers.name длиннее 200 / trainer_accounts.display_name длиннее 200
select count(*) as trainer_name_over_200 from public.trainers where length(name) > 200;
select count(*) as trainer_account_display_name_over_200 from public.trainer_accounts where length(display_name) > 200;

-- 10. Активные trainer_accounts для неактивных/удалённых trainers
select count(*) as active_account_for_inactive_trainer
from public.trainer_accounts ta
join public.trainers t on t.id = ta.trainer_row_id
where ta.is_active = true and coalesce(t.aktiv, '') <> 'JA';

-- 11. Администраторы (rolle='Admin') с is_active=false
select count(*) as inactive_admin_accounts
from public.trainer_accounts ta
join public.trainers t on t.id = ta.trainer_row_id
where t.rolle = 'Admin' and ta.is_active = false;

-- 12а. Мигрированные тренеры (есть trainer_accounts), у которых ещё жив pin_hash
select count(*) as migrated_trainers_with_retained_pin_hash
from public.trainer_accounts ta
join public.trainers t on t.id = ta.trainer_row_id
where t.pin_hash is not null;

-- 12б. То же самое, но ТОЛЬКО среди деактивированных — это ЧИСЛО реальных
-- тренеров, которые ДО применения migration 025 могли бы обойти
-- деактивацию через legacy PIN (см. TRAINER_AUTH_THREAT_MODEL.md, 4.6).
-- После применения 025 + обновлённого app.js риск закрыт для всех них.
select count(*) as deactivated_migrated_with_retained_pin_hash
from public.trainer_accounts ta
join public.trainers t on t.id = ta.trainer_row_id
where t.pin_hash is not null and ta.is_active = false;
```

**Интерпретация:** 1–3, 6 — любое значение > 0 это `BLOCKER` (миграции
011/026 упадут или уже нарушена целостность). 4–5 — `WARNING`, требует
разбора КАЖДОЙ строки перед продолжением (сверочный запрос, не блокирует
миграции сам по себе). 7–9 — `WARNING`, можно почистить данные до
применения новых `CHECK`-подобных ограничений в приложении (constraint'ов
на длину в БД миграции не добавляют, только Edge Function). 10–11 —
`WARNING`, бизнес-аномалия, не блокер миграций. 12а — информационное,
12б — `WARNING`, если > 0 (это и есть окно риска, которое закрывает
migration 025 — само по себе не блокер, но подтверждает, что фикс нужен
именно на production, не только локально).

## Блок 5 — функции и права

```sql
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  pg_get_function_result(p.oid) as return_type,
  case p.prosecdef when true then 'DEFINER' else 'INVOKER' end as security,
  pg_get_userbyid(p.proowner) as owner,
  p.proconfig as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'normalize_login_name', 'resolve_trainer_login_email', 'family_club_exists',
    'rename_trainer_login', 'trainer_has_active_account', 'trainer_has_any_account',
    'log_trainer_account_operation'
  )
order by p.proname;

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'normalize_login_name', 'resolve_trainer_login_email', 'family_club_exists',
    'rename_trainer_login', 'trainer_has_active_account', 'trainer_has_any_account',
    'log_trainer_account_operation'
  )
order by routine_name, grantee;

-- Есть ли где-то лишний PUBLIC execute (нежелательно нигде из этого списка)
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'normalize_login_name', 'resolve_trainer_login_email', 'family_club_exists',
    'rename_trainer_login', 'trainer_has_active_account', 'trainer_has_any_account',
    'log_trainer_account_operation'
  )
  and grantee = 'PUBLIC';

-- Доступность базовых таблиц для service_role
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('trainers', 'clubs', 'trainer_accounts', 'trainer_account_audit_log')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;
```

Функции НЕ вызывать с реальными данными. Если нужно проверить
`resolve_trainer_login_email`, вызвать только с заведомо несуществующим
плейсхолдером, например:
```sql
select public.resolve_trainer_login_email('__preflight_check_nonexistent__', '__preflight_check__');
-- Ожидается NULL (клуб не найден) — не более.
```

## Блок 6 — auth (только агрегат, БЕЗ PII)

```sql
select count(*) as auth_users_linked_to_trainer_accounts
from auth.users u
join public.trainer_accounts ta on ta.auth_user_id = u.id;
```

Edge Functions (`manage-trainer-account`, `create-family-account`) и их
secrets **не проверяются SQL** — это платформенные объекты. Владельцу
нужно проверить отдельно:
- Dashboard → Edge Functions — есть ли `manage-trainer-account` в списке, дата последнего деплоя.
- Dashboard → Edge Functions → Secrets (или `supabase secrets list --project-ref whorwleydkziejjafsea` из-под своей CLI-сессии) — присутствует ли `ADMIN_FUNCTION_SECRET`. Если да — он больше не читается кодом (подтверждено ревью кода в этой сессии), можно оставить как есть до деплоя новой версии функции или удалить заранее — не влияет на безопасность, только гигиена.
- `verify_jwt` для функции — Dashboard → Edge Functions → `manage-trainer-account` → Details.

## Блок 7 — bootstrap первого администратора

```sql
select count(*) as active_auth_admins
from public.trainer_accounts ta
join public.trainers t on t.id = ta.trainer_row_id
where ta.is_active = true and t.rolle = 'Admin';

select count(distinct t.club_id) as clubs_with_active_auth_admin
from public.trainer_accounts ta
join public.trainers t on t.id = ta.trainer_row_id
where ta.is_active = true and t.rolle = 'Admin';

select count(*) as clubs_without_active_auth_admin
from public.clubs c
where not exists (
  select 1 from public.trainer_accounts ta
  join public.trainers t on t.id = ta.trainer_row_id
  where t.club_id = c.club_id and ta.is_active = true and t.rolle = 'Admin'
);
```

Если `active_auth_admins > 0` — bootstrap может не требоваться (уже есть
хотя бы один рабочий вход). Если `0` — рекомендуется вариант A (создание
через Dashboard), см. предыдущий отчёт этой сессии.
