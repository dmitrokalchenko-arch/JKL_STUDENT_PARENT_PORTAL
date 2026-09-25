# SQL verification — migration 20260930100076 (Individual Student Kyu Program)

> Ручной запуск в Supabase SQL Editor (роль `postgres`), по одному блоку.
> Этот документ **не содержит команды применения** миграции. SQL ещё не
> исполнялся (Docker недоступен) — синтаксис проверен только чтением; при
> синтаксической ошибке прислать её текст.

| Стадия | Когда | Что |
|---|---|---|
| A. PRECHECK (read-only) | до применения 076 | зависимости, типы, отсутствие новых объектов, готовность теста |
| B. APPLY 076 | отдельное решение | — (здесь не приводится) |
| C1. POST static (read-only) | после 076 | объекты, RLS, grants, маркеры |
| C2. POST runtime (auto-rollback) | после 076 | группы A–H, versioning 1–10, безопасность |
| C3. LEFTOVER (read-only) | сразу после C2 | временных данных не осталось |

## A. PRECHECK — READ-ONLY

```sql
-- A. PRE-076 READ-ONLY CHECK. Только SELECT по каталогам.
with rel(name) as (values
  ('public.students'), ('public.kyu_lookup'), ('public.judo_techniques'), ('public.trainer_accounts'),
  ('public.trainers'), ('public.trainer_groups'), ('public.groups'), ('public.clubs'),
  ('public.club_kyu_program_items'), ('public.student_page_access'), ('auth.users')
),
fn(sig) as (values
  ('public.can_trainer_access_student(bigint)'), ('public.can_trainer_access_student_page(bigint)'),
  ('public.get_student_page_access(bigint)'), ('public.resolve_next_kyu_lookup_id(text)'),
  ('private.current_active_trainer_account_id()'), ('public.get_required_techniques_for_student(bigint)'),
  ('public.get_trainer_required_techniques(bigint)'), ('public.get_family_required_techniques(bigint)')
),
col(tbl, col, expected) as (values
  ('public.students', 'id', 'bigint'), ('public.kyu_lookup', 'id', 'bigint'),
  ('public.judo_techniques', 'id', 'uuid'), ('public.trainer_accounts', 'id', 'uuid'),
  ('public.students', 'club_id', 'text'), ('public.students', 'kyu_grad', 'text'),
  ('public.club_kyu_program_items', 'block_type', 'text')
),
r(section, check_item, expected, actual) as (
  select 'A dependency', 'table ' || rel.name, 'true', (to_regclass(rel.name) is not null)::text from rel
  union all
  select 'A dependency', 'function ' || fn.sig, 'true', (to_regprocedure(fn.sig) is not null)::text from fn
  union all
  select 'A dependency', 'schema private exists', 'true', exists (select 1 from pg_namespace where nspname = 'private')::text
  union all
  select 'A dependency', '074 applied (resolver returns block_type)', 'true',
         coalesce((pg_get_functiondef(to_regprocedure('public.get_required_techniques_for_student(bigint)'))
                   like '%''block_type'', ckpi.block_type%')::text, 'false')
  union all
  select 'B types', col.tbl || '.' || col.col, col.expected,
         coalesce((select format_type(a.atttypid, a.atttypmod) from pg_attribute a
                   where a.attrelid = to_regclass(col.tbl) and a.attname = col.col and not a.attisdropped), 'MISSING')
  from col
  union all
  select 'C not yet applied', 'table public.student_kyu_programs absent', 'true', (to_regclass('public.student_kyu_programs') is null)::text
  union all
  select 'C not yet applied', 'table public.student_kyu_program_items absent', 'true', (to_regclass('public.student_kyu_program_items') is null)::text
  union all
  select 'C not yet applied', 'save/reset RPC + edit helper absent', 'true',
         (to_regprocedure('public.save_trainer_student_kyu_program(bigint,bigint,jsonb,integer)') is null
          and to_regprocedure('public.reset_trainer_student_kyu_program(bigint,bigint,integer)') is null
          and to_regprocedure('private.can_trainer_edit_student_page(bigint)') is null)::text
  union all
  select 'D grants now', 'resolver EXECUTE anon / authenticated / service_role', 'false / false / true',
         coalesce(has_function_privilege('anon', to_regprocedure('public.get_required_techniques_for_student(bigint)'), 'EXECUTE')::text, 'null') || ' / '
         || coalesce(has_function_privilege('authenticated', to_regprocedure('public.get_required_techniques_for_student(bigint)'), 'EXECUTE')::text, 'null') || ' / '
         || coalesce(has_function_privilege('service_role', to_regprocedure('public.get_required_techniques_for_student(bigint)'), 'EXECUTE')::text, 'null')
  union all
  select 'D grants now', 'get_trainer_required_techniques EXECUTE anon / authenticated', 'false / true',
         coalesce(has_function_privilege('anon', to_regprocedure('public.get_trainer_required_techniques(bigint)'), 'EXECUTE')::text, 'null') || ' / '
         || coalesce(has_function_privilege('authenticated', to_regprocedure('public.get_trainer_required_techniques(bigint)'), 'EXECUTE')::text, 'null')
  union all
  select 'E readiness', 'current_user', 'postgres', current_user::text
  union all
  select 'E readiness', 'can SET ROLE authenticated / anon', 'true / true',
         pg_has_role(current_user, 'authenticated', 'MEMBER')::text || ' / ' || pg_has_role(current_user, 'anon', 'MEMBER')::text
  union all
  select 'E readiness', 'auth.uid() reads request.jwt.claim(s)', 'true',
         coalesce((pg_get_functiondef(to_regprocedure('auth.uid()')) like '%request.jwt.claim%')::text, 'false')
  union all
  select 'E readiness', 'INSERT privilege on ' || rel.name, 'true', coalesce(has_table_privilege(to_regclass(rel.name), 'INSERT')::text, 'null')
  from rel where rel.name in ('public.students', 'public.trainers', 'public.trainer_groups', 'public.groups', 'public.clubs',
                              'public.trainer_accounts', 'public.student_page_access', 'public.club_kyu_program_items', 'auth.users')
  union all
  select 'E readiness', 'at least 3 active judo_techniques', 'true',
         ((select count(*) from public.judo_techniques where active) >= 3)::text
  union all
  select 'E readiness', 'kyu_lookup has 7. / 6. / 5. Kyu', 'true',
         ((select count(*) from public.kyu_lookup where lower(trim(kyu_grad)) in ('7. kyu', '6. kyu', '5. kyu')) = 3)::text
  union all
  select 'F schema', rel.name || ': NOT NULL without default', '(info)',
         coalesce((select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
                   from pg_attribute a left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
                   where a.attrelid = to_regclass(rel.name) and a.attnum > 0 and not a.attisdropped
                     and a.attnotnull and ad.adbin is null and a.attidentity = '' and a.attgenerated = ''), '-')
  from rel where rel.name in ('public.clubs', 'public.trainers', 'public.trainer_groups', 'public.groups', 'public.students', 'public.trainer_accounts')
  union all
  select 'F schema', rel.name || ': FOREIGN KEYS', '(info)',
         coalesce((select string_agg(c.conname || ': ' || pg_get_constraintdef(c.oid), ' ; ')
                   from pg_constraint c where c.conrelid = to_regclass(rel.name) and c.contype = 'f'), '-')
  from rel where rel.name in ('public.trainers', 'public.trainer_groups', 'public.groups', 'public.students')
  union all
  select 'F schema', rel.name || ': UNIQUE / CHECK', '(info)',
         coalesce((select string_agg(c.conname || ': ' || pg_get_constraintdef(c.oid), ' ; ')
                   from pg_constraint c where c.conrelid = to_regclass(rel.name) and c.contype in ('u', 'c')), '-')
  from rel where rel.name in ('public.clubs', 'public.trainers', 'public.trainer_groups', 'public.groups', 'public.students')
  union all
  select 'F schema', rel.name || ': user triggers', '(info)',
         coalesce((select string_agg(tg.tgname, ', ') from pg_trigger tg where tg.tgrelid = to_regclass(rel.name) and not tg.tgisinternal), '-')
  from rel where rel.name in ('public.clubs', 'public.trainers', 'public.trainer_groups', 'public.groups', 'public.students',
                              'public.trainer_accounts', 'auth.users')
)
select section, check_item, expected, actual,
       case when expected like '%(info)%' then 'INFO' when actual = expected then 'PASS' else 'FAIL' end as result
from r
order by section, check_item;
```

**Ожидается:** все строки A–E = `PASS` (в т.ч. `074 applied`, типы `bigint/bigint/uuid/uuid/text/text/text`,
новые объекты отсутствуют); F — информация (важно увидеть FK `trainer_groups`/`groups`
и обязательные колонки legacy-таблиц — runtime-тест заполняет их заглушками).

## C1. POST static — READ-ONLY — **RUN ONLY AFTER MIGRATION 076**

```sql
-- C1. POST-076 STATIC CHECK. Только SELECT.
with r(check_item, expected, actual) as (
  select 'tables exist', 'true / true',
         (to_regclass('public.student_kyu_programs') is not null)::text || ' / ' || (to_regclass('public.student_kyu_program_items') is not null)::text
  union all
  select 'RLS enabled (programs / items)', 'true / true',
         coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.student_kyu_programs')), 'null') || ' / '
         || coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.student_kyu_program_items')), 'null')
  union all
  select 'no RLS policies on new tables', '0',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('student_kyu_programs', 'student_kyu_program_items'))
  union all
  select 'direct table privileges anon / authenticated (any of SELECT/INSERT/UPDATE/DELETE)', 'false / false',
         (has_table_privilege('anon', to_regclass('public.student_kyu_programs'), 'SELECT,INSERT,UPDATE,DELETE')
          or has_table_privilege('anon', to_regclass('public.student_kyu_program_items'), 'SELECT,INSERT,UPDATE,DELETE'))::text || ' / '
         || (has_table_privilege('authenticated', to_regclass('public.student_kyu_programs'), 'SELECT,INSERT,UPDATE,DELETE')
          or has_table_privilege('authenticated', to_regclass('public.student_kyu_program_items'), 'SELECT,INSERT,UPDATE,DELETE'))::text
  union all
  select 'one-active partial unique index exists', 'true', (to_regclass('public.student_kyu_programs_one_active_uidx') is not null)::text
  union all
  select 'immutability triggers exist', '2',
         (select count(*)::text from pg_trigger where not tgisinternal and tgname in ('trg_student_kyu_programs_immutable', 'trg_student_kyu_program_items_immutable'))
  union all
  select 'save EXECUTE anon / authenticated', 'false / true',
         coalesce(has_function_privilege('anon', to_regprocedure('public.save_trainer_student_kyu_program(bigint,bigint,jsonb,integer)'), 'EXECUTE')::text, 'null') || ' / '
         || coalesce(has_function_privilege('authenticated', to_regprocedure('public.save_trainer_student_kyu_program(bigint,bigint,jsonb,integer)'), 'EXECUTE')::text, 'null')
  union all
  select 'reset EXECUTE anon / authenticated', 'false / true',
         coalesce(has_function_privilege('anon', to_regprocedure('public.reset_trainer_student_kyu_program(bigint,bigint,integer)'), 'EXECUTE')::text, 'null') || ' / '
         || coalesce(has_function_privilege('authenticated', to_regprocedure('public.reset_trainer_student_kyu_program(bigint,bigint,integer)'), 'EXECUTE')::text, 'null')
  union all
  select 'edit helper EXECUTE anon / authenticated', 'false / false',
         coalesce(has_function_privilege('anon', to_regprocedure('private.can_trainer_edit_student_page(bigint)'), 'EXECUTE')::text, 'null') || ' / '
         || coalesce(has_function_privilege('authenticated', to_regprocedure('private.can_trainer_edit_student_page(bigint)'), 'EXECUTE')::text, 'null')
  union all
  select 'resolver EXECUTE anon / authenticated / service_role', 'false / false / true',
         coalesce(has_function_privilege('anon', to_regprocedure('public.get_required_techniques_for_student(bigint)'), 'EXECUTE')::text, 'null') || ' / '
         || coalesce(has_function_privilege('authenticated', to_regprocedure('public.get_required_techniques_for_student(bigint)'), 'EXECUTE')::text, 'null') || ' / '
         || coalesce(has_function_privilege('service_role', to_regprocedure('public.get_required_techniques_for_student(bigint)'), 'EXECUTE')::text, 'null')
  union all
  select 'resolver: individual branch + source marker', 'true',
         coalesce((pg_get_functiondef(to_regprocedure('public.get_required_techniques_for_student(bigint)')) like '%student_kyu_programs%'
                   and pg_get_functiondef(to_regprocedure('public.get_required_techniques_for_student(bigint)')) like '%''source'', ''individual''%')::text, 'false')
  union all
  select 'trainer wrapper returns canEdit via edit helper', 'true',
         coalesce((pg_get_functiondef(to_regprocedure('public.get_trainer_required_techniques(bigint)')) like '%can_trainer_edit_student_page%')::text, 'false')
  union all
  select 'trainer wrapper READ gate unchanged (can_trainer_access_student_page)', 'true',
         coalesce((pg_get_functiondef(to_regprocedure('public.get_trainer_required_techniques(bigint)')) like '%can_trainer_access_student_page(p_student_id)%')::text, 'false')
  union all
  select 'family wrapper unchanged (can_family_access_student_page, no canEdit)', 'true',
         coalesce((pg_get_functiondef(to_regprocedure('public.get_family_required_techniques(bigint)')) like '%can_family_access_student_page%'
                   and pg_get_functiondef(to_regprocedure('public.get_family_required_techniques(bigint)')) not like '%canEdit%')::text, 'false')
  union all
  select 'edit helper ignores trainer_access_after_expiry', 'true',
         coalesce((pg_get_functiondef(to_regprocedure('private.can_trainer_edit_student_page(bigint)')) like '%familySubscriptionAllowsAccess%'
                   and pg_get_functiondef(to_regprocedure('private.can_trainer_edit_student_page(bigint)')) not like '%trainerSubscriptionAllowsAccess%')::text, 'false')
)
select check_item, expected, actual, case when actual = expected then 'PASS' else 'FAIL' end as result from r;
```

**Ожидается:** все `PASS`.

## C2. POST runtime — **RUN ONLY AFTER MIGRATION 076** (auto-rollback)

Один оператор `DO`: создаёт **только** временные записи с меткой `zz076…`
(2 клуба, 4 тренера в `trainers`/`trainer_accounts`/`trainer_groups`, группы,
6 учеников, `student_page_access` для них, программу клуба ТОЛЬКО временного
клуба, `auth.users` для тренеров и «семьи»), проверяет всё под симулированными
ролями (`SET LOCAL ROLE authenticated` + `request.jwt.claims` — тот же механизм,
что PostgREST) и **всегда** заканчивается `RAISE EXCEPTION` → весь блок
откатывается, даже при упавшей проверке. Реальные ученики, тренеры, клубы и их
программы не затрагиваются. Результат — текст ошибки `JKL_076_RUNTIME_REPORT`.

```sql
-- C2. POST-076 RUNTIME CHECK — ends with an ERROR on purpose, everything is rolled back.
do $jkl$
declare
  v_tag text := 'zz076' || to_char(clock_timestamp(), 'HH24MISS');
  v_rows text[] := '{}';
  v_setup_error text;
  v_club_a text; v_club_c text;
  g_a text; g_b text; g_c text;
  u_ta uuid := gen_random_uuid(); u_tb uuid := gen_random_uuid(); u_tc uuid := gen_random_uuid();
  u_td uuid := gen_random_uuid(); u_fam uuid := gen_random_uuid();
  r_ta jsonb; r_tb jsonb; r_tc jsonb; r_td jsonb;
  a_ta uuid; a_td uuid;
  s_act bigint; s_exp bigint; s_man bigint; s_norow bigint; s_null bigint; s_grp_b bigint;
  k6 bigint; k5 bigint;
  v_t uuid[]; t1 uuid; t2 uuid; t3 uuid;
  v_json jsonb; v_res jsonb; v_txt text; v_int int; v_pid uuid;
  v_out text := ''; v_pass int := 0; v_fail int := 0; v_status text; i int;
begin
  begin
    ---------------------------------------------------------------- helper (pg_temp, rolled back)
    execute $f$
      create function pg_temp.jkl_insert(p_table regclass, p_values jsonb) returns jsonb
      language plpgsql as $b$
      declare
        r record; v_cols text[] := '{}'; v_vals text[] := '{}'; v_row jsonb;
        v_override boolean := false; v_label text; v_id bigint;
      begin
        p_values := jsonb_strip_nulls(p_values);
        for r in
          select a.attname::text as col, format_type(a.atttypid, a.atttypmod) as typ, t.typcategory::text as cat,
                 a.atttypid as typid, a.attnotnull as notnull, (d.adbin is not null) as has_default,
                 a.attidentity::text as ident, a.attgenerated::text as gen
          from pg_attribute a
          join pg_type t on t.oid = a.atttypid
          left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
          order by a.attnum
        loop
          if r.gen <> '' then continue; end if;
          if p_values ? r.col then
            v_cols := v_cols || quote_ident(r.col);
            v_vals := v_vals || format('%L::%s', p_values ->> r.col, r.typ);
            if r.ident = 'a' then v_override := true; end if;
          elsif r.notnull and not r.has_default and r.ident = '' then
            v_cols := v_cols || quote_ident(r.col);
            if r.col = 'id' and r.cat = 'N' then
              execute format('select coalesce(max(id), 0) + 1000000 + (random() * 100000)::int from %s', p_table) into v_id;
              v_vals := v_vals || format('%s::%s', v_id, r.typ);
            elsif r.cat = 'S' then v_vals := v_vals || format('%L::%s', 'ZZ076', r.typ);
            elsif r.cat = 'N' then v_vals := v_vals || format('0::%s', r.typ);
            elsif r.cat = 'B' then v_vals := v_vals || 'false'::text;
            elsif r.cat = 'D' then v_vals := v_vals || format('now()::%s', r.typ);
            elsif r.typ = 'uuid' then v_vals := v_vals || 'gen_random_uuid()'::text;
            elsif r.typ in ('json', 'jsonb') then v_vals := v_vals || format('%L::%s', '{}', r.typ);
            elsif r.cat = 'A' then v_vals := v_vals || format('%L::%s', '{}', r.typ);
            elsif r.cat = 'E' then
              select quote_literal(e.enumlabel) into v_label from pg_enum e where e.enumtypid = r.typid order by e.enumsortorder limit 1;
              v_vals := v_vals || (v_label || '::' || r.typ);
            else
              raise exception 'cannot auto-fill %.% (type %)', p_table, r.col, r.typ;
            end if;
          end if;
        end loop;
        execute format('insert into %s as x (%s) %s values (%s) returning to_jsonb(x)',
                       p_table, array_to_string(v_cols, ', '),
                       case when v_override then 'overriding system value' else '' end,
                       array_to_string(v_vals, ', '))
          into v_row;
        return v_row;
      end
      $b$
    $f$;

    ---------------------------------------------------------------- guard: 076 applied
    if to_regprocedure('public.save_trainer_student_kyu_program(bigint,bigint,jsonb,integer)') is null then
      raise exception 'MIGRATION 076 IS NOT APPLIED — runtime test aborted, nothing created';
    end if;

    ---------------------------------------------------------------- read-only reference data
    select array_agg(x.id order by x.name) into v_t
    from (select jt.id, jt.name from public.judo_techniques jt where jt.active order by jt.name limit 3) x;
    t1 := v_t[1]; t2 := v_t[2]; t3 := v_t[3];
    select kl.id into k6 from public.kyu_lookup kl where lower(trim(kl.kyu_grad)) = '6. kyu';
    select kl.id into k5 from public.kyu_lookup kl where lower(trim(kl.kyu_grad)) = '5. kyu';

    ---------------------------------------------------------------- temporary clubs / groups / trainers
    v_club_a := v_tag || 'a';
    v_club_c := v_tag || 'c';
    perform pg_temp.jkl_insert(to_regclass('public.clubs'), jsonb_build_object(
      'club_id', v_club_a, 'club_short_name', v_club_a, 'club_name', 'ZZ076 Club A', 'name', 'ZZ076 Club A'));
    perform pg_temp.jkl_insert(to_regclass('public.clubs'), jsonb_build_object(
      'club_id', v_club_c, 'club_short_name', v_club_c, 'club_name', 'ZZ076 Club C', 'name', 'ZZ076 Club C'));

    g_a := (990760000 + (random() * 9000)::int)::text;
    g_b := (g_a::bigint + 1)::text;
    g_c := (g_a::bigint + 2)::text;
    if to_regclass('public.groups') is not null then
      perform pg_temp.jkl_insert(to_regclass('public.groups'), jsonb_build_object('gruppe_id', g_a, 'gruppenname', 'ZZ076 GA', 'club_id', v_club_a));
      perform pg_temp.jkl_insert(to_regclass('public.groups'), jsonb_build_object('gruppe_id', g_b, 'gruppenname', 'ZZ076 GB', 'club_id', v_club_a));
      perform pg_temp.jkl_insert(to_regclass('public.groups'), jsonb_build_object('gruppe_id', g_c, 'gruppenname', 'ZZ076 GC', 'club_id', v_club_c));
    end if;

    r_ta := pg_temp.jkl_insert(to_regclass('public.trainers'), jsonb_build_object('trainer_id', v_tag || '_ta', 'club_id', v_club_a, 'name', 'ZZ076 TA', 'aktiv', 'JA', 'rolle', 'Trainer'));
    r_tb := pg_temp.jkl_insert(to_regclass('public.trainers'), jsonb_build_object('trainer_id', v_tag || '_tb', 'club_id', v_club_a, 'name', 'ZZ076 TB', 'aktiv', 'JA', 'rolle', 'Trainer'));
    r_tc := pg_temp.jkl_insert(to_regclass('public.trainers'), jsonb_build_object('trainer_id', v_tag || '_tc', 'club_id', v_club_c, 'name', 'ZZ076 TC', 'aktiv', 'JA', 'rolle', 'Trainer'));
    r_td := pg_temp.jkl_insert(to_regclass('public.trainers'), jsonb_build_object('trainer_id', v_tag || '_td', 'club_id', v_club_a, 'name', 'ZZ076 TD', 'aktiv', 'JA', 'rolle', 'Trainer'));

    perform pg_temp.jkl_insert(to_regclass('auth.users'), jsonb_build_object('id', u_ta, 'aud', 'authenticated', 'role', 'authenticated', 'email', v_tag || '_ta@example.invalid'));
    perform pg_temp.jkl_insert(to_regclass('auth.users'), jsonb_build_object('id', u_tb, 'aud', 'authenticated', 'role', 'authenticated', 'email', v_tag || '_tb@example.invalid'));
    perform pg_temp.jkl_insert(to_regclass('auth.users'), jsonb_build_object('id', u_tc, 'aud', 'authenticated', 'role', 'authenticated', 'email', v_tag || '_tc@example.invalid'));
    perform pg_temp.jkl_insert(to_regclass('auth.users'), jsonb_build_object('id', u_td, 'aud', 'authenticated', 'role', 'authenticated', 'email', v_tag || '_td@example.invalid'));
    perform pg_temp.jkl_insert(to_regclass('auth.users'), jsonb_build_object('id', u_fam, 'aud', 'authenticated', 'role', 'authenticated', 'email', v_tag || '_fam@example.invalid'));

    a_ta := (pg_temp.jkl_insert(to_regclass('public.trainer_accounts'), jsonb_build_object('auth_user_id', u_ta, 'trainer_row_id', r_ta ->> 'id', 'club_id', v_club_a, 'login_name', v_tag || ' ta', 'display_name', 'ZZ076 TA', 'is_active', true)) ->> 'id')::uuid;
    perform pg_temp.jkl_insert(to_regclass('public.trainer_accounts'), jsonb_build_object('auth_user_id', u_tb, 'trainer_row_id', r_tb ->> 'id', 'club_id', v_club_a, 'login_name', v_tag || ' tb', 'display_name', 'ZZ076 TB', 'is_active', true));
    perform pg_temp.jkl_insert(to_regclass('public.trainer_accounts'), jsonb_build_object('auth_user_id', u_tc, 'trainer_row_id', r_tc ->> 'id', 'club_id', v_club_c, 'login_name', v_tag || ' tc', 'display_name', 'ZZ076 TC', 'is_active', true));
    a_td := (pg_temp.jkl_insert(to_regclass('public.trainer_accounts'), jsonb_build_object('auth_user_id', u_td, 'trainer_row_id', r_td ->> 'id', 'club_id', v_club_a, 'login_name', v_tag || ' td', 'display_name', 'ZZ076 TD', 'is_active', true)) ->> 'id')::uuid;

    -- TA и TD — группа A (два тренера одной группы), TB — только группа B того же клуба, TC — другой клуб.
    perform pg_temp.jkl_insert(to_regclass('public.trainer_groups'), jsonb_build_object('trainer_id', r_ta ->> 'trainer_id', 'club_id', v_club_a, 'gruppe_id', g_a, 'trainer_name', 'ZZ076 TA'));
    perform pg_temp.jkl_insert(to_regclass('public.trainer_groups'), jsonb_build_object('trainer_id', r_td ->> 'trainer_id', 'club_id', v_club_a, 'gruppe_id', g_a, 'trainer_name', 'ZZ076 TD'));
    perform pg_temp.jkl_insert(to_regclass('public.trainer_groups'), jsonb_build_object('trainer_id', r_tb ->> 'trainer_id', 'club_id', v_club_a, 'gruppe_id', g_b, 'trainer_name', 'ZZ076 TB'));
    perform pg_temp.jkl_insert(to_regclass('public.trainer_groups'), jsonb_build_object('trainer_id', r_tc ->> 'trainer_id', 'club_id', v_club_c, 'gruppe_id', g_c, 'trainer_name', 'ZZ076 TC'));

    ---------------------------------------------------------------- temporary students (club A)
    s_act   := (pg_temp.jkl_insert(to_regclass('public.students'), jsonb_build_object('club_id', v_club_a, 'gruppe_id', g_a, 'kyu_grad', '7. Kyu', 'vorname', 'ZZ076_active',   'nachname', 'Test', 'aktiv', 'JA')) ->> 'id')::bigint;
    s_exp   := (pg_temp.jkl_insert(to_regclass('public.students'), jsonb_build_object('club_id', v_club_a, 'gruppe_id', g_a, 'kyu_grad', '7. Kyu', 'vorname', 'ZZ076_expired',  'nachname', 'Test', 'aktiv', 'JA')) ->> 'id')::bigint;
    s_man   := (pg_temp.jkl_insert(to_regclass('public.students'), jsonb_build_object('club_id', v_club_a, 'gruppe_id', g_a, 'kyu_grad', '7. Kyu', 'vorname', 'ZZ076_manual',   'nachname', 'Test', 'aktiv', 'JA')) ->> 'id')::bigint;
    s_norow := (pg_temp.jkl_insert(to_regclass('public.students'), jsonb_build_object('club_id', v_club_a, 'gruppe_id', g_a, 'kyu_grad', '7. Kyu', 'vorname', 'ZZ076_norow',    'nachname', 'Test', 'aktiv', 'JA')) ->> 'id')::bigint;
    s_null  := (pg_temp.jkl_insert(to_regclass('public.students'), jsonb_build_object('club_id', v_club_a, 'gruppe_id', g_a, 'kyu_grad', '7. Kyu', 'vorname', 'ZZ076_nulluntil','nachname', 'Test', 'aktiv', 'JA')) ->> 'id')::bigint;
    s_grp_b := (pg_temp.jkl_insert(to_regclass('public.students'), jsonb_build_object('club_id', v_club_a, 'gruppe_id', g_b, 'kyu_grad', '7. Kyu', 'vorname', 'ZZ076_groupB',   'nachname', 'Test', 'aktiv', 'JA')) ->> 'id')::bigint;

    insert into public.student_page_access (student_id, access_until, manual_disabled, trainer_access_after_expiry) values
      (s_act,   current_date + 30, false, false),
      (s_exp,   current_date - 10, false, true),   -- expired + trainer READ exception
      (s_man,   null,              true,  false),
      (s_null,  null,              false, false),
      (s_grp_b, current_date + 30, false, false);
    -- s_norow: no access row (compatibility = active)

    -- Club program of the TEMPORARY club A for 6. Kyu: t1 -> required_nage, t2 -> additional.
    insert into public.club_kyu_program_items (club_id, kyu_lookup_id, item_type, technique_id, block_type, sort_order) values
      (v_club_a, k6, 'technique', t1, 'required_nage', 0),
      (v_club_a, k6, 'technique', t2, 'additional', 0);

    -- ==================== GROUP ACCESS A–H
    -- (A, V1) Trainer A, shared group, active page
    perform set_config('request.jwt.claims', json_build_object('sub', u_ta::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_ta::text, true);
    execute 'set local role authenticated';
    v_rows := v_rows || array[['0 AUTH', 'simulated role / uid = trainer A', 'authenticated / true', current_user::text || ' / ' || coalesce((auth.uid() = u_ta)::text, 'null')]];
    v_json := public.get_trainer_required_techniques(s_act);
    v_rows := v_rows || array[['A', 'trainer A READ student (status)', 'ok', v_json ->> 'status']];
    v_rows := v_rows || array[['A', 'trainer A canEdit', 'true', coalesce(v_json ->> 'canEdit', 'absent')]];
    v_rows := v_rows || array[['V1', 'no individual -> source/version', 'club/null', (v_json ->> 'source') || '/' || coalesce(v_json ->> 'version', 'null')]];
    v_rows := v_rows || array[['V1', 'nextKyuLookupId = 6. Kyu', k6::text, v_json ->> 'nextKyuLookupId']];
    -- (V2, V9) first Save, same technique in two blocks
    v_res := public.save_trainer_student_kyu_program(s_act, k6, jsonb_build_array(
      jsonb_build_object('technique_id', t1, 'block_type', 'required_nage'),
      jsonb_build_object('technique_id', t2, 'block_type', 'additional'),
      jsonb_build_object('technique_id', t1, 'block_type', 'additional')), null);
    v_rows := v_rows || array[['V2', 'first Save -> ok, version 1', 'true/1', (v_res ->> 'ok') || '/' || coalesce(v_res ->> 'version', 'null')]];
    v_json := public.get_trainer_required_techniques(s_act);
    v_rows := v_rows || array[['V3', 'resolver after Save -> source/version', 'individual/1', (v_json ->> 'source') || '/' || coalesce(v_json ->> 'version', 'null')]];
    select string_agg(t ->> 'block_type', ',' order by o) into v_txt
    from jsonb_array_elements(v_json -> 'techniques') with ordinality e(t, o) where (t ->> 'technique_id')::uuid = t1;
    v_rows := v_rows || array[['V9', 'same technique in two blocks kept', 'required_nage,additional', coalesce(v_txt, 'none')]];
    -- invalid input
    v_res := public.save_trainer_student_kyu_program(s_act, k6, jsonb_build_array(jsonb_build_object('technique_id', t1, 'block_type', 'bonus')), 1);
    v_rows := v_rows || array[['SEC', 'invalid block_type -> invalid_items', 'invalid_items', v_res ->> 'reason']];
    v_res := public.save_trainer_student_kyu_program(s_act, k6, jsonb_build_array(jsonb_build_object('technique_id', gen_random_uuid(), 'block_type', 'additional')), 1);
    v_rows := v_rows || array[['SEC', 'unknown technique_id -> invalid_items', 'invalid_items', v_res ->> 'reason']];
    -- (E) expired + trainer_access_after_expiry: READ yes, WRITE no
    v_json := public.get_trainer_required_techniques(s_exp);
    v_rows := v_rows || array[['E', 'expired+exception: READ status', 'ok', v_json ->> 'status']];
    v_rows := v_rows || array[['E', 'expired+exception: canEdit', 'false', coalesce(v_json ->> 'canEdit', 'absent')]];
    v_rows := v_rows || array[['E', 'expired+exception: Save', 'page_inactive', public.save_trainer_student_kyu_program(s_exp, k6, '[]'::jsonb, null) ->> 'reason']];
    v_rows := v_rows || array[['E', 'expired+exception: Reset', 'page_inactive', public.reset_trainer_student_kyu_program(s_exp, k6, null) ->> 'reason']];
    -- (F) manual_disabled
    v_rows := v_rows || array[['F', 'manual_disabled: Save', 'page_inactive', public.save_trainer_student_kyu_program(s_man, k6, '[]'::jsonb, null) ->> 'reason']];
    v_rows := v_rows || array[['F', 'manual_disabled: Reset', 'page_inactive', public.reset_trainer_student_kyu_program(s_man, k6, null) ->> 'reason']];
    -- (G) no access row, (H) access_until NULL; G also checks source=club_copy
    v_json := public.get_trainer_required_techniques(s_norow);
    v_rows := v_rows || array[['G', 'no access row: canEdit', 'true', coalesce(v_json ->> 'canEdit', 'absent')]];
    v_res := public.save_trainer_student_kyu_program(s_norow, k6, jsonb_build_array(
      jsonb_build_object('technique_id', t1, 'block_type', 'required_nage'),
      jsonb_build_object('technique_id', t2, 'block_type', 'additional')), null);
    v_rows := v_rows || array[['G', 'no access row: Save', 'true', v_res ->> 'ok']];
    v_json := public.get_trainer_required_techniques(s_null);
    v_rows := v_rows || array[['H', 'access_until NULL: canEdit', 'true', coalesce(v_json ->> 'canEdit', 'absent')]];
    v_rows := v_rows || array[['H', 'access_until NULL: Save', 'true',
      public.save_trainer_student_kyu_program(s_null, k6, jsonb_build_array(jsonb_build_object('technique_id', t3, 'block_type', 'required_katame')), null) ->> 'ok']];
    execute 'reset role';

    -- (B) Trainer B: same club, no shared group
    perform set_config('request.jwt.claims', json_build_object('sub', u_tb::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_tb::text, true);
    execute 'set local role authenticated';
    v_json := public.get_trainer_required_techniques(s_act);
    v_rows := v_rows || array[['B', 'trainer B READ (denied format)', 'no_current_kyu/0', (v_json ->> 'status') || '/' || jsonb_array_length(v_json -> 'techniques')]];
    v_rows := v_rows || array[['B', 'trainer B Save', 'not_allowed', public.save_trainer_student_kyu_program(s_act, k6, '[]'::jsonb, 1) ->> 'reason']];
    v_rows := v_rows || array[['B', 'trainer B Reset', 'not_allowed', public.reset_trainer_student_kyu_program(s_act, k6, 1) ->> 'reason']];
    v_json := public.get_trainer_required_techniques(s_grp_b);
    v_rows := v_rows || array[['B', 'trainer B READ own group student', 'ok', v_json ->> 'status']];
    execute 'reset role';

    -- (C) Trainer C: other club
    perform set_config('request.jwt.claims', json_build_object('sub', u_tc::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_tc::text, true);
    execute 'set local role authenticated';
    v_json := public.get_trainer_required_techniques(s_act);
    v_rows := v_rows || array[['C', 'other-club trainer READ (denied format)', 'no_current_kyu/0', (v_json ->> 'status') || '/' || jsonb_array_length(v_json -> 'techniques')]];
    v_rows := v_rows || array[['C', 'other-club trainer Save', 'not_allowed', public.save_trainer_student_kyu_program(s_act, k6, '[]'::jsonb, 1) ->> 'reason']];
    v_rows := v_rows || array[['C', 'other-club trainer Reset', 'not_allowed', public.reset_trainer_student_kyu_program(s_act, k6, 1) ->> 'reason']];
    execute 'reset role';

    -- Family / any authenticated user without trainer account
    perform set_config('request.jwt.claims', json_build_object('sub', u_fam::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_fam::text, true);
    execute 'set local role authenticated';
    v_rows := v_rows || array[['SEC', 'non-trainer (family) Save', 'not_allowed', public.save_trainer_student_kyu_program(s_act, k6, '[]'::jsonb, 1) ->> 'reason']];
    v_rows := v_rows || array[['SEC', 'non-trainer (family) Reset', 'not_allowed', public.reset_trainer_student_kyu_program(s_act, k6, 1) ->> 'reason']];
    begin
      perform count(*) from public.student_kyu_programs;
      v_txt := 'allowed';
    exception when insufficient_privilege then v_txt := 'denied_42501';
    end;
    v_rows := v_rows || array[['SEC', 'authenticated direct SELECT student_kyu_programs', 'denied_42501', v_txt]];
    execute 'reset role';

    -- anon
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    begin
      execute 'set local role anon';
      begin
        perform public.save_trainer_student_kyu_program(s_act, k6, '[]'::jsonb, 1);
        v_txt := 'allowed';
      exception when insufficient_privilege then v_txt := 'denied_42501';
      end;
      execute 'reset role';
    exception when others then v_txt := 'not testable: ' || sqlerrm;
    end;
    v_rows := v_rows || array[['SEC', 'anon Save', 'denied_42501', v_txt]];

    -- ==================== VERSIONING (D, V4–V10)
    -- (D, V4) Trainer D (same group as A) saves on top of version 1
    perform set_config('request.jwt.claims', json_build_object('sub', u_td::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_td::text, true);
    execute 'set local role authenticated';
    v_json := public.get_trainer_required_techniques(s_act);
    v_rows := v_rows || array[['D', 'trainer D (same group) READ / canEdit', 'ok/true', (v_json ->> 'status') || '/' || coalesce(v_json ->> 'canEdit', 'absent')]];
    v_res := public.save_trainer_student_kyu_program(s_act, k6, jsonb_build_array(
      jsonb_build_object('technique_id', t1, 'block_type', 'required_nage'),
      jsonb_build_object('technique_id', t3, 'block_type', 'required_katame')), 1);
    v_rows := v_rows || array[['V4', 'second Save (trainer D, expected 1) -> version 2', 'true/2', (v_res ->> 'ok') || '/' || coalesce(v_res ->> 'version', 'null')]];
    execute 'reset role';

    select string_agg(p.version || ':' || p.status, ',' order by p.version) into v_txt
    from public.student_kyu_programs p where p.student_id = s_act and p.kyu_lookup_id = k6;
    v_rows := v_rows || array[['V4', 'DB after second Save', '1:superseded,2:active', v_txt]];
    select (p.ended_by_trainer_account_id = a_td)::text into v_txt
    from public.student_kyu_programs p where p.student_id = s_act and p.kyu_lookup_id = k6 and p.version = 1;
    v_rows := v_rows || array[['V4', 'version 1 ended_by = trainer D', 'true', coalesce(v_txt, 'null')]];

    -- (V5) Trainer A with stale expected_version = 1
    perform set_config('request.jwt.claims', json_build_object('sub', u_ta::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_ta::text, true);
    execute 'set local role authenticated';
    v_res := public.save_trainer_student_kyu_program(s_act, k6, jsonb_build_array(jsonb_build_object('technique_id', t2, 'block_type', 'required_nage')), 1);
    v_rows := v_rows || array[['V5', 'stale Save -> version_conflict (currentVersion 2)', 'version_conflict/2', (v_res ->> 'reason') || '/' || coalesce(v_res ->> 'currentVersion', 'null')]];
    v_res := public.reset_trainer_student_kyu_program(s_act, k6, 1);
    v_rows := v_rows || array[['V5', 'stale Reset -> version_conflict', 'version_conflict', v_res ->> 'reason']];
    execute 'reset role';
    select string_agg(p.version || ':' || p.status, ',' order by p.version) into v_txt
    from public.student_kyu_programs p where p.student_id = s_act and p.kyu_lookup_id = k6;
    v_rows := v_rows || array[['V5', 'DB unchanged after conflicts', '1:superseded,2:active', v_txt]];

    -- (V6) Reset, (V7) new Save continues numbering
    perform set_config('request.jwt.claims', json_build_object('sub', u_ta::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_ta::text, true);
    execute 'set local role authenticated';
    v_res := public.reset_trainer_student_kyu_program(s_act, k6, 2);
    v_rows := v_rows || array[['V6', 'Reset (expected 2) -> ok', 'true', v_res ->> 'ok']];
    v_json := public.get_trainer_required_techniques(s_act);
    v_rows := v_rows || array[['V6', 'after Reset -> source club, version null', 'club/null', (v_json ->> 'source') || '/' || coalesce(v_json ->> 'version', 'null')]];
    v_res := public.save_trainer_student_kyu_program(s_act, k6, jsonb_build_array(jsonb_build_object('technique_id', t2, 'block_type', 'required_nage')), null);
    v_rows := v_rows || array[['V7', 'Save after Reset -> version 3', 'true/3', (v_res ->> 'ok') || '/' || coalesce(v_res ->> 'version', 'null')]];
    execute 'reset role';
    select string_agg(p.version || ':' || p.status, ',' order by p.version) into v_txt
    from public.student_kyu_programs p where p.student_id = s_act and p.kyu_lookup_id = k6;
    v_rows := v_rows || array[['V7', 'DB history kept', '1:superseded,2:reset,3:active', v_txt]];
    select count(*) into v_int
    from public.student_kyu_program_items i join public.student_kyu_programs p on p.id = i.student_kyu_program_id
    where p.student_id = s_act and p.kyu_lookup_id = k6;
    v_rows := v_rows || array[['V7', 'items of all versions kept (3 + 2 + 1)', '6', v_int::text]];
    select source into v_txt from public.student_kyu_programs where student_id = s_norow and kyu_lookup_id = k6 and status = 'active';
    v_rows := v_rows || array[['G', 'Save equal to club program -> source club_copy', 'club_copy', coalesce(v_txt, 'null')]];
    select count(*) into v_int from public.club_kyu_program_items where club_id = v_club_a and kyu_lookup_id = k6;
    v_rows := v_rows || array[['V8', 'club program untouched by individual saves', '2', v_int::text]];

    -- (V8) club program changes later -> individual snapshot unchanged
    insert into public.club_kyu_program_items (club_id, kyu_lookup_id, item_type, technique_id, block_type, sort_order)
    values (v_club_a, k6, 'technique', t3, 'required_katame', 0);
    perform set_config('request.jwt.claims', json_build_object('sub', u_ta::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_ta::text, true);
    execute 'set local role authenticated';
    v_json := public.get_trainer_required_techniques(s_act);
    v_rows := v_rows || array[['V8', 'club changed -> individual v3 still 1 technique', 'individual/3/1',
      (v_json ->> 'source') || '/' || coalesce(v_json ->> 'version', 'null') || '/' || jsonb_array_length(v_json -> 'techniques')]];
    execute 'reset role';

    -- immutability / uniqueness (as postgres)
    select id into v_pid from public.student_kyu_programs where student_id = s_act and kyu_lookup_id = k6 and version = 1;
    begin
      update public.student_kyu_program_items set sort_order = 99 where student_kyu_program_id = v_pid;
      v_txt := 'allowed';
    exception when others then v_txt := 'blocked';
    end;
    v_rows := v_rows || array[['SEC', 'UPDATE history items', 'blocked', v_txt]];
    begin
      delete from public.student_kyu_programs where id = v_pid;
      v_txt := 'allowed';
    exception when others then v_txt := 'blocked';
    end;
    v_rows := v_rows || array[['SEC', 'DELETE history version', 'blocked', v_txt]];
    begin
      update public.student_kyu_programs set status = 'active', ended_at = null, ended_by_trainer_account_id = null where id = v_pid;
      v_txt := 'allowed';
    exception when others then v_txt := 'blocked';
    end;
    v_rows := v_rows || array[['SEC', 'reactivate superseded version', 'blocked', v_txt]];
    begin
      insert into public.student_kyu_programs (club_id, student_id, kyu_lookup_id, version, status, source, created_by_trainer_account_id)
      values (v_club_a, s_act, k6, 99, 'active', 'edited', a_ta);
      v_txt := 'allowed';
    exception when others then v_txt := 'blocked';
    end;
    v_rows := v_rows || array[['SEC', 'second active version (partial unique)', 'blocked', v_txt]];

    -- (V10) Kyu changes -> old target is history, stale editor Save denied
    update public.students set kyu_grad = '6. Kyu' where id = s_act;
    perform set_config('request.jwt.claims', json_build_object('sub', u_ta::text, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u_ta::text, true);
    execute 'set local role authenticated';
    v_res := public.save_trainer_student_kyu_program(s_act, k6, jsonb_build_array(jsonb_build_object('technique_id', t1, 'block_type', 'required_nage')), 3);
    v_rows := v_rows || array[['V10', 'stale editor Save for old target Kyu', 'target_kyu_changed', v_res ->> 'reason']];
    v_res := public.reset_trainer_student_kyu_program(s_act, k6, 3);
    v_rows := v_rows || array[['V10', 'stale editor Reset for old target Kyu', 'target_kyu_changed', v_res ->> 'reason']];
    v_json := public.get_trainer_required_techniques(s_act);
    v_rows := v_rows || array[['V10', 'resolver now targets 5. Kyu from club (no individual)', k5::text || '/club',
      coalesce(v_json ->> 'nextKyuLookupId', 'null') || '/' || coalesce(v_json ->> 'source', 'null')]];
    execute 'reset role';
    select string_agg(p.version || ':' || p.status, ',' order by p.version) into v_txt
    from public.student_kyu_programs p where p.student_id = s_act and p.kyu_lookup_id = k6;
    v_rows := v_rows || array[['V10', '6. Kyu history preserved', '1:superseded,2:reset,3:active', v_txt]];

  exception when others then
    v_setup_error := sqlstate || ': ' || sqlerrm;
  end;

  ---------------------------------------------------------------- report (RAISE rolls back everything)
  for i in 1..coalesce(array_length(v_rows, 1), 0) loop
    v_status := case when v_rows[i][4] is not distinct from v_rows[i][3] then 'PASS' else 'FAIL' end;
    if v_status = 'PASS' then v_pass := v_pass + 1; else v_fail := v_fail + 1; end if;
    v_out := v_out || E'\n' || v_status || ' | ' || v_rows[i][1] || ' | ' || v_rows[i][2]
             || ' | expected: ' || coalesce(v_rows[i][3], 'NULL') || ' | actual: ' || coalesce(v_rows[i][4], 'NULL');
  end loop;

  raise exception '%', format(
    E'JKL_076_RUNTIME_REPORT — this ERROR is expected, ALL test data was rolled back.\nSETUP: %s\nPASS=%s FAIL=%s%s',
    coalesce('ERROR ' || v_setup_error, 'ok'), v_pass, v_fail, v_out);
end
$jkl$;
```

**Ожидается:** ERROR `JKL_076_RUNTIME_REPORT … SETUP: ok`, `FAIL=0`, все строки `PASS`:

- **A** — тренер A (общая группа): READ `ok`, `canEdit=true`.
- **B** — тренер B (тот же клуб, другая группа): READ в формате отказа
  `no_current_kyu/0`, Save/Reset `not_allowed`; своего ученика группы B читает (`ok`).
- **C** — тренер другого клуба: READ отказ, Save/Reset `not_allowed`.
- **D** — второй тренер группы A: READ `ok`, `canEdit=true`, сохраняет версию 2.
- **E** — истёкшая страница + `trainer_access_after_expiry`: READ `ok`, `canEdit=false`,
  Save/Reset `page_inactive`.
- **F** — `manual_disabled`: Save/Reset `page_inactive`.
- **G/H** — нет строки доступа / `access_until = NULL`: `canEdit=true`, Save `ok`;
  Save, совпадающий с программой клуба, → `source = club_copy`.
- **V1–V10** — club → v1 → individual; v2 от второго тренера (v1 superseded, ended_by = D);
  устаревший Save/Reset → `version_conflict` без изменений БД; Reset → club; новый Save → v3;
  история `1:superseded,2:reset,3:active`, items всех версий сохранены (6); изменение
  программы клуба не меняет v3; одна техника в двух блоках; после смены Kyu устаревший
  Save/Reset → `target_kyu_changed`, resolver берёт 5. Kyu из программы клуба, история 6. Kyu на месте.
- **SEC** — неверный `block_type` / неизвестная техника → `invalid_items`; не-тренер (семья)
  Save/Reset → `not_allowed`; прямой SELECT таблицы от `authenticated` → `denied_42501`;
  anon Save → `denied_42501`; UPDATE/DELETE истории, реактивация старой версии и вторая
  active — `blocked`.

`SETUP: ERROR …` — временные данные не удалось создать (ограничения legacy-таблиц,
см. PRECHECK F); всё откатано — прислать текст.

## C3. LEFTOVER — READ-ONLY (сразу после C2)

```sql
select
  (select count(*) from public.students where vorname like 'ZZ076%')          as temp_students,
  (select count(*) from public.trainers where trainer_id like 'zz076%')       as temp_trainers,
  (select count(*) from public.trainer_accounts where display_name like 'ZZ076%') as temp_trainer_accounts,
  (select count(*) from public.clubs where club_id like 'zz076%')             as temp_clubs,
  (select count(*) from auth.users where email like 'zz076%')                 as temp_auth_users,
  (select count(*) from public.student_kyu_programs p
     join public.students s on s.id = p.student_id where s.vorname like 'ZZ076%') as temp_programs;
```

**Ожидается:** все значения `0`.
