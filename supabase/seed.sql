-- ⚠️ DEV/LOCAL ONLY.
--
-- `supabase/seed.sql` — специальное имя файла Supabase CLI: применяется
-- ТОЛЬКО командой `supabase db reset` на локальной эфемерной базе (создаётся
-- заново из миграций при каждом reset), НИКОГДА автоматически не применяется
-- к удалённому/production проекту через `supabase db push`.
--
-- НЕ выполнять это вручную в SQL Editor реального Supabase-проекта, которым
-- пользуется живой JCL_Gruppen — это создаст вымышленный клуб и вымышленного
-- ученика в боевой системе тренеров. Если нужны тестовые данные в самом
-- удалённом проекте (а не в локальной копии), их нужно вставлять отдельно,
-- после явного согласования, с явно узнаваемым club_short_name (как здесь).
--
-- Полностью самодостаточно: не переиспользует и не угадывает ID реальных
-- клубов/учеников JCL_Gruppen — создаёт свой собственный тестовый клуб и
-- ученика с фиксированными, легко узнаваемыми значениями.
--
-- ТИПЫ (аудит этапа 2.2, подтверждено диагностикой реальной базы 20.07.2026):
--   clubs.id        uuid, автогенерируется (gen_random_uuid()) — не задаём вручную
--   clubs.club_id   text (человекочитаемый slug, напр. 'jcl') — задаём сами
--   students.id     bigint, БЕЗ автогенерации (нет default) — приложение
--                   назначает id само; здесь используется заведомо большая,
--                   легко узнаваемая тестовая константа, чтобы исключить
--                   совпадение с реальным диапазоном ID (диапазон реальных
--                   ID не проверялся — доступа к данным нет, только к схеме)
--   students.club_id  text, ссылается на clubs.club_id (совпадающее значение)
--   students.kyu_grad text (НЕ число — более ранняя версия seed ошибочно
--                   вставляла integer)

do $$
declare
  v_club_id text := 'jkl-test-seed';
  v_student_id bigint := 900000000001;
  v_belt_id uuid;
  v_i integer;
  v_technique_id uuid;
begin
  -- Явная проверка существования вместо ON CONFLICT (club_id) — уникальный
  -- индекс/constraint на clubs.club_id не подтверждён диагностикой реальной
  -- базы (подтверждён только clubs.id как PK), ON CONFLICT (club_id) упал бы
  -- с ошибкой "no unique or exclusion constraint" при его отсутствии.
  if not exists (select 1 from public.clubs where club_id = v_club_id) then
    insert into public.clubs (club_id, club_name, club_short_name, active)
    values (v_club_id, 'JKL Test Club (seed)', 'jkl-test-seed', true);
  end if;

  insert into public.students (id, club_id, vorname, nachname, geburtsdatum, guertelfarbe, kyu_grad, aktiv)
  values (v_student_id, v_club_id, 'Test', 'Student', date '2015-01-01', 'Жёлтый пояс', '5', 'JA')
  on conflict (id) do nothing;

  insert into public.club_technique_progress_settings (club_id, feature_enabled, default_bonus_requirement, bonus_points)
  values (v_club_id, true, 8, 50)
  on conflict (club_id) do nothing;

  select id into v_belt_id from public.club_belts where club_id = v_club_id and name = 'Жёлтый пояс';
  if v_belt_id is null then
    insert into public.club_belts (club_id, name, color_hex, sort_order)
    values (v_club_id, 'Жёлтый пояс', '#f2d13c', 2)
    returning id into v_belt_id;
  end if;

  -- 8 Tachi-waza, первые 5 отмечены как выполненные (совпадает с примером из
  -- ТЗ: "для бонуса нужно 8, выполнено 5 -> 3 пустых слота"). У первой
  -- выполненной техники есть тестовый video_path (сам файл в Storage не
  -- загружается этим seed'ом — UI покажет "видео пока не добавлено", пока
  -- реальный объект не будет положен в bucket technique-videos вручную).
  for v_i in 1..8 loop
    insert into public.club_techniques (club_id, name, category, is_active)
    values (v_club_id, 'Tachi-waza seed #' || v_i, 'tachi-waza', true)
    returning id into v_technique_id;

    insert into public.club_belt_techniques (club_id, belt_id, technique_id, sort_order)
    values (v_club_id, v_belt_id, v_technique_id, v_i);

    if v_i <= 5 then
      insert into public.student_technique_progress (club_id, student_id, technique_id, belt_id, completed_at, video_path)
      values (
        v_club_id, v_student_id, v_technique_id, v_belt_id, now() - (v_i || ' days')::interval,
        case when v_i = 1
          -- Путь ВНУТРИ бакета technique-videos, без имени бакета как префикса
          -- (см. комментарий в 20260720120007_technique_progress_storage.sql).
          then v_club_id || '/' || v_student_id::text || '/seed-progress-' || v_i || '/demo.mp4'
          else null
        end
      );
    end if;
  end loop;

  -- 8 Ne-waza, ни одна не выполнена — проверка полностью required-категории.
  for v_i in 1..8 loop
    insert into public.club_techniques (club_id, name, category, is_active)
    values (v_club_id, 'Ne-waza seed #' || v_i, 'ne-waza', true)
    returning id into v_technique_id;

    insert into public.club_belt_techniques (club_id, belt_id, technique_id, sort_order)
    values (v_club_id, v_belt_id, v_technique_id, v_i);
  end loop;
end $$;
