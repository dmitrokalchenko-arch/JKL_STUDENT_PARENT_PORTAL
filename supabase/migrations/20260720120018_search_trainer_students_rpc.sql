-- RPC search_trainer_students — read-only поиск учеников СВОИХ групп
-- текущего активного тренера, по фамилии/имени (ilike, регистронезависимо).
--
-- Identity строго из auth.uid() -> private.current_active_trainer_account_id()
-- (тот же архитектурный gate, что get_current_trainer_groups, migration 016)
-- — trainer_id/club_id клиенту передать невозможно (функция принимает
-- только строку поиска), подмена чужих групп исключена.
--
-- Членство ученика в группе проверяется тем же способом, что в
-- can_trainer_access_student (migration 017) — разбор students.gruppe_id по
-- ';'/',' и точное сравнение с trainer_groups.gruppe_id текущего тренера,
-- не ilike/substring.
--
-- Не даёт прямого доступа к students/trainer_groups/groups с клиента — GRANT
-- только на саму функцию (SECURITY DEFINER), тот же принцип, что
-- get_current_trainer_groups. Возвращаемые поля — минимальный набор для
-- подсказок автодополнения, без персональных данных семьи/договора (эти
-- таблицы вообще не читаются).
--
-- id возвращается как text, не bigint — та же защита от потери точности
-- bigint через JSON, что уже применена в get_current_family_children (см.
-- комментарий в familyDataService.js): frontend НЕ должен приводить его к
-- Number/parseInt ни на каком этапе (studentId в URL /trainer/student/:id
-- остаётся строкой).
create or replace function public.search_trainer_students(p_query text)
returns table (
  id text,
  vorname text,
  nachname text,
  geburtsdatum date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_trainer_account_id uuid;
  v_club_id text;
  v_trainer_text_id text;
  v_query text := trim(coalesce(p_query, ''));
begin
  v_trainer_account_id := private.current_active_trainer_account_id();

  -- Пустой запрос или нет активной тренерской сессии -> 0 строк, не ошибка
  -- (тот же принцип, что get_current_trainer_groups: отсутствие прав или
  -- данных не сигнализируется исключением).
  if v_trainer_account_id is null or v_query = '' then
    return;
  end if;

  select ta.club_id into v_club_id
  from public.trainer_accounts ta
  where ta.id = v_trainer_account_id;

  select t.trainer_id into v_trainer_text_id
  from public.trainers t
  join public.trainer_accounts ta on ta.trainer_row_id = t.id
  where ta.id = v_trainer_account_id;

  if v_trainer_text_id is null then
    return;
  end if;

  return query
  select distinct s.id::text as id, s.vorname, s.nachname, s.geburtsdatum
  from public.students s
  where s.club_id = v_club_id
    and (s.nachname ilike '%' || v_query || '%' or s.vorname ilike '%' || v_query || '%')
    and exists (
      select 1
      from regexp_split_to_table(coalesce(s.gruppe_id, ''), '[;,]') as g
      join public.trainer_groups tg
        on tg.gruppe_id::text = trim(g)
       and tg.trainer_id = v_trainer_text_id
       and tg.club_id = v_club_id
      where trim(g) <> ''
    )
  order by s.nachname, s.vorname
  limit 10;
end;
$$;

comment on function public.search_trainer_students(text) is
  'SECURITY DEFINER: read-only поиск учеников (ilike по nachname/vorname), ограниченный ТОЛЬКО группами текущего активного тренера (auth.uid() -> current_active_trainer_account_id() -> trainer_groups). Пустой запрос или неактивный/отсутствующий тренер -> 0 строк, не ошибка. limit 10, сортировка по nachname/vorname. Персональные данные семьи/договора не читаются и не возвращаются.';

revoke all on function public.search_trainer_students(text) from public;
revoke all on function public.search_trainer_students(text) from anon;
grant execute on function public.search_trainer_students(text) to authenticated;
