-- Локальный аудит операций manage-trainer-account (JWT-модель авторизации).
--
-- Хранит ТОЛЬКО идентификаторы и метку операции — никогда пароль, JWT,
-- email или иной секрет. Таблица полностью закрыта RLS без единой policy:
-- прямой доступ из anon/authenticated невозможен, единственный вход — через
-- SECURITY DEFINER функцию log_trainer_account_operation() ниже, вызываемую
-- Edge Function от имени service_role.
create table public.trainer_account_audit_log (
  id uuid primary key default gen_random_uuid(),
  performed_by_auth_user_id uuid not null references auth.users(id) on delete restrict,
  target_trainer_row_id bigint not null references public.trainers(id) on delete restrict,
  target_trainer_id text not null,
  club_id text not null,
  operation text not null check (operation in ('create', 'update', 'activate', 'deactivate')),
  created_at timestamptz not null default now()
);

alter table public.trainer_account_audit_log enable row level security;

create or replace function public.log_trainer_account_operation(
  p_performed_by_auth_user_id uuid,
  p_target_trainer_row_id bigint,
  p_target_trainer_id text,
  p_club_id text,
  p_operation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.trainer_account_audit_log (
    performed_by_auth_user_id, target_trainer_row_id, target_trainer_id, club_id, operation
  ) values (
    p_performed_by_auth_user_id, p_target_trainer_row_id, p_target_trainer_id, p_club_id, p_operation
  );
end;
$$;

-- Тот же класс пробела, что уже находился фактическим тестом для
-- normalize_login_name/resolve_trainer_login_email/family_club_exists/
-- rename_trainer_login (migrations 20260720120020-23): revoke all from
-- public не оставляет service_role скрытого доступа, EXECUTE нужен явно.
revoke all on function public.log_trainer_account_operation(uuid, bigint, text, text, text) from public;
grant execute on function public.log_trainer_account_operation(uuid, bigint, text, text, text) to service_role;
