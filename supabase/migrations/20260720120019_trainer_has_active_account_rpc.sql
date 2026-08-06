-- RPC trainer_has_active_account — единственная информация, нужная JCL_Gruppen
-- ДО входа (анонимно), чтобы решить, вести пользователя по новому
-- Supabase Auth flow или по старому PIN-flow. Возвращает ТОЛЬКО boolean —
-- никакого email/auth_user_id/login_name не раскрывает (в отличие от
-- resolve_trainer_login_email, который строит email, здесь даже это не
-- нужно и сознательно не возвращается).
--
-- Идентификация тренера — по паре (trainer_id, club_id), тем же способом,
-- что использует сам JCL_Gruppen (trainers.trainer_id — text, НЕ PK, но
-- используется как бизнес-идентификатор во всех существующих RPC этого
-- проекта, см. get_current_trainer_groups, migration 016).
--
-- anon — сознательно разрешён (grant ниже): вызывается ДО какой-либо
-- сессии, на экране логина, до определения PIN или Auth. Не является
-- утечкой: сам факт "у этого trainer_id есть портал-аккаунт" не более
-- чувствителен, чем то, что уже происходит сегодня в JCL_Gruppen при
-- обычном подборе PIN (публичный anon-ключ и так читает всю таблицу
-- trainers). Email/auth_user_id не раскрываются в любом случае.
create or replace function public.trainer_has_active_account(
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
      and ta.is_active = true
  );
$$;

comment on function public.trainer_has_active_account(text, text) is
  'SECURITY DEFINER: true, если у тренера (по trainer_id+club_id — бизнес-идентификаторы JCL_Gruppen, не PK) есть активная строка trainer_accounts. Возвращает ТОЛЬКО boolean — email/auth_user_id/login_name никогда не раскрываются. Используется JCL_Gruppen ДО входа для ветвления PIN/Auth flow, вызывается анонимно.';

revoke all on function public.trainer_has_active_account(text, text) from public;
grant execute on function public.trainer_has_active_account(text, text) to anon, authenticated;
