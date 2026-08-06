-- Helper can_trainer_access_student — проверка доступа ТЕКУЩЕГО активного
-- тренера (auth.uid() -> private.current_active_trainer_account_id()) к
-- конкретному ученику. Прямая аналогия can_family_access_student (migration
-- 002), но проверка идёт по членству в группе, а не по семейной связи.
--
-- Связь тренер -> группы -> ученик идёт через ЧУЖИЕ (JCL_Gruppen) таблицы
-- trainers/trainer_groups/groups/students, которых эта миграция НЕ создаёт
-- и НЕ изменяет — только читает (тот же принцип, что get_current_trainer_groups,
-- migration 016).
--
-- students.gruppe_id — text, может содержать НЕСКОЛЬКО id групп через
-- разделитель ';' или ',' (подтверждено аудитом, см.
-- docs/database/EXISTING_DATABASE_AUDIT.md, раздел "Риски дублирования").
-- Сравнение идёт по точным элементам после разбиения регулярным выражением
-- '[;,]', а не через ilike/substring — иначе id группы "1" ложно совпал бы
-- с "10"/"21" и т.п.
--
-- club_id проверяется дополнительно (belt-and-suspenders, тот же принцип,
-- что enforce_trainer_accounts_club_match/get_current_trainer_groups) —
-- students.club_id, trainer_groups.club_id и trainer_accounts.club_id
-- должны совпадать.
create or replace function public.can_trainer_access_student(p_student_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_trainer_account_id uuid;
  v_club_id text;
  v_trainer_text_id text;
  v_student_club_id text;
  v_student_gruppe_id text;
  v_group_ids text[];
begin
  v_trainer_account_id := private.current_active_trainer_account_id();

  if v_trainer_account_id is null then
    return false;
  end if;

  select ta.club_id into v_club_id
  from public.trainer_accounts ta
  where ta.id = v_trainer_account_id;

  select t.trainer_id into v_trainer_text_id
  from public.trainers t
  join public.trainer_accounts ta on ta.trainer_row_id = t.id
  where ta.id = v_trainer_account_id;

  if v_trainer_text_id is null then
    return false;
  end if;

  select s.club_id, s.gruppe_id
    into v_student_club_id, v_student_gruppe_id
  from public.students s
  where s.id = p_student_id;

  if v_student_club_id is null or v_student_club_id <> v_club_id then
    return false;
  end if;

  select array_agg(trim(g))
    into v_group_ids
  from regexp_split_to_table(coalesce(v_student_gruppe_id, ''), '[;,]') as g
  where trim(g) <> '';

  if v_group_ids is null or array_length(v_group_ids, 1) is null then
    return false;
  end if;

  return exists (
    select 1
    from public.trainer_groups tg
    where tg.trainer_id = v_trainer_text_id
      and tg.club_id = v_club_id
      and tg.gruppe_id::text = any(v_group_ids)
  );
end;
$$;

comment on function public.can_trainer_access_student(bigint) is
  'SECURITY DEFINER: true, если auth.uid() — активный тренер (current_active_trainer_account_id()), у которого ученик p_student_id состоит хотя бы в одной из его групп (students.gruppe_id разобран по ;/,, сравнение точное, не substring), и club_id совпадает. false для любого другого случая, включая отсутствие тренерской сессии. Используется будущими RPC тренерской страницы ученика (Trainer Family Block) как единая точка проверки доступа.';

revoke all on function public.can_trainer_access_student(bigint) from public;
revoke all on function public.can_trainer_access_student(bigint) from anon;
grant execute on function public.can_trainer_access_student(bigint) to authenticated;
