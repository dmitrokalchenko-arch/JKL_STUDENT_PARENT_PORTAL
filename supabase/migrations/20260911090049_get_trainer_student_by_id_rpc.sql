-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION.
--
-- НАЗНАЧЕНИЕ: TrainerStudentPage (маршрут /trainer/student/:studentId)
-- получает от роутинга ТОЛЬКО studentId (см. App.jsx: переход туда — это
-- обычный window.location.href из TrainerStudentSearch, без какого-либо
-- переданного state) — сегодня на этой странице нет ни одного безопасного
-- источника Nachname/Vorname текущего ученика. Modal подтверждения
-- выполнения техники (задание, этап 1/13) должен показывать "фамилию и имя
-- текущего ученика" — нужен ровно один новый read-only способ получить их
-- по known studentId.
--
-- Почему НЕ переиспользовать search_trainer_students (migration 018):
-- она ищет по ПОДСТРОКЕ имени/фамилии (ilike), а не по id — вызвать её с
-- studentId вместо текста не имеет смысла и потребовало бы либо угадывать
-- текст поиска, либо тянуть с фронтенда лишние данные, которых там нет.
-- Прямой lookup по id — отдельная, более простая и точная операция.
--
-- Граница доступа — ТА ЖЕ функция, что уже гейтит SELECT/INSERT/DELETE на
-- student_technique_records (public.can_trainer_access_student, migration
-- 017) — не переизобретается отдельная проверка группы/клуба, тот же
-- trust boundary, что и везде в этой цепочке.
--
-- id возвращается как text — та же защита от потери точности bigint через
-- JSON/JS Number, что и в search_trainer_students/get_current_family_children
-- (studentId и по всей остальной цепочке этого проекта остаётся строкой).
create or replace function public.get_trainer_student_by_id(p_student_id bigint)
returns table (
  id text,
  vorname text,
  nachname text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_trainer_access_student(p_student_id) then
    -- Нет доступа (или нет активной тренерской сессии вовсе) -> 0 строк,
    -- не ошибка — тот же принцип "отсутствие прав не сигнализируется
    -- исключением", что у search_trainer_students/get_current_trainer_groups.
    return;
  end if;

  return query
  select s.id::text, s.vorname, s.nachname
  from public.students s
  where s.id = p_student_id;
end;
$$;

comment on function public.get_trainer_student_by_id(bigint) is
  'SECURITY DEFINER: {id, vorname, nachname} ОДНОГО ученика по p_student_id — ТОЛЬКО если public.can_trainer_access_student(p_student_id) сейчас true для auth.uid(). 0 строк, если доступа нет (не ошибка) — тот же анти-enumeration принцип, что у остальных RPC этого проекта. Персональные данные семьи/договора не читаются и не возвращаются — только id/vorname/nachname, минимум для отображения "Ученик: Фамилия Имя" в модалке подтверждения выполнения техники.';

revoke all on function public.get_trainer_student_by_id(bigint) from public;
revoke all on function public.get_trainer_student_by_id(bigint) from anon;
grant execute on function public.get_trainer_student_by_id(bigint) to authenticated;
