-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- НАЗНАЧЕНИЕ: Phase 2 задачи "Student Page Access / Subscription
-- Management" — точечное подключение существующих Student Page-specific
-- server-side точек к public.can_family_access_student_page(bigint)/
-- public.can_trainer_access_student_page(bigint) (migration
-- 20260919100064, уже применена и полностью проверена в production).
--
-- can_family_access_student(bigint)/can_trainer_access_student(bigint) —
-- НЕ изменяются этой миграцией ни на строку. Остаются чистыми relationship
-- helper'ами, как и сегодня.
--
-- ══════════════════════════════════════════════════════════════════════
-- FRONTEND-CONSUMER АУДИТ ПЕРЕД ЭТОЙ МИГРАЦИЕЙ (см. итоговый отчёт задачи)
-- ══════════════════════════════════════════════════════════════════════
--
-- Найдены ДВА структурно РАЗНЫХ класса Student Page server-side точек —
-- поэтому эта миграция применяет к ним ДВЕ РАЗНЫЕ стратегии, не одну:
--
-- КЛАСС 1 — "page-level loader" (get_current_family_children,
-- get_trainer_student_by_id): их результат управляет ВИДИМОСТЬЮ
-- профиля/ребёнка целиком, и у КАЖДОГО из них уже сегодня существует
-- НЕТРИВИАЛЬНОЕ поведение на "0 строк":
--   • FamilyDashboard.jsx: isEmptyAfterRealLoad = children.length===0 ->
--     АВТОМАТИЧЕСКИ signOutFamily() + markFamilyAccessDeactivated()
--     (see FamilyDashboard.jsx) — это ДЕСТРУКТИВНОЕ действие с ВВОДЯЩИМ В
--     ЗАБЛУЖДЕНИЕ уведомлением "семья деактивирована", если истёк срок
--     ОДНОГО ребёнка (а не вся семья технически suspended). Для
--     multi-child семьи (схема это разрешает, см. архитектурный аудит)
--     истёкший ребёнок вообще молча исчез бы из списка без объяснения.
--   • TrainerStudentPage.jsx: student===null -> статичный, НЕДЕСТРУКТИВНЫЙ
--     t('trainerTechniques.accessDenied') — безопасно деградирует уже
--     сегодня, НО conflate'ит "не мой ученик" и "мой ученик, Student Page
--     заблокирована" в одно и то же сообщение — задание прямо просит
--     уметь ИХ РАЗЛИЧАТЬ для будущего UI.
-- ВЫВОД: прямое переключение WHERE/access-gate ЭТИХ ДВУХ функций на
-- combined wrapper НЕБЕЗОПАСНО (Family) или архитектурно неверно
-- (Trainer, теряет различимость причины). Поэтому ЭТА МИГРАЦИЯ:
--   - НЕ меняет relationship-based включение строки в результат
--     (get_current_family_children/get_trainer_student_by_id по-прежнему
--     возвращают строку/0 строк ИСКЛЮЧИТЕЛЬНО по
--     can_family_access_student/can_trainer_access_student, БЕЗ ИЗМЕНЕНИЙ);
--   - ДОБАВЛЯЕТ additive-only колонки (subscription_managed/access_until/
--     manual_disabled/is_expired/days_remaining/warning_active/
--     *_subscription_allows_access), вычисленные через
--     public.get_student_page_access(s.id) (SECURITY DEFINER chain,
--     EXECUTE не требуется authenticated — вызывается изнутри, тем же
--     принципом, что уже подтверждён в 20260918140063/20260919100064).
-- Существующий frontend (familyDataService.js/trainerStudentsService.js)
-- деструктурирует поля ПО ИМЕНИ — новые колонки НЕ читаются существующим
-- кодом и НИКАК не влияют на сегодняшнее поведение (подтверждено чтением
-- обоих файлов перед этой миграцией). Ни одно существующее поле не
-- переименовано/не удалено/не сменило тип.
--
-- КЛАСС 2 — "leaf Student-Page-specific content/actions"
-- (get_family_required_techniques/get_trainer_required_techniques,
-- student_technique_records SELECT/INSERT/DELETE,
-- student-technique-videos Storage INSERT/DELETE/SELECT×2): здесь
-- ПРЯМОЕ переключение access-gate на combined wrapper БЕЗОПАСНО СЕЙЧАС,
-- backend-only, без синхронного frontend-изменения:
--   • get_family_required_techniques/get_trainer_required_techniques:
--     отказ в доступе УЖЕ СЕГОДНЯ возвращает тот же самый
--     v_empty_result = {status:'no_current_kyu', techniques:[]}, что и
--     любой relationship-отказ — RequiredTechniquesSection.jsx уже
--     рендерит этот статус НЕЙТРАЛЬНО (t('requiredTechniques.
--     noCurrentKyu')), без ошибки/креша — НИКАКОГО нового UI-состояния не
--     появляется, переиспользуется уже существующий, уже протестированный
--     путь.
--   • student_technique_records (SELECT/INSERT/DELETE) и
--     student-technique-videos (INSERT/DELETE/SELECT-trainer) — проверено
--     прямым поиском по src/pages: ни MarkTechniqueCompletedModal, ни
--     CompletedTechniquesList, ни JudoTechniquePicker, ни
--     StudentVideoPlayerModal НЕ импортируются НИ ОДНОЙ реально
--     роутящейся страницей (TrainerStudentPage.jsx явно исключил их ранее,
--     см. её комментарий "REMOVED FROM THIS PAGE") — у этих write/storage
--     путей СЕГОДНЯ НЕТ ни одного живого frontend-потребителя вообще,
--     значит переключение их access-gate НЕ может дать пользователю
--     наблюдаемую регрессию ни при каких условиях.
--   • student-technique-videos SELECT-family — тоже без живого frontend
--     consumer'а на этом этапе (Family Portal video viewer ещё не
--     реализован, см. миграцию 20260911090050).
--
-- ══════════════════════════════════════════════════════════════════════
-- ЧТО ЭТА МИГРАЦИЯ НЕ ТРОГАЕТ (сознательно, подтверждено перед написанием)
-- ══════════════════════════════════════════════════════════════════════
-- search_trainer_students/get_current_trainer_groups/
-- get_current_trainer_write_context — не про Student Page, roster/
-- autocomplete/identity остаются полностью независимы от subscription
-- (Trainer по-прежнему находит ученика в поиске даже с истёкшей Student
-- Page — задание, T7/T8). Attendance/Gruppenverwaltung (Block 1) —
-- архитектурно независимы (подтверждено отдельным аудитом сессии), эта
-- миграция их вообще не касается — там нет ни одной ссылки на
-- can_trainer_access_student/can_family_access_student.
-- public.get_required_techniques_for_student(bigint) (миграция 063) — НЕ
-- access-check функция, не меняется ни на строку — меняются только её
-- вызывающие обёртки (см. класс 2 выше).
-- create-student-preview-token/get-student-preview/student_preview_tokens
-- — Super Admin Preview остаётся полностью независим от subscription, эта
-- миграция их не трогает вообще.
-- families.status/family_guardians/Supabase Auth ban — по-прежнему
-- ЕДИНСТВЕННЫЙ механизм полного технического отключения family login,
-- semantически отдельный от per-student subscription — не смешивается.

-- ══════════════════════════════════════════════════════════════════════
-- КЛАСС 1a — get_current_family_children(): ADDITIVE-ONLY
-- ══════════════════════════════════════════════════════════════════════
-- RETURNS TABLE меняется (новые колонки) -> DROP + CREATE, тот же приём,
-- что уже дважды использовался для этой функции (миграции 20260901100040,
-- 20260916160059). WHERE/JOIN-условия (кто вообще виден вызывающему) —
-- ПОБАЙТОВО без изменений.
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
    ) as trainer_names,
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
  where fg.auth_user_id = (select auth.uid())
  order by fs.linked_at asc, s.id asc;
$$;

comment on function public.get_current_family_children() is
  'SECURITY DEFINER: активные дети текущей семьи. ВКЛЮЧЕНИЕ строки — БЕЗ ИЗМЕНЕНИЙ, только families.status=''active''/family_students.status=''active''/fg.auth_user_id=auth.uid() (Phase 2 сознательно НЕ фильтрует по subscription — см. миграцию 20260920100065: это предотвратило бы FamilyDashboard.isEmptyAfterRealLoad от ложного срабатывания и forced sign-out при истечении ОДНОГО ребёнка). subscription_managed/access_until/manual_disabled/is_expired/days_remaining/warning_active/family_subscription_allows_access — ДОПОЛНИТЕЛЬНЫЕ additive-поля (миграция 20260920100065), вычислены через public.get_student_page_access(s.id), для будущего frontend blocked/warning UI. Существующие поля не переименованы/не удалены.';

revoke all on function public.get_current_family_children() from public;
revoke all on function public.get_current_family_children() from anon;
grant execute on function public.get_current_family_children() to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- КЛАСС 1b — get_trainer_student_by_id(bigint): ADDITIVE-ONLY
-- ══════════════════════════════════════════════════════════════════════
-- Access-gate (can_trainer_access_student) — БЕЗ ИЗМЕНЕНИЙ: Trainer
-- по-прежнему видит профиль своего ученика (roster/поиск/просмотр
-- карточки) независимо от subscription — блокируется только КОНКРЕТНЫЙ
-- Student-Page-specific контент (Required Techniques/completion/видео,
-- класс 2 ниже), не сама видимость профиля. Тот же RETURNS TABLE DROP +
-- CREATE приём, что и раньше (миграции 20260911090049/20260915130056/
-- 20260916160059).
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
  trainer_names text,
  subscription_managed boolean,
  access_until date,
  manual_disabled boolean,
  is_expired boolean,
  days_remaining integer,
  warning_active boolean,
  trainer_subscription_allows_access boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not public.can_trainer_access_student(p_student_id) then
    -- Нет доступа (или нет активной тренерской сессии вовсе) -> 0 строк,
    -- не ошибка — без изменений, тот же анти-enumeration принцип.
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
    ) as trainer_names,
    (spa.access ->> 'subscriptionManaged')::boolean,
    (spa.access ->> 'accessUntil')::date,
    (spa.access ->> 'manualDisabled')::boolean,
    (spa.access ->> 'isExpired')::boolean,
    (spa.access ->> 'daysRemaining')::integer,
    (spa.access ->> 'warningActive')::boolean,
    (spa.access ->> 'trainerSubscriptionAllowsAccess')::boolean
  from public.students s
  left join public.sports sp on sp.sport_id = s.sport_id
  left join public.groups gr on gr.gruppe_id = s.gruppe_id
  cross join lateral (select public.get_student_page_access(s.id) as access) spa
  where s.id = p_student_id;
end;
$$;

comment on function public.get_trainer_student_by_id(bigint) is
  'SECURITY DEFINER: профиль ОДНОГО ученика — access-gate БЕЗ ИЗМЕНЕНИЙ (can_trainer_access_student(p_student_id), не combined wrapper — Trainer сохраняет видимость профиля независимо от subscription, только Student-Page-specific КОНТЕНТ блокируется отдельно, см. миграцию 20260920100065). subscription_managed/access_until/manual_disabled/is_expired/days_remaining/warning_active/trainer_subscription_allows_access — additive-поля для будущего blocked/warning UI, вычислены через public.get_student_page_access(p_student_id). Существующие поля не переименованы/не удалены.';

revoke all on function public.get_trainer_student_by_id(bigint) from public;
revoke all on function public.get_trainer_student_by_id(bigint) from anon;
grant execute on function public.get_trainer_student_by_id(bigint) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- КЛАСС 2a — get_family_required_techniques/get_trainer_required_techniques:
-- ПРЯМОЕ переключение access-gate на combined wrapper
-- ══════════════════════════════════════════════════════════════════════
-- Единственное изменение в теле каждой функции — заменена ОДНА строка
-- access-check (can_family_access_student -> can_family_access_student_page,
-- can_trainer_access_student -> can_trainer_access_student_page).
-- get_required_techniques_for_student (calculator, миграция 063) — БЕЗ
-- ИЗМЕНЕНИЙ. Сигнатура/RETURNS/response contract/anti-enumeration/grants
-- — без изменений (CREATE OR REPLACE с идентичной формой сохраняет
-- существующие grants).
create or replace function public.get_family_required_techniques(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_empty_result jsonb := jsonb_build_object(
    'currentKyu', null, 'nextKyu', null, 'status', 'no_current_kyu', 'techniques', '[]'::jsonb
  );
begin
  if (select auth.uid()) is null then
    return v_empty_result;
  end if;

  if not public.can_family_access_student_page(p_student_id) then
    return v_empty_result;
  end if;

  return public.get_required_techniques_for_student(p_student_id);
end;
$$;

comment on function public.get_family_required_techniques(bigint) is
  'Family read-path для "Необходимые техники". Access-gate — public.can_family_access_student_page(bigint) (миграция 20260920100065: relationship AND Student Page subscription allows access), вместо relationship-only can_family_access_student. Отказ (relationship ИЛИ subscription) даёт ТОТ ЖЕ anti-enumeration v_empty_result, что и раньше — RequiredTechniquesSection уже рендерит его нейтрально, новое UI-состояние не появляется.';

create or replace function public.get_trainer_required_techniques(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_empty_result jsonb := jsonb_build_object(
    'currentKyu', null, 'nextKyu', null, 'status', 'no_current_kyu', 'techniques', '[]'::jsonb
  );
begin
  if (select auth.uid()) is null then
    return v_empty_result;
  end if;

  if not public.can_trainer_access_student_page(p_student_id) then
    return v_empty_result;
  end if;

  return public.get_required_techniques_for_student(p_student_id);
end;
$$;

comment on function public.get_trainer_required_techniques(bigint) is
  'Trainer read-path для "Необходимые техники". Access-gate — public.can_trainer_access_student_page(bigint) (миграция 20260920100065), вместо relationship-only can_trainer_access_student — учитывает trainer_access_after_expiry. Отказ даёт ТОТ ЖЕ anti-enumeration v_empty_result, что и раньше.';

-- ══════════════════════════════════════════════════════════════════════
-- КЛАСС 2b — student_technique_records: ПРЯМОЕ переключение RLS
-- ══════════════════════════════════════════════════════════════════════
-- Нет живого frontend-потребителя на этом этапе (см. шапку файла) —
-- ужесточение проходит НЕЗАМЕТНО для сегодняшнего production UI. Имена
-- policy, роль, команда — БЕЗ ИЗМЕНЕНИЙ, меняется только вызываемая
-- функция внутри USING/WITH CHECK.
drop policy if exists student_technique_records_select_own_students on public.student_technique_records;
create policy student_technique_records_select_own_students
  on public.student_technique_records
  for select
  to authenticated
  using (public.can_trainer_access_student_page(student_id));

drop policy if exists student_technique_records_insert_own_students on public.student_technique_records;
create policy student_technique_records_insert_own_students
  on public.student_technique_records
  for insert
  to authenticated
  with check (
    public.can_trainer_access_student_page(student_id)
    and completed_by = private.current_trainer_row_id()
  );

drop policy if exists student_technique_records_delete_own_students on public.student_technique_records;
create policy student_technique_records_delete_own_students
  on public.student_technique_records
  for delete
  to authenticated
  using (public.can_trainer_access_student_page(student_id));

comment on policy student_technique_records_select_own_students on public.student_technique_records is
  'Тренер видит записи только тех учеников, к которым у него есть доступ ПРЯМО СЕЙЧАС: relationship AND Student Page subscription (public.can_trainer_access_student_page, миграция 20260920100065 — учитывает manual_disabled/trainer_access_after_expiry). Сегодня без живого frontend-потребителя (см. миграцию 065) — ужесточение не наблюдаемо в production UI.';
comment on policy student_technique_records_insert_own_students on public.student_technique_records is
  'Тренер может создать запись только (а) при Student Page access (public.can_trainer_access_student_page — relationship AND subscription), И (б) с completed_by = его собственный trainers.id. Миграция 20260920100065.';
comment on policy student_technique_records_delete_own_students on public.student_technique_records is
  'Тренер может удалить запись только при Student Page access (public.can_trainer_access_student_page). Миграция 20260920100065.';

-- ══════════════════════════════════════════════════════════════════════
-- КЛАСС 2c — student-technique-videos (storage.objects): ПРЯМОЕ
-- переключение Storage policies
-- ══════════════════════════════════════════════════════════════════════
-- Только 4 policy этого КОНКРЕТНОГО private-бакета (миграция
-- 20260911090050) — public judo-techniques bucket/catalog images и любые
-- другие buckets НЕ затрагиваются вообще.
drop policy if exists student_technique_videos_insert_trainer on storage.objects;
create policy student_technique_videos_insert_trainer
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'student-technique-videos'
    and public.can_trainer_access_student_page(private.storage_object_student_id(name))
  );

drop policy if exists student_technique_videos_delete_trainer on storage.objects;
create policy student_technique_videos_delete_trainer
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'student-technique-videos'
    and public.can_trainer_access_student_page(private.storage_object_student_id(name))
  );

drop policy if exists student_technique_videos_select_trainer on storage.objects;
create policy student_technique_videos_select_trainer
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'student-technique-videos'
    and public.can_trainer_access_student_page(private.storage_object_student_id(name))
  );

drop policy if exists student_technique_videos_select_family on storage.objects;
create policy student_technique_videos_select_family
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'student-technique-videos'
    and public.can_family_access_student_page(private.storage_object_student_id(name))
  );

comment on policy student_technique_videos_insert_trainer on storage.objects is
  'Тренер загружает видео только при Student Page access (public.can_trainer_access_student_page, миграция 20260920100065). Без живого frontend-потребителя на этом этапе.';
comment on policy student_technique_videos_delete_trainer on storage.objects is
  'Тренер удаляет видео только при Student Page access (public.can_trainer_access_student_page, миграция 20260920100065).';
comment on policy student_technique_videos_select_trainer on storage.objects is
  'Тренер читает видео только при Student Page access (public.can_trainer_access_student_page, миграция 20260920100065).';
comment on policy student_technique_videos_select_family on storage.objects is
  'Family читает видео СВОЕГО ученика только при Student Page access (public.can_family_access_student_page, миграция 20260920100065). Без живого frontend-потребителя на этом этапе (Family Portal video viewer ещё не реализован).';
