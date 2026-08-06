-- RPC get_current_trainer_profile — минимальный профиль текущего тренера
-- (auth.uid()) для проверки доступа к /trainer. Прямая аналогия с
-- get_current_family_children, но с другой семантикой пустого результата:
--
--   - профиля нет вообще (auth.uid() не связан ни с одной строкой
--     trainer_accounts) -> 0 строк, НЕ exception;
--   - профиль есть, но is_active=false -> 1 строка С is_active=false
--     (а не 0 строк!) — так frontend различит "вы не тренер" и "доступ
--     приостановлен" разными сообщениями (согласованное решение этапа
--     backend-контракта). is_active НЕ фильтруется в WHERE.
--
-- Email НЕ возвращается никогда — единственная точка, где email вообще
-- когда-либо отдаётся клиенту, это resolve_trainer_login_email (migration
-- 012), больше нигде. login_name и trainer_row_id тоже не возвращаются:
-- login_name не нужен после входа (display_name достаточно для UI),
-- trainer_row_id — внутренний bigint чужой системы, раскрывать незачем.
--
-- SECURITY DEFINER необходим (не выбран по умолчанию): authenticated не
-- имеет и не получает прямого GRANT SELECT на trainer_accounts (см.
-- migration 011 — RLS enable без единой policy). Без параметров —
-- единственный вход auth.uid(), подмена чужого профиля невозможна.
create or replace function public.get_current_trainer_profile()
returns table (
  trainer_account_id uuid,
  club_id text,
  display_name text,
  is_active boolean
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
    ta.is_active
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid());
$$;

comment on function public.get_current_trainer_profile() is
  'SECURITY DEFINER: минимальный профиль ТЕКУЩЕГО auth.uid() (без параметров — подмена чужого профиля невозможна). 0 строк = не тренер (не ошибка). 1 строка с is_active=false = доступ к /trainer приостановлен (отличается от "не тренер" для UX). email/login_name/trainer_row_id намеренно не возвращаются.';

revoke all on function public.get_current_trainer_profile() from public;
revoke all on function public.get_current_trainer_profile() from anon;
grant execute on function public.get_current_trainer_profile() to authenticated;
