-- Тесты public.get_current_trainer_groups() (migration 016) — 5 backend-
-- сценариев из задания. Только локальная эфемерная база (`supabase db
-- reset`). Полностью самодостаточен: фикстуры создаются и откатываются
-- внутри одной транзакции (rollback в конце), кроме auth.users — их
-- нельзя надёжно создать INSERT'ом (см. local_test_fixtures.sql), поэтому
-- три тестовых тренера создаются ОТДЕЛЬНО через Auth Admin API перед
-- запуском этого файла (временные локальные пароли, не в tracked-файлах):
--
--   curl -X POST "$API_URL/auth/v1/admin/users" \
--     -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"email":"trainer_groups_test_a@internal.jkl","password":"<temp>","email_confirm":true}'
--   (аналогично test_b, test_c)
--
-- Запуск (БЕЗ одинарных кавычек внутри значений -v — :'uid_a' в самом
-- скрипте уже добавляет корректное SQL-квотирование; двойное квотирование
-- ломает cast к uuid):
--   psql "$DB_URL" \
--     -v uid_a=<uuid из ответа Admin API, trainer_groups_test_a> \
--     -v uid_b=<uuid ..._test_b> \
--     -v uid_c=<uuid ..._test_c> \
--     -f supabase/tests/trainer_groups_rpc_tests.sql
--
-- Сценарии:
--   1. Неавторизованный (anon без grant + authenticated без trainer_accounts) не получает группы.
--   2. Неактивный trainer account (Trainer C, is_active=false) не получает группы.
--   3. Trainer A получает свою группу (Group A1).
--   4. Trainer A НЕ получает группу Trainer B (Group B1, тот же клуб).
--   5. Trainer A НЕ получает группу другого клуба (Group Club2, тот же
--      trainer_id намеренно "просочился" в trainer_groups чужого клуба —
--      проверяет club_id-скоуп, не только trainer_id).

\set ON_ERROR_STOP on

\if :{?uid_a}
\else
  \echo 'FATAL: -v uid_a="''<uuid>''" не передан. Останов.'
  \quit
\endif
\if :{?uid_b}
\else
  \echo 'FATAL: -v uid_b="''<uuid>''" не передан. Останов.'
  \quit
\endif
\if :{?uid_c}
\else
  \echo 'FATAL: -v uid_c="''<uuid>''" не передан. Останов.'
  \quit
\endif

begin;

select set_config('jkl_test.uid_a', :'uid_a', false);
select set_config('jkl_test.uid_b', :'uid_b', false);
select set_config('jkl_test.uid_c', :'uid_c', false);

-- === Фикстуры (как postgres, до переключения ролей) ===========================
do $$
declare
  v_club1 text := 'jkl-test-seed';       -- совпадает с seed.sql
  v_club2 text := 'jkl-test-seed-2';
  v_uid_a uuid := current_setting('jkl_test.uid_a')::uuid;
  v_uid_b uuid := current_setting('jkl_test.uid_b')::uuid;
  v_uid_c uuid := current_setting('jkl_test.uid_c')::uuid;
begin
  if not exists (select 1 from public.clubs where club_id = v_club2) then
    insert into public.clubs (club_id, club_name, club_short_name, active)
    values (v_club2, 'JKL Test Club 2 (seed)', 'jkl-test-seed-2', true);
  end if;

  insert into public.trainers (id, club_id, trainer_id) values
    (900000000010, v_club1, 'T-A'),
    (900000000011, v_club1, 'T-B'),
    (900000000012, v_club1, 'T-C');

  insert into public.groups (gruppe_id, club_id, gruppenname, alter, aktiv) values
    (900000000020, v_club1, 'Group A1', '6-10', true),
    (900000000021, v_club1, 'Group B1', '11-14', true),
    (900000000022, v_club2, 'Group Club2', null, true);

  insert into public.trainer_groups (trainer_id, gruppe_id, club_id, trainer_name) values
    ('T-A', 900000000020, v_club1, 'Trainer A'),
    ('T-B', 900000000021, v_club1, 'Trainer B'),
    -- Trainer A's trainer_id "просочился" в trainer_groups другого клуба —
    -- проверяет, что club_id-скоуп в RPC защищает, а не только trainer_id.
    ('T-A', 900000000022, v_club2, 'Trainer A');

  insert into public.trainer_accounts (auth_user_id, trainer_row_id, club_id, login_name, display_name, is_active) values
    (v_uid_a, 900000000010, v_club1, 'Trainer A', 'Trainer A', true),
    (v_uid_b, 900000000011, v_club1, 'Trainer B', 'Trainer B', true),
    (v_uid_c, 900000000012, v_club1, 'Trainer C', 'Trainer C', false);
end $$;

-- === 1a. anon не может вызвать RPC вообще (нет GRANT) ==========================
set local role anon;
do $$
begin
  perform public.get_current_trainer_groups();
  raise exception 'FAIL 1a: anon смог вызвать get_current_trainer_groups() без GRANT';
exception
  when sqlstate '42501' then
    raise notice 'PASS 1a: anon корректно отклонён (permission denied) на get_current_trainer_groups()';
end $$;
reset role;

-- === 1b. authenticated без trainer_accounts (случайный auth.uid()) -> 0 строк ===
select set_config(
  'request.jwt.claims',
  json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.get_current_trainer_groups();
  if v_count = 0 then
    raise notice 'PASS 1b: authenticated без trainer_accounts получил 0 строк (не ошибку)';
  else
    raise exception 'FAIL 1b: ожидалось 0 строк для неизвестного auth.uid(), получено %', v_count;
  end if;
end $$;
reset role;

-- === 2. Неактивный trainer account (Trainer C) -> 0 строк =======================
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('jkl_test.uid_c')::uuid, 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.get_current_trainer_groups();
  if v_count = 0 then
    raise notice 'PASS 2: неактивный Trainer C получил 0 строк';
  else
    raise exception 'FAIL 2: неактивный Trainer C получил % строк вместо 0', v_count;
  end if;
end $$;
reset role;

-- === 3/4/5. Trainer A видит только свою группу, не B, не чужого клуба ==========
select set_config(
  'request.jwt.claims',
  json_build_object('sub', current_setting('jkl_test.uid_a')::uuid, 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare
  v_own_count integer;
  v_other_trainer_count integer;
  v_other_club_count integer;
  v_total_count integer;
begin
  select count(*) into v_total_count from public.get_current_trainer_groups();

  select count(*) into v_own_count
  from public.get_current_trainer_groups()
  where group_id = '900000000020';

  select count(*) into v_other_trainer_count
  from public.get_current_trainer_groups()
  where group_id = '900000000021';

  select count(*) into v_other_club_count
  from public.get_current_trainer_groups()
  where group_id = '900000000022';

  if v_own_count = 1 then
    raise notice 'PASS 3: Trainer A видит свою группу Group A1';
  else
    raise exception 'FAIL 3: Trainer A не видит свою группу (% строк вместо 1)', v_own_count;
  end if;

  if v_other_trainer_count = 0 then
    raise notice 'PASS 4: Trainer A НЕ видит группу Trainer B';
  else
    raise exception 'FAIL 4: Trainer A получил чужую группу Trainer B (% строк)', v_other_trainer_count;
  end if;

  if v_other_club_count = 0 then
    raise notice 'PASS 5: Trainer A НЕ видит группу другого клуба (club_id-скоуп сработал)';
  else
    raise exception 'FAIL 5: Trainer A получил группу другого клуба (% строк) — club_id-скоуп не сработал', v_other_club_count;
  end if;

  if v_total_count = 1 then
    raise notice 'PASS 3b: у Trainer A ровно 1 группа в общем результате (не больше)';
  else
    raise exception 'FAIL 3b: ожидалась ровно 1 строка всего, получено %', v_total_count;
  end if;
end $$;
reset role;

rollback; -- фикстуры этого теста не остаются (auth.users, созданные Admin API, вне транзакции — не откатываются, это ожидаемо)
