-- Вспомогательные функции для семейной аутентификации и RLS.
--
-- ДОПУЩЕНИЕ (не входило в прямое задание, зафиксировано явно): JCL — мультиклубная
-- платформа, один и тот же портал может обслуживать семьи разных клубов, а
-- nickname уникален только в пределах club_id (не глобально). Поэтому вход
-- запрашивает клуб через clubs.club_short_name (колонка подтверждена аудитом,
-- docs/database/EXISTING_DATABASE_AUDIT.md, раздел 5.3) + nickname + пароль.
-- Экран входа как таковой ещё не спроектирован (нет ТЗ/визуального макета) —
-- это техническое допущение для работы RLS/RPC, а не согласованный UX.
--
-- ТИПЫ (аудит этапа 2.2, подтверждено диагностикой реальной базы 20.07.2026):
-- clubs.club_id — text (human-readable slug, напр. 'jcl'), НЕ uuid.
-- students.id — bigint, НЕ uuid. Более ранняя версия миграции ошибочно
-- предполагала uuid для обоих.

create or replace function public.normalize_family_nickname(p_nickname text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(p_nickname), '[^a-zA-Z0-9]', '', 'g'));
$$;

comment on function public.normalize_family_nickname(text) is
  'Приводит nickname (или club_id — переиспользуется в family_login_email для безопасного построения email) к каноническому виду: нижний регистр, без разделителей.';

-- Технический email для Supabase Auth. Не показывается пользователю нигде в UI.
-- Формат по требованию: family_<clubId>_<normalizedNickname>@internal.jkl
-- club_id тоже нормализуется той же функцией — clubs.club_id это read-only
-- text slug из существующей базы, его реальное содержимое (допустимые
-- символы) не подтверждено аудитом, поэтому безопаснее не подставлять его
-- в email как есть.
create or replace function public.family_login_email(p_club_id text, p_nickname text)
returns text
language sql
immutable
as $$
  select 'family_' || public.normalize_family_nickname(p_club_id) || '_' || public.normalize_family_nickname(p_nickname) || '@internal.jkl';
$$;

comment on function public.family_login_email(text, text) is
  'Строит технический (не публичный) email для семейного auth.users. p_club_id — clubs.club_id (text slug), НЕ clubs.id (uuid). Используется только серверным кодом (Edge Function создания аккаунта) и resolve_family_login_email.';

-- Публичная точка входа: клиент передаёт club_short_name + nickname, получает
-- технический email для supabase.auth.signInWithPassword().
--
-- ИСПРАВЛЕНО (аудит этапа 2.1): первая версия проверяла существование
-- активной семьи с этим nickname и возвращала null, если такой семьи нет —
-- это делало функцию оракулом для перебора nickname (null = нет такой
-- семьи в клубе, email-строка = есть). Теперь email строится
-- ДЕТЕРМИНИРОВАННО для любого nickname, без проверки существования семьи.
-- Если семьи с таким nickname на самом деле нет, соответствующего
-- auth.users тоже не существует, и auth.signInWithPassword() вернёт свою
-- обычную generic-ошибку "Invalid login credentials" — неотличимую от
-- случая "семья есть, пароль неверный". Раскрывается только существование
-- САМОГО КЛУБА (по club_short_name) — это осознанно принято как неопасное:
-- клуб не секрет (в отличие от того, какие именно семьи в нём есть).
create or replace function public.resolve_family_login_email(p_club_short_name text, p_nickname text)
returns text
language plpgsql
security definer
set search_path = public
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

  return public.family_login_email(v_club_id, p_nickname);
end;
$$;

comment on function public.resolve_family_login_email(text, text) is
  'SECURITY DEFINER: строит технический email для club_short_name+nickname БЕЗ проверки, существует ли такая семья — иначе функция становится оракулом перебора nickname. Существование семьи проверяет только auth.signInWithPassword() на следующем шаге, единой generic-ошибкой.';

revoke all on function public.resolve_family_login_email(text, text) from public;
grant execute on function public.resolve_family_login_email(text, text) to anon, authenticated;

-- ИСПРАВЛЕНО (аудит этапа 2.1): у normalize_family_nickname и
-- family_login_email не было revoke/grant вовсе — Postgres по умолчанию
-- даёт EXECUTE всем ролям (PUBLIC) для новых функций. Обе нужны только
-- внутренним вызовам (resolve_family_login_email выше, Edge Function через
-- service_role) — service_role не ограничен этими grant'ами, поэтому можно
-- закрыть прямой публичный/анонимный доступ без потери функциональности.
revoke all on function public.normalize_family_nickname(text) from public;
revoke all on function public.family_login_email(text, text) from public;

-- Ядро RLS: может ли ТЕКУЩИЙ авторизованный пользователь (auth.uid()) читать
-- данные конкретного ученика через свою семью. Используется во всех RLS
-- policies и в RPC этого и последующих модулей вместо дублирования JOIN'ов.
-- p_student_id: bigint — students.id (реальный PK, подтверждено диагностикой).
create or replace function public.can_family_access_student(p_student_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_guardians fg
    join public.family_students fs on fs.family_id = fg.family_id
    where fg.auth_user_id = auth.uid()
      and fs.student_id = p_student_id
      and fs.status = 'active'
  );
$$;

comment on function public.can_family_access_student(bigint) is
  'true, если auth.uid() — guardian семьи, активно связанной с p_student_id (students.id, bigint). false для чужой семьи, другого клуба или анонимного пользователя.';

revoke all on function public.can_family_access_student(bigint) from public;
grant execute on function public.can_family_access_student(bigint) to authenticated;
