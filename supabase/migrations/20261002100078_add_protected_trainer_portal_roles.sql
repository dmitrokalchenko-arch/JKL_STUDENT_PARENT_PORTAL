-- Protected Trainer Portal roles: trainer_accounts.portal_role ('trainer' | 'admin').
--
-- Авторитетный источник Portal-роли — ТОЛЬКО public.trainer_accounts.portal_role
-- (+ trainer_accounts.is_active, + trainer_accounts.club_id). Legacy
-- public.trainers.rolle / trainers.aktiv, Admin PIN session, клиентские
-- параметры и JWT metadata НЕ участвуют в Portal-авторизации.
--
-- Что делает миграция:
--   1. portal_role text NOT NULL DEFAULT 'trainer' + CHECK. Все существующие
--      аккаунты получают 'trainer'. Admin НЕ назначается (bootstrap первого
--      Portal Admin — отдельный owner-controlled шаг ПОСЛЕ проверки миграции).
--   2. private-хелперы current_trainer_portal_role() /
--      is_current_trainer_portal_admin() (SECURITY DEFINER, закрыты от клиентов).
--   3. get_current_trainer_profile() дополнительно возвращает СВОЮ portal_role
--      (только для UI; авторизация — всегда на сервере).
--   4. trainer_account_audit_log.operation: + promote_admin / demote_admin.
--   5. can_trainer_access_student: Admin видит всех учеников СВОЕГО клуба.
--   6. search_trainer_students: Admin ищет по всему СВОЕМУ клубу.
--   7. save_trainer_student_page_config / save_trainer_kyu_program /
--      save_trainer_kyu_template и Admin-редакторы get_trainer_kyu_program /
--      get_trainer_kyu_template — только Portal Admin.
--   8. Триггер защиты последнего активного Portal Admin клуба (переход >=1 -> 0).
--   9. Самопроверка (только чтение каталога) — любое расхождение откатывает всё.
--
-- НЕ делает: не включает manage-trainer-account (остаётся отключённой на уровне
-- Edge Function), не добавляет RPC смены роли, не меняет legacy public.trainers /
-- public.students, RLS/policies, get_trainer_student_page_config, Stage 2
-- (individual Kyu program) и семантику trainer_access_after_expiry.
--
-- Default privileges этого проекта выдают anon/authenticated EXECUTE на каждую
-- НОВУЮ функцию (см. 077) — поэтому у каждой новой/пересозданной функции ниже
-- явный REVOKE. CREATE OR REPLACE с той же сигнатурой сохраняет существующий ACL.
--
-- Проверка: docs/database/PROTECTED_TRAINER_PORTAL_ROLES_SQL_VERIFICATION.md

begin;

-- ── 1. portal_role ───────────────────────────────────────────────────────
-- text + CHECK (не enum): в проекте нет ни одного enum; CHECK проще менять и
-- не создаёт отдельный объект с собственными default privileges.
-- ADD COLUMN с константным DEFAULT заполняет существующие строки значением
-- 'trainer' без перезаписи таблицы; триггеры UPDATE при этом не срабатывают.
-- Права клиентов на колонку: нет (после 077 у PUBLIC/anon/authenticated нет
-- никаких прав на public.trainer_accounts; колонка наследует права таблицы).
alter table public.trainer_accounts
  add column portal_role text not null default 'trainer';

alter table public.trainer_accounts
  add constraint trainer_accounts_portal_role_check
  check (portal_role in ('trainer', 'admin'));

comment on column public.trainer_accounts.portal_role is
  'Авторитетная роль Trainer Portal: trainer (группы) | admin (весь свой клуб + club-wide настройки). Единственный источник Portal-роли; legacy trainers.rolle НЕ используется. Меняется только service_role / владельцем БД (клиентских прав на таблицу нет). Первый admin — owner-controlled bootstrap.';

-- ── 2. private-хелперы роли ──────────────────────────────────────────────
-- Та же модель, что private.current_active_trainer_account_id() (014):
-- auth.uid() -> trainer_accounts (auth_user_id UNIQUE) -> is_active = true.
-- SECURITY DEFINER нужен, т.к. у клиентских ролей нет прав на trainer_accounts.
-- Вызываются только изнутри SECURITY DEFINER функций (owner postgres) —
-- EXECUTE у PUBLIC/anon/authenticated отозван.
create function private.current_trainer_portal_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ta.portal_role
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;
$$;

comment on function private.current_trainer_portal_role() is
  'SECURITY DEFINER: portal_role ТЕКУЩЕГО auth.uid() только для АКТИВНОГО trainer_accounts, иначе NULL. Без параметров — чужую роль запросить нельзя. Не читает legacy trainers.rolle. Только для вызова изнутри SECURITY DEFINER функций.';

revoke all on function private.current_trainer_portal_role() from public, anon, authenticated;

create function private.is_current_trainer_portal_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_trainer_portal_role() = 'admin', false);
$$;

comment on function private.is_current_trainer_portal_admin() is
  'SECURITY DEFINER: true только если текущий auth.uid() — АКТИВНЫЙ trainer_accounts с portal_role = admin. Неактивный/отсутствующий аккаунт или trainer -> false. Только для вызова изнутри SECURITY DEFINER функций.';

revoke all on function private.is_current_trainer_portal_admin() from public, anon, authenticated;

-- ── 3. get_current_trainer_profile(): + собственная portal_role ──────────
-- Меняется тип результата -> DROP + CREATE (CREATE OR REPLACE не может менять
-- OUT-колонки). Новый объект заново получает default privileges, поэтому ACL
-- восстанавливается явно: как в 013 — authenticated, без anon/PUBLIC.
-- Колонка добавлена В КОНЕЦ: frontend читает поля по имени (data[0]).
drop function public.get_current_trainer_profile();

create function public.get_current_trainer_profile()
returns table (
  trainer_account_id uuid,
  club_id text,
  display_name text,
  is_active boolean,
  portal_role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ta.id as trainer_account_id,
    ta.club_id,
    ta.display_name,
    ta.is_active,
    ta.portal_role
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid());
$$;

comment on function public.get_current_trainer_profile() is
  'SECURITY DEFINER: минимальный профиль ТЕКУЩЕГО auth.uid() (без параметров — подмена чужого профиля невозможна). 0 строк = не тренер. is_active=false = доступ приостановлен. portal_role — СОБСТВЕННАЯ роль только для отображения UI; НЕ является авторизацией — серверные RPC проверяют роль сами (private.is_current_trainer_portal_admin). email/login_name/trainer_row_id не возвращаются.';

revoke all on function public.get_current_trainer_profile() from public, anon;
grant execute on function public.get_current_trainer_profile() to authenticated;

-- ── 4. Аудит смены роли ──────────────────────────────────────────────────
-- Нужен уже сейчас: owner-bootstrap первого admin пишет promote_admin. Имя
-- ограничения — автоматическое имя inline CHECK из 024; DROP без IF EXISTS
-- намеренно: расхождение схемы должно остановить миграцию, а не скрыться.
-- log_trainer_account_operation и его ACL (077: только service_role) не меняются.
alter table public.trainer_account_audit_log
  drop constraint trainer_account_audit_log_operation_check;

alter table public.trainer_account_audit_log
  add constraint trainer_account_audit_log_operation_check
  check (operation in ('create', 'update', 'activate', 'deactivate', 'promote_admin', 'demote_admin'));

-- ── 5. Admin: ученики всего СВОЕГО клуба (единая точка can_trainer_access_student) ──
-- Тело скопировано без изменений из 20260720120017; добавлена только ветка Admin.
-- CREATE OR REPLACE с той же сигнатурой сохраняет ACL и comment. Все зависимые
-- RPC/RLS/Storage-policy (get_trainer_student_by_id, *_student_page, Stage 2,
-- student_technique_records, student-technique-videos) наследуют Admin-scope.
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

  -- 078: Portal Admin (trainer_accounts.portal_role; legacy-роль не используется)
  -- видит любого ученика СВОЕГО клуба без trainer_groups; другой клуб — никогда.
  if private.is_current_trainer_portal_admin() then
    return exists (
      select 1
      from public.students s
      where s.id = p_student_id
        and s.club_id = v_club_id
    );
  end if;

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

-- ── 6. Admin: поиск по всему СВОЕМУ клубу ─────────────────────────────────
-- Тело скопировано без изменений из 20260720120018; добавлена только ветка Admin.
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

  -- 078: Portal Admin ищет по всему СВОЕМУ клубу (без trainer_groups).
  if private.is_current_trainer_portal_admin() then
    return query
    select s.id::text as id, s.vorname, s.nachname, s.geburtsdatum
    from public.students s
    where s.club_id = v_club_id
      and (s.nachname ilike '%' || v_query || '%' or s.vorname ilike '%' || v_query || '%')
    order by s.nachname, s.vorname
    limit 10;
    return;
  end if;

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

-- ── 7. Club-wide WRITE и Admin-редакторы — только Portal Admin ────────────
-- Тела скопированы без изменений из 057 / 072 / 073; добавлен только guard в
-- начало. get_trainer_student_page_config НЕ меняется (нужна обычному Trainer
-- для отображения Student Page).
create or replace function public.save_trainer_student_page_config(p_config jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id text;
  v_match_count integer;
begin
  -- 078: club-wide WRITE — только Portal Admin (trainer_accounts.portal_role).
  if not private.is_current_trainer_portal_admin() then
    return false;
  end if;

  select count(*)
    into v_match_count
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  if v_match_count = 0 then
    return false;
  end if;

  if v_match_count > 1 then
    raise exception 'Ambiguous active trainer account';
  end if;

  select ta.club_id
    into v_club_id
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  insert into public.club_student_page_settings (club_id, config, updated_at)
  values (v_club_id, p_config, now())
  on conflict (club_id) do update
    set config = excluded.config,
        updated_at = now();

  return true;
end;
$$;

create or replace function public.get_trainer_kyu_program(p_kyu_lookup_id bigint)
returns table (
  technique_id uuid,
  name text,
  category text,
  main_group text,
  image_path text,
  youtube_url text,
  youtube_video_id text,
  sort_order integer,
  block_type text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_club_id text;
  v_match_count integer;
  v_kyu_label text;
begin
  -- 078: Admin-редактор club-wide программы — только Portal Admin. Runtime
  -- resolver (get_required_techniques_for_student) от этого НЕ зависит.
  if not private.is_current_trainer_portal_admin() then
    return;
  end if;

  select count(*)
    into v_match_count
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  if v_match_count = 0 then
    return;
  end if;

  if v_match_count > 1 then
    raise exception 'Ambiguous active trainer account';
  end if;

  select ta.club_id
    into v_club_id
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  select kl.kyu_grad
    into v_kyu_label
  from public.kyu_lookup kl
  where kl.id = p_kyu_lookup_id;

  if v_kyu_label is null then
    raise exception 'kyu_lookup_id % does not exist', p_kyu_lookup_id;
  end if;

  if v_kyu_label not ilike '%Kyu%' then
    raise exception 'kyu_lookup_id % is not an editable Kyu grade (Dan is not supported here)', p_kyu_lookup_id;
  end if;

  return query
  select
    jt.id,
    jt.name,
    jt.category,
    jt.main_group,
    jt.image_path,
    jt.youtube_url,
    jt.youtube_video_id,
    ckpi.sort_order,
    ckpi.block_type
  from public.club_kyu_program_items ckpi
  join public.judo_techniques jt on jt.id = ckpi.technique_id
  where ckpi.club_id = v_club_id
    and ckpi.kyu_lookup_id = p_kyu_lookup_id
    and ckpi.item_type = 'technique'
  order by ckpi.block_type, ckpi.sort_order, jt.name;
end;
$$;

create or replace function public.save_trainer_kyu_program(
  p_kyu_lookup_id bigint,
  p_items jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id text;
  v_match_count integer;
  v_kyu_label text;
  v_items jsonb;
  v_invalid_block_count integer;
  v_invalid_technique_count integer;
begin
  -- 078: club-wide WRITE — только Portal Admin (trainer_accounts.portal_role).
  if not private.is_current_trainer_portal_admin() then
    return false;
  end if;

  select count(*)
    into v_match_count
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  if v_match_count = 0 then
    return false;
  end if;

  if v_match_count > 1 then
    raise exception 'Ambiguous active trainer account';
  end if;

  select ta.club_id
    into v_club_id
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  select kl.kyu_grad
    into v_kyu_label
  from public.kyu_lookup kl
  where kl.id = p_kyu_lookup_id;

  if v_kyu_label is null then
    raise exception 'kyu_lookup_id % does not exist', p_kyu_lookup_id;
  end if;

  if v_kyu_label not ilike '%Kyu%' then
    raise exception 'kyu_lookup_id % is not an editable Kyu grade (Dan is not supported here)', p_kyu_lookup_id;
  end if;

  v_items := coalesce(p_items, '[]'::jsonb);

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  select count(*)
    into v_invalid_block_count
  from jsonb_array_elements(v_items) as elem
  where (elem->>'block_type') is null
     or (elem->>'block_type') not in ('required_nage', 'required_katame', 'additional')
     or (elem->>'technique_id') is null;

  if v_invalid_block_count > 0 then
    raise exception 'One or more items have an invalid or missing block_type/technique_id';
  end if;

  select count(*)
    into v_invalid_technique_count
  from (
    select distinct (elem->>'technique_id')::uuid as technique_id
    from jsonb_array_elements(v_items) as elem
  ) t
  where not exists (
    select 1
    from public.judo_techniques jt
    where jt.id = t.technique_id
      and jt.active = true
  );

  if v_invalid_technique_count > 0 then
    raise exception 'One or more technique_ids do not exist or are not active';
  end if;

  delete from public.club_kyu_program_items
  where club_id = v_club_id
    and kyu_lookup_id = p_kyu_lookup_id
    and item_type = 'technique';

  with parsed as (
    select
      (elem->>'technique_id')::uuid as technique_id,
      elem->>'block_type' as block_type,
      ord
    from jsonb_array_elements(v_items) with ordinality as arr(elem, ord)
  ),
  deduped as (
    select distinct on (block_type, technique_id) technique_id, block_type, ord
    from parsed
    order by block_type, technique_id, ord
  ),
  ranked as (
    select
      technique_id,
      block_type,
      row_number() over (partition by block_type order by ord) as rn
    from deduped
  )
  insert into public.club_kyu_program_items (club_id, kyu_lookup_id, item_type, technique_id, block_type, sort_order)
  select v_club_id, p_kyu_lookup_id, 'technique', technique_id, block_type, rn - 1
  from ranked;

  return true;
end;
$$;

create or replace function public.get_trainer_kyu_template(
  p_kyu_lookup_id bigint,
  p_template_type text
)
returns table (
  technique_id uuid,
  name text,
  category text,
  main_group text,
  image_path text,
  youtube_url text,
  youtube_video_id text,
  sort_order integer,
  block_type text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_club_id text;
  v_match_count integer;
  v_kyu_label text;
begin
  -- 078: Admin-редактор club-wide программы — только Portal Admin. Runtime
  -- resolver (get_required_techniques_for_student) от этого НЕ зависит.
  if not private.is_current_trainer_portal_admin() then
    return;
  end if;

  if p_template_type not in ('djb', 'go_kyu') then
    raise exception 'p_template_type must be one of: djb, go_kyu';
  end if;

  select count(*)
    into v_match_count
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  if v_match_count = 0 then
    return;
  end if;

  if v_match_count > 1 then
    raise exception 'Ambiguous active trainer account';
  end if;

  select ta.club_id
    into v_club_id
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  select kl.kyu_grad
    into v_kyu_label
  from public.kyu_lookup kl
  where kl.id = p_kyu_lookup_id;

  if v_kyu_label is null then
    raise exception 'kyu_lookup_id % does not exist', p_kyu_lookup_id;
  end if;

  if v_kyu_label not ilike '%Kyu%' then
    raise exception 'kyu_lookup_id % is not an editable Kyu grade (Dan is not supported here)', p_kyu_lookup_id;
  end if;

  return query
  select
    jt.id,
    jt.name,
    jt.category,
    jt.main_group,
    jt.image_path,
    jt.youtube_url,
    jt.youtube_video_id,
    ckti.sort_order,
    ckti.block_type
  from public.club_kyu_template_items ckti
  join public.judo_techniques jt on jt.id = ckti.technique_id
  where ckti.club_id = v_club_id
    and ckti.kyu_lookup_id = p_kyu_lookup_id
    and ckti.template_type = p_template_type
  order by ckti.block_type, ckti.sort_order, jt.name;
end;
$$;

create or replace function public.save_trainer_kyu_template(
  p_kyu_lookup_id bigint,
  p_template_type text,
  p_items jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id text;
  v_match_count integer;
  v_kyu_label text;
  v_items jsonb;
  v_invalid_block_count integer;
  v_invalid_technique_count integer;
begin
  -- 078: club-wide WRITE — только Portal Admin (trainer_accounts.portal_role).
  if not private.is_current_trainer_portal_admin() then
    return false;
  end if;

  if p_template_type not in ('djb', 'go_kyu') then
    raise exception 'p_template_type must be one of: djb, go_kyu';
  end if;

  select count(*)
    into v_match_count
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  if v_match_count = 0 then
    return false;
  end if;

  if v_match_count > 1 then
    raise exception 'Ambiguous active trainer account';
  end if;

  select ta.club_id
    into v_club_id
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  select kl.kyu_grad
    into v_kyu_label
  from public.kyu_lookup kl
  where kl.id = p_kyu_lookup_id;

  if v_kyu_label is null then
    raise exception 'kyu_lookup_id % does not exist', p_kyu_lookup_id;
  end if;

  if v_kyu_label not ilike '%Kyu%' then
    raise exception 'kyu_lookup_id % is not an editable Kyu grade (Dan is not supported here)', p_kyu_lookup_id;
  end if;

  v_items := coalesce(p_items, '[]'::jsonb);

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  select count(*)
    into v_invalid_block_count
  from jsonb_array_elements(v_items) as elem
  where (elem->>'block_type') is null
     or (elem->>'block_type') not in ('required_nage', 'required_katame', 'additional')
     or (elem->>'technique_id') is null;

  if v_invalid_block_count > 0 then
    raise exception 'One or more items have an invalid or missing block_type/technique_id';
  end if;

  select count(*)
    into v_invalid_technique_count
  from (
    select distinct (elem->>'technique_id')::uuid as technique_id
    from jsonb_array_elements(v_items) as elem
  ) t
  where not exists (
    select 1
    from public.judo_techniques jt
    where jt.id = t.technique_id
      and jt.active = true
  );

  if v_invalid_technique_count > 0 then
    raise exception 'One or more technique_ids do not exist or are not active';
  end if;

  delete from public.club_kyu_template_items
  where club_id = v_club_id
    and kyu_lookup_id = p_kyu_lookup_id
    and template_type = p_template_type;

  with parsed as (
    select
      (elem->>'technique_id')::uuid as technique_id,
      elem->>'block_type' as block_type,
      ord
    from jsonb_array_elements(v_items) with ordinality as arr(elem, ord)
  ),
  deduped as (
    select distinct on (block_type, technique_id) technique_id, block_type, ord
    from parsed
    order by block_type, technique_id, ord
  ),
  ranked as (
    select
      technique_id,
      block_type,
      row_number() over (partition by block_type order by ord) as rn
    from deduped
  )
  insert into public.club_kyu_template_items (club_id, kyu_lookup_id, template_type, technique_id, block_type, sort_order)
  select v_club_id, p_kyu_lookup_id, p_template_type, technique_id, block_type, rn - 1
  from ranked;

  return true;
end;
$$;

-- ── 8. Защита последнего активного Portal Admin клуба ───────────────────
-- Инвариант: если в клубе есть активный Portal Admin, UPDATE/DELETE не может
-- перевести клуб из состояния ">= 1 активный admin" в "0 активных admin"
-- (demote, deactivate, смена club_id, удаление — в т.ч. каскадом из auth.users).
-- Состояние "0 admin" ДО bootstrap допустимо: проверка срабатывает только на
-- ПОТЕРЮ активного admin, INSERT и повышение не проверяются.
--
-- Конкуренция ("A понижает B, одновременно B деактивирует A"): транзакционный
-- advisory lock на club_id сериализует все такие переходы клуба. Проверка
-- выполняется ПОСЛЕ получения lock отдельным запросом, который в READ COMMITTED
-- видит уже закоммиченное изменение конкурента -> вторая операция получает
-- ошибку. Строки других admin НЕ блокируются FOR UPDATE: целевая строка уже
-- заблокирована самим UPDATE, и взаимная блокировка строк дала бы deadlock.
-- При REPEATABLE READ / SERIALIZABLE снимок транзакции мог бы не увидеть
-- конкурента — поэтому такие переходы в других уровнях изоляции запрещены
-- явной ошибкой (fail closed). PostgREST/Edge Functions/SQL Editor — READ
-- COMMITTED по умолчанию. TRUNCATE (только владелец) триггер не вызывает.
create function private.enforce_trainer_accounts_last_active_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_active_admin boolean;
  v_remains_active_admin boolean;
begin
  v_was_active_admin := old.is_active and old.portal_role = 'admin';

  if tg_op = 'DELETE' then
    v_remains_active_admin := false;
  else
    v_remains_active_admin := new.is_active
      and new.portal_role = 'admin'
      and new.club_id = old.club_id;
  end if;

  if v_was_active_admin and not v_remains_active_admin then
    if current_setting('transaction_isolation') <> 'read committed' then
      raise exception 'last_active_portal_admin_check_requires_read_committed'
        using errcode = '25001';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('trainer_accounts.last_active_portal_admin:' || old.club_id, 0)
    );

    if not exists (
      select 1
      from public.trainer_accounts ta
      where ta.club_id = old.club_id
        and ta.id <> old.id
        and ta.is_active = true
        and ta.portal_role = 'admin'
    ) then
      raise exception 'last_active_portal_admin: club % must keep at least one active portal admin', old.club_id
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function private.enforce_trainer_accounts_last_active_admin() is
  'Триггер trainer_accounts (BEFORE UPDATE OR DELETE): запрещает потерю последнего АКТИВНОГО portal_role=admin клуба (demote/deactivate/смена club_id/delete). Advisory lock на club_id сериализует конкурентные переходы; только READ COMMITTED. Состояние без admin до bootstrap допустимо.';

revoke all on function private.enforce_trainer_accounts_last_active_admin() from public, anon, authenticated;

create trigger trg_trainer_accounts_last_active_admin
  before update or delete on public.trainer_accounts
  for each row execute function private.enforce_trainer_accounts_last_active_admin();

-- ── 9. Самопроверка (только чтение каталога) ─────────────────────────────
-- Любое расхождение — exception внутри транзакции -> COMMIT ниже не фиксирует
-- ничего (в aborted state COMMIT выполняется как ROLLBACK).
do $$
declare
  v_ta regclass := to_regclass('public.trainer_accounts');
  v_fn regprocedure;
  v_sig text;
  v_role text;
  v_priv text;
  v_count integer;
begin
  -- portal_role: NOT NULL, DEFAULT 'trainer', CHECK trainer/admin
  if not exists (
    select 1
    from pg_attribute a
    where a.attrelid = v_ta and a.attname = 'portal_role' and not a.attisdropped
      and a.attnotnull and format_type(a.atttypid, a.atttypmod) = 'text'
  ) then
    raise exception '078 check: portal_role missing, nullable or not text';
  end if;

  if coalesce((
    select pg_get_expr(d.adbin, d.adrelid)
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where d.adrelid = v_ta and a.attname = 'portal_role'
  ), '') not like '''trainer''%' then
    raise exception '078 check: portal_role default is not trainer';
  end if;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = v_ta and c.conname = 'trainer_accounts_portal_role_check' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%trainer%' and pg_get_constraintdef(c.oid) like '%admin%'
  ) then
    raise exception '078 check: trainer_accounts_portal_role_check missing';
  end if;

  -- Никакого автоматического admin: все существующие аккаунты — trainer.
  select count(*) into v_count from public.trainer_accounts where portal_role <> 'trainer';
  if v_count <> 0 then
    raise exception '078 check: % account(s) are not trainer after migration', v_count;
  end if;

  -- 077 сохранена: у anon/authenticated нет прав на trainer_accounts.
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, v_ta, v_priv) then
        raise exception '078 check: % has % on public.trainer_accounts', v_role, v_priv;
      end if;
    end loop;
  end loop;
  if exists (
    select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = v_ta and a.grantee = 0
  ) then
    raise exception '078 check: PUBLIC has privileges on public.trainer_accounts';
  end if;

  -- Внутренние функции: SECURITY DEFINER, search_path = '', без клиентского EXECUTE.
  foreach v_sig in array array[
    'private.current_trainer_portal_role()',
    'private.is_current_trainer_portal_admin()',
    'private.enforce_trainer_accounts_last_active_admin()',
    'public.rename_trainer_login(uuid,text)',
    'public.log_trainer_account_operation(bigint,uuid,bigint,text,text,text)',
    'public.rename_family_nickname(uuid,text)'
  ] loop
    v_fn := to_regprocedure(v_sig);
    if v_fn is null then
      raise exception '078 check: % not found', v_sig;
    end if;
    if not (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
            from pg_proc p where p.oid = v_fn) then
      raise exception '078 check: % is not SECURITY DEFINER with search_path=""', v_sig;
    end if;
    if exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) or has_function_privilege('anon', v_fn, 'EXECUTE')
      or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '078 check: client EXECUTE on %', v_sig;
    end if;
  end loop;

  -- Клиентские RPC: ровно одна перегрузка, anon/PUBLIC нет, authenticated есть.
  foreach v_sig in array array[
    'public.get_current_trainer_profile()',
    'public.can_trainer_access_student(bigint)',
    'public.search_trainer_students(text)',
    'public.get_trainer_student_page_config()',
    'public.save_trainer_student_page_config(jsonb)',
    'public.get_trainer_kyu_program(bigint)',
    'public.save_trainer_kyu_program(bigint,jsonb)',
    'public.get_trainer_kyu_template(bigint,text)',
    'public.save_trainer_kyu_template(bigint,text,jsonb)'
  ] loop
    v_fn := to_regprocedure(v_sig);
    if v_fn is null then
      raise exception '078 check: % not found', v_sig;
    end if;
    select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = split_part(split_part(v_sig, '(', 1), '.', 2);
    if v_count <> 1 then
      raise exception '078 check: % overload(s) of %', v_count, v_sig;
    end if;
    if not (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
            from pg_proc p where p.oid = v_fn) then
      raise exception '078 check: % is not SECURITY DEFINER with search_path=""', v_sig;
    end if;
    if exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) or has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception '078 check: PUBLIC/anon EXECUTE on %', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '078 check: authenticated lost EXECUTE on %', v_sig;
    end if;
  end loop;

  -- Профиль возвращает portal_role.
  if pg_get_function_result(to_regprocedure('public.get_current_trainer_profile()')) not like '%portal_role text%' then
    raise exception '078 check: get_current_trainer_profile does not return portal_role';
  end if;

  -- Admin-гейты присутствуют; runtime-чтение конфигурации Student Page — без гейта.
  foreach v_sig in array array[
    'public.can_trainer_access_student(bigint)',
    'public.search_trainer_students(text)',
    'public.save_trainer_student_page_config(jsonb)',
    'public.get_trainer_kyu_program(bigint)',
    'public.save_trainer_kyu_program(bigint,jsonb)',
    'public.get_trainer_kyu_template(bigint,text)',
    'public.save_trainer_kyu_template(bigint,text,jsonb)'
  ] loop
    if (select p.prosrc from pg_proc p where p.oid = to_regprocedure(v_sig))
       not like '%private.is_current_trainer_portal_admin()%' then
      raise exception '078 check: admin gate missing in %', v_sig;
    end if;
  end loop;
  if (select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.get_trainer_student_page_config()'))
     like '%is_current_trainer_portal_admin%' then
    raise exception '078 check: get_trainer_student_page_config must stay available to trainers';
  end if;

  -- Ни одна функция, созданная/изменённая этой миграцией, не читает legacy trainers.rolle.
  foreach v_sig in array array[
    'private.current_trainer_portal_role()',
    'private.is_current_trainer_portal_admin()',
    'private.enforce_trainer_accounts_last_active_admin()',
    'public.get_current_trainer_profile()',
    'public.can_trainer_access_student(bigint)',
    'public.search_trainer_students(text)',
    'public.save_trainer_student_page_config(jsonb)',
    'public.get_trainer_kyu_program(bigint)',
    'public.save_trainer_kyu_program(bigint,jsonb)',
    'public.get_trainer_kyu_template(bigint,text)',
    'public.save_trainer_kyu_template(bigint,text,jsonb)'
  ] loop
    if (select coalesce(p.prosrc, '') from pg_proc p where p.oid = to_regprocedure(v_sig)) ~* '\mrolle\M' then
      raise exception '078 check: % references legacy trainers.rolle', v_sig;
    end if;
  end loop;

  -- Триггер последнего admin установлен и включён.
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = v_ta and t.tgname = 'trg_trainer_accounts_last_active_admin'
      and not t.tgisinternal and t.tgenabled <> 'D'
  ) then
    raise exception '078 check: trg_trainer_accounts_last_active_admin missing or disabled';
  end if;

  -- Аудит допускает promote_admin / demote_admin.
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.trainer_account_audit_log')
      and c.conname = 'trainer_account_audit_log_operation_check'
      and pg_get_constraintdef(c.oid) like '%promote_admin%'
      and pg_get_constraintdef(c.oid) like '%demote_admin%'
  ) then
    raise exception '078 check: audit operation check does not allow promote_admin/demote_admin';
  end if;
end
$$;

commit;
