-- RPC для frontend: текущая семья (auth.uid()) и список активных детей,
-- к которым у неё есть доступ. Спроектировано и согласовано отдельно
-- (этап "frontend integration", анализ до создания миграции).
--
-- Единственный вход — auth.uid(); функция не принимает параметров, поэтому
-- подмена family_id/student_id для обхода доступа структурно невозможна.
--
-- SECURITY DEFINER обоснован необходимостью, не выбран по умолчанию:
--   - public.families: RLS-policy families_select_own существует, но base
--     GRANT SELECT сознательно НЕ выдан authenticated (решение предыдущего
--     этапа privilege map — не было подтверждённого прямого вызывающего).
--   - public.students: base GRANT authenticated отсутствует и не выдавался
--     ни на одном этапе (используется только изнутри SECURITY DEFINER).
--     Фактические privileges authenticated/anon на students в реальной
--     базе JCL_Gruppen не задокументированы аудитом — полагаться на них
--     было бы недетерминированно.
--   - public.family_guardians/public.family_students уже имеют base GRANT
--     SELECT (миграция 9), но обрабатываются тем же способом для
--     единообразия внутри одной функции.
-- Эта миграция НЕ добавляет никаких новых GRANT SELECT на families/
-- students/family_guardians/family_students — весь доступ инкапсулирован
-- внутри SECURITY DEFINER.
--
-- families.status НЕ фильтруется на этом этапе (по решению пользователя) —
-- правила доступа для suspended-семей будут определены отдельно.
--
-- family_students.status = 'active' фильтруется — не показывать
-- приостановленные связи с учеником.
--
-- student_id возвращается как text, не bigint — PostgREST сериализует
-- int8 в JSON-число, которое JS парсит как float64 и теряет точность выше
-- Number.MAX_SAFE_INTEGER; реальный диапазон students.id в JCL_Gruppen не
-- подтверждён аудитом. Фронтенд обязан обращаться с этим полем как с
-- непрозрачной строкой и никогда не приводить её к Number.
--
-- club_id возвращается в фактическом типе колонки family_students.club_id
-- (подтверждено information_schema перед созданием этой миграции: text).
create or replace function public.get_current_family_children()
returns table (
  family_id uuid,
  family_display_name text,
  student_id text,
  student_first_name text,
  student_last_name text,
  club_id text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id as family_id,
    f.display_name as family_display_name,
    s.id::text as student_id,
    s.vorname as student_first_name,
    s.nachname as student_last_name,
    fs.club_id as club_id
  from public.family_guardians fg
  join public.family_students fs
    on fs.family_id = fg.family_id
   and fs.status = 'active'
  join public.families f
    on f.id = fg.family_id
  join public.students s
    on s.id = fs.student_id
  where fg.auth_user_id = (select auth.uid())
  order by fs.linked_at asc, s.id asc;
$$;

comment on function public.get_current_family_children() is
  'SECURITY DEFINER: возвращает семью и активных детей ТЕКУЩЕГО auth.uid() (без параметров — подмена family_id/student_id невозможна). student_id возвращается как text для защиты от потери точности bigint->JSON->JS. Пустой результат для семьи без детей — не ошибка. families.status не фильтруется на этом этапе.';

revoke all on function public.get_current_family_children() from public;
revoke all on function public.get_current_family_children() from anon;
grant execute on function public.get_current_family_children() to authenticated;
