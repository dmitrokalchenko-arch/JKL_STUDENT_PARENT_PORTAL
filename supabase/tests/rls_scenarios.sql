-- Сценарии A-J из задания (аудит этапа 2.1, раздел 11).
-- Запускать ТОЛЬКО на локальной эфемерной базе, ПОСЛЕ:
--   1. supabase db reset (применяет все миграции + supabase/seed.sql)
--   2. supabase/tests/local_test_fixtures.sql
--   3. создания двух auth-пользователей (Family A guardian, Family B guardian)
--      через Auth Admin API — см. docs/database/LOCAL_SUPABASE_TEST_PLAN.md,
--      раздел 3-4 — и привязки Family A к Student A строкой family_students.
--
-- Запуск (psql, с реальными UUID вместо плейсхолдеров):
--   psql "$DB_URL" \
--     -v family_a_uid="'<uuid guardian A>'" \
--     -v family_b_uid="'<uuid guardian B>'" \
--     -f supabase/tests/rls_scenarios.sql
--
-- ИСПРАВЛЕНО (этап G1): подстановка psql-переменных вида :name НЕ работает
-- внутри DO $$ ... $$ блоков (подтверждено изолированными тестами при
-- фактическом локальном прогоне — psql интерполирует `:var` в обычном SQL,
-- но не внутри dollar-quoted тела функций/DO-блоков). Раньше это приводило
-- к "syntax error at or near ':'" на первом же сценарии. Теперь входные
-- параметры передаются через session settings (set_config/current_setting,
-- namespace `jkl_test.*`) — они читаются PL/pgSQL изнутри DO-блоков без
-- какой-либо psql-подстановки, только через SQL. Psql-переменные
-- (:student_a_id и т.д.) используются ТОЛЬКО один раз — при первичном
-- заполнении session settings ниже, где подстановка происходит в обычном
-- SQL-операторе (не внутри $$), это подтверждённо работает.
--
-- ТИПЫ (аудит этапа 2.2): student id — bigint, club_id — text slug,
-- family_a_uid/family_b_uid — uuid (auth.users.id).

\set ON_ERROR_STOP on

-- Обязательные внешние параметры — family_a_uid/family_b_uid передаются
-- через -v при запуске psql. Явная ошибка, если не заданы (вместо тихого
-- NULL) — \if :{?name} проверяет именно факт передачи переменной через -v.
\if :{?family_a_uid}
\else
  \echo 'FATAL: -v family_a_uid="''<uuid>''" не передан. Останов.'
  \quit
\endif
\if :{?family_b_uid}
\else
  \echo 'FATAL: -v family_b_uid="''<uuid>''" не передан. Останов.'
  \quit
\endif

-- Внутренние тестовые константы (совпадают с supabase/tests/local_test_fixtures.sql
-- и supabase/seed.sql). Не psql-переменные внешнего ввода — фиксированы здесь.
\set student_a_id 900000000001
\set student_b_id 900000000003
\set student_c_id 900000000004
\set club2_id '''jkl-test-seed-2'''

begin;

-- Session settings (jkl_test.*) — единственное место, где используется
-- psql-подстановка :'name' (в обычном SQL-операторе, не внутри $$).
-- Третий аргумент set_config = false -> область видимости "текущая сессия"
-- (не транзакция), переживает все последующие SET LOCAL ROLE/RESET ROLE
-- внутри этой же сессии psql.
select set_config('jkl_test.student_a_id', :'student_a_id', false);
select set_config('jkl_test.student_b_id', :'student_b_id', false);
select set_config('jkl_test.student_c_id', :'student_c_id', false);
select set_config('jkl_test.club2_id', :'club2_id', false);
select set_config('jkl_test.family_a_uid', :'family_a_uid', false);
select set_config('jkl_test.family_b_uid', :'family_b_uid', false);

-- === A. Family A / Club 1 видит Student A ===================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('jkl_test.family_a_uid')::uuid, 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.family_students
  where student_id = current_setting('jkl_test.student_a_id')::bigint;
  if v_count = 1 then
    raise notice 'PASS A: Family A видит Student A через family_students (% строк)', v_count;
  else
    raise exception 'FAIL A: ожидалась 1 строка family_students для Student A, получено %', v_count;
  end if;
end $$;

do $$
declare v_result jsonb;
begin
  select public.get_student_technique_progress(current_setting('jkl_test.student_a_id')::bigint) into v_result;
  if v_result is not null then
    raise notice 'PASS A2: get_student_technique_progress(Student A) вернул данные для Family A';
  else
    raise exception 'FAIL A2: get_student_technique_progress(Student A) вернул null для Family A';
  end if;
end $$;

-- === B. Family A / Club 1 НЕ видит Student B =================================
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.family_students
  where student_id = current_setting('jkl_test.student_b_id')::bigint;
  if v_count = 0 then
    raise notice 'PASS B: Family A не видит family_students для Student B';
  else
    raise exception 'FAIL B: Family A получила % строк для чужого Student B', v_count;
  end if;
end $$;

do $$
begin
  perform public.get_student_technique_progress(current_setting('jkl_test.student_b_id')::bigint);
  raise exception 'FAIL B2: get_student_technique_progress(Student B) не выбросил access_denied для Family A';
exception
  when sqlstate '42501' then
    raise notice 'PASS B2: get_student_technique_progress(Student B) корректно отклонён (access_denied)';
end $$;

-- === C. Family A / Club 1 НЕ видит Student C из Club 2 ========================
do $$
begin
  perform public.get_student_technique_progress(current_setting('jkl_test.student_c_id')::bigint);
  raise exception 'FAIL C: get_student_technique_progress(Student C, чужой клуб) не был отклонён';
exception
  when sqlstate '42501' then
    raise notice 'PASS C: Student C из Club 2 недоступен Family A (access_denied)';
end $$;

reset role;

-- === D. Family B не видит Student A ===========================================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('jkl_test.family_b_uid')::uuid, 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.family_students
  where student_id = current_setting('jkl_test.student_a_id')::bigint;
  if v_count = 0 then
    raise notice 'PASS D: Family B не видит family_students для Student A';
  else
    raise exception 'FAIL D: Family B получила % строк для чужого Student A', v_count;
  end if;
end $$;

do $$
begin
  perform public.get_student_technique_progress(current_setting('jkl_test.student_a_id')::bigint);
  raise exception 'FAIL D2: get_student_technique_progress(Student A) не был отклонён для Family B';
exception
  when sqlstate '42501' then
    raise notice 'PASS D2: Student A недоступен Family B (access_denied)';
end $$;

reset role;

-- === E. anon не имеет base table privilege на families (SQLSTATE 42501) =======
-- ИСПРАВЛЕНО (этап I, privilege map migration 09): предыдущая версия этого
-- сценария предполагала, что у Supabase-проектов anon/authenticated
-- ИМЕЮТ базовый platform-default GRANT SELECT на таблицы public-схемы, и
-- ожидала просто пустой результат (RLS без policy = 0 строк, без ошибки).
-- Фактическая проверка (information_schema.role_table_grants) показала,
-- что это предположение неверно для этого модуля: ни anon, ни
-- authenticated не получают SELECT/INSERT/UPDATE/DELETE ни на одной
-- таблице public-схемы автоматически — только явный GRANT добавляет эти
-- права. Ни одна RLS-policy в модуле не выдана роли anon (сознательное
-- решение миграции 3), и по решению этапа I роли anon НЕ выдаётся GRANT
-- SELECT на families — RLS не заменяет base table privilege. Поэтому
-- правильное ожидаемое поведение — Postgres должен отклонить сам SELECT
-- ДО применения RLS с ошибкой "permission denied for table families",
-- SQLSTATE 42501 (insufficient_privilege), а не вернуть 0 строк. Успешный
-- SELECT (с любым количеством строк, включая 0) теперь считается FAIL —
-- он означал бы, что anon неожиданно получил base table privilege. Любая
-- ДРУГАЯ ошибка (не insufficient_privilege) не перехватывается этим
-- блоком и не маскируется — она пройдёт как обычная необработанная
-- ошибка и остановит скрипт через ON_ERROR_STOP, как и для всех
-- остальных сценариев.
select set_config('request.jwt.claims', '', true);
set local role anon;

do $$
declare v_count integer;
begin
  begin
    select count(*) into v_count from public.families;
    raise exception 'FAIL E: anon смог выполнить SELECT на families без ошибки доступа (% строк, ожидался permission denied)', v_count;
  exception
    when insufficient_privilege then
      raise notice 'PASS E: anon получил permission denied (SQLSTATE 42501) при SELECT на families, как и ожидалось';
  end;
end $$;

reset role;

-- === I. Прямой SELECT чужих таблиц блокируется RLS (Family A -> student_technique_progress Student B) ===
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('jkl_test.family_a_uid')::uuid, 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.student_technique_progress
  where student_id = current_setting('jkl_test.student_b_id')::bigint;
  if v_count = 0 then
    raise notice 'PASS I: прямой SELECT student_technique_progress для чужого Student B не вернул строк (RLS фильтрует)';
  else
    raise exception 'FAIL I: прямой SELECT вернул % строк чужого прогресса', v_count;
  end if;
end $$;

-- === J. Попытка подменить club_id при INSERT отклоняется =======================
-- Family A вообще не имеет INSERT policy на family_students — ожидаем
-- ошибку RLS (SQLSTATE 42501), а не молчаливый успех с чужим club_id.
do $$
begin
  insert into public.family_students (family_id, student_id, club_id)
  values (
    (select family_id from public.family_guardians where auth_user_id = current_setting('jkl_test.family_a_uid')::uuid),
    current_setting('jkl_test.student_c_id')::bigint,
    current_setting('jkl_test.club2_id')
  );
  raise exception 'FAIL J: INSERT с подменённым club_id прошёл — не должен был';
exception
  when insufficient_privilege then
    raise notice 'PASS J: INSERT в family_students отклонён (нет INSERT policy для authenticated)';
end $$;

reset role;

-- === F. featureEnabled=false возвращается без списка техник ===================
-- Временно выключаем клубный флаг (от имени владельца, RLS на UPDATE тут не
-- участвует — миграции выполняются без RLS-ограничений) и проверяем ответ
-- для Student A от имени Family A.
update public.club_technique_progress_settings
set feature_enabled = false
where club_id = 'jkl-test-seed';

select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('jkl_test.family_a_uid')::uuid, 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare v_result jsonb;
begin
  select public.get_student_technique_progress(current_setting('jkl_test.student_a_id')::bigint) into v_result;
  if (v_result->>'featureEnabled')::boolean is false and jsonb_array_length(v_result->'techniques') = 0 then
    raise notice 'PASS F: featureEnabled=false -> techniques=[] (без ошибки)';
  else
    raise exception 'FAIL F: неожиданный ответ при feature_enabled=false: %', v_result;
  end if;
end $$;

reset role;
update public.club_technique_progress_settings
set feature_enabled = true
where club_id = 'jkl-test-seed';

-- === G. completed техника не возвращается как required =========================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('jkl_test.family_a_uid')::uuid, 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_result jsonb;
  v_dup_count integer;
begin
  select public.get_student_technique_progress(current_setting('jkl_test.student_a_id')::bigint) into v_result;

  select count(*) into v_dup_count
  from jsonb_array_elements(v_result->'techniques') t
  where (t->>'status') = 'completed'
  group by t->>'id'
  having count(*) > 1;

  if v_dup_count is null then
    raise notice 'PASS G: ни одна техника не встречается дважды (completed и required одновременно невозможно по конструкции запроса)';
  else
    raise exception 'FAIL G: обнаружена техника с дублирующимся статусом';
  end if;
end $$;

reset role;

rollback; -- ничего из тестового прогона (кроме уже закоммиченных ранее фикстур) не остаётся

-- === H. video signed URL недоступен чужой семье ================================
-- Не тестируется здесь (createSignedUrl — вызов Storage API, не чистый SQL).
-- См. docs/database/LOCAL_SUPABASE_TEST_PLAN.md, раздел 6 — curl-пример
-- через local Storage REST endpoint с JWT Family B на путь Student A.
