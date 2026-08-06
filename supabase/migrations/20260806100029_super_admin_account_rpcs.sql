-- RPC super_admin_has_active_account / super_admin_has_any_account —
-- прямая аналогия trainer_has_active_account (migration 019) и
-- trainer_has_any_account (migration 025), включая уже известный из
-- тренерской стороны фикс: различать "аккаунта никогда не было" (безопасный
-- откат на старый PIN-flow) от "аккаунт есть, но деактивирован" (доступ
-- должен блокироваться целиком, НЕ откатываться на PIN) — обе функции
-- добавлены СРАЗУ вместе, а не задним числом, чтобы избежать той же дыры,
-- что нашёл живой тест на тренерской стороне (migration 025).
--
-- Возвращают ТОЛЬКО boolean — email/auth_user_id/login_name не раскрываются
-- ни в каком случае. anon разрешён сознательно: вызывается на экране логина
-- Super Admin ДО какой-либо сессии, тем же способом, что и тренерский
-- аналог (сам факт "у этого username есть аккаунт" не чувствительнее того,
-- что super_admins и так читается anon-ключом целиком сегодня).
create or replace function public.super_admin_has_active_account(
  p_username text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.super_admin_accounts sa
    where sa.normalized_login_name = public.normalize_login_name(p_username)
      and sa.is_active = true
  );
$$;

comment on function public.super_admin_has_active_account(text) is
  'SECURITY DEFINER: true, если у Super Admin (по username) есть активная строка super_admin_accounts. Только boolean. Используется JCL_Gruppen до входа для ветвления PIN/Auth flow.';

revoke all on function public.super_admin_has_active_account(text) from public;
grant execute on function public.super_admin_has_active_account(text) to anon, authenticated;

create or replace function public.super_admin_has_any_account(
  p_username text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.super_admin_accounts sa
    where sa.normalized_login_name = public.normalize_login_name(p_username)
  );
$$;

comment on function public.super_admin_has_any_account(text) is
  'SECURITY DEFINER: true, если у Super Admin (по username) есть строка super_admin_accounts вне зависимости от is_active. Отличает "никогда не мигрирован" (откат на PIN безопасен) от "мигрирован, но деактивирован" (блокировать целиком) — тот же фикс, что trainer_has_any_account (migration 025).';

revoke all on function public.super_admin_has_any_account(text) from public;
grant execute on function public.super_admin_has_any_account(text) to anon, authenticated;

-- normalize_login_name используется здесь SQL-выражением внутри SECURITY
-- DEFINER функций владельца миграции (postgres) — выполняется с правами
-- владельца, отдельного grant service_role не требует (в отличие от
-- generated-колонки, см. migration 022 на тренерской стороне, где именно
-- generated-выражение при INSERT/UPDATE оценивается с правами ВЫПОЛНЯЮЩЕЙ
-- операцию роли, а не владельца функции/таблицы).
