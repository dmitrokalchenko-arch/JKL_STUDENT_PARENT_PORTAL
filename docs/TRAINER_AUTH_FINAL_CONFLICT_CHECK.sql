-- =====================================================================
-- TRAINER_AUTH_FINAL_CONFLICT_CHECK.sql
-- =====================================================================
--
-- НАЗНАЧЕНИЕ: последняя обязательная read-only проверка на СКРЫТЫЕ
-- конфликты имён объектов (в любых пользовательских схемах, не только
-- public) перед применением production-пакета Trainer Auth (миграции
-- 011-026). Это НЕ повторный общий preflight — общий preflight уже
-- выполнен отдельно (см. TRAINER_AUTH_PRODUCTION_PREFLIGHT_SINGLE_QUERY.sql)
-- и уже подтвердил: public.trainers/clubs существуют, trainer_accounts/
-- trainer_account_audit_log отсутствуют, функции Trainer Auth отсутствуют,
-- supabase_migrations.schema_migrations отсутствует. Здесь проверяется
-- ТОЛЬКО то, что тот прогон не проверял: нет ли ОДНОИМЁННЫХ или похожих
-- объектов в ДРУГИХ схемах либо неожиданных сигнатур/типов, которые могут
-- незаметно помешать применению пакета.
--
-- ⚠️ ТОЛЬКО ДЛЯ РУЧНОГО ЗАПУСКА ВЛАДЕЛЬЦЕМ В PRODUCTION SQL EDITOR.
-- Этот файл НЕ выполнялся против production. Ни один SELECT из него не был
-- отправлен на сервер whorwleydkziejjafsea.
--
-- ЭТОТ СКРИПТ ЯВЛЯЕТСЯ READ-ONLY:
--   - один SELECT (WITH ... SELECT), один result grid;
--   - обращается ТОЛЬКО к pg_catalog/information_schema (pg_class,
--     pg_namespace, pg_proc, pg_constraint, pg_trigger, pg_type) и
--     безопасным read-only функциям (pg_get_function_identity_arguments,
--     pg_get_function_result, pg_get_userbyid);
--   - НЕ содержит INSERT/UPDATE/DELETE/MERGE/CREATE/ALTER/DROP/TRUNCATE/
--     GRANT/REVOKE/DO/CALL/EXECUTE/динамический SQL;
--   - НЕ читает ни одной пользовательской строки данных (только метаданные
--     схемы: имена объектов, сигнатуры, владельцы, типы);
--   - НЕ выводит UUID/email/PIN/login_name/имена тренеров/иные персональные
--     данные — их структурно негде взять в system catalog-запросе такого
--     рода;
--   - системные схемы (pg_catalog, information_schema, pg_toast,
--     pg_temp*, pg_toast_temp*) исключены из поиска.
--
-- ПЕРЕД ЗАПУСКОМ: визуально подтвердите project ref "whorwleydkziejjafsea"
-- в Supabase Dashboard (URL и/или шапка Dashboard) — это НЕ локальный
-- стенд и НЕ другой проект.
--
-- Результат: ОДИН result grid, колонки:
--   category | object_schema | object_name | object_type | status | details
-- status: GREEN / YELLOW / RED / INFO.
-- Последняя строка (check_name в details = FINAL_CONFLICT_CHECK) — итог.
-- =====================================================================

with

-- ── A. Таблицы/views/matviews/foreign tables/sequences ────────────────
-- Ищем ТОЧНЫЕ совпадения имён trainer_accounts / trainer_account_audit_log
-- во ВСЕХ пользовательских схемах (не только public).
a_targets(target_name) as (
  values ('trainer_accounts'), ('trainer_account_audit_log')
),
a_found as (
  select t.target_name,
         n.nspname as object_schema,
         c.relname as object_name,
         case c.relkind
           when 'r' then 'table' when 'v' then 'view' when 'm' then 'materialized view'
           when 'f' then 'foreign table' when 'S' then 'sequence' else c.relkind::text
         end as object_type,
         case when n.nspname = 'public' then 'RED' else 'YELLOW' end as status,
         case when n.nspname = 'public'
              then 'Точное имя уже занято объектом в public — напрямую блокирует создание соответствующей миграции (011 для trainer_accounts / 024 для trainer_account_audit_log)'
              else 'Объект с этим именем существует в ДРУГОЙ пользовательской схеме — не блокирует public, но требует ручного просмотра перед применением'
         end as details
  from a_targets t
  join pg_class c on c.relname = t.target_name and c.relkind in ('r','v','m','f','S')
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog','information_schema','pg_toast')
    and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%'
),
a_rows as (
  select 'A_TABLE_LIKE_OBJECTS'::text as category, object_schema, object_name, object_type, status, details
  from a_found
  union all
  select 'A_TABLE_LIKE_OBJECTS', 'n/a', t.target_name, 'n/a', 'GREEN',
         'Объектов (таблица/view/materialized view/foreign table/sequence) с этим именем не найдено ни в одной пользовательской схеме'
  from a_targets t
  where not exists (select 1 from a_found f where f.target_name = t.target_name)
),

-- ── B. Функции и процедуры ──────────────────────────────────────────
-- Ожидаемые сигнатуры взяты ТОЛЬКО из миграций 011-026 (не по памяти):
--   normalize_login_name(text) returns text                         — migration 011
--   resolve_trainer_login_email(text,text) returns text              — migration 012
--   family_club_exists(text) returns boolean                         — migration 001
--   rename_trainer_login(uuid,text) returns void                     — migration 011
--   trainer_has_active_account(text,text) returns boolean            — migration 019
--   trainer_has_any_account(text,text) returns boolean               — migration 025
--   log_trainer_account_operation(uuid,bigint,text,text,text) returns void — migration 024
b_targets(fname, expected_sig) as (
  values
    ('normalize_login_name', '(text)'),
    ('resolve_trainer_login_email', '(text,text)'),
    ('family_club_exists', '(text)'),
    ('rename_trainer_login', '(uuid,text)'),
    ('trainer_has_active_account', '(text,text)'),
    ('trainer_has_any_account', '(text,text)'),
    ('log_trainer_account_operation', '(uuid,bigint,text,text,text)')
),
b_found as (
  select f.fname, f.expected_sig,
         n.nspname as object_schema,
         p.proname as object_name,
         case p.prokind when 'f' then 'function' when 'p' then 'procedure' else p.prokind::text end as object_type,
         case
           when n.nspname <> 'public' then 'YELLOW'
           when to_regprocedure(quote_ident(n.nspname) || '.' || f.fname || f.expected_sig) = p.oid then 'YELLOW'
           else 'RED'
         end as status,
         'identity_arguments=(' || pg_get_function_identity_arguments(p.oid)
           || '), returns=' || pg_get_function_result(p.oid)
           || ', owner=' || pg_get_userbyid(p.proowner)
           || ', security=' || (case when p.prosecdef then 'DEFINER' else 'INVOKER' end)
           || case
                when n.nspname <> 'public' then ' — функция в другой пользовательской схеме, требует ручного просмотра'
                when to_regprocedure(quote_ident(n.nspname) || '.' || f.fname || f.expected_sig) = p.oid
                  then ' — сигнатура совпадает с ожидаемой по миграциям: объект УЖЕ СУЩЕСТВУЕТ, нельзя слепо (пере)применять migration с CREATE OR REPLACE вслепую'
                else ' — СИГНАТУРА НЕ СОВПАДАЕТ с ожидаемой ' || f.expected_sig || ' — прямой конфликт имени функции в public'
              end as details
  from b_targets f
  join pg_proc p on p.proname = f.fname
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog','information_schema','pg_toast')
    and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%'
),
b_rows as (
  select 'B_FUNCTIONS'::text as category, object_schema, object_name, object_type, status, details
  from b_found
  union all
  select 'B_FUNCTIONS', 'n/a', t.fname, 'n/a', 'GREEN',
         'Функций/процедур с этим именем не найдено ни в одной пользовательской схеме'
  from b_targets t
  where not exists (select 1 from b_found f where f.fname = t.fname)
),

-- ── C. Constraints и triggers ────────────────────────────────────────
-- Точные имена, используемые миграциями 011-026 (constraints и triggers,
-- не сами функции-исполнители триггеров — те не входят в фиксированный
-- список раздела B).
c_exact_names(name) as (
  values
    ('trainer_accounts_pkey'),
    ('trainer_accounts_auth_user_id_key'),
    ('trainer_accounts_club_id_normalized_login_name_key'),
    ('trainer_accounts_trainer_row_id_key'),
    ('trainer_accounts_auth_user_id_fkey'),
    ('trainer_accounts_trainer_row_id_fkey'),
    ('trainer_account_audit_log_pkey'),
    ('trg_trainer_accounts_club_exists'),
    ('trg_trainer_accounts_club_match'),
    ('trg_trainer_accounts_login_name_immutable'),
    ('trg_trainer_accounts_set_updated_at')
),
c_constraints_exact as (
  select con.conname as matched_name,
         n.nspname as object_schema,
         cl.relname || '.' || con.conname as object_name,
         'constraint (' || con.contype::text || ')' as object_type,
         'RED'::text as status,
         'Точное имя constraint уже занято на объекте ' || n.nspname || '.' || cl.relname || ' — прямой конфликт при применении миграции с этим именем ограничения' as details
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  where con.conname in (select name from c_exact_names)
    and n.nspname not in ('pg_catalog','information_schema','pg_toast')
    and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%'
),
c_triggers_exact as (
  select tg.tgname as matched_name,
         n.nspname as object_schema,
         cl.relname || '.' || tg.tgname as object_name,
         'trigger' as object_type,
         'RED'::text as status,
         'Точное имя trigger уже занято на объекте ' || n.nspname || '.' || cl.relname || ' — прямой конфликт при применении миграции с этим именем триггера' as details
  from pg_trigger tg
  join pg_class cl on cl.oid = tg.tgrelid
  join pg_namespace n on n.oid = cl.relnamespace
  where tg.tgname in (select name from c_exact_names)
    and not tg.tgisinternal
    and n.nspname not in ('pg_catalog','information_schema','pg_toast')
    and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%'
),
-- Похожие имена (подстроки), не входящие в список точных совпадений выше —
-- чтобы не дублировать строки.
c_constraints_fuzzy as (
  select n.nspname as object_schema,
         cl.relname || '.' || con.conname as object_name,
         'constraint (' || con.contype::text || ')' as object_type,
         'YELLOW'::text as status,
         'Похожее (не точное) имя constraint на объекте ' || n.nspname || '.' || cl.relname || ' — не блокирует напрямую, но требует ручного просмотра' as details
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  join pg_namespace n on n.oid = cl.relnamespace
  where con.conname not in (select name from c_exact_names)
    and (con.conname ilike '%trainer_account%' or con.conname ilike '%login_name%'
         or con.conname ilike '%club_match%' or con.conname ilike '%club_exists%')
    and n.nspname not in ('pg_catalog','information_schema','pg_toast')
    and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%'
),
c_triggers_fuzzy as (
  select n.nspname as object_schema,
         cl.relname || '.' || tg.tgname as object_name,
         'trigger' as object_type,
         'YELLOW'::text as status,
         'Похожее (не точное) имя trigger на объекте ' || n.nspname || '.' || cl.relname || ' — не блокирует напрямую, но требует ручного просмотра' as details
  from pg_trigger tg
  join pg_class cl on cl.oid = tg.tgrelid
  join pg_namespace n on n.oid = cl.relnamespace
  where tg.tgname not in (select name from c_exact_names)
    and not tg.tgisinternal
    and (tg.tgname ilike '%trainer_account%' or tg.tgname ilike '%login_name%'
         or tg.tgname ilike '%club_match%' or tg.tgname ilike '%club_exists%')
    and n.nspname not in ('pg_catalog','information_schema','pg_toast')
    and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%'
),
c_exact_matched_names as (
  select matched_name from c_constraints_exact
  union
  select matched_name from c_triggers_exact
),
c_found as (
  select object_schema, object_name, object_type, status, details from c_constraints_exact
  union all
  select object_schema, object_name, object_type, status, details from c_triggers_exact
  union all
  select object_schema, object_name, object_type, status, details from c_constraints_fuzzy
  union all
  select object_schema, object_name, object_type, status, details from c_triggers_fuzzy
),
c_rows as (
  select 'C_CONSTRAINTS_TRIGGERS'::text as category, object_schema, object_name, object_type, status, details
  from c_found
  union all
  select 'C_CONSTRAINTS_TRIGGERS', 'n/a', e.name, 'n/a', 'GREEN',
         'Точное имя constraint/trigger не найдено ни на одном объекте ни в одной пользовательской схеме'
  from c_exact_names e
  where not exists (select 1 from c_exact_matched_names m where m.matched_name = e.name)
),

-- ── D. Composite types / enum / domain ──────────────────────────────
-- Ни одна из миграций 011-026 не выполняет CREATE TYPE — trainer_account_
-- operation используется только как список значений CHECK-ограничения на
-- text-колонке (migration 024), не как отдельный enum/domain. Совпадение
-- здесь не блокирует применение ТЕКУЩЕГО пакета, но фиксируется на будущее.
d_targets(name) as (
  values ('trainer_accounts'), ('trainer_account_audit_log'), ('trainer_account_operation')
),
d_found as (
  select n.nspname as object_schema,
         t.typname as object_name,
         case t.typtype when 'c' then 'composite type' when 'e' then 'enum' when 'd' then 'domain' else t.typtype::text end as object_type,
         'YELLOW'::text as status,
         'Совпадение имени типа — ни одна из миграций 011-026 не выполняет CREATE TYPE с этим именем сегодня, поэтому применение текущего пакета не блокирует; фиксируется для будущих миграций' as details
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where t.typname in (select name from d_targets)
    and (
      t.typtype in ('e','d')
      or (t.typtype = 'c' and exists (select 1 from pg_class rc where rc.reltype = t.oid and rc.relkind = 'c'))
    )
    and n.nspname not in ('pg_catalog','information_schema','pg_toast')
    and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%'
),
d_rows as (
  select 'D_TYPES'::text as category, object_schema, object_name, object_type, status, details
  from d_found
  union all
  select 'D_TYPES', 'n/a', t.name, 'n/a', 'GREEN',
         'Composite type/enum/domain с этим именем не найден ни в одной пользовательской схеме'
  from d_targets t
  where not exists (select 1 from d_found f where f.object_name = t.name)
),

all_rows as (
  select * from a_rows
  union all
  select * from b_rows
  union all
  select * from c_rows
  union all
  select * from d_rows
),

final_rows as (
  select category, object_schema, object_name, object_type, status, details
  from all_rows

  union all

  select
    'E_SUMMARY' as category,
    'n/a' as object_schema,
    'n/a' as object_name,
    'n/a' as object_type,
    case
      when count(*) filter (where status = 'RED') > 0 then 'RED'
      when count(*) filter (where status = 'YELLOW') > 0 then 'YELLOW'
      else 'GREEN'
    end as status,
    'check_name=FINAL_CONFLICT_CHECK; red=' || count(*) filter (where status = 'RED')
      || ', yellow=' || count(*) filter (where status = 'YELLOW')
      || ', green=' || count(*) filter (where status = 'GREEN') || '. '
      || case
           when count(*) filter (where status = 'RED') > 0
             then 'Не применять пакет до устранения конкретного конфликта.'
           when count(*) filter (where status = 'YELLOW') > 0
             then 'Просмотреть только перечисленные совпадения; не запускать новый общий аудит.'
           else 'STOP CHECKING: перейти к применению production-пакета по runbook.'
         end as details
  from all_rows
)

select category, object_schema, object_name, object_type, status, details
from final_rows
order by
  case status when 'RED' then 1 when 'YELLOW' then 2 when 'GREEN' then 3 else 4 end,
  category, object_name;

-- =====================================================================
-- ИНСТРУКЦИЯ ДЛЯ ВЛАДЕЛЬЦА
-- =====================================================================
-- 1. Войти в Supabase Dashboard, визуально подтвердить project ref
--    whorwleydkziejjafsea.
-- 2. SQL Editor → New query → вставить этот файл целиком.
-- 3. Нажать Run один раз (это ОДИН SELECT, один result grid).
-- 4. Передать весь result grid для анализа.
-- 5. Если итоговая строка E_SUMMARY = GREEN — следующий шаг: применение
--    production-пакета по TRAINER_AUTH_PRODUCTION_RUNBOOK.md, не новая
--    проверка.
-- =====================================================================
