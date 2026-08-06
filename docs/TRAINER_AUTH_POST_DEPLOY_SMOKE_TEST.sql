-- =====================================================================
-- TRAINER_AUTH_POST_DEPLOY_SMOKE_TEST.sql
-- =====================================================================
--
-- НАЗНАЧЕНИЕ: read-only проверка сразу после
-- TRAINER_AUTH_PRODUCTION_DEPLOY.sql (и, желательно, после
-- TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE.sql) — подтверждает, что
-- инфраструктура Trainer Auth создана полностью и корректно. Раздел
-- D_FUNCTIONS включает и три family-layer prerequisite функции
-- (set_updated_at/family_club_exists/normalize_family_nickname),
-- которые TRAINER_AUTH_PRODUCTION_DEPLOY.sql теперь создаёт сам.
--
-- ⚠️ ТОЛЬКО ДЛЯ РУЧНОГО ЗАПУСКА ВЛАДЕЛЬЦЕМ. Не выполнялся против production.
--
-- READ-ONLY: только SELECT/WITH, только pg_catalog/information_schema и
-- безопасные read-only функции (to_regclass/to_regprocedure/
-- pg_get_function_identity_arguments/pg_get_function_result/
-- pg_get_userbyid/has_function_privilege/has_table_privilege). Не выводит
-- PII/email/UUID/login_name/строки пользователей — только агрегаты и
-- метаданные схемы. Структурно не падает, даже если deploy не выполнялся
-- (тогда покажет RED по отсутствующим объектам, не ошибку).
--
-- Результат: ОДИН result grid, колонки:
--   section | check_name | status | actual_value | expected_value | details
-- Финальная строка check_name = POST_DEPLOY_SMOKE_TEST.
-- =====================================================================

with

-- ── A. Существование таблиц ──────────────────────────────────────────
a_rows as (
  select 'A_EXISTENCE'::text as section, 'public.trainer_accounts exists'::text as check_name,
         case when to_regclass('public.trainer_accounts') is not null then 'GREEN' else 'RED' end as status,
         (to_regclass('public.trainer_accounts') is not null)::text as actual_value,
         'true'::text as expected_value, ''::text as details
  union all
  select 'A_EXISTENCE', 'public.trainer_account_audit_log exists',
         case when to_regclass('public.trainer_account_audit_log') is not null then 'GREEN' else 'RED' end,
         (to_regclass('public.trainer_account_audit_log') is not null)::text,
         'true', ''
),

-- ── B. Колонки и типы ────────────────────────────────────────────────
b_ta_targets(col_name, expected) as (
  values
    ('trainer_row_id', 'bigint, not null'),
    ('auth_user_id', 'uuid, not null'),
    ('club_id', 'text, not null'),
    ('login_name', 'text, not null'),
    ('normalized_login_name', 'text, generated always'),
    ('is_active', 'boolean, not null, default false'),
    ('created_at', 'timestamp with time zone, not null'),
    ('updated_at', 'timestamp with time zone, not null')
),
b_ta_rows as (
  select 'B_STRUCTURE'::text as section, 'trainer_accounts.' || t.col_name as check_name,
         case when c.data_type is null then 'RED' else 'GREEN' end as status,
         coalesce(c.data_type || ', nullable=' || c.is_nullable || ', default=' || coalesce(c.column_default, '-') || ', generated=' || c.is_generated, 'MISSING') as actual_value,
         t.expected as expected_value, ''::text as details
  from b_ta_targets t
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = 'trainer_accounts' and c.column_name = t.col_name
),
b_audit_targets(col_name, expected) as (
  values
    ('performed_by_auth_user_id', 'uuid, not null'),
    ('target_trainer_row_id', 'bigint, not null'),
    ('target_trainer_id', 'text, not null'),
    ('club_id', 'text, not null'),
    ('operation', 'text, not null, check in (create/update/activate/deactivate)'),
    ('created_at', 'timestamp with time zone, not null')
),
b_audit_rows as (
  select 'B_STRUCTURE'::text as section, 'trainer_account_audit_log.' || t.col_name as check_name,
         case when c.data_type is null then 'RED' else 'GREEN' end as status,
         coalesce(c.data_type || ', nullable=' || c.is_nullable, 'MISSING') as actual_value,
         t.expected as expected_value, ''::text as details
  from b_audit_targets t
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = 'trainer_account_audit_log' and c.column_name = t.col_name
),

-- ── C. Constraints (PK/UNIQUE/FK + ON DELETE) ───────────────────────
c_rows as (
  select 'C_CONSTRAINTS'::text as section, 'trainer_accounts PRIMARY KEY'::text as check_name,
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'p') then 'GREEN' else 'RED' end as status,
         exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'p')::text as actual_value,
         'true'::text as expected_value, ''::text as details
  union all
  select 'C_CONSTRAINTS', 'trainer_accounts UNIQUE(auth_user_id)',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'u' and pg_get_constraintdef(oid) ilike '%(auth_user_id)%') then 'GREEN' else 'RED' end,
         exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'u' and pg_get_constraintdef(oid) ilike '%(auth_user_id)%')::text,
         'true', ''
  union all
  select 'C_CONSTRAINTS', 'trainer_accounts UNIQUE(club_id, normalized_login_name)',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'u' and pg_get_constraintdef(oid) ilike '%club_id%normalized_login_name%') then 'GREEN' else 'RED' end,
         exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'u' and pg_get_constraintdef(oid) ilike '%club_id%normalized_login_name%')::text,
         'true', ''
  union all
  select 'C_CONSTRAINTS', 'trainer_accounts UNIQUE(trainer_row_id) [migration 026]',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'u' and pg_get_constraintdef(oid) ilike '%(trainer_row_id)%') then 'GREEN' else 'RED' end,
         exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'u' and pg_get_constraintdef(oid) ilike '%(trainer_row_id)%')::text,
         'true', 'Отсутствие = migration 026 не применилась (race-condition фикс не закрыт)'
  union all
  select 'C_CONSTRAINTS', 'trainer_accounts FK trainer_row_id -> trainers.id',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'f' and confrelid = to_regclass('public.trainers')) then 'GREEN' else 'RED' end,
         coalesce((select 'on delete ' || case confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default' else confdeltype::text end
                   from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'f' and confrelid = to_regclass('public.trainers') limit 1), 'missing'),
         'on delete restrict', ''
  union all
  select 'C_CONSTRAINTS', 'trainer_accounts FK auth_user_id -> auth.users.id',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'f' and confrelid = to_regclass('auth.users')) then 'GREEN' else 'RED' end,
         coalesce((select 'on delete ' || case confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default' else confdeltype::text end
                   from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype = 'f' and confrelid = to_regclass('auth.users') limit 1), 'missing'),
         'on delete cascade', ''
  union all
  select 'C_CONSTRAINTS', 'trainer_account_audit_log PRIMARY KEY',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_account_audit_log') and contype = 'p') then 'GREEN' else 'RED' end,
         exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_account_audit_log') and contype = 'p')::text,
         'true', ''
  union all
  select 'C_CONSTRAINTS', 'trainer_account_audit_log FK performed_by_auth_user_id -> auth.users.id',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_account_audit_log') and contype = 'f' and confrelid = to_regclass('auth.users')) then 'GREEN' else 'RED' end,
         coalesce((select 'on delete ' || case confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default' else confdeltype::text end
                   from pg_constraint where conrelid = to_regclass('public.trainer_account_audit_log') and contype = 'f' and confrelid = to_regclass('auth.users') limit 1), 'missing'),
         'on delete restrict', ''
  union all
  select 'C_CONSTRAINTS', 'trainer_account_audit_log FK target_trainer_row_id -> trainers.id',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_account_audit_log') and contype = 'f' and confrelid = to_regclass('public.trainers')) then 'GREEN' else 'RED' end,
         coalesce((select 'on delete ' || case confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default' else confdeltype::text end
                   from pg_constraint where conrelid = to_regclass('public.trainer_account_audit_log') and contype = 'f' and confrelid = to_regclass('public.trainers') limit 1), 'missing'),
         'on delete restrict', ''
  union all
  select 'C_CONSTRAINTS', 'trainer_account_audit_log CHECK(operation)',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_account_audit_log') and contype = 'c') then 'GREEN' else 'RED' end,
         exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_account_audit_log') and contype = 'c')::text,
         'true', ''
),

-- ── D. Функции: существование, сигнатура, security, search_path, гранты ─
d_targets(fname, expected_sig, expected_sec) as (
  values
    -- Family layer prerequisites (создаются самим TRAINER_AUTH_PRODUCTION_DEPLOY.sql,
    -- раздел FAMILY LAYER FUNCTION PREREQUISITES, дословно из migrations 001-002)
    ('public.set_updated_at', '()', 'INVOKER'),
    ('public.family_club_exists', '(text)', 'DEFINER'),
    ('public.normalize_family_nickname', '(text)', 'INVOKER'),
    -- Trainer Auth (migrations 011-026)
    ('public.normalize_login_name', '(text)', 'INVOKER'),
    ('public.resolve_trainer_login_email', '(text,text)', 'DEFINER'),
    ('public.rename_trainer_login', '(uuid,text)', 'DEFINER'),
    ('public.get_current_trainer_profile', '()', 'DEFINER'),
    ('private.current_active_trainer_account_id', '()', 'DEFINER'),
    ('public.get_current_trainer_groups', '()', 'DEFINER'),
    ('public.can_trainer_access_student', '(bigint)', 'DEFINER'),
    ('public.search_trainer_students', '(text)', 'DEFINER'),
    ('public.trainer_has_active_account', '(text,text)', 'DEFINER'),
    ('public.trainer_has_any_account', '(text,text)', 'DEFINER'),
    ('public.log_trainer_account_operation', '(uuid,bigint,text,text,text)', 'DEFINER')
),
d_exist_rows as (
  select 'D_FUNCTIONS'::text as section, t.fname || t.expected_sig || ' exists+signature' as check_name,
         case when to_regprocedure(t.fname || t.expected_sig) is not null then 'GREEN' else 'RED' end as status,
         coalesce((select pg_get_function_identity_arguments(oid) || ' returns ' || pg_get_function_result(oid) from pg_proc where oid = to_regprocedure(t.fname || t.expected_sig)), 'MISSING') as actual_value,
         t.expected_sig as expected_value, ''::text as details
  from d_targets t
  union all
  select 'D_FUNCTIONS', t.fname || t.expected_sig || ' security',
         case
           when to_regprocedure(t.fname || t.expected_sig) is null then 'RED'
           when (select prosecdef from pg_proc where oid = to_regprocedure(t.fname || t.expected_sig)) = (t.expected_sec = 'DEFINER') then 'GREEN'
           else 'RED'
         end,
         coalesce((select case when prosecdef then 'DEFINER' else 'INVOKER' end from pg_proc where oid = to_regprocedure(t.fname || t.expected_sig)), 'MISSING'),
         t.expected_sec, ''
  from d_targets t
  union all
  select 'D_FUNCTIONS', t.fname || t.expected_sig || ' search_path',
         'INFO',
         coalesce((select coalesce(array_to_string(proconfig, ';'), '(not set)') from pg_proc where oid = to_regprocedure(t.fname || t.expected_sig)), 'MISSING'),
         case when t.expected_sec = 'DEFINER' then 'search_path=(empty), задан явно' else 'не задан (не требуется — не SECURITY DEFINER)' end,
         ''
  from d_targets t
  union all
  select 'D_FUNCTIONS', t.fname || t.expected_sig || ' owner', 'INFO',
         coalesce((select pg_get_userbyid(proowner) from pg_proc where oid = to_regprocedure(t.fname || t.expected_sig)), 'MISSING'),
         'любой (обычно postgres/владелец проекта)', ''
  from d_targets t
),
d_grant_roles(role_name, display_name) as (
  values ('anon','anon'), ('authenticated','authenticated'), ('service_role','service_role'), ('public','PUBLIC')
),
d_grant_rows as (
  -- ПРИМЕЧАНИЕ: PUBLIC EXECUTE на функции с returns trigger НЕ считается
  -- проблемой — Postgres физически не позволяет вызвать trigger-функцию
  -- как обычный RPC независимо от грантов (эмпирически подтверждено в
  -- этом проекте ранее, см. migration 014). public.set_updated_at() —
  -- ровно такой случай: migration 001 никогда её не revoke'ила от public,
  -- это дословно сохранённое исходное поведение, не новый пробел.
  select 'D_FUNCTIONS'::text as section, t.fname || t.expected_sig || ' EXECUTE grant to ' || r.display_name as check_name,
         case
           when to_regprocedure(t.fname || t.expected_sig) is null then 'RED'
           when r.role_name = 'public'
                and has_function_privilege('public', to_regprocedure(t.fname || t.expected_sig), 'EXECUTE')
                and coalesce((select pg_get_function_result(oid) from pg_proc where oid = to_regprocedure(t.fname || t.expected_sig)), '') <> 'trigger'
             then 'RED'
           else 'INFO'
         end as status,
         case when to_regprocedure(t.fname || t.expected_sig) is null then 'function missing'
              else has_function_privilege(r.role_name, to_regprocedure(t.fname || t.expected_sig), 'EXECUTE')::text end as actual_value,
         case
           when r.display_name = 'PUBLIC'
                and coalesce((select pg_get_function_result(oid) from pg_proc where oid = to_regprocedure(t.fname || t.expected_sig)), '') = 'trigger'
             then 'true допустимо — returns trigger, вызов как RPC невозможен независимо от грантов'
           when r.display_name = 'PUBLIC' then 'false (нежелательный PUBLIC EXECUTE)'
           else 'см. TRAINER_AUTH_ARCHITECTURE.md / соответствующую миграцию для точного списка ролей на эту функцию'
         end as expected_value,
         ''::text as details
  from d_targets t
  cross join d_grant_roles r
),

-- ── E. Triggers на trainer_accounts ──────────────────────────────────
e_targets(tname) as (
  values ('trg_trainer_accounts_set_updated_at'), ('trg_trainer_accounts_login_name_immutable'),
         ('trg_trainer_accounts_club_match'), ('trg_trainer_accounts_club_exists')
),
e_rows as (
  select 'E_TRIGGERS'::text as section, t.tname as check_name,
         case when exists(select 1 from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid
                           where cl.relname = 'trainer_accounts' and tg.tgname = t.tname and not tg.tgisinternal) then 'GREEN' else 'RED' end as status,
         exists(select 1 from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid
                where cl.relname = 'trainer_accounts' and tg.tgname = t.tname and not tg.tgisinternal)::text as actual_value,
         'true'::text as expected_value, ''::text as details
  from e_targets t
),

-- ── F. RLS + policies ────────────────────────────────────────────────
f_rows as (
  select 'F_RLS'::text as section, 'trainer_accounts RLS enabled'::text as check_name,
         case when coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.trainer_accounts')), false) then 'GREEN' else 'RED' end as status,
         coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.trainer_accounts')), 'table missing') as actual_value,
         'true'::text as expected_value, ''::text as details
  union all
  select 'F_RLS', 'trainer_accounts policy count', 'INFO',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'trainer_accounts'),
         '0 (доступ только через SECURITY DEFINER функции, по дизайну)', ''
  union all
  select 'F_RLS', 'trainer_account_audit_log RLS enabled',
         case when coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.trainer_account_audit_log')), false) then 'GREEN' else 'RED' end,
         coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.trainer_account_audit_log')), 'table missing'),
         'true', ''
  union all
  select 'F_RLS', 'trainer_account_audit_log policy count', 'INFO',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'trainer_account_audit_log'),
         '0 (доступ только через log_trainer_account_operation, по дизайну)', ''
),

-- ── G. Целостность данных (агрегаты, без PII) ────────────────────────
g_rows as (
  select 'G_DATA_INTEGRITY'::text as section, 'duplicate_trainer_row_id_groups'::text as check_name,
         case when to_regclass('public.trainer_accounts') is null then 'INFO'
              when (select count(*) from (select trainer_row_id from public.trainer_accounts group by trainer_row_id having count(*) > 1) x) > 0 then 'RED'
              else 'GREEN' end as status,
         coalesce((select count(*)::text from (select trainer_row_id from public.trainer_accounts group by trainer_row_id having count(*) > 1) x), 'table missing') as actual_value,
         '0'::text as expected_value, ''::text as details
  where to_regclass('public.trainer_accounts') is not null
  union all
  select 'G_DATA_INTEGRITY', 'duplicate_club_id_normalized_login_name_groups',
         case when (select count(*) from (select club_id, normalized_login_name from public.trainer_accounts group by club_id, normalized_login_name having count(*) > 1) x) > 0 then 'RED' else 'GREEN' end,
         (select count(*)::text from (select club_id, normalized_login_name from public.trainer_accounts group by club_id, normalized_login_name having count(*) > 1) x),
         '0', ''
  where to_regclass('public.trainer_accounts') is not null
  union all
  select 'G_DATA_INTEGRITY', 'orphaned_trainer_row_id',
         case when (select count(*) from public.trainer_accounts ta left join public.trainers t on t.id = ta.trainer_row_id where t.id is null) > 0 then 'RED' else 'GREEN' end,
         (select count(*)::text from public.trainer_accounts ta left join public.trainers t on t.id = ta.trainer_row_id where t.id is null),
         '0', ''
  where to_regclass('public.trainer_accounts') is not null and to_regclass('public.trainers') is not null
  union all
  select 'G_DATA_INTEGRITY', 'club_id_mismatch_trainer_accounts_vs_trainers',
         case when (select count(*) from public.trainer_accounts ta join public.trainers t on t.id = ta.trainer_row_id where ta.club_id is distinct from t.club_id) > 0 then 'RED' else 'GREEN' end,
         (select count(*)::text from public.trainer_accounts ta join public.trainers t on t.id = ta.trainer_row_id where ta.club_id is distinct from t.club_id),
         '0', ''
  where to_regclass('public.trainer_accounts') is not null and to_regclass('public.trainers') is not null
),

-- ── H. Bootstrap-администратор (только информационно, не влияет на RED/YELLOW) ─
h_rows as (
  select 'H_BOOTSTRAP_INFO'::text as section, 'active_auth_admins_count'::text as check_name,
         'INFO'::text as status,
         (select count(*)::text from public.trainer_accounts ta join public.trainers t on t.id = ta.trainer_row_id where ta.is_active = true and t.rolle = 'Admin') as actual_value,
         '>= 1 (после выполнения bootstrap template)'::text as expected_value,
         'Не влияет на итоговый статус инфраструктуры — это отдельный операционный шаг (bootstrap), а не структурная готовность схемы. Если 0 — выполните TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE.sql перед тем, как считать этап завершённым для реального использования.'::text as details
  where to_regclass('public.trainer_accounts') is not null and to_regclass('public.trainers') is not null
),

-- ── H2. Схема private + private.current_active_trainer_account_id() ────
-- Явные GREEN/RED-проверки (не полагаемся только на общий INFO-паттерн
-- d_grant_rows) — эта схема/функция добавлены в deploy отдельным фиксом
-- (FAMILY LAYER PREREQUISITES) поверх исходных migrations 008/009/014.
h2_rows as (
  select 'H2_PRIVATE_SCHEMA'::text as section, 'schema private exists'::text as check_name,
         case when to_regnamespace('private') is not null then 'GREEN' else 'RED' end as status,
         (to_regnamespace('private') is not null)::text as actual_value,
         'true'::text as expected_value, ''::text as details
  union all
  select 'H2_PRIVATE_SCHEMA', 'schema private USAGE for PUBLIC',
         case when coalesce(has_schema_privilege('public', to_regnamespace('private'), 'USAGE'), true) then 'RED' else 'GREEN' end,
         coalesce(has_schema_privilege('public', to_regnamespace('private'), 'USAGE')::text, 'schema missing'),
         'false', ''
  union all
  select 'H2_PRIVATE_SCHEMA', 'schema private USAGE for anon',
         case when coalesce(has_schema_privilege('anon', to_regnamespace('private'), 'USAGE'), true) then 'RED' else 'GREEN' end,
         coalesce(has_schema_privilege('anon', to_regnamespace('private'), 'USAGE')::text, 'schema missing'),
         'false', ''
  union all
  select 'H2_PRIVATE_SCHEMA', 'schema private USAGE for authenticated',
         case when coalesce(has_schema_privilege('authenticated', to_regnamespace('private'), 'USAGE'), false) then 'GREEN' else 'RED' end,
         coalesce(has_schema_privilege('authenticated', to_regnamespace('private'), 'USAGE')::text, 'schema missing'),
         'true', ''
  union all
  select 'H2_PRIVATE_SCHEMA', 'private.current_active_trainer_account_id() exists+signature',
         case when to_regprocedure('private.current_active_trainer_account_id()') is not null then 'GREEN' else 'RED' end,
         coalesce((select pg_get_function_identity_arguments(oid) || ' returns ' || pg_get_function_result(oid) from pg_proc where oid = to_regprocedure('private.current_active_trainer_account_id()')), 'MISSING'),
         '() returns uuid', ''
  union all
  select 'H2_PRIVATE_SCHEMA', 'private.current_active_trainer_account_id() return type',
         case when coalesce((select pg_get_function_result(oid) from pg_proc where oid = to_regprocedure('private.current_active_trainer_account_id()')), '') = 'uuid' then 'GREEN' else 'RED' end,
         coalesce((select pg_get_function_result(oid) from pg_proc where oid = to_regprocedure('private.current_active_trainer_account_id()')), 'MISSING'),
         'uuid', ''
  union all
  select 'H2_PRIVATE_SCHEMA', 'private.current_active_trainer_account_id() security',
         case when coalesce((select prosecdef from pg_proc where oid = to_regprocedure('private.current_active_trainer_account_id()')), false) then 'GREEN' else 'RED' end,
         coalesce((select case when prosecdef then 'DEFINER' else 'INVOKER' end from pg_proc where oid = to_regprocedure('private.current_active_trainer_account_id()')), 'MISSING'),
         'DEFINER', ''
  union all
  select 'H2_PRIVATE_SCHEMA', 'private.current_active_trainer_account_id() search_path',
         -- Формат сериализации proconfig для пустого search_path зависит от
         -- версии Postgres (замечено на практике: PG17 отдаёт 'search_path=""',
         -- а не 'search_path=') — сравниваем по регулярному выражению на
         -- плоской строке, а не буквальным равенством или сравнением массива.
         case when coalesce((select array_to_string(proconfig, ';') from pg_proc where oid = to_regprocedure('private.current_active_trainer_account_id()')), '') ~ '^search_path=("")?$'
              then 'GREEN' else 'RED' end,
         coalesce((select coalesce(array_to_string(proconfig, ';'), '(not set)') from pg_proc where oid = to_regprocedure('private.current_active_trainer_account_id()')), 'MISSING'),
         'search_path= или search_path="" (пусто, задан явно)', ''
  union all
  select 'H2_PRIVATE_SCHEMA', 'private.current_active_trainer_account_id() EXECUTE for PUBLIC',
         case when coalesce(has_function_privilege('public', to_regprocedure('private.current_active_trainer_account_id()'), 'EXECUTE'), true) then 'RED' else 'GREEN' end,
         coalesce(has_function_privilege('public', to_regprocedure('private.current_active_trainer_account_id()'), 'EXECUTE')::text, 'function missing'),
         'false', ''
  union all
  select 'H2_PRIVATE_SCHEMA', 'private.current_active_trainer_account_id() EXECUTE for anon',
         case when coalesce(has_function_privilege('anon', to_regprocedure('private.current_active_trainer_account_id()'), 'EXECUTE'), true) then 'RED' else 'GREEN' end,
         coalesce(has_function_privilege('anon', to_regprocedure('private.current_active_trainer_account_id()'), 'EXECUTE')::text, 'function missing'),
         'false', ''
  union all
  select 'H2_PRIVATE_SCHEMA', 'private.current_active_trainer_account_id() EXECUTE for authenticated',
         case when coalesce(has_function_privilege('authenticated', to_regprocedure('private.current_active_trainer_account_id()'), 'EXECUTE'), false) then 'GREEN' else 'RED' end,
         coalesce(has_function_privilege('authenticated', to_regprocedure('private.current_active_trainer_account_id()'), 'EXECUTE')::text, 'function missing'),
         'true', ''
),

all_rows as (
  select * from a_rows
  union all select * from b_ta_rows
  union all select * from b_audit_rows
  union all select * from c_rows
  union all select * from d_exist_rows
  union all select * from d_grant_rows
  union all select * from e_rows
  union all select * from f_rows
  union all select * from g_rows
  union all select * from h_rows
  union all select * from h2_rows
),

-- Итоговый статус считается ТОЛЬКО по строкам, для которых RED реально
-- означает проблему инфраструктуры (H_BOOTSTRAP_INFO сознательно исключён
-- из подсчёта — см. details этой секции).
final_rows as (
  select * from all_rows
  union all
  select
    'I_SUMMARY' as section,
    'POST_DEPLOY_SMOKE_TEST' as check_name,
    case
      when count(*) filter (where status = 'RED' and section <> 'H_BOOTSTRAP_INFO') > 0 then 'RED'
      when count(*) filter (where status = 'YELLOW' and section <> 'H_BOOTSTRAP_INFO') > 0 then 'YELLOW'
      else 'GREEN'
    end as status,
    'red=' || count(*) filter (where status = 'RED' and section <> 'H_BOOTSTRAP_INFO')
      || ', yellow=' || count(*) filter (where status = 'YELLOW' and section <> 'H_BOOTSTRAP_INFO')
      || ', green=' || count(*) filter (where status = 'GREEN' and section <> 'H_BOOTSTRAP_INFO') as actual_value,
    'red=0' as expected_value,
    case
      when count(*) filter (where status = 'RED' and section <> 'H_BOOTSTRAP_INFO') > 0
        then 'Есть конкретная ошибка, переход к UI запрещён. Смотреть строки со статусом RED выше.'
      when count(*) filter (where status = 'YELLOW' and section <> 'H_BOOTSTRAP_INFO') > 0
        then 'Deploy выполнен, но есть неблокирующее ручное действие — смотреть строки со статусом YELLOW выше.'
      else 'Trainer Auth infrastructure complete. Перейти к страницам тренера и семейным страницам.'
    end as details
  from all_rows
)

select section, check_name, status, actual_value, expected_value, details
from final_rows
order by
  case status when 'RED' then 1 when 'YELLOW' then 2 when 'GREEN' then 3 else 4 end,
  section, check_name;
