-- RPC get_current_trainer_groups — первый рабочий вертикальный сценарий
-- Trainer Area: список групп ТЕКУЩЕГО авторизованного и активного тренера.
--
-- Identity исключительно из auth.uid() + trainer_accounts — ни trainer_id,
-- ни trainer_row_id, ни club_id НЕ принимаются параметрами (функция без
-- аргументов), подмена чужих полномочий с клиента невозможна.
--
-- Security-gate — private.current_active_trainer_account_id() (migration
-- 014), как того требует зафиксированное там архитектурное правило: любой
-- RPC, возвращающий тренерские бизнес-данные, обязан его использовать и
-- отклонять/возвращать пусто при NULL. Неактивный или отсутствующий
-- trainer account -> 0 строк, НЕ ошибка (тот же принцип, что
-- get_current_trainer_profile при отсутствии профиля).
--
-- Связь тренер -> группы идёт через ЧУЖИЕ (JCL_Gruppen) таблицы
-- public.trainers/public.trainer_groups/public.groups, которых эта
-- миграция НЕ создаёт и НЕ изменяет — только читает. Путь: trainer_accounts
-- (наша таблица, trainer_row_id bigint -> trainers.id) -> trainers.trainer_id
-- (отдельная text-колонка, НЕ bigint id — см. docs/database/EXISTING_DATABASE_AUDIT.md,
-- раздел 5.3: "trainers (trainer_id) ──< trainer_groups (trainer_id)") ->
-- trainer_groups.trainer_id -> trainer_groups.gruppe_id -> groups.gruppe_id.
-- club_id проверяется дополнительно (belt-and-suspenders, тот же принцип,
-- что enforce_trainer_accounts_club_match) — trainer_groups.club_id и
-- groups.club_id оба должны совпадать с trainer_accounts.club_id.
--
-- SECURITY DEFINER необходим: trainer_accounts заперта (RLS без единой
-- policy, migration 011), а trainers/trainer_groups/groups — чужие таблицы
-- JCL_Gruppen без GRANT authenticated на прямой доступ (эта миграция такой
-- GRANT сознательно не добавляет — см. ниже).
--
-- Возвращаемые поля — минимальный набор для карточек списка, без
-- персональных данных детей/семей (эти таблицы вообще не читаются):
--   group_id   — gruppe_id, приведён к text (тип groups.gruppe_id в
--                production не подтверждён напрямую диагностикой, как это
--                было сделано для trainers.club_id/clubs.club_short_name —
--                text-приведение делает возвращаемое значение стабильным
--                для frontend независимо от точного числового типа);
--   group_name — gruppenname;
--   category   — alter (текстовое описание возрастной/уровневой категории,
--                как есть в JCL_Gruppen, без структурирования);
--   is_active  — aktiv.
-- "Роль текущего тренера в группе" не возвращается — в документированной
-- схеме trainer_groups такого поля нет (только trainer_id/trainer_name/
-- gruppe_id/club_id).
create or replace function public.get_current_trainer_groups()
returns table (
  group_id text,
  group_name text,
  category text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_trainer_account_id uuid;
  v_trainer_row_id bigint;
  v_club_id text;
  v_trainer_text_id text;
begin
  v_trainer_account_id := private.current_active_trainer_account_id();

  if v_trainer_account_id is null then
    return;
  end if;

  select ta.trainer_row_id, ta.club_id
    into v_trainer_row_id, v_club_id
  from public.trainer_accounts ta
  where ta.id = v_trainer_account_id;

  select t.trainer_id into v_trainer_text_id
  from public.trainers t
  where t.id = v_trainer_row_id;

  if v_trainer_text_id is null then
    return;
  end if;

  return query
  select
    g.gruppe_id::text as group_id,
    g.gruppenname as group_name,
    g.alter as category,
    g.aktiv as is_active
  from public.trainer_groups tg
  join public.groups g on g.gruppe_id = tg.gruppe_id
  where tg.trainer_id = v_trainer_text_id
    and tg.club_id = v_club_id
    and g.club_id = v_club_id;
end;
$$;

comment on function public.get_current_trainer_groups() is
  'SECURITY DEFINER: группы ТЕКУЩЕГО активного тренера (auth.uid() -> private.current_active_trainer_account_id(), без параметров — подмена чужих групп/клуба с клиента невозможна). 0 строк = не тренер, неактивен, или групп нет — не ошибка. Читает чужие таблицы trainers/trainer_groups/groups (JCL_Gruppen) только на SELECT, ничего не изменяет и не создаёт прямой клиентский GRANT на них. Персональные данные детей/семей не возвращает и не читает.';

revoke all on function public.get_current_trainer_groups() from public;
revoke all on function public.get_current_trainer_groups() from anon;
grant execute on function public.get_current_trainer_groups() to authenticated;
