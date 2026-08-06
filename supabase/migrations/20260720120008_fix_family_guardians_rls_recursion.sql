-- Исправление: бесконечная рекурсия в RLS-политике family_guardians_select_own_family
-- (миграция 20260720120003_family_layer_rls.sql), обнаруженная фактическим
-- локальным прогоном (не статическим анализом) — этап 2.2/H.
--
-- Причина: policy family_guardians_select_own_family определена НА таблице
-- family_guardians и при этом читает family_guardians в своём же подзапросе
-- (select family_id from public.family_guardians where auth_user_id =
-- auth.uid()) — Postgres пытается применить эту же policy к подзапросу,
-- что требует повторного применения policy, и так до бесконечности
-- ("infinite recursion detected in policy for relation family_guardians").
--
-- Решение: SECURITY DEFINER helper-функция в закрытой схеме private.
-- SECURITY DEFINER выполняется с правами ВЛАДЕЛЬЦА функции (postgres),
-- который также владеет family_guardians и поэтому не подчиняется RLS этой
-- таблицы (обычное поведение Postgres: владелец таблицы обходит RLS, пока
-- не включён FORCE ROW LEVEL SECURITY — здесь он выключен, подтверждено
-- этапом H1). Чтение family_guardians ВНУТРИ helper'а не запускает
-- повторно ту же policy — рекурсия исключена структурно.
--
-- Migration 03 (уже применённая) не редактируется задним числом — три
-- policy пересоздаются здесь же, с теми же именами и тем же бизнес-смыслом
-- (пользователь видит только семьи/связи, в которых он состоит guardian'ом).

create schema if not exists private;

-- Явно закрытая схема. По умолчанию новая схема и так не даёт доступа
-- PUBLIC/anon/authenticated — эти revoke подтверждают намерение явно, а не
-- отменяют ранее выданные права (их не было).
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

-- p_family_id: uuid — подтверждено information_schema (families.id и
-- family_guardians.family_id оба uuid), тип не предполагался без проверки.
--
-- Назначение:
--   - предотвращает рекурсивное применение RLS-policy family_guardians
--     изнутри её же policy (SECURITY DEFINER читает таблицу от имени
--     владельца-postgres, в обход RLS этой конкретной таблицы);
--   - принимает ТОЛЬКО family_id — auth_user_id никогда не передаётся
--     параметром, функция всегда проверяет исключительно auth.uid()
--     текущего вызывающего, подмена чужого пользователя невозможна;
--   - возвращает boolean, не возвращает строки family_guardians.
create or replace function private.is_current_user_family_guardian(
  p_family_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_guardians fg
    where fg.family_id = p_family_id
      and fg.auth_user_id = (select auth.uid())
  );
$$;

comment on function private.is_current_user_family_guardian(uuid) is
  'SECURITY DEFINER: true, если ТЕКУЩИЙ auth.uid() — guardian семьи p_family_id. Не принимает auth_user_id параметром (только текущий пользователь). Используется в RLS-policies families/family_guardians/family_students вместо inline-подзапроса к family_guardians, чтобы исключить рекурсию policy на самой family_guardians (см. комментарий в шапке файла).';

-- Владелец функции — та же роль, что выполняет эту миграцию (postgres,
-- подтверждено этапом H1: current_user = postgres) — обычное поведение
-- CREATE FUNCTION без явного ALTER FUNCTION ... OWNER TO. Жёстко прописывать
-- имя роли в миграции менее надёжно, чем полагаться на то, что создающая
-- роль и есть нужный владелец (тот же, что владеет public.family_guardians).

revoke all on function private.is_current_user_family_guardian(uuid) from public;
grant execute on function private.is_current_user_family_guardian(uuid) to authenticated;

-- Пересоздание трёх SELECT-policies migration 03 с теми же именами и тем же
-- бизнес-смыслом (пользователь видит только семьи/связи, в которых он
-- состоит guardian'ом) — теперь через helper вместо inline-подзапроса.
drop policy if exists families_select_own on public.families;
drop policy if exists family_guardians_select_own_family on public.family_guardians;
drop policy if exists family_students_select_own_family on public.family_students;

create policy families_select_own on public.families
  for select
  to authenticated
  using (
    (select private.is_current_user_family_guardian(id))
  );

create policy family_guardians_select_own_family on public.family_guardians
  for select
  to authenticated
  using (
    (select private.is_current_user_family_guardian(family_id))
  );

create policy family_students_select_own_family on public.family_students
  for select
  to authenticated
  using (
    (select private.is_current_user_family_guardian(family_id))
  );
