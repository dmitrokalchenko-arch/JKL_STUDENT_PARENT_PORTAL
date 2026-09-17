-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION.
--
-- НАЗНАЧЕНИЕ: задача "student-profile-data-pipeline-audit" — E2E-аудит
-- показал, что club-wide конфигурация (миграции 20260916140057/058) уже
-- корректно управляет ВИДИМОСТЬЮ 14 полей StudentProfileCard, но 5 из них
-- (weight/phone/email/photo/trainer) физически ОТСУТСТВУЮТ в ответе
-- get_trainer_student_by_id/get_current_family_children — Trainer включил
-- поле в /trainer/settings, а показывать нечего, потому что данные до сих
-- пор не доходят до фронтенда. Эта миграция ТОЛЬКО добавляет недостающие
-- колонки к двум уже существующим RPC — расширение источника данных, не
-- расширение прав доступа (WHERE/JOIN-условия, определяющие, ЧЕЙ именно
-- ученик виден вызывающему, НЕ меняются ни на символ):
--
--   get_trainer_student_by_id: can_trainer_access_student(p_student_id) —
--     БЕЗ ИЗМЕНЕНИЙ, тот же вызов в начале тела функции, что и в текущей
--     production-версии (миграция 20260915130056).
--   get_current_family_children: тот же JOIN family_guardians ->
--     family_students(status='active') -> families(status='active') ->
--     students по fg.auth_user_id = auth.uid() — БЕЗ ИЗМЕНЕНИЙ.
--
-- gender/birthDate/kyuGrade/beltColor НЕ добавляются этой миграцией — они
-- уже присутствуют в обеих функциях (geschlecht/geburtsdatum/kyu_grade/
-- belt_color были в RETURNS TABLE и раньше), их отсутствие на реальной
-- Student Page было чисто frontend-маппингом (см. соответствующий commit
-- в этом же PR) — не DB-проблема, поэтому здесь не трогается.
--
-- НОВЫЕ КОЛОНКИ (обе функции получают одинаковый набор):
--   telefon, email          — students.telefon/email напрямую, те же
--                              колонки, что уже видит Block 1.
--   aktuelles_gewicht        — students.aktuelles_gewicht напрямую.
--   foto_url                 — students.foto_url напрямую (существующий
--                              Supabase Storage URL, если он там есть —
--                              никакой новый bucket не создаётся).
--   trainer_names             — НЕ прямая колонка students (там нет
--                              trainer_id/единственного тренера) — students
--                              НЕ хранит явную привязку к тренеру.
--                              Реальная связь — ЧЕРЕЗ группу: students.
--                              gruppe_id (может содержать несколько ID
--                              через ';'/',', тот же формат, что уже
--                              разбирает public.can_trainer_access_student,
--                              миграция 20260911090049) -> public.
--                              trainer_groups(club_id, gruppe_id) ->
--                              trainer_name. Один ученик может состоять в
--                              нескольких группах и/или у группы может быть
--                              несколько тренеров (Matviei Sukonko, id=78:
--                              группа G_J_Mo_19:00_Mi_18:30 ->
--                              "Fucks Andreas" + "Kalchenko Dmytro",
--                              подтверждено прямым запросом к production
--                              при аудите этой задачи) — string_agg(DISTINCT
--                              ...) собирает все уникальные имена в одну
--                              строку через ", ", ни один тренер не
--                              теряется. Та же club_id-изоляция, что и в
--                              can_trainer_access_student (tg.club_id =
--                              s.club_id) — тренер другого клуба никогда не
--                              попадёт в список, даже если бы у него
--                              случайно совпал gruppe_id.
--
-- PRIVACY (Phone/E-Mail): доступность этих двух колонок определяется
-- ИСКЛЮЧИТЕЛЬНО уже существующей авторизацией каждой функции (см. выше) —
-- эта миграция не создаёт для них никакого отдельного/более широкого
-- пути чтения. Anon по-прежнему НЕ может вызвать ни одну из этих функций
-- (EXECUTE только authenticated, см. явный revoke-паттерн ниже).
--
-- RETURNS TABLE меняется (новые колонки) -> DROP + CREATE, тот же приём,
-- что уже дважды использовался в этом проекте для этих же двух функций
-- (миграции 20260901100040, 20260915130056). Зависимостей (view/rule/
-- другие функции) у обеих нет.

-- ── get_trainer_student_by_id ───────────────────────────────────────────
drop function if exists public.get_trainer_student_by_id(bigint);

create function public.get_trainer_student_by_id(p_student_id bigint)
returns table (
  id text,
  vorname text,
  nachname text,
  geburtsdatum date,
  alter integer,
  geschlecht text,
  sport_id text,
  sport_name text,
  gruppe_id text,
  group_name text,
  training_day text,
  training_time text,
  belt_color text,
  kyu_grade text,
  contract_status text,
  contract_date date,
  telefon text,
  email text,
  aktuelles_gewicht numeric,
  foto_url text,
  trainer_names text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_trainer_access_student(p_student_id) then
    -- Нет доступа (или нет активной тренерской сессии вовсе) -> 0 строк,
    -- не ошибка — без изменений, тот же анти-enumeration принцип, что и
    -- в текущей production-версии этой функции.
    return;
  end if;

  return query
  select
    s.id::text,
    s.vorname,
    s.nachname,
    s.geburtsdatum,
    s.alter,
    s.geschlecht,
    s.sport_id,
    sp.name as sport_name,
    s.gruppe_id,
    gr.gruppenname as group_name,
    gr.trainingstag as training_day,
    gr.trainingszeit as training_time,
    s.guertelfarbe as belt_color,
    s.kyu_grad as kyu_grade,
    s.vertrag_status as contract_status,
    s.vertrag_datum as contract_date,
    s.telefon,
    s.email,
    s.aktuelles_gewicht,
    s.foto_url,
    (
      select string_agg(distinct tg.trainer_name, ', ' order by tg.trainer_name)
      from public.trainer_groups tg
      where tg.club_id = s.club_id
        and tg.gruppe_id = any (
          select trim(g)
          from regexp_split_to_table(coalesce(s.gruppe_id, ''), '[;,]') as g
          where trim(g) <> ''
        )
    ) as trainer_names
  from public.students s
  left join public.sports sp on sp.sport_id = s.sport_id
  left join public.groups gr on gr.gruppe_id = s.gruppe_id
  where s.id = p_student_id;
end;
$$;

comment on function public.get_trainer_student_by_id(bigint) is
  'SECURITY DEFINER: профиль ОДНОГО ученика по p_student_id — ТОЛЬКО если public.can_trainer_access_student(p_student_id) сейчас true для auth.uid(). 0 строк, если доступа нет (не ошибка). Расширено миграцией 20260916160059: telefon/email/aktuelles_gewicht/foto_url — прямые students-колонки; trainer_names — агрегированные имена тренеров ученика через students.gruppe_id -> trainer_groups (может быть несколько, через ", "). Доступ НЕ расширен — тот же can_trainer_access_student, что и раньше.';

revoke all on function public.get_trainer_student_by_id(bigint) from public;
revoke all on function public.get_trainer_student_by_id(bigint) from anon;
grant execute on function public.get_trainer_student_by_id(bigint) to authenticated;

-- ── get_current_family_children ─────────────────────────────────────────
drop function if exists public.get_current_family_children();

create function public.get_current_family_children()
returns table (
  family_id uuid,
  family_display_name text,
  student_id text,
  student_first_name text,
  student_last_name text,
  club_id text,
  student_birthdate date,
  student_age integer,
  student_gender text,
  sport_id text,
  sport_name text,
  gruppe_id text,
  group_name text,
  training_day text,
  training_time text,
  belt_color text,
  kyu_grade text,
  contract_status text,
  contract_date date,
  telefon text,
  email text,
  aktuelles_gewicht numeric,
  foto_url text,
  trainer_names text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id as family_id,
    f.display_name as family_display_name,
    s.id::text as student_id,
    s.vorname as student_first_name,
    s.nachname as student_last_name,
    fs.club_id as club_id,
    s.geburtsdatum as student_birthdate,
    s.alter as student_age,
    s.geschlecht as student_gender,
    s.sport_id as sport_id,
    sp.name as sport_name,
    s.gruppe_id as gruppe_id,
    gr.gruppenname as group_name,
    gr.trainingstag as training_day,
    gr.trainingszeit as training_time,
    s.guertelfarbe as belt_color,
    s.kyu_grad as kyu_grade,
    s.vertrag_status as contract_status,
    s.vertrag_datum as contract_date,
    s.telefon,
    s.email,
    s.aktuelles_gewicht,
    s.foto_url,
    (
      select string_agg(distinct tg.trainer_name, ', ' order by tg.trainer_name)
      from public.trainer_groups tg
      where tg.club_id = s.club_id
        and tg.gruppe_id = any (
          select trim(g)
          from regexp_split_to_table(coalesce(s.gruppe_id, ''), '[;,]') as g
          where trim(g) <> ''
        )
    ) as trainer_names
  from public.family_guardians fg
  join public.family_students fs
    on fs.family_id = fg.family_id
   and fs.status = 'active'
  join public.families f
    on f.id = fg.family_id
   and f.status = 'active'
  join public.students s
    on s.id = fs.student_id
  left join public.sports sp
    on sp.sport_id = s.sport_id
  left join public.groups gr
    on gr.gruppe_id = s.gruppe_id
  where fg.auth_user_id = (select auth.uid())
  order by fs.linked_at asc, s.id asc;
$$;

comment on function public.get_current_family_children() is
  'SECURITY DEFINER: активные дети текущей семьи (fg.auth_user_id = auth.uid()) — доступ НЕ расширен, тот же JOIN family_guardians/family_students(active)/families(active), что и раньше. Расширено миграцией 20260916160059 тем же набором полей и тем же способом, что get_trainer_student_by_id (см. её comment) — telefon/email/aktuelles_gewicht/foto_url/trainer_names.';

revoke all on function public.get_current_family_children() from public;
revoke all on function public.get_current_family_children() from anon;
grant execute on function public.get_current_family_children() to authenticated;
