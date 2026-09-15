-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION.
--
-- НАЗНАЧЕНИЕ: TrainerStudentPage (маршрут /trainer/student/:studentId)
-- сегодня получает от get_trainer_student_by_id ТОЛЬКО {id, vorname,
-- nachname} (миграция 20260911090049, уже применена к production —
-- подтверждено прямым чтением production-функции при аудите этой задачи).
-- Этого недостаточно для общего StudentProfileCard, который уже показывает
-- Family (sport/group/пояс/статус договора) — задание этого этапа: Trainer
-- должен видеть ТУ ЖЕ универсальную Student Page с реальными данными, не
-- только имя.
--
-- Источник данных и набор полей — НАМЕРЕННО ТЕ ЖЕ САМЫЕ и в ТОЙ ЖЕ форме,
-- что уже проверенный boевой get_current_family_children() (миграция
-- 20260901100040 + 20260914110055) отдаёт Family для каждого её ребёнка:
-- students LEFT JOIN sports/groups, те же имена колонок. Никаких новых
-- источников/расчётов не вводится — тот же students, тот же LEFT JOIN.
--
-- ГРАНИЦА ДОСТУПА — БЕЗ ИЗМЕНЕНИЙ: public.can_trainer_access_student —
-- та же самая проверка, что и в текущей production-версии этой функции;
-- задание прямо требует НЕ ослаблять её. 0 строк без ошибки, если доступа
-- нет — тот же анти-enumeration принцип, что и раньше.
--
-- Familienzugang/families.status/family_students.status здесь НЕ
-- участвуют вообще и не появляются ни в одном JOIN этой функции — доступ
-- Trainer к Student Page не зависит и не должен зависеть от статуса
-- семейного доступа (задание, раздел 8).
--
-- RETURNS TABLE меняется (новые колонки) — CREATE OR REPLACE FUNCTION не
-- позволяет менять список возвращаемых колонок существующей функции
-- (Postgres: "cannot change return type of existing function"), поэтому
-- DROP + CREATE, тот же приём, что уже использовался для
-- get_current_family_children (миграция 20260901100040). Зависимостей
-- (view/rule/другие функции) у get_trainer_student_by_id нет — проверено
-- прямым запросом к pg_depend/pg_proc при аудите, безопасно удалять.
drop function if exists public.get_trainer_student_by_id(bigint);

create function public.get_trainer_student_by_id(p_student_id bigint)
returns table (
  id text,
  vorname text,
  nachname text,
  geburtsdatum date,
  alter integer,
  geschlecht text,
  sport_id text,
  sport_name text,
  gruppe_id text,
  group_name text,
  training_day text,
  training_time text,
  belt_color text,
  kyu_grade text,
  contract_status text,
  contract_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_trainer_access_student(p_student_id) then
    -- Нет доступа (или нет активной тренерской сессии вовсе) -> 0 строк,
    -- не ошибка — без изменений, тот же анти-enumeration принцип, что и
    -- в текущей production-версии этой функции.
    return;
  end if;

  return query
  select
    s.id::text,
    s.vorname,
    s.nachname,
    s.geburtsdatum,
    s.alter,
    s.geschlecht,
    s.sport_id,
    sp.name as sport_name,
    s.gruppe_id,
    gr.gruppenname as group_name,
    gr.trainingstag as training_day,
    gr.trainingszeit as training_time,
    s.guertelfarbe as belt_color,
    s.kyu_grad as kyu_grade,
    s.vertrag_status as contract_status,
    s.vertrag_datum as contract_date
  from public.students s
  left join public.sports sp on sp.sport_id = s.sport_id
  left join public.groups gr on gr.gruppe_id = s.gruppe_id
  where s.id = p_student_id;
end;
$$;

comment on function public.get_trainer_student_by_id(bigint) is
  'SECURITY DEFINER: профиль ОДНОГО ученика по p_student_id — ТОЛЬКО если public.can_trainer_access_student(p_student_id) сейчас true для auth.uid(). 0 строк, если доступа нет (не ошибка). Тот же набор Block-1 базовых полей (students LEFT JOIN sports/groups), что уже отдаёт get_current_family_children() для Family — единственный источник истины, не дублируется отдельным расчётом. Familienzugang/families.status/family_students.status НЕ участвуют — Trainer-доступ к Student Page не зависит от семейного доступа. Персональные данные семьи/договора семьи (не ученика) по-прежнему не читаются.';

-- Явный REVOKE/GRANT заново — DROP FUNCTION уничтожает все ранее выданные
-- привилегии, CREATE FUNCTION их не наследует. Тот же итоговый результат,
-- что и в production-версии до этой миграции (подтверждено аудитом:
-- authenticated=true, anon=false).
revoke all on function public.get_trainer_student_by_id(bigint) from public;
revoke all on function public.get_trainer_student_by_id(bigint) from anon;
grant execute on function public.get_trainer_student_by_id(bigint) to authenticated;
