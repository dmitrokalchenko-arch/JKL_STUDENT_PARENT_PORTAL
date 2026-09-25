-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- НАЗНАЧЕНИЕ: security follow-up к этапу 1 "Необходимые техники по блокам +
-- Family Student Page gate". Frontend уже не открывает неактивную Student
-- Page; эта миграция закрывает единственный оставшийся Family server-side
-- путь к платному контенту Student Page в ФАКТИЧЕСКОЙ production-схеме —
-- профиль ребёнка в public.get_current_family_children().
--
-- ПЕРЕРАБОТАНО после read-only production reconciliation (2026-09-25).
-- Первая версия этого файла дополнительно меняла
-- get_student_technique_progress, RLS student_technique_progress и Storage
-- policy technique-videos — это объекты НЕ развёрнутого модуля миграций
-- 20260720120004-007 (намеренно не применялись, см.
-- 20260720120009/20260829120001/20260908130043). В production их нет:
-- ни таблицы student_technique_progress, ни RPC get_student_technique_progress,
-- ни club_belts/club_techniques/..., ни buckets technique-videos/
-- technique-images. Эти части удалены: миграция НЕ создаёт и НЕ трогает
-- старый модуль и НЕ делает 004-007 своей предпосылкой.
--
-- Используется СУЩЕСТВУЮЩАЯ authoritative логика подписки (migration
-- 20260919100064, в production), второй механизм НЕ создаётся, expiry
-- заново НЕ считается:
--   public.get_student_page_access(bigint) ->> 'familySubscriptionAllowsAccess'
--   manual_disabled — высший приоритет; нет строки student_page_access ИЛИ
--   access_until IS NULL -> активна; managed + истёк -> не активна;
--   trainer_access_after_expiry на Family НЕ влияет. Semantics не меняются.
--
-- КАРТА FAMILY-ПУТЕЙ ФАКТИЧЕСКОЙ PRODUCTION-АРХИТЕКТУРЫ (аудит перед этой версией):
--   get_current_family_children()     — shell + профиль, профиль НЕ гейтится -> ИЗМЕНЯЕТСЯ здесь
--   get_family_required_techniques()  — уже can_family_access_student_page (065), источник
--                                       club_kyu_program_items -> НЕ трогается
--   get_family_student_page_config()  — club-wide настройки, не per-student -> НЕ трогается
--   student_technique_records         — только Trainer-policies (065), у Family нет SELECT-policy -> НЕ трогается
--   storage student-technique-videos  — Family SELECT уже can_family_access_student_page (065) -> НЕ трогается
--   get_student_technique_progress / student_technique_progress /
--   technique-videos / technique-images — В PRODUCTION НЕ СУЩЕСТВУЮТ -> НЕ трогаются
--
-- ЗАВИСИМОСТИ (все подтверждены read-only в production): public.families,
-- family_guardians, family_students, students, sports, groups,
-- trainer_groups, public.get_student_page_access(bigint) (064), текущая
-- форма RETURNS TABLE get_current_family_children (065,
-- family_subscription_allows_access присутствует).
--
-- TRAINER / SUPER ADMIN: ни одна Trainer-функция/policy и ни один
-- service_role-путь (get-student-preview) здесь не меняются.
--
-- GRANTS: CREATE OR REPLACE с идентичной сигнатурой/RETURNS сохраняет
-- существующие привилегии; ни один grant не добавляется и не расширяется.

-- ══════════════════════════════════════════════════════════════════════
-- get_current_family_children(): строка ребёнка ОСТАЁТСЯ, профиль
-- ребёнка с неактивной Student Page — NULL
-- ══════════════════════════════════════════════════════════════════════
-- Включение строки — побайтово как в 065 (families.status/
-- family_students.status/auth.uid()), НЕ фильтруется по подписке: Family
-- Account ↔ Child не зависит от Student Page (BUSINESS_RULES п.33), и
-- FamilyDashboard.isEmptyAfterRealLoad при 0 строк выполняет forced
-- sign-out — фильтр строк здесь недопустим.
--
-- A — Family Account shell, отдаётся ВСЕГДА: family_id,
--   family_display_name, student_id, student_first_name,
--   student_last_name, club_id + access-поля (subscription_managed,
--   access_until, manual_disabled, is_expired, days_remaining,
--   warning_active, family_subscription_allows_access) — нужны, чтобы
--   показать ребёнка в выборе и метку "Не активна".
-- B — профиль Student Page (дата рождения/возраст/пол/спорт/группа/
--   расписание/пояс/Kyu/договор/телефон/email/вес/фото/тренеры) — NULL,
--   если familySubscriptionAllowsAccess != true. RETURNS TABLE не меняется
--   (CREATE OR REPLACE допустим, frontend читает поля по имени).
create or replace function public.get_current_family_children()
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
  trainer_names text,
  subscription_managed boolean,
  access_until date,
  manual_disabled boolean,
  is_expired boolean,
  days_remaining integer,
  warning_active boolean,
  family_subscription_allows_access boolean
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    f.id as family_id,
    f.display_name as family_display_name,
    s.id::text as student_id,
    s.vorname as student_first_name,
    s.nachname as student_last_name,
    fs.club_id as club_id,
    case when pa.allowed then s.geburtsdatum end as student_birthdate,
    case when pa.allowed then s.alter end as student_age,
    case when pa.allowed then s.geschlecht end as student_gender,
    case when pa.allowed then s.sport_id end as sport_id,
    case when pa.allowed then sp.name end as sport_name,
    case when pa.allowed then s.gruppe_id end as gruppe_id,
    case when pa.allowed then gr.gruppenname end as group_name,
    case when pa.allowed then gr.trainingstag end as training_day,
    case when pa.allowed then gr.trainingszeit end as training_time,
    case when pa.allowed then s.guertelfarbe end as belt_color,
    case when pa.allowed then s.kyu_grad end as kyu_grade,
    case when pa.allowed then s.vertrag_status end as contract_status,
    case when pa.allowed then s.vertrag_datum end as contract_date,
    case when pa.allowed then s.telefon end as telefon,
    case when pa.allowed then s.email end as email,
    case when pa.allowed then s.aktuelles_gewicht end as aktuelles_gewicht,
    case when pa.allowed then s.foto_url end as foto_url,
    case when pa.allowed then (
      select string_agg(distinct tg.trainer_name, ', ' order by tg.trainer_name)
      from public.trainer_groups tg
      where tg.club_id = s.club_id
        and tg.gruppe_id = any (
          select trim(g)
          from regexp_split_to_table(coalesce(s.gruppe_id, ''), '[;,]') as g
          where trim(g) <> ''
        )
    ) end as trainer_names,
    (spa.access ->> 'subscriptionManaged')::boolean as subscription_managed,
    (spa.access ->> 'accessUntil')::date as access_until,
    (spa.access ->> 'manualDisabled')::boolean as manual_disabled,
    (spa.access ->> 'isExpired')::boolean as is_expired,
    (spa.access ->> 'daysRemaining')::integer as days_remaining,
    (spa.access ->> 'warningActive')::boolean as warning_active,
    (spa.access ->> 'familySubscriptionAllowsAccess')::boolean as family_subscription_allows_access
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
  cross join lateral (select public.get_student_page_access(s.id) as access) spa
  cross join lateral (
    select coalesce((spa.access ->> 'familySubscriptionAllowsAccess')::boolean, false) as allowed
  ) pa
  where fg.auth_user_id = (select auth.uid())
  order by fs.linked_at asc, s.id asc;
$$;

comment on function public.get_current_family_children() is
  'SECURITY DEFINER: активные дети текущей семьи. ВКЛЮЧЕНИЕ строки — только families.status=''active''/family_students.status=''active''/fg.auth_user_id=auth.uid(), по подписке НЕ фильтруется (Family Account ↔ Child не зависит от Student Page; 0 строк вызывает forced sign-out во FamilyDashboard). Family Account shell (family_id/family_display_name/student_id/имя/club_id) и access-поля (subscription_managed/access_until/manual_disabled/is_expired/days_remaining/warning_active/family_subscription_allows_access, через public.get_student_page_access) отдаются всегда. Профиль Student Page (все остальные колонки) — NULL, если familySubscriptionAllowsAccess != true (миграция 20260929110075).';
