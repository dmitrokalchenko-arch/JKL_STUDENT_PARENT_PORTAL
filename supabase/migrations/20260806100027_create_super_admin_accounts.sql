-- Super Admin Auth: таблица super_admin_accounts — связь auth.users с
-- платформенным Super Admin (JCL_Gruppen.super_admins), по прямой аналогии
-- с trainer_accounts (migration 011).
--
-- ПОЧЕМУ ЭТО НУЖНО: JCL_Gruppen.super_admins сегодня не использует Supabase
-- Auth вообще — вход сравнивает PIN, полученный обычным SELECT с anon-ключом,
-- на стороне клиента (app.js, _superAdminLoginCore). Для защищённой Edge
-- Function управления Familienzugänge (manage-family-account) нужен способ
-- СЕРВЕРНОЙ проверки "этот запрос реально пришёл от вошедшего Super Admin" —
-- единственный такой механизм в этой системе (см. manage-trainer-account) это
-- Supabase Auth JWT (`Authorization: Bearer <access_token>`), проверяемый
-- через supabaseAdmin.auth.getUser(token). Эта миграция даёт Super Admin
-- собственный auth.users-аккаунт для этой цели, полностью отдельный от
-- family_guardians/trainer_accounts (тот же принцип "всегда разные auth.users
-- для разных ролей", что и в migration 011).
--
-- НЕ заменяет и не изменяет существующий super_admins/_superAdminLoginCore —
-- это ДОПОЛНИТЕЛЬНЫЙ, опциональный путь входа. is_active по умолчанию false:
-- ни один существующий Super Admin не получает доступ к привилегированным
-- Edge Function автоматически, только явным bootstrap-действием.
--
-- ДОПУЩЕНИЕ (по аналогии с trainers.club_id в migration 011, ТРЕБУЕТ
-- проверки на реальной базе перед применением к production): super_admins.id
-- предполагается bigint — подтверждено аудитом только то, что колонки
-- id/username/name/pin существуют (docs/database/EXISTING_DATABASE_AUDIT.md,
-- со ссылкой на JCL_Gruppen.super_admins), точный тип id НЕ подтверждён
-- диагностикой реальной базы (в отличие от trainers.id/students.id, которые
-- были явно продиагностированы в этапе Trainer Auth). Если реальный тип
-- отличается — эту миграцию нужно исправить ПЕРЕД применением к production,
-- не после.
--
-- normalize_login_name(text) переиспользуется как есть (migration 011,
-- Unicode-safe: нижний регистр + удаление пробелов, без ограничения
-- алфавита) — она не специфична тренерам по реализации, только по месту
-- первого появления; создавать копию для Super Admin нет смысла.

create table public.super_admin_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  super_admin_id bigint not null unique,
  login_name text not null,
  normalized_login_name text generated always as (public.normalize_login_name(login_name)) stored,
  display_name text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_login_name)
);

comment on table public.super_admin_accounts is
  'Связь auth.users с платформенным Super Admin (JCL_Gruppen.super_admins, ЧУЖАЯ таблица — не создаётся и не изменяется здесь). Дополнительный, опциональный путь входа — существующий PIN-логин через super_admins.pin не затрагивается. is_active=false по умолчанию: доступ к привилегированным Edge Function включается только явным административным действием. unique(super_admin_id): не более одного аккаунта на Super Admin (race-condition-проблема из trainer_accounts, migration 026, здесь закрыта сразу, а не задним числом). normalized_login_name уникален ГЛОБАЛЬНО (не по club_id — Super Admin не привязан к одному клубу).';
comment on column public.super_admin_accounts.super_admin_id is
  'FK-по-значению (без формального FOREIGN KEY, т.к. точный тип super_admins.id не подтверждён диагностикой реальной базы, только предположен bigint по аналогии с trainers.id/students.id) на JCL_Gruppen.super_admins.id. Соответствие проверяется только на уровне Edge Function при bootstrap, не триггером — сознательно минимальный контур для платформенной, не клубной сущности.';

create trigger trg_super_admin_accounts_set_updated_at
  before update on public.super_admin_accounts
  for each row execute function public.set_updated_at();

-- Immutability login_name — прямая копия паттерна trainer_accounts
-- (migration 011): обычный UPDATE всегда блокируется, обход только через
-- rename_super_admin_login() ниже с session-scoped GUC bypass.
create or replace function public.enforce_super_admin_accounts_login_name_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.login_name <> old.login_name
     and coalesce(current_setting('super_admin_accounts.allow_login_rename', true), 'false') <> 'true' then
    raise exception 'super_admin_accounts.login_name is immutable; use rename_super_admin_login() instead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_super_admin_accounts_login_name_immutable
  before update on public.super_admin_accounts
  for each row execute function public.enforce_super_admin_accounts_login_name_immutable();

create or replace function public.rename_super_admin_login(
  p_super_admin_account_id uuid,
  p_new_login_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  perform set_config('super_admin_accounts.allow_login_rename', 'true', true);

  update public.super_admin_accounts
  set login_name = p_new_login_name
  where id = p_super_admin_account_id;

  v_updated := found;

  perform set_config('super_admin_accounts.allow_login_rename', 'false', true);

  if not v_updated then
    raise exception 'super_admin_accounts.id % not found', p_super_admin_account_id;
  end if;
end;
$$;

comment on function public.rename_super_admin_login(uuid, text) is
  'Единственный контролируемый способ изменить super_admin_accounts.login_name в обход immutability-триггера. Не используется текущим MVP (Familienzugänge bootstrap создаёт логин один раз), добавлена для симметрии с trainer_accounts и на случай будущей смены логина Super Admin.';

revoke all on function public.rename_super_admin_login(uuid, text) from public;

-- RLS enabled, без единой policy — тот же принцип, что и trainer_accounts/
-- families/family_guardians: единственный путь к данным — SECURITY DEFINER
-- RPC ниже и Edge Function через service_role.
alter table public.super_admin_accounts enable row level security;
