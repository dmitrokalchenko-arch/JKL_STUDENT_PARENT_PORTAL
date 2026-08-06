-- RLS для модуля «Прогресс техник» — только семейный read-only доступ.
--
-- ТИПЫ (аудит этапа 2.2): club_id везде text (clubs.club_id slug), не uuid.
--
-- Тренерские и административные policies НЕ создаются в этой миграции.
-- Причина: тренеры сейчас авторизуются собственным PIN-механизмом
-- (trainers.pin), не через Supabase Auth — auth.uid() для тренерской сессии
-- сегодня не существует физически, писать RLS-policy "тренер видит своих
-- учеников" не на что опереться (см. отчёт аудита и явное указание
-- пользователя: "не менять пока существующую PIN-авторизацию тренеров...
-- в будущем тренерские аккаунты можно будет отдельно перевести на Supabase
-- Auth, но это не входит в текущую задачу"). Это осознанный,
-- задокументированный пробел, а не забытая часть задания — он будет закрыт
-- на этапе 3 роадмапа (интерфейс тренера) одновременно с решением по
-- тренерской аутентификации.
--
-- Отдельно зафиксировано (этап 2.2): диагностика реальной базы показала,
-- что RLS на students/trainers у JCL_Gruppen УЖЕ включён, но политики
-- крайне открытые (SELECT/INSERT/UPDATE/DELETE для ролей public/anon с
-- qual=true) — то есть фактически без ограничений. Это существующая
-- особенность чужой системы (JCL_Gruppen), не входит в эту задачу и не
-- меняется здесь — упомянуто для полноты картины и задокументировано в
-- docs/database/EXISTING_DATABASE_AUDIT.md.

alter table public.club_technique_progress_settings enable row level security;
alter table public.club_belts enable row level security;
alter table public.club_techniques enable row level security;
alter table public.club_belt_techniques enable row level security;
alter table public.club_belt_technique_settings enable row level security;
alter table public.student_technique_progress enable row level security;

create or replace function public.is_family_in_club(p_club_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.family_guardians
    where auth_user_id = auth.uid()
      and club_id = p_club_id
  );
$$;

comment on function public.is_family_in_club(text) is
  'true, если auth.uid() — guardian семьи именно этого клуба (club_id — text slug, clubs.club_id). Используется для чтения club-уровневых справочников (club_belts/club_techniques/...), где ещё не важен конкретный student_id.';

revoke all on function public.is_family_in_club(text) from public;
grant execute on function public.is_family_in_club(text) to authenticated;

create policy club_technique_progress_settings_select_own_club
  on public.club_technique_progress_settings
  for select
  to authenticated
  using (public.is_family_in_club(club_id));

create policy club_belts_select_own_club
  on public.club_belts
  for select
  to authenticated
  using (public.is_family_in_club(club_id));

create policy club_techniques_select_own_club
  on public.club_techniques
  for select
  to authenticated
  using (public.is_family_in_club(club_id));

create policy club_belt_techniques_select_own_club
  on public.club_belt_techniques
  for select
  to authenticated
  using (public.is_family_in_club(club_id));

create policy club_belt_technique_settings_select_own_club
  on public.club_belt_technique_settings
  for select
  to authenticated
  using (public.is_family_in_club(club_id));

-- Прогресс ученика — самая чувствительная таблица: доступ не по club_id,
-- а строго по конкретному student_id через can_family_access_student().
create policy student_technique_progress_select_own_children
  on public.student_technique_progress
  for select
  to authenticated
  using (public.can_family_access_student(student_id));

-- Никаких insert/update/delete policies для authenticated ни на одной из
-- таблиц этого модуля — семья только читает. anon доступа не имеет вовсе.
