-- ⚠️ ЗАПУСТИТЬ ПЕРВЫМ, ДО ЛЮБОЙ ИЗ МИГРАЦИЙ 2026072012000{1..7}.
--
-- Только чтение (SELECT из information_schema/pg_catalog) — ничего не
-- меняет и не создаёт. Безопасно выполнить в SQL Editor реального
-- Supabase-проекта JCL_Gruppen.
--
-- ЗАЧЕМ: docs/database/EXISTING_DATABASE_AUDIT.md прямо пометил типы
-- колонок clubs/students/trainers как 🔴 "требует проверки в Dashboard" —
-- аудит подтвердил только НАЗВАНИЯ колонок (по факту использования в коде
-- app.js), не их реальные Postgres-типы. Все миграции 2026072012000{1..7}
-- предполагают, что clubs.club_id, students.id и trainers.trainer_id имеют
-- тип uuid. Если это не так (например, bigint/integer/serial — обычная
-- практика для админ-систем такого возраста), ВСЕ миграции откажут при
-- создании внешних ключей (Postgres не позволяет FK между несовместимыми
-- типами) — до применения нужно подтвердить типы этим скриптом и при
-- необходимости скорректировать миграции (см.
-- docs/database/FAMILY_AUTH_AND_TECHNIQUE_PROGRESS_SCHEMA.md, раздел
-- "Типы существующих ключей").

-- 1. Типы и nullable колонок трёх ключевых таблиц.
select
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('clubs', 'students', 'trainers')
order by table_name,
  case column_name
    when 'club_id' then 0
    when 'id' then 0
    when 'trainer_id' then 0
    else 1
  end,
  ordinal_position;

-- 2. Реальные PRIMARY KEY колонки и их типы (на случай, если PK называется
-- иначе, чем предполагает аудит, например clubs.id вместо clubs.club_id).
select
  tc.table_name,
  kcu.column_name as pk_column,
  c.data_type,
  c.udt_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name
 and kcu.table_schema = tc.table_schema
join information_schema.columns c
  on c.table_schema = tc.table_schema
 and c.table_name = tc.table_name
 and c.column_name = kcu.column_name
where tc.constraint_type = 'PRIMARY KEY'
  and tc.table_schema = 'public'
  and tc.table_name in ('clubs', 'students', 'trainers');

-- 3. Все NOT NULL колонки students (нужно для supabase/seed.sql — insert
-- может упасть, если существуют обязательные колонки, не подтверждённые
-- аудитом по использованию в коде).
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'students'
  and is_nullable = 'no'
order by ordinal_position;

-- 4. Существует ли уже RLS на clubs/students/trainers (аудит предположил,
-- что RLS нигде не используется, но не мог проверить это напрямую).
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('clubs', 'students', 'trainers');

-- 5. Существующие RLS policies (если rowsecurity = true где-то выше, важно
-- увидеть, что именно они разрешают/запрещают).
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('clubs', 'students', 'trainers');

-- 6. Проверка, что clubs.club_short_name и clubs.active действительно
-- существуют под этими именами (resolve_family_login_email и seed.sql на
-- них полагаются) — аудит подтвердил их по использованию в коде, не по
-- Dashboard.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'clubs'
  and column_name in ('club_short_name', 'active');

-- 7. Проверка students.guertelfarbe / students.kyu_grad / students.club_id
-- (на них полагаются club_belts-сопоставление и все FK на students).
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'students'
  and column_name in ('guertelfarbe', 'kyu_grad', 'club_id');

-- 8. auth.users.id — на этот тип ссылаются family_guardians.auth_user_id
-- (FK на auth.users(id)) и все SECURITY DEFINER функции через auth.uid().
-- В штатной установке Supabase Auth это всегда uuid, но задание прямо
-- просит не предполагать типы без проверки — проверяем и это.
select table_schema, table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'auth'
  and table_name = 'users'
  and column_name = 'id';
