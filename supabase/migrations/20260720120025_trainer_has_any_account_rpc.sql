-- НАЙДЕНО РУЧНЫМ РЕВЬЮ + ПОДТВЕРЖДЕНО ЖИВЫМ ТЕСТОМ (не предположением):
-- trainer_has_active_account (migration 019) возвращает false и для
-- "тренер никогда не мигрирован", и для "тренер мигрирован, но
-- деактивирован администратором (trainer_accounts.is_active = false)" —
-- JCL_Gruppen (app.js, login()) в обоих случаях одинаково откатывается на
-- старый PIN-flow. Если у деактивированного тренера остался рабочий
-- pin_hash/pin_salt (миграция на новую систему НЕ очищает эти поля — и не
-- должна, чтобы не терять данные без необходимости), деактивация портального
-- доступа полностью обходится: тренер просто входит по старому PIN.
--
-- Живой тест (T-DUPLICATE-TEST, .local-supabase-test): активная строка
-- trainer_accounts переведена в is_active=false, при этом pin_hash/pin_salt
-- оставлены рабочими — вход через PIN прошёл успешно, хотя портальный
-- доступ формально деактивирован.
--
-- Fix: новый RPC различает "аккаунта никогда не было" (можно безопасно
-- откатываться на PIN, как раньше) от "аккаунт есть, но неактивен" (доступ
-- должен быть заблокирован целиком, откат на PIN — дыра). Сам
-- trainer_has_active_account не меняется — он по-прежнему корректно отвечает
-- на вопрос "есть ли АКТИВНЫЙ аккаунт". Тот же anti-enumeration принцип, что
-- и в migration 019: возвращается только boolean, email/auth_user_id/
-- login_name не раскрываются.
create or replace function public.trainer_has_any_account(
  p_trainer_id text,
  p_club_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trainer_accounts ta
    join public.trainers t on t.id = ta.trainer_row_id
    where t.trainer_id = p_trainer_id
      and t.club_id = p_club_id
      and ta.club_id = p_club_id
  );
$$;

comment on function public.trainer_has_any_account(text, text) is
  'SECURITY DEFINER: true, если у тренера (по trainer_id+club_id) есть строка trainer_accounts ВНЕ ЗАВИСИМОСТИ от is_active. Используется JCL_Gruppen, чтобы отличить "никогда не мигрирован" (безопасный откат на legacy PIN) от "мигрирован, но деактивирован" (доступ должен быть заблокирован целиком, а не откатываться на PIN). Возвращает только boolean.';

revoke all on function public.trainer_has_any_account(text, text) from public;
grant execute on function public.trainer_has_any_account(text, text) to anon, authenticated;
