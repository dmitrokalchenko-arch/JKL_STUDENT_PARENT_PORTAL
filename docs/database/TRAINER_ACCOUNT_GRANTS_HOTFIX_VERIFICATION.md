# SQL verification — migration 20261001100077 (Trainer Account grants hotfix)

> Ручной запуск в Supabase SQL Editor (роль `postgres`). Этот документ **не
> содержит команды применения** миграции. Запрос ниже — строго READ-ONLY: только
> каталоги Postgres, данные приложения не читаются и не хешируются.

Hotfix `20261001100077_harden_trainer_account_grants.sql` меняет только права
на четыре объекта:

| Объект | После hotfix |
|---|---|
| `public.trainer_accounts` (table) | PUBLIC / anon / authenticated — никаких прав; service_role — SELECT, INSERT, UPDATE, DELETE |
| `public.rename_trainer_login(uuid,text)` | EXECUTE только service_role |
| `public.log_trainer_account_operation(bigint,uuid,bigint,text,text,text)` | EXECUTE только service_role |
| `public.rename_family_nickname(uuid,text)` | EXECUTE только service_role |

Тела функций, схема, данные, RLS и policies не меняются. `portal_role`,
`ALTER DEFAULT PRIVILEGES`, legacy `public.trainers` / `trainers.rolle` — вне
этого hotfix.

## Как использовать

| Стадия | Когда | Ожидание |
|---|---|---|
| Baseline (необязательно) | до применения | строки `A …` и `B EXECUTE …` для PUBLIC/anon/authenticated — `FAIL` (ожидаемо); `B exists` / `B properties` — `PASS`; сохранить строки `C` |
| POST | после применения | **все 13 строк `check` — `PASS`**; строки `C` совпадают с baseline |

Строки `C` — только структурные fingerprints (определения функций, колонки
`trainer_accounts`, RLS policies, ACL legacy `public.trainers`); обычная работа
приложения их не меняет.

Если во время применения миграции SQL Editor сообщил об ошибке и транзакция
осталась в состоянии aborted — отдельно выполнить `rollback;`.

## Verification query (READ-ONLY)

```sql
-- POST-HOTFIX VERIFICATION: READ-ONLY. No application data is read or hashed.
with fn(sig) as (
  values ('public.rename_trainer_login(uuid,text)'),
         ('public.log_trainer_account_operation(bigint,uuid,bigint,text,text,text)'),
         ('public.rename_family_nickname(uuid,text)')
),
f as (select sig, to_regprocedure(sig) as oid from fn),
t as (select to_regclass('public.trainer_accounts') as oid),
r(role_name) as (values ('anon'), ('authenticated'), ('service_role')),
tp as (
  select r.role_name,
         coalesce(nullif(concat_ws(',',
           case when has_table_privilege(r.role_name, t.oid, 'SELECT')     then 'SELECT' end,
           case when has_table_privilege(r.role_name, t.oid, 'INSERT')     then 'INSERT' end,
           case when has_table_privilege(r.role_name, t.oid, 'UPDATE')     then 'UPDATE' end,
           case when has_table_privilege(r.role_name, t.oid, 'DELETE')     then 'DELETE' end,
           case when has_table_privilege(r.role_name, t.oid, 'TRUNCATE')   then 'TRUNCATE' end,
           case when has_table_privilege(r.role_name, t.oid, 'REFERENCES') then 'REFERENCES' end,
           case when has_table_privilege(r.role_name, t.oid, 'TRIGGER')    then 'TRIGGER' end), ''), 'none') as privs,
         coalesce(has_table_privilege(r.role_name, t.oid, 'SELECT') and has_table_privilege(r.role_name, t.oid, 'INSERT')
              and has_table_privilege(r.role_name, t.oid, 'UPDATE') and has_table_privilege(r.role_name, t.oid, 'DELETE'), false) as has_crud
  from r cross join t
),
pub as (
  select coalesce(string_agg(a.privilege_type, ',' order by a.privilege_type), 'none') as privs
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where c.oid = (select oid from t) and a.grantee = 0
),
fx as (
  select f.sig, p.oid, p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proconfig,
         exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where a.grantee = 0 and a.privilege_type = 'EXECUTE') as e_pub,
         has_function_privilege('anon',          p.oid, 'EXECUTE') as e_anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as e_auth,
         has_function_privilege('service_role',  p.oid, 'EXECUTE') as e_srv
  from f join pg_proc p on p.oid = f.oid
)
select * from (
  -- ── A. public.trainer_accounts ──
  select 1 as sort_key, 'check' as kind, 'A trainer_accounts privileges: PUBLIC' as item,
         'none' as expected, pub.privs as actual,
         case when pub.privs = 'none' then 'PASS' else 'FAIL' end as status
  from pub
  union all
  select 1, 'check', 'A trainer_accounts privileges: ' || role_name,
         case when role_name = 'service_role' then 'includes SELECT,INSERT,UPDATE,DELETE' else 'none' end,
         privs,
         case when role_name = 'service_role' then case when has_crud then 'PASS' else 'FAIL' end
              else case when privs = 'none' then 'PASS' else 'FAIL' end end
  from tp
  union all
  select 1, 'check', 'A trainer_accounts RLS enabled / forced', 'true / false',
         coalesce((select c.relrowsecurity::text || ' / ' || c.relforcerowsecurity::text
                   from pg_class c where c.oid = (select oid from t)), 'TABLE MISSING'),
         case when (select c.relrowsecurity and not c.relforcerowsecurity
                    from pg_class c where c.oid = (select oid from t)) then 'PASS' else 'FAIL' end
  union all
  select 1, 'check', 'A trainer_accounts policies count', '0', count(*)::text,
         case when count(*) = 0 then 'PASS' else 'FAIL' end
  from pg_policies where schemaname = 'public' and tablename = 'trainer_accounts'

  -- ── B. three functions ──
  union all
  select 1, 'check', 'B exists: ' || f.sig, 'exists',
         case when f.oid is null then 'MISSING' else 'exists' end,
         case when f.oid is null then 'FAIL' else 'PASS' end
  from f
  union all
  select 1, 'check', 'B properties: ' || fx.sig, 'security_definer=true owner=postgres search_path=""',
         'security_definer=' || fx.prosecdef::text || ' owner=' || fx.owner
           || ' config=' || coalesce(array_to_string(fx.proconfig, '; '), '(none)'),
         case when fx.prosecdef and fx.owner = 'postgres'
                   and 'search_path=""' = any(coalesce(fx.proconfig, array[]::text[]))
              then 'PASS' else 'FAIL' end
  from fx
  union all
  select 1, 'check', 'B EXECUTE: ' || fx.sig, 'public=false anon=false authenticated=false service_role=true',
         'public=' || fx.e_pub::text || ' anon=' || fx.e_anon::text
           || ' authenticated=' || fx.e_auth::text || ' service_role=' || fx.e_srv::text,
         case when not fx.e_pub and not fx.e_anon and not fx.e_auth and fx.e_srv then 'PASS' else 'FAIL' end
  from fx

  -- ── C. optional structural fingerprints (compare with baseline if taken) ──
  union all
  select 2, 'fingerprint', 'C definition md5: ' || fx.sig, 'identical before/after',
         md5(pg_get_functiondef(fx.oid)), 'COMPARE'
  from fx
  union all
  select 2, 'fingerprint', 'C trainer_accounts column definitions', 'identical before/after',
         md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod)
                        || ':' || a.attnotnull::text, ',' order by a.attnum)), 'COMPARE'
  from pg_attribute a
  where a.attrelid = (select oid from t) and a.attnum > 0 and not a.attisdropped
  union all
  select 2, 'fingerprint', 'C RLS policies public/private', 'identical before/after',
         count(*)::text || ' policies / ' || md5(coalesce(string_agg(concat_ws('|', schemaname, tablename, policyname,
           cmd, roles::text, qual, with_check), ',' order by schemaname, tablename, policyname), '')), 'COMPARE'
  from pg_policies where schemaname in ('public', 'private')
  union all
  select 2, 'fingerprint', 'C legacy public.trainers ACL (must be untouched)', 'identical before/after',
         md5(coalesce(c.relacl::text, '(default)')), 'COMPARE'
  from pg_class c where c.oid = to_regclass('public.trainers')
) q
order by sort_key, item;
```

## Smoke tests после применения (вручную)

1. Вход в Trainer Portal (напрямую и через «Trainer Portal Zugang» из
   JCL_Gruppen) работает.
2. «Поиск ученика» и страница ученика своей группы загружаются.
3. Индивидуальная Kyu-программа ученика читается (без сохранения).
4. Переименование логина тренера через `manage-trainer-account`
   (JCL_Gruppen → Trainer Portal Zugang) — переименовать и вернуть прежний.
5. Переименование nickname семьи через `manage-family-account` (Super Admin) —
   переименовать и вернуть прежний.
6. Прямые вызовы от anon / authenticated запрещены. Каждый блок — отдельно,
   всегда `rollback`, идентификаторы намеренно несуществующие; ожидается
   `permission denied`. Затем те же блоки с `set local role authenticated`.

```sql
begin;
set local role anon;
select public.rename_trainer_login('00000000-0000-0000-0000-000000000000'::uuid, 'smoke-test');
rollback;
```

```sql
begin;
set local role anon;
select public.log_trainer_account_operation(-1, null, -1, 'smoke', 'smoke', 'update');
rollback;
```

```sql
begin;
set local role anon;
select public.rename_family_nickname('00000000-0000-0000-0000-000000000000'::uuid, 'smoke-test');
rollback;
```

```sql
begin;
set local role anon;
select count(*) from public.trainer_accounts;
rollback;
```

## Вне этого hotfix (follow-ups)

- Default privileges Supabase снова выдают anon/authenticated права каждому
  новому объекту `public` (в т.ч. при `DROP` + `CREATE`) — системное решение
  отдельно; до него каждая миграция обязана явно делать
  `revoke ... from public, anon, authenticated`.
- Legacy `public.trainers.rolle` доступна anon на UPDATE, а
  `manage-trainer-account` признаёт Admin по `rolle === 'Admin'` —
  Security Migration Block 1 / проектирование `portal_role`.
- Назначение первого Portal Admin (`portal_role` bootstrap) не решено.
