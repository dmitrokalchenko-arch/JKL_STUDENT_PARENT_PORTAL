-- Дополнительные фикстуры для локального RLS-тестирования (сценарии A-J,
-- см. LOCAL_SUPABASE_TEST_PLAN). Применять ТОЛЬКО на локальной эфемерной
-- базе (`supabase db reset`), ПОСЛЕ supabase/seed.sql.
--
-- ТИПЫ (аудит этапа 2.2): club_id — text slug, student id — bigint. Более
-- ранняя версия этого файла ошибочно использовала uuid для обоих.
--
-- seed.sql уже создаёт: Club 1 (club_id='jkl-test-seed'), Student A
-- (id=900000000001, в Club 1).
-- Этот файл добавляет то, чего не хватает для проверки изоляции:
--   Club 2 (второй клуб — для cross-club теста);
--   Student B (в Club 1, НЕ связан с Family A — для cross-family теста);
--   Student C (в Club 2 — для cross-club теста);
--   Family B (в Club 1, без привязанных детей — видит только пустоту).
--
-- Family A создаётся ОТДЕЛЬНО через Auth Admin API (не SQL) — потому что
-- auth.users нельзя надёжно создавать напрямую INSERT'ом (хеширование
-- пароля и формат зависят от версии GoTrue). После создания guardian через
-- API нужно вручную привязать её к Student A строкой family_students.

do $$
declare
  v_club1_id text := 'jkl-test-seed';       -- совпадает с seed.sql
  v_club2_id text := 'jkl-test-seed-2';
  v_student_b_id bigint := 900000000003;
  v_student_c_id bigint := 900000000004;
  v_family_b_id uuid := '00000000-0000-4000-8000-000000000005';
begin
  -- Club 2 — для cross-club теста (сценарий C).
  if not exists (select 1 from public.clubs where club_id = v_club2_id) then
    insert into public.clubs (club_id, club_name, club_short_name, active)
    values (v_club2_id, 'JKL Test Club 2 (seed)', 'jkl-test-seed-2', true);
  end if;

  -- Student B — в том же клубе, что Student A, но не привязан к Family A
  -- (сценарий B: "Family A не видит Student B").
  insert into public.students (id, club_id, vorname, nachname, geburtsdatum, guertelfarbe, kyu_grad, aktiv)
  values (v_student_b_id, v_club1_id, 'Test', 'StudentB', date '2016-01-01', 'Белый пояс', '6', 'JA')
  on conflict (id) do nothing;

  -- Student C — в ДРУГОМ клубе (сценарий C: "Family A не видит Student C из Club 2").
  insert into public.students (id, club_id, vorname, nachname, geburtsdatum, guertelfarbe, kyu_grad, aktiv)
  values (v_student_c_id, v_club2_id, 'Test', 'StudentC', date '2016-01-01', 'Белый пояс', '6', 'JA')
  on conflict (id) do nothing;

  -- Family B — в Club 1, БЕЗ привязанных детей (сценарий D: "Family B не
  -- видит Student A"). guardian для неё создаётся отдельно через Auth API,
  -- как и для Family A.
  insert into public.families (id, club_id, nickname, normalized_nickname, display_name)
  values (v_family_b_id, v_club1_id, 'familyb', 'familyb', 'Семья B (тест)')
  on conflict (club_id, normalized_nickname) do nothing;
end $$;
