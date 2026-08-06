-- RPC resolve_super_admin_login_email — построение технического email
-- Super Admin по username. Прямая аналогия resolve_trainer_login_email
-- (migration 012), но без клубного контекста вообще — Super Admin не
-- принадлежит одному club_id, поэтому здесь нет ни p_club_short_name, ни
-- club_id в самом email.
--
-- hex-кодирование username (не просто normalize_login_name в чистом виде) —
-- тот же приём, что и у тренеров (migration 012): username Super Admin
-- теоретически может содержать не-ASCII символы, а фактический тест на
-- тренерской стороне показал, что нелатинские символы в auth.users.email
-- искажаются локальным GoTrue. hex устраняет этот риск для любого алфавита.
--
-- Анти-enumeration: детерминированное построение без проверки существования
-- super_admin_accounts — тот же принцип, что resolve_trainer_login_email/
-- resolve_family_login_email. Здесь даже не с чем сверяться на входе (нет
-- клуба) — функция всегда возвращает строку для непустого username.
create or replace function public.resolve_super_admin_login_email(
  p_username text
)
returns text
language sql
immutable
as $$
  select 'superadmin_'
    || encode(convert_to(public.normalize_login_name(p_username), 'UTF8'), 'hex')
    || '@internal.jkl';
$$;

comment on function public.resolve_super_admin_login_email(text) is
  'Строит технический (не публичный) email Super Admin из username. Детерминированная, без проверки существования super_admin_accounts (анти-enumeration). Без клубного контекста — Super Admin платформенный, не привязан к club_id.';

-- Грант сразу всем трём ролям, которым он реально нужен (login-экран вызывает
-- анонимно ДО сессии; Edge Function — через service_role) — на тренерской
-- стороне это было найдено отдельной миграцией задним числом (020), здесь
-- учтено сразу.
revoke all on function public.resolve_super_admin_login_email(text) from public;
grant execute on function public.resolve_super_admin_login_email(text) to anon, authenticated, service_role;
