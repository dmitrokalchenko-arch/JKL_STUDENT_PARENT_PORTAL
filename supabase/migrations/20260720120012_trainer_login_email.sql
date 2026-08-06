-- RPC resolve_trainer_login_email — построение технического email тренера
-- по club_short_name + login_name. Прямая аналогия с
-- resolve_family_login_email (migration 2), но НЕ слепое копирование:
--
--   - p_club_short_name (а не p_club_id) — потому что единственный
--     сегодняшний источник конфигурации клуба на frontend (PORTAL_CLUB_ID,
--     src/config/portalClub.js) уже физически хранит club_short_name (это
--     подтверждено, не предположение — см. архитектурный анализ "club_id
--     против club_short_name"). Это ВРЕМЕННО ПОДТВЕРЖДЁННАЯ совместимость,
--     не долгосрочный архитектурный стандарт — если семейная система
--     перейдёт на настоящий clubs.club_id, этот RPC нужно будет
--     пересмотреть вместе с ней, не по отдельности.
--
--   - для club_id-части email используется public.normalize_family_nickname()
--     (переиспользуется как есть — club_id всегда латинский slug, кириллицы
--     там не бывает, эта функция для него корректна);
--   - для login_name-части — НЕ просто public.normalize_login_name()
--     (migration 011) в чистом виде, а её результат в hex-кодировке UTF8
--     байтов. Найдено фактическим тестом (не предположением): реальный
--     локальный Supabase Auth Admin API исказил email с кириллицей
--     ("иванп" превратился в "?????" в сохранённой записи auth.users) —
--     то есть email с не-ASCII символами ненадёжен и не гарантирует
--     совпадения при повторном построении на этапе входа. login_name
--     строится из реальных ФИО на любом языке (тот же баг с кириллицей,
--     что уже был найден и исправлен в normalize_login_name самой по себе,
--     migration 011) — hex-кодирование универсально устраняет риск для
--     ЛЮБОГО алфавита, без транслитерации.
--
-- Анти-enumeration: email строится ДЕТЕРМИНИРОВАННО, без проверки
-- существования trainer_accounts — тот же принцип, что у
-- resolve_family_login_email. Раскрывается только существование клуба
-- (по club_short_name), не существование конкретного login_name/аккаунта.
-- Активность (trainer_accounts.is_active) на этом шаге намеренно НЕ
-- проверяется — иначе сам факт "email построился/не построился" стал бы
-- оракулом активности; is_active проверяется только после входа, в
-- get_current_trainer_profile (следующий шаг).
create or replace function public.resolve_trainer_login_email(
  p_club_short_name text,
  p_login_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id text;
begin
  select club_id into v_club_id
  from public.clubs
  where club_short_name = p_club_short_name
    and active = true;

  if v_club_id is null then
    return null;
  end if;

  return 'trainer_'
    || public.normalize_family_nickname(v_club_id)
    || '_'
    || encode(convert_to(public.normalize_login_name(p_login_name), 'UTF8'), 'hex')
    || '@internal.jkl';
end;
$$;

comment on function public.resolve_trainer_login_email(text, text) is
  'SECURITY DEFINER: строит технический email тренера БЕЗ проверки существования trainer_accounts (анти-enumeration, как у resolve_family_login_email). p_club_short_name временно совместим с существующей конфигурацией frontend (PORTAL_CLUB_ID), не долгосрочный стандарт. is_active НЕ проверяется здесь — только в get_current_trainer_profile после входа.';

revoke all on function public.resolve_trainer_login_email(text, text) from public;
grant execute on function public.resolve_trainer_login_email(text, text) to anon, authenticated;
