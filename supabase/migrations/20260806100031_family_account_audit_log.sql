-- Аудит операций manage-family-account (JWT-модель, Super Admin через
-- super_admin_accounts). Прямая аналогия trainer_account_audit_log
-- (migration 024): хранит ТОЛЬКО идентификаторы и метку операции — НИКОГДА
-- пароль, JWT, email или иной секрет. Полностью закрыта RLS без единой
-- policy, единственный вход — log_family_account_operation() ниже,
-- вызываемая Edge Function от имени service_role.
create table public.family_account_audit_log (
  id uuid primary key default gen_random_uuid(),
  performed_by_auth_user_id uuid not null references auth.users(id) on delete restrict,
  target_family_id uuid not null references public.families(id) on delete restrict,
  target_student_id bigint not null references public.students(id) on delete restrict,
  club_id text not null,
  operation text not null check (operation in (
    'create', 'link_existing', 'set_login', 'set_password',
    'activate', 'deactivate', 'send_recovery'
  )),
  created_at timestamptz not null default now()
);

comment on table public.family_account_audit_log is
  'Журнал привилегированных действий Super Admin над Familienzugänge. target_student_id — ученик, из чьей карточки в JCL_Gruppen была вызвана операция (контекст для читаемости лога; сама операция всегда затрагивает всю семью target_family_id, не только этого ученика). Пароль/email/JWT никогда не пишутся.';

alter table public.family_account_audit_log enable row level security;

create index idx_family_account_audit_log_target_family_id on public.family_account_audit_log(target_family_id);
create index idx_family_account_audit_log_target_student_id on public.family_account_audit_log(target_student_id);

create or replace function public.log_family_account_operation(
  p_performed_by_auth_user_id uuid,
  p_target_family_id uuid,
  p_target_student_id bigint,
  p_club_id text,
  p_operation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.family_account_audit_log (
    performed_by_auth_user_id, target_family_id, target_student_id, club_id, operation
  ) values (
    p_performed_by_auth_user_id, p_target_family_id, p_target_student_id, p_club_id, p_operation
  );
end;
$$;

comment on function public.log_family_account_operation(uuid, uuid, bigint, text, text) is
  'Единственный способ записать в family_account_audit_log. Вызывается только manage-family-account Edge Function от имени service_role.';

revoke all on function public.log_family_account_operation(uuid, uuid, bigint, text, text) from public;
grant execute on function public.log_family_account_operation(uuid, uuid, bigint, text, text) to service_role;
