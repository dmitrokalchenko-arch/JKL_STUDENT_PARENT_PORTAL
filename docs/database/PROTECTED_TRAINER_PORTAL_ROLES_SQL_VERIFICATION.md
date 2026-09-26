# SQL verification — migration 20261002100078 (protected Trainer Portal roles)

> Ручной запуск в Supabase SQL Editor (роль `postgres`), по одному блоку.
> Этот документ **не содержит команды применения** миграции. SQL ещё не исполнялся
> (Docker недоступен, локальной БД нет) — синтаксис проверен только чтением.

| Стадия | Когда | Что | Изменяет данные |
|---|---|---|---|
| A. PRECHECK | до применения 078 | структура, отсутствие portal_role, перегрузки, права, 077, аудит | нет |
| B. APPLY 078 | отдельное решение | файл миграции целиком (явная транзакция + самопроверка) | да |
| C1. POST static | после 078 | колонка, CHECK, хелперы, гейты, права, триггер, аудит | нет |
| C2/C3. POST runtime | после 078, по желанию | поведение Trainer и симуляция Admin | нет — блок **всегда** откатывается (RAISE в конце) |
| D. BOOTSTRAP | отдельное решение владельца после C | первый Portal Admin | да |
| E. Edge | после 078 | `manage-trainer-account` всё ещё 403 | нет |

## A. PRECHECK — READ-ONLY

Ожидается: все строки `PASS` или `INFO`. `FAIL` — не применять 078. `CHECK` — разобрать
(например, P22: точный текст ограничения аудита может отличаться форматированием).

```sql
-- PRECHECK 078: READ-ONLY. Catalog metadata and aggregate counts only.
-- No PII, no PIN/hash, no email, no names, no row values.
with
t as (select to_regclass('public.trainer_accounts') as ta, to_regclass('public.trainer_account_audit_log') as al),
client_rpc(sig) as (
  values ('public.get_current_trainer_profile()'),
         ('public.can_trainer_access_student(bigint)'),
         ('public.search_trainer_students(text)'),
         ('public.get_trainer_student_page_config()'),
         ('public.save_trainer_student_page_config(jsonb)'),
         ('public.get_trainer_kyu_program(bigint)'),
         ('public.save_trainer_kyu_program(bigint,jsonb)'),
         ('public.get_trainer_kyu_template(bigint,text)'),
         ('public.save_trainer_kyu_template(bigint,text,jsonb)')
),
svc_fn(sig) as (
  values ('public.rename_trainer_login(uuid,text)'),
         ('public.log_trainer_account_operation(bigint,uuid,bigint,text,text,text)'),
         ('public.rename_family_nickname(uuid,text)')
),
new_names(proname) as (
  values ('current_trainer_portal_role'), ('is_current_trainer_portal_admin'),
         ('enforce_trainer_accounts_last_active_admin')
),
acc as (
  select a.id, a.auth_user_id, a.trainer_row_id, a.club_id, a.is_active,
         t2.id as t_id, t2.club_id::text as t_club_id,
         count(*) over (partition by a.auth_user_id) as n_auth,
         count(*) over (partition by a.trainer_row_id) as n_row
  from public.trainer_accounts a
  left join public.trainers t2 on t2.id = a.trainer_row_id
)
select * from (
  -- 1. trainer_accounts structure
  select 'P01' as id, 'trainer_accounts columns' as check_name,
         'id,auth_user_id,trainer_row_id,club_id,login_name,normalized_login_name,display_name,is_active,created_at,updated_at' as expected,
         (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
           where a.attrelid = (select ta from t) and a.attnum > 0 and not a.attisdropped) as actual,
         'INFO' as status
  union all
  select 'P02', 'portal_role column absent', 'absent',
         case when exists (select 1 from pg_attribute a where a.attrelid = (select ta from t)
                            and a.attname = 'portal_role' and not a.attisdropped) then 'PRESENT' else 'absent' end,
         case when exists (select 1 from pg_attribute a where a.attrelid = (select ta from t)
                            and a.attname = 'portal_role' and not a.attisdropped) then 'FAIL' else 'PASS' end
  union all
  select 'P03', 'role-like columns on trainer_accounts', 'none',
         coalesce((select string_agg(a.attname, ',') from pg_attribute a
                   where a.attrelid = (select ta from t) and a.attnum > 0 and not a.attisdropped
                     and a.attname ~* '(role|admin|permission|privilege)'), 'none'),
         case when exists (select 1 from pg_attribute a where a.attrelid = (select ta from t) and a.attnum > 0
                            and not a.attisdropped and a.attname ~* '(role|admin|permission|privilege)')
              then 'FAIL' else 'PASS' end
  union all
  select 'P04', 'trainer_accounts constraints', '(info) portal_role check absent',
         (select string_agg(c.conname || ':' || c.contype::text, ', ' order by c.conname) from pg_constraint c
           where c.conrelid = (select ta from t)),
         case when exists (select 1 from pg_constraint c where c.conrelid = (select ta from t)
                            and c.conname = 'trainer_accounts_portal_role_check') then 'FAIL' else 'PASS' end
  union all
  select 'P05', 'trainer_accounts indexes', '(info)',
         (select string_agg(i.indexname, ', ' order by i.indexname) from pg_indexes i
           where i.schemaname = 'public' and i.tablename = 'trainer_accounts'),
         'INFO'
  union all
  select 'P06', 'trainer_accounts triggers', '(info) last-admin trigger absent',
         (select string_agg(tg.tgname || ':' || tg.tgenabled::text, ', ' order by tg.tgname) from pg_trigger tg
           where tg.tgrelid = (select ta from t) and not tg.tgisinternal),
         case when exists (select 1 from pg_trigger tg where tg.tgrelid = (select ta from t)
                            and tg.tgname = 'trg_trainer_accounts_last_active_admin') then 'FAIL' else 'PASS' end
  union all
  select 'P07', 'table owner trainer_accounts / audit_log', 'postgres / postgres',
         (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = (select ta from t)) || ' / ' ||
         (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = (select al from t)),
         case when (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = (select ta from t)) = 'postgres'
               and (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = (select al from t)) = 'postgres'
              then 'PASS' else 'CHECK' end

  -- 3 / 8 / 9 / 10. counts and consistency
  union all
  select 'P08', 'accounts total / active (all will get portal_role=trainer)', '(info)',
         (select count(*)::text || ' / ' || count(*) filter (where is_active)::text from acc), 'INFO'
  union all
  select 'P09', 'accounts without trainers row / club mismatch', '0 / 0',
         (select count(*) filter (where t_id is null)::text || ' / '
                 || count(*) filter (where t_id is not null and t_club_id is distinct from club_id)::text from acc),
         case when (select count(*) filter (where t_id is null or t_club_id is distinct from club_id) from acc) = 0
              then 'PASS' else 'FAIL' end
  union all
  select 'P10', 'duplicate auth_user_id / trainer_row_id', '0 / 0',
         (select count(*) filter (where n_auth > 1)::text || ' / ' || count(*) filter (where n_row > 1)::text from acc),
         case when (select count(*) filter (where n_auth > 1 or n_row > 1) from acc) = 0 then 'PASS' else 'FAIL' end

  -- 4. helper / object name conflicts
  union all
  select 'P11', 'name conflicts for new functions (any schema)', '0',
         (select count(*)::text from pg_proc p where p.proname in (select proname from new_names)),
         case when (select count(*) from pg_proc p where p.proname in (select proname from new_names)) = 0
              then 'PASS' else 'FAIL' end
  union all
  select 'P12', 'functions referencing portal_role (public/private)', '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'private') and coalesce(p.prosrc, '') ~* 'portal_role'),
         case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in ('public', 'private') and coalesce(p.prosrc, '') ~* 'portal_role') = 0
              then 'PASS' else 'FAIL' end
  union all
  select 'P13', 'schema private exists (owner)', 'postgres',
         coalesce((select pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname = 'private'), 'MISSING'),
         case when (select pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname = 'private') = 'postgres'
              then 'PASS' else 'CHECK' end

  -- 5 / 6. signatures, overloads, properties, grants of RPCs 078 replaces
  union all
  select 'P14', 'RPC ' || c.sig,
         'exists, 1 overload, definer, search_path="", owner postgres, anon=f auth=t',
         case when p.oid is null then 'MISSING' else
           'overloads=' || (select count(*) from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace
                             where n2.nspname = 'public' and p2.proname = p.proname)::text
           || ' definer=' || p.prosecdef::text
           || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '(none)')
           || ' owner=' || pg_get_userbyid(p.proowner)
           || ' public=' || (exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text
           || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
           || ' auth=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text end,
         case when p.oid is not null
               and (select count(*) from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace
                     where n2.nspname = 'public' and p2.proname = p.proname) = 1
               and p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
               and pg_get_userbyid(p.proowner) = 'postgres'
               and not has_function_privilege('anon', p.oid, 'EXECUTE')
               and has_function_privilege('authenticated', p.oid, 'EXECUTE')
              then 'PASS' else 'FAIL' end
  from client_rpc c left join pg_proc p on p.oid = to_regprocedure(c.sig)
  union all
  select 'P15', 'get_current_trainer_profile result type',
         'TABLE(trainer_account_id uuid, club_id text, display_name text, is_active boolean)',
         pg_get_function_result(to_regprocedure('public.get_current_trainer_profile()')),
         case when pg_get_function_result(to_regprocedure('public.get_current_trainer_profile()'))
                   = 'TABLE(trainer_account_id uuid, club_id text, display_name text, is_active boolean)'
              then 'PASS' else 'FAIL' end
  union all
  select 'P16', 'objects depending on get_current_trainer_profile (DROP safety)', '0',
         (select count(*)::text from pg_depend d
           where d.refclassid = 'pg_catalog.pg_proc'::regclass
             and d.refobjid = to_regprocedure('public.get_current_trainer_profile()') and d.deptype = 'n'),
         case when (select count(*) from pg_depend d
                     where d.refclassid = 'pg_catalog.pg_proc'::regclass
                       and d.refobjid = to_regprocedure('public.get_current_trainer_profile()') and d.deptype = 'n') = 0
              then 'PASS' else 'FAIL' end
  union all
  select 'P17', 'other functions calling get_current_trainer_profile (info)', '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'private') and p.proname <> 'get_current_trainer_profile'
             and coalesce(p.prosrc, '') ~* 'get_current_trainer_profile'),
         'INFO'

  -- 7 / 12. RLS and migration 077 hardening
  union all
  select 'P18', 'trainer_accounts RLS enabled/forced, policies', 'true/false, 0',
         (select c.relrowsecurity::text || '/' || c.relforcerowsecurity::text from pg_class c where c.oid = (select ta from t))
           || ', ' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'trainer_accounts')::text,
         case when (select c.relrowsecurity and not c.relforcerowsecurity from pg_class c where c.oid = (select ta from t))
               and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'trainer_accounts') = 0
              then 'PASS' else 'FAIL' end
  union all
  select 'P19', '077: anon/authenticated table privileges on trainer_accounts', 'none',
         coalesce(nullif(concat_ws(',',
           case when has_table_privilege('anon', (select ta from t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then 'anon' end,
           case when has_table_privilege('authenticated', (select ta from t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then 'authenticated' end), ''), 'none'),
         case when not has_table_privilege('anon', (select ta from t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               and not has_table_privilege('authenticated', (select ta from t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              then 'PASS' else 'FAIL' end
  union all
  select 'P20', '077: service_role CRUD on trainer_accounts', 'true',
         has_table_privilege('service_role', (select ta from t), 'SELECT')::text,
         case when has_table_privilege('service_role', (select ta from t), 'SELECT')
               and has_table_privilege('service_role', (select ta from t), 'INSERT')
               and has_table_privilege('service_role', (select ta from t), 'UPDATE')
               and has_table_privilege('service_role', (select ta from t), 'DELETE')
              then 'PASS' else 'FAIL' end
  union all
  -- 13. manage-trainer-account DB dependencies (077) untouched
  select 'P21', '077: ' || s.sig, 'exists, anon=f auth=f service_role=t',
         case when p.oid is null then 'MISSING' else
           'anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
           || ' auth=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
           || ' service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text end,
         case when p.oid is not null and not has_function_privilege('anon', p.oid, 'EXECUTE')
               and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
               and has_function_privilege('service_role', p.oid, 'EXECUTE') then 'PASS' else 'FAIL' end
  from svc_fn s left join pg_proc p on p.oid = to_regprocedure(s.sig)

  -- audit constraint that 078 replaces
  union all
  select 'P22', 'audit operation check (exact name/definition)',
         'CHECK ((operation = ANY (ARRAY[''create''::text, ''update''::text, ''activate''::text, ''deactivate''::text])))',
         coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                   where c.conrelid = (select al from t) and c.conname = 'trainer_account_audit_log_operation_check'), 'MISSING'),
         case when (select pg_get_constraintdef(c.oid) from pg_constraint c
                    where c.conrelid = (select al from t) and c.conname = 'trainer_account_audit_log_operation_check')
                   = 'CHECK ((operation = ANY (ARRAY[''create''::text, ''update''::text, ''activate''::text, ''deactivate''::text])))'
              then 'PASS' else 'CHECK' end
  union all
  select 'P23', 'audit rows total / with unexpected operation', '(info) / 0',
         (select count(*)::text || ' / ' || count(*) filter (where operation not in ('create', 'update', 'activate', 'deactivate'))::text
          from public.trainer_account_audit_log),
         case when (select count(*) filter (where operation not in ('create', 'update', 'activate', 'deactivate'))
                    from public.trainer_account_audit_log) = 0 then 'PASS' else 'FAIL' end

  -- 14. runtime prerequisites
  union all
  select 'P24', 'default_transaction_isolation', 'read committed',
         current_setting('default_transaction_isolation'),
         case when current_setting('default_transaction_isolation') = 'read committed' then 'PASS' else 'CHECK' end
  union all
  select 'P25', 'hashtextextended available / server_version_num', 'yes / >= 110000',
         (to_regprocedure('pg_catalog.hashtextextended(text,bigint)') is not null)::text || ' / ' || current_setting('server_version_num'),
         case when to_regprocedure('pg_catalog.hashtextextended(text,bigint)') is not null
               and current_setting('server_version_num')::int >= 110000 then 'PASS' else 'FAIL' end
) q
order by id, check_name;
```

## C1. POST static — READ-ONLY

Ожидается: все строки `PASS` (V03 до bootstrap: `N / 0 / 0`).

```sql
-- POST-078 C1: READ-ONLY static verification (catalog metadata + aggregate counts).
with
t as (select to_regclass('public.trainer_accounts') as ta),
internal_fn(sig) as (
  values ('private.current_trainer_portal_role()'),
         ('private.is_current_trainer_portal_admin()'),
         ('private.enforce_trainer_accounts_last_active_admin()'),
         ('public.rename_trainer_login(uuid,text)'),
         ('public.log_trainer_account_operation(bigint,uuid,bigint,text,text,text)'),
         ('public.rename_family_nickname(uuid,text)')
),
client_rpc(sig, gated) as (
  values ('public.get_current_trainer_profile()', false),
         ('public.get_trainer_student_page_config()', false),
         ('public.can_trainer_access_student(bigint)', true),
         ('public.search_trainer_students(text)', true),
         ('public.save_trainer_student_page_config(jsonb)', true),
         ('public.get_trainer_kyu_program(bigint)', true),
         ('public.save_trainer_kyu_program(bigint,jsonb)', true),
         ('public.get_trainer_kyu_template(bigint,text)', true),
         ('public.save_trainer_kyu_template(bigint,text,jsonb)', true)
)
select * from (
  select 'V01' as id, 'portal_role type / not null / default' as check_name,
         'text / true / ''trainer''::text' as expected,
         (select format_type(a.atttypid, a.atttypmod) || ' / ' || a.attnotnull::text || ' / '
                 || coalesce(pg_get_expr(d.adbin, d.adrelid), '(none)')
          from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = (select ta from t) and a.attname = 'portal_role' and not a.attisdropped) as actual,
         case when (select format_type(a.atttypid, a.atttypmod) = 'text' and a.attnotnull
                           and pg_get_expr(d.adbin, d.adrelid) = '''trainer''::text'
                    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                    where a.attrelid = (select ta from t) and a.attname = 'portal_role' and not a.attisdropped)
              then 'PASS' else 'FAIL' end as status
  union all
  select 'V02', 'portal_role CHECK', 'trainer, admin only',
         coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                   where c.conrelid = (select ta from t) and c.conname = 'trainer_accounts_portal_role_check'), 'MISSING'),
         case when (select pg_get_constraintdef(c.oid) from pg_constraint c
                    where c.conrelid = (select ta from t) and c.conname = 'trainer_accounts_portal_role_check')
                   = 'CHECK ((portal_role = ANY (ARRAY[''trainer''::text, ''admin''::text])))' then 'PASS' else 'FAIL' end
  union all
  select 'V03', 'accounts: trainer / admin / active admin (pre-bootstrap)', 'all / 0 / 0',
         (select count(*) filter (where portal_role = 'trainer')::text || ' / '
                 || count(*) filter (where portal_role = 'admin')::text || ' / '
                 || count(*) filter (where portal_role = 'admin' and is_active)::text
          from public.trainer_accounts),
         case when (select count(*) filter (where portal_role <> 'trainer') from public.trainer_accounts) = 0
              then 'PASS' else 'CHECK (admin present — expected only after bootstrap)' end
  union all
  select 'V04', 'client privileges on trainer_accounts / portal_role column', 'none',
         coalesce(nullif(concat_ws(',',
           case when has_table_privilege('anon', (select ta from t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then 'anon:table' end,
           case when has_table_privilege('authenticated', (select ta from t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then 'authenticated:table' end,
           case when has_column_privilege('anon', (select ta from t), 'portal_role', 'SELECT,INSERT,UPDATE') then 'anon:portal_role' end,
           case when has_column_privilege('authenticated', (select ta from t), 'portal_role', 'SELECT,INSERT,UPDATE') then 'authenticated:portal_role' end), ''), 'none'),
         case when not has_table_privilege('anon', (select ta from t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               and not has_table_privilege('authenticated', (select ta from t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
               and not has_column_privilege('anon', (select ta from t), 'portal_role', 'SELECT,INSERT,UPDATE')
               and not has_column_privilege('authenticated', (select ta from t), 'portal_role', 'SELECT,INSERT,UPDATE')
              then 'PASS' else 'FAIL' end
  union all
  select 'V05', 'trainer_accounts RLS enabled/forced, policies', 'true/false, 0',
         (select c.relrowsecurity::text || '/' || c.relforcerowsecurity::text from pg_class c where c.oid = (select ta from t))
           || ', ' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'trainer_accounts')::text,
         case when (select c.relrowsecurity and not c.relforcerowsecurity from pg_class c where c.oid = (select ta from t))
               and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'trainer_accounts') = 0
              then 'PASS' else 'FAIL' end
  union all
  select 'V06', 'internal ' || i.sig, 'definer, search_path="", no client EXECUTE',
         case when p.oid is null then 'MISSING' else
           'definer=' || p.prosecdef::text || ' config=' || coalesce(array_to_string(p.proconfig, ';'), '(none)')
           || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
           || ' auth=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
           || ' service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text end,
         case when p.oid is not null and p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
               and not has_function_privilege('anon', p.oid, 'EXECUTE')
               and not has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'PASS' else 'FAIL' end
  from internal_fn i left join pg_proc p on p.oid = to_regprocedure(i.sig)
  union all
  select 'V07', 'client RPC ' || c.sig,
         case when c.gated then '1 overload, anon=f auth=t, admin gate present' else '1 overload, anon=f auth=t, NO admin gate' end,
         case when p.oid is null then 'MISSING' else
           'overloads=' || (select count(*) from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace
                             where n2.nspname = 'public' and p2.proname = p.proname)::text
           || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
           || ' auth=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
           || ' gate=' || (coalesce(p.prosrc, '') like '%private.is_current_trainer_portal_admin()%')::text end,
         case when p.oid is not null
               and (select count(*) from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace
                     where n2.nspname = 'public' and p2.proname = p.proname) = 1
               and not has_function_privilege('anon', p.oid, 'EXECUTE')
               and has_function_privilege('authenticated', p.oid, 'EXECUTE')
               and (coalesce(p.prosrc, '') like '%private.is_current_trainer_portal_admin()%') = c.gated
              then 'PASS' else 'FAIL' end
  from client_rpc c left join pg_proc p on p.oid = to_regprocedure(c.sig)
  union all
  select 'V08', 'get_current_trainer_profile returns portal_role', 'contains portal_role text',
         pg_get_function_result(to_regprocedure('public.get_current_trainer_profile()')),
         case when pg_get_function_result(to_regprocedure('public.get_current_trainer_profile()')) like '%portal_role text%'
              then 'PASS' else 'FAIL' end
  union all
  select 'V09', 'last-active-admin trigger', 'present, enabled, BEFORE UPDATE OR DELETE',
         coalesce((select tg.tgname || ' enabled=' || tg.tgenabled::text || ' | ' || pg_get_triggerdef(tg.oid)
                   from pg_trigger tg where tg.tgrelid = (select ta from t) and tg.tgname = 'trg_trainer_accounts_last_active_admin'), 'MISSING'),
         case when exists (select 1 from pg_trigger tg where tg.tgrelid = (select ta from t)
                            and tg.tgname = 'trg_trainer_accounts_last_active_admin' and tg.tgenabled <> 'D')
              then 'PASS' else 'FAIL' end
  union all
  select 'V10', 'audit operation check', 'includes promote_admin, demote_admin',
         coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                   where c.conrelid = to_regclass('public.trainer_account_audit_log')
                     and c.conname = 'trainer_account_audit_log_operation_check'), 'MISSING'),
         case when (select pg_get_constraintdef(c.oid) from pg_constraint c
                    where c.conrelid = to_regclass('public.trainer_account_audit_log')
                      and c.conname = 'trainer_account_audit_log_operation_check') like '%promote_admin%demote_admin%'
              then 'PASS' else 'FAIL' end
  union all
  select 'V11', 'functions of 078 referencing legacy rolle', '0',
         (select count(*)::text from pg_proc p
           where p.oid in (select to_regprocedure(sig) from client_rpc union all select to_regprocedure(sig) from internal_fn)
             and coalesce(p.prosrc, '') ~* '\mrolle\M'),
         case when (select count(*) from pg_proc p
                    where p.oid in (select to_regprocedure(sig) from client_rpc union all select to_regprocedure(sig) from internal_fn)
                      and coalesce(p.prosrc, '') ~* '\mrolle\M') = 0 then 'PASS' else 'FAIL' end
) q
order by id, check_name;
```

## C2/C3. POST runtime — по желанию, гарантированный ROLLBACK

Блок имперсонирует существующий портальный аккаунт (обычный trainer) внутри одной
транзакции, временно повышает его до admin только для C3 и **всегда** завершается
`RAISE EXCEPTION` — все изменения откатываются. Отчёт — в тексте ошибки
(«POST-078 RUNTIME REPORT …»), только булевы значения и счётчики. Ожидается: все
пункты `PASS` (или `SKIP`, если в клубе нет подходящего ученика).

```sql
-- POST-078 C2/C3: OPTIONAL runtime verification with GUARANTEED ROLLBACK.
-- The whole DO block always ends with RAISE EXCEPTION, so every change made inside
-- it (including the temporary portal_role='admin' used for the Admin simulation in
-- C3 and any save that would wrongly succeed) is rolled back. Nothing persists.
-- Output: the report is in the ERROR message. Only booleans/counts are reported —
-- no names, ids of students or other personal data.
-- Test account: the existing production Portal account (ordinary trainer).
do $$
declare
  c_account_id constant uuid := '006f5fd3-9878-41fa-8c8e-3d301fe92ec4';
  v_acc record;
  v_kyu bigint;
  v_own bigint;
  v_other bigint;
  v_cross bigint;
  v_other_nachname text;
  v_cfg jsonb;
  v_prog_count integer;
  v_int integer;
  v_int2 integer;
  v_bool boolean;
  v_txt text;
  r text := '';
begin
  -- ── setup as the SQL Editor owner role (reads only) ──
  select ta.id, ta.auth_user_id, ta.club_id, t.trainer_id
    into v_acc
  from public.trainer_accounts ta
  join public.trainers t on t.id = ta.trainer_row_id
  where ta.id = c_account_id and ta.is_active and ta.portal_role = 'trainer';
  if v_acc.id is null then
    raise exception 'setup: test account not found, not active or not trainer';
  end if;

  select s.id into v_own
  from public.students s
  where s.club_id = v_acc.club_id
    and exists (
      select 1 from regexp_split_to_table(coalesce(s.gruppe_id, ''), '[;,]') as g
      join public.trainer_groups tg
        on tg.gruppe_id::text = trim(g) and tg.trainer_id = v_acc.trainer_id and tg.club_id = v_acc.club_id
      where trim(g) <> '')
  order by s.id limit 1;

  select s.id, s.nachname into v_other, v_other_nachname
  from public.students s
  where s.club_id = v_acc.club_id
    and not exists (
      select 1 from regexp_split_to_table(coalesce(s.gruppe_id, ''), '[;,]') as g
      join public.trainer_groups tg
        on tg.gruppe_id::text = trim(g) and tg.trainer_id = v_acc.trainer_id and tg.club_id = v_acc.club_id
      where trim(g) <> '')
  order by s.id limit 1;

  select s.id into v_cross from public.students s
  where s.club_id is distinct from v_acc.club_id order by s.id limit 1;

  select kl.id into v_kyu from public.kyu_lookup kl where kl.kyu_grad ilike '%Kyu%' order by kl.id limit 1;
  select csps.config into v_cfg from public.club_student_page_settings csps where csps.club_id = v_acc.club_id;
  select count(*) into v_prog_count from public.club_kyu_program_items ckpi
  where ckpi.club_id = v_acc.club_id and ckpi.kyu_lookup_id = v_kyu and ckpi.item_type = 'technique';

  r := r || format(' setup: own=%s other=%s cross=%s cfg=%s kyu=%s;',
                   v_own is not null, v_other is not null, v_cross is not null, v_cfg is not null, v_kyu is not null);

  -- impersonate the trainer (JWT claims + authenticated role, transaction-local)
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_acc.auth_user_id::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_acc.auth_user_id::text, true);
  execute 'set local role authenticated';

  -- ── C2: ordinary Trainer ──
  select p.portal_role into v_txt from public.get_current_trainer_profile() p;
  r := r || format(' T1 profile.portal_role=%s %s;', coalesce(v_txt, 'NULL'), case when v_txt = 'trainer' then 'PASS' else 'FAIL' end);

  r := r || format(' T2 own=%s %s | other=%s %s | cross=%s %s;',
    coalesce(public.can_trainer_access_student(v_own)::text, 'n/a'),
    case when v_own is null then 'SKIP' when public.can_trainer_access_student(v_own) then 'PASS' else 'FAIL' end,
    coalesce(public.can_trainer_access_student(v_other)::text, 'n/a'),
    case when v_other is null then 'SKIP' when not public.can_trainer_access_student(v_other) then 'PASS' else 'FAIL' end,
    coalesce(public.can_trainer_access_student(v_cross)::text, 'n/a'),
    case when v_cross is null then 'SKIP' when not public.can_trainer_access_student(v_cross) then 'PASS' else 'FAIL' end);

  select count(*), count(*) filter (where not public.can_trainer_access_student(x.id::bigint))
    into v_int, v_int2 from public.search_trainer_students('%') x;
  r := r || format(' T3 search rows=%s outside-scope=%s %s;', v_int, v_int2, case when v_int2 = 0 then 'PASS' else 'FAIL' end);

  v_bool := public.save_trainer_student_page_config(coalesce(v_cfg, '{}'::jsonb));
  r := r || format(' T4a save_page_config=%s %s;', v_bool, case when v_bool then 'FAIL' else 'PASS' end);
  v_bool := public.save_trainer_kyu_program(v_kyu, '[]'::jsonb);
  r := r || format(' T4b save_kyu_program=%s %s;', v_bool, case when v_bool then 'FAIL' else 'PASS' end);
  v_bool := public.save_trainer_kyu_template(v_kyu, 'djb', '[]'::jsonb);
  r := r || format(' T4c save_kyu_template=%s %s;', v_bool, case when v_bool then 'FAIL' else 'PASS' end);

  select count(*) into v_int from public.get_trainer_kyu_program(v_kyu);
  select count(*) into v_int2 from public.get_trainer_kyu_template(v_kyu, 'djb');
  r := r || format(' T5 editor GET program=%s template=%s %s;', v_int, v_int2,
                   case when v_int = 0 and v_int2 = 0 then 'PASS' else 'FAIL' end);

  v_bool := public.get_trainer_student_page_config() is not distinct from v_cfg;
  r := r || format(' T6a runtime page_config readable=%s %s;', v_bool, case when v_bool then 'PASS' else 'FAIL' end);
  if v_own is not null then
    v_txt := public.get_trainer_required_techniques(v_own) ->> 'status';
    r := r || format(' T6b required_techniques(own).status=%s %s;', coalesce(v_txt, 'NULL'),
                     case when v_txt is not null then 'PASS' else 'FAIL' end);
  end if;

  begin
    update public.trainer_accounts set portal_role = 'admin' where id = v_acc.id;
    r := r || ' T7 direct role update ALLOWED FAIL;';
  exception when insufficient_privilege then
    r := r || ' T7 direct role update denied PASS;';
  end;

  begin
    perform private.is_current_trainer_portal_admin();
    r := r || ' T8 private helper callable FAIL;';
  exception when insufficient_privilege then
    r := r || ' T8 private helper denied PASS;';
  end;

  -- ── C3: Admin simulation (temporary, rolled back) ──
  execute 'reset role';
  update public.trainer_accounts set portal_role = 'admin' where id = v_acc.id;
  execute 'set local role authenticated';

  select p.portal_role into v_txt from public.get_current_trainer_profile() p;
  r := r || format(' A1 profile.portal_role=%s %s;', coalesce(v_txt, 'NULL'), case when v_txt = 'admin' then 'PASS' else 'FAIL' end);

  r := r || format(' A2 own=%s | other=%s %s | cross=%s %s;',
    coalesce(public.can_trainer_access_student(v_own)::text, 'n/a'),
    coalesce(public.can_trainer_access_student(v_other)::text, 'n/a'),
    case when v_other is null then 'SKIP' when public.can_trainer_access_student(v_other) then 'PASS' else 'FAIL' end,
    coalesce(public.can_trainer_access_student(v_cross)::text, 'n/a'),
    case when v_cross is null then 'SKIP' when not public.can_trainer_access_student(v_cross) then 'PASS' else 'FAIL' end);

  if v_other is not null then
    select count(*) into v_int from public.search_trainer_students(v_other_nachname) x where x.id = v_other::text;
    r := r || format(' A3 admin search finds non-group student=%s %s;', v_int > 0, case when v_int > 0 then 'PASS' else 'FAIL' end);
  end if;

  if v_cfg is not null then
    v_bool := public.save_trainer_student_page_config(v_cfg);
    r := r || format(' A4 admin save_page_config(same config)=%s %s;', v_bool, case when v_bool then 'PASS' else 'FAIL' end);
  end if;

  select count(*) into v_int from public.get_trainer_kyu_program(v_kyu);
  r := r || format(' A5 admin editor GET program=%s expected=%s %s;', v_int, v_prog_count,
                   case when v_int = v_prog_count then 'PASS' else 'FAIL' end);

  -- last-active-admin protection (owner role, still inside the rolled-back block)
  execute 'reset role';
  begin
    update public.trainer_accounts set portal_role = 'trainer' where id = v_acc.id;
    r := r || ' A6 demote last admin ALLOWED FAIL;';
  exception when check_violation then
    r := r || ' A6 demote last admin blocked PASS;';
  end;
  begin
    update public.trainer_accounts set is_active = false where id = v_acc.id;
    r := r || ' A7 deactivate last admin ALLOWED FAIL;';
  exception when check_violation then
    r := r || ' A7 deactivate last admin blocked PASS;';
  end;

  raise exception 'POST-078 RUNTIME REPORT (auto-rollback, nothing persisted):%', r;
end
$$;
```

## D. BOOTSTRAP первого Portal Admin — шаблон (НЕ часть миграции)

```sql
-- BOOTSTRAP TEMPLATE — NOT EXECUTABLE AS-IS (placeholders fail the uuid cast on purpose).
-- Run only after migration 078 is applied and verified, as a separate owner decision.
-- Promotes exactly ONE explicitly chosen active trainer account; never by trainers.rolle,
-- email, login, name or trainer_id.
do $$
declare
  c_account_id constant uuid := '<TRAINER_ACCOUNT_ID>';
  c_club_id constant text := '<CLUB_ID>';
  v_row record;
  v_count integer;
begin
  update public.trainer_accounts ta
     set portal_role = 'admin'
   where ta.id = c_account_id
     and ta.club_id = c_club_id
     and ta.is_active = true
     and ta.portal_role = 'trainer'
  returning ta.trainer_row_id, ta.club_id into v_row;

  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'bootstrap: expected exactly 1 promoted row, got %', v_count;
  end if;

  perform public.log_trainer_account_operation(
    null,                       -- performed_by_trainer_row_id: owner action, no portal caller
    null,                       -- performed_by_auth_user_id
    v_row.trainer_row_id,
    (select t.trainer_id from public.trainers t where t.id = v_row.trainer_row_id),
    v_row.club_id,
    'promote_admin'
  );
end
$$;
```

После bootstrap: C1 V03 → `N-1 / 1 / 1`; вход этим аккаунтом показывает Admin-функции
(после frontend-этапа); попытка понизить/деактивировать единственного admin — ошибка
`last_active_portal_admin`.

## E. Edge Function остаётся отключённой

Migration 078 не меняет Edge Functions. Проверка — как в
`docs/security/TRAINER_ACCOUNT_MANAGEMENT_HOTFIX.md`: `POST` без Authorization на
`/functions/v1/manage-trainer-account` → `403 {"error":"trainer_account_management_disabled"}`.
