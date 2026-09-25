-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- НАЗНАЧЕНИЕ: security follow-up к этапу 1 "Необходимые техники по блокам +
-- Family Student Page gate". Frontend уже не открывает неактивную Student
-- Page, но несколько Family server-side путей всё ещё проверяли ТОЛЬКО
-- relationship (can_family_access_student), без подписки — прямой RPC/REST
-- вызов семьёй отдавал платный Student Page content ребёнка с неактивной
-- страницей. Эта миграция переводит их на СУЩЕСТВУЮЩУЮ authoritative
-- логику (migration 20260919100064), второй subscription-механизм НЕ
-- создаётся, expiry заново НЕ считается:
--   public.can_family_access_student_page(bigint)
--     = can_family_access_student AND get_student_page_access(...)
--       .familySubscriptionAllowsAccess
--   get_student_page_access: manual_disabled — высший приоритет; нет строки
--   ИЛИ access_until IS NULL -> активна; managed + истёк -> не активна;
--   trainer_access_after_expiry на Family НЕ влияет. Semantics не меняются.
--
-- КАРТА FAMILY-ПУТЕЙ (аудит перед миграцией):
--   get_current_family_children()       — shell (A) + профиль (B)  -> ИЗМЕНЯЕТСЯ (1)
--   get_student_technique_progress()    — B, relationship-only    -> ИЗМЕНЯЕТСЯ (2)
--   student_technique_progress (RLS)    — B, прямой SELECT granted -> ИЗМЕНЯЕТСЯ (3)
--   storage technique-videos (SELECT)   — B, видео ученика        -> ИЗМЕНЯЕТСЯ (4)
--   get_family_required_techniques()    — B, уже can_family_access_student_page (065), НЕ трогается
--   storage student-technique-videos    — B, уже can_family_access_student_page (065), НЕ трогается
--   get_family_student_page_config()    — club-wide настройки, не per-student, НЕ трогается
--   storage technique-images, club_* каталоги (is_family_in_club) — каталог клуба, не per-student, НЕ трогается
--   families/family_guardians/family_students — Family Account metadata, НЕ трогается
--
-- TRAINER: ни одна Trainer-функция/policy здесь не меняется
-- (get_trainer_student_by_id, get_trainer_required_techniques,
-- student_technique_records, trainer storage policies — без изменений).
-- get_student_technique_progress и student_technique_progress Trainer не
-- использует (только Family, src/services/techniqueProgressService.js).
-- Super Admin Preview (get-student-preview, service_role) не использует
-- ни одну из изменяемых функций/policy для профиля/прогресса.
--
-- GRANTS: CREATE OR REPLACE с идентичной сигнатурой/RETURNS сохраняет
-- существующие привилегии; ни один grant не расширяется. Policy меняются
-- только выражением USING (роль/команда/имя — прежние).

-- ══════════════════════════════════════════════════════════════════════
-- (1) get_current_family_children(): строка ребёнка ОСТАЁТСЯ, профиль
--     ребёнка с неактивной Student Page — NULL
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

-- ══════════════════════════════════════════════════════════════════════
-- (2) get_student_technique_progress(): access-check -> *_student_page
-- ══════════════════════════════════════════════════════════════════════
-- Тело побайтово как в 20260720120006, изменена ТОЛЬКО одна строка
-- access-check. Формат отказа — прежний (exception 42501 access_denied),
-- поэтому существующий frontend обрабатывает его как и раньше.
create or replace function public.get_student_technique_progress(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_club_id text;
  v_belt_id uuid;
  v_settings record;
  v_belt_override record;
  v_feature_enabled boolean;
  v_bonus_requirement integer;
  v_bonus_points integer;
  v_belt jsonb;
  v_techniques jsonb;
begin
  -- Пункт 9 задания: функция сама проверяет доступ, подстановка чужого
  -- student_id ничего не возвращает — доступ отклоняется явной ошибкой,
  -- а не тихим пустым ответом (чтобы не путать "нет доступа" с "нет данных").
  -- Миграция 20260929110075: relationship И активная Student Page.
  if not public.can_family_access_student_page(p_student_id) then
    raise exception 'access_denied: current user cannot access student %', p_student_id
      using errcode = '42501';
  end if;

  select club_id into v_club_id from public.students where id = p_student_id;

  select * into v_settings
  from public.club_technique_progress_settings
  where club_id = v_club_id;

  v_belt_id := public.resolve_student_current_belt(p_student_id);

  select * into v_belt_override
  from public.club_belt_technique_settings
  where club_id = v_club_id and belt_id = v_belt_id;

  v_feature_enabled := coalesce(v_belt_override.feature_enabled, v_settings.feature_enabled, false);
  v_bonus_requirement := coalesce(v_belt_override.bonus_requirement, v_settings.default_bonus_requirement, 5);
  v_bonus_points := coalesce(v_belt_override.bonus_points, v_settings.bonus_points);

  if v_belt_id is not null then
    select jsonb_build_object('id', cb.id, 'name', cb.name, 'color', cb.color_hex)
    into v_belt
    from public.club_belts cb
    where cb.id = v_belt_id;
  end if;

  -- featureEnabled=false или отсутствие набора техник пояса -> пустой массив,
  -- не ошибка (пункт 9 задания).
  if not v_feature_enabled or v_club_id is null or v_belt_id is null then
    v_techniques := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ct.id,
        'name', ct.name,
        'category', ct.category,
        'status', case when stp.id is null then 'required' else 'completed' end,
        'imagePath', ct.image_path,
        'videoPath', stp.video_path,
        'completedAt', stp.completed_at,
        'trainerComment', stp.trainer_comment
      )
      order by cbt.sort_order
    ), '[]'::jsonb)
    into v_techniques
    from public.club_belt_techniques cbt
    join public.club_techniques ct on ct.id = cbt.technique_id
    left join public.student_technique_progress stp
      on stp.student_id = p_student_id
     and stp.technique_id = cbt.technique_id
     and stp.belt_id = cbt.belt_id
    where cbt.belt_id = v_belt_id
      and cbt.club_id = v_club_id
      and ct.is_active = true;
  end if;

  return jsonb_build_object(
    'featureEnabled', v_feature_enabled,
    'bonusRequirement', v_bonus_requirement,
    'bonusPoints', v_bonus_points,
    'belt', v_belt,
    'techniques', v_techniques
  );
end;
$$;

comment on function public.get_student_technique_progress(bigint) is
  'Единая точка чтения для семейной страницы. Access-check — public.can_family_access_student_page (relationship AND активная Student Page, миграция 20260929110075); отказ — exception 42501 access_denied, как и раньше. status вычисляется из ЕДИНОГО источника (наличие/отсутствие student_technique_progress), сортировка по club_belt_techniques.sort_order. videoPath — только Storage path, не подписанная ссылка. p_student_id — bigint (students.id).';

-- ══════════════════════════════════════════════════════════════════════
-- (3) student_technique_progress: RLS SELECT (прямой grant select to
--     authenticated, migration 20260829120001) -> *_student_page
-- ══════════════════════════════════════════════════════════════════════
drop policy if exists student_technique_progress_select_own_children on public.student_technique_progress;
create policy student_technique_progress_select_own_children
  on public.student_technique_progress
  for select
  to authenticated
  using (public.can_family_access_student_page(student_id));

comment on policy student_technique_progress_select_own_children on public.student_technique_progress is
  'Family читает прогресс СВОЕГО ученика только при активной Student Page (public.can_family_access_student_page — relationship AND subscription, миграция 20260929110075).';

-- ══════════════════════════════════════════════════════════════════════
-- (4) storage technique-videos (видео прогресса ученика, путь
--     {club_id}/{student_id}/...) -> *_student_page
-- ══════════════════════════════════════════════════════════════════════
drop policy if exists technique_videos_select_own_children on storage.objects;
create policy technique_videos_select_own_children
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'technique-videos'
    and public.can_family_access_student_page( ( (storage.foldername(name))[2] )::bigint )
  );
