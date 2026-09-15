-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION.
--
-- НАЗНАЧЕНИЕ: закрывает найденное окно безопасности — после
-- manage-family-account/deactivate уже выданный (ещё не истёкший) access
-- token семьи мог продолжать читать family/student data, потому что
-- существующие secure RPC/RLS проверяли ТОЛЬКО auth.uid() (кто вызывает) и
-- family_students.status (какой ребёнок привязан), но не families.status
-- (сама семья активна ли вообще). families.status при этом УЖЕ пишется
-- корректно и атомарно самим deactivate/activate (manage-family-account,
-- действие activate/deactivate) — этой миграцией НЕ меняется ничего в
-- Edge Function, только то, как читающая сторона его использует.
--
-- SOURCE OF TRUTH: families.status — единственные два значения уже
-- зафиксированы CHECK-ограничением в migration 20260720120001
-- (status in ('active','suspended')) — новые статусы здесь не вводятся.
--
-- ЧТО МЕНЯЕТСЯ — ровно два места, ОБА уже существующие (не новые
-- сущности), CREATE OR REPLACE FUNCTION с идентичной сигнатурой/типом
-- возврата (DROP не требуется):
--   1) public.can_family_access_student(bigint) — единственный общий
--      access-check helper семейного слоя (migration 20260720120002),
--      уже сегодня напрямую вызываемый authenticated-сессией семьи
--      (см. migration 20260829120002 — grant для authenticated сохранён
--      намеренно) и используемый Storage RLS-policy
--      student_technique_videos_select_family (migration
--      20260911090050, ещё не применена к production) и старым RPC
--      get_student_technique_progress (migration 20260720120006,
--      подтверждено ранее в этом проекте НЕ применённым к production —
--      исправление здесь готовит helper к моменту, когда любой из этих
--      путей реально появится в production, без повторной миграции).
--   2) public.get_current_family_children() — единственный РЕАЛЬНО живой
--      в production family-facing read path, возвращающий данные
--      ученика (migration 20260720120010 + 20260901100040). Это и есть
--      RPC, который FamilyDashboard вызывает сегодня.
--
-- ЧТО НЕ МЕНЯЕТСЯ (сознательно, см. итоговый отчёт задачи):
--   - RLS-policies families_select_own/family_guardians_select_own_family/
--     family_students_select_own_family (migration 20260720120003) —
--     прямой SELECT этих трёх таблиц отдаёт только служебные строки
--     связи (id/family_id/student_id/nickname), НЕ профиль ученика
--     (students/sports/groups) — то же наблюдение, что уже
--     задокументировано для родственной ситуации в
--     LOCAL_SUPABASE_TEST_PLAN.md. Реальный "читает данные ученика" путь
--     — это RPC/Storage выше, не эти три policy.
--   - public.students/public.trainers RLS — чужая (JCL_Gruppen) таблица,
--     её RLS-политики этим проектом не создаются и не трогаются здесь;
--     уже задокументированная (LOCAL_SUPABASE_TEST_PLAN.md, "Побочная
--     находка") открытая RLS на этих таблицах — отдельный, вне рамок
--     этой задачи риск на стороне Block 1, не новый и не созданный этой
--     миграцией.
--   - Edge Function manage-family-account — activate/deactivate уже
--     сегодня корректно и атомарно пишет families.status при КАЖДОМ
--     вызове (проверено чтением кода), править нечего.

-- ── 1) can_family_access_student(bigint) ────────────────────────────────
-- Добавлена JOIN на families с условием status = 'active' — семья должна
-- быть одновременно (а) владеть guardian'ом текущего auth.uid() И (б) быть
-- активной, ТОЛЬКО ТОГДА доступ к конкретному student_id разрешён. Условие
-- family_students.status = 'active' сохранено БЕЗ ИЗМЕНЕНИЙ (п.6 задания —
-- одно не заменяет другое, оба обязательны одновременно).
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
    join public.families f
      on f.id = fg.family_id
     and f.status = 'active'
    join public.family_students fs
      on fs.family_id = fg.family_id
     and fs.status = 'active'
    where fg.auth_user_id = auth.uid()
      and fs.student_id = p_student_id
  );
$$;

comment on function public.can_family_access_student(bigint) is
  'true, если auth.uid() — guardian АКТИВНОЙ семьи (families.status=''active''), активно связанной с p_student_id (family_students.status=''active''). false для чужой семьи, другого клуба, анонимного пользователя, деактивированной семьи ИЛИ деактивированной привязки конкретного ребёнка — оба условия обязательны одновременно (миграция 20260914110055).';

-- Явный REVOKE/GRANT не нужен здесь заново — CREATE OR REPLACE FUNCTION с
-- идентичной сигнатурой сохраняет ранее выданные привилегии (уже
-- корректно настроены migration 20260720120002 + 20260829120002).

-- ── 2) get_current_family_children() ────────────────────────────────────
-- Единственное изменение — добавлено условие f.status = 'active' к уже
-- существующему JOIN на families (было: просто "on f.id = fg.family_id").
-- Сигнатура/RETURNS TABLE/список колонок/порядок JOIN'ов и остальные
-- условия — БЕЗ ИЗМЕНЕНИЙ (минимальный диф от версии
-- 20260901100040_get_current_family_children_add_student_profile.sql).
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
  contract_date date
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
    s.vertrag_datum as contract_date
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
  'SECURITY DEFINER: семья + активные дети текущего auth.uid() (без параметров — student_id/family_id-подмена структурно невозможна). Требует ОДНОВРЕМЕННО families.status=''active'' И family_students.status=''active'' (миграция 20260914110055) — уже выданный, ещё не истёкший access token суспендированной семьи с этого момента получает пустой результат при следующем вызове, а не устаревшие данные ученика. student_id как text (защита точности bigint). Содержит ТОЛЬКО Block-1 базовые Student-профиль поля (students/groups/sports) — тренерские данные (техники, прогресс, экзамен) сюда не входят.';

-- Явный REVOKE/GRANT не нужен — сигнатура/RETURNS TABLE не изменились,
-- CREATE OR REPLACE FUNCTION сохраняет уже выданные ранее привилегии
-- (revoke public/anon + grant authenticated, migration 20260901100040).
