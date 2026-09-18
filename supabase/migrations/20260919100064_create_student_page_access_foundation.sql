-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- НАЗНАЧЕНИЕ: Phase 1 задачи "Student Page Access / Subscription
-- Management" (см. архитектурный аудит этой же сессии) — backend-
-- фундамент: новая таблица подписки Student Page + центральный read-only
-- resolver + два boolean wrapper'а для Family/Trainer. НИКАКОЙ существующий
-- RPC/RLS/Storage policy НЕ переключается на них в этой миграции — это
-- отдельный, следующий, отдельно авторизуемый Phase 2. Edge Functions,
-- Super Admin Preview (get-student-preview/create-student-preview-token/
-- student_preview_tokens) и весь frontend — НЕ затронуты.
--
-- ГРАНУЛЯРНОСТЬ: одна строка на student_id — subscription относится к
-- Student Page КОНКРЕТНОГО ученика, не к family account (families/
-- family_students НЕ трогаются и не используются здесь) — см. аудит:
-- одна семья может иметь несколько детей с разными сроками оплаты, один
-- ученик может иметь до 2 активных семей одновременно, а Trainer-доступ
-- вообще не завязан на family-таблицы — ни одна из них не подходит по
-- гранулярности.
--
-- ПОДТВЕРЖДЁННОЕ BUSINESS RULE (backward compatibility, зафиксировано
-- пользователем перед этой миграцией): ОТСУТСТВИЕ строки для student_id
-- И access_until IS NULL — ОБА состояния означают "subscription ещё не
-- управляется" (legacy/unlimited), НЕ "истёк", НЕ "заблокирован". Ни
-- одному из существующих 40 students/3 families/3 family_students этот
-- Phase 1 не меняет фактического доступа — до тех пор, пока Super Admin
-- явно не проставит access_until конкретному ученику (что эта миграция
-- тоже не делает — backfill сознательно не выполняется, см. ниже).
--
-- ТИПЫ (read-only подтверждено перед написанием этой миграции):
--   students.id                bigint (реальный PK)
--   student_preview_tokens.student_id            bigint
--   student_preview_tokens.created_by_super_admin_id   uuid, БЕЗ formal FK
--   super_admins.id             uuid, public schema
-- updated_by_super_admin_id ниже — uuid БЕЗ formal FK на super_admins(id),
-- намеренно тот же паттерн, что уже принят в student_preview_tokens
-- (created_by_super_admin_id) — не вводится новый прецедент.
--
-- ПОЧЕМУ ON DELETE RESTRICT (не CASCADE): тот же принцип, что
-- family_students.student_id (migration 20260720120001) — платёжная
-- история/manual override не должна тихо исчезнуть при удалении строки
-- students (которое в этом проекте и так практически не происходит).
--
-- МИНИМАЛЬНЫЙ НАБОР ПОЛЕЙ (сознательно, по прямому требованию задания):
-- НЕ добавляются activated_at/deactivated_at/deactivation_reason/payment
-- amount/provider/history/planы/cron-поля — если понадобятся, отдельная
-- audit-таблица по образцу уже существующих trainer_account_audit_log/
-- family_account_audit_log, отдельным будущим этапом, не здесь.
create table public.student_page_access (
  student_id bigint primary key references public.students(id) on delete restrict,
  access_until date,
  manual_disabled boolean not null default false,
  trainer_access_after_expiry boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_super_admin_id uuid
);

comment on table public.student_page_access is
  'Одна строка на student_id — управляемая Super Admin подписка Student Page (НЕ family account, НЕ family_students — см. шапку файла). Отсутствие строки ИЛИ access_until IS NULL = "subscription не управляется" = существующий доступ НЕ ограничивается (подтверждённое business rule, backward compatibility для существующих 40 students). Прямой SELECT/UPDATE с клиента невозможен ни для одной роли (RLS enabled, policy не создаются, direct grants только service_role) — единственный путь чтения/записи — через public.get_student_page_access(bigint) (read) и будущий Super Admin backend action (write, Phase 3, не эта миграция).';
comment on column public.student_page_access.access_until is
  'Календарная дата, ВКЛЮЧИТЕЛЬНО ("Gültig bis einschließlich") — весь указанный день доступ ещё разрешён, истекает со следующего дня по Europe/Berlin. NULL = subscription не управляется (legacy/unlimited), НЕ означает "истёк".';
comment on column public.student_page_access.manual_disabled is
  'Ручное отключение Student Page Super Admin''ом — высший приоритет: family=false И trainer=false независимо от access_until/trainer_access_after_expiry. Super Admin Preview НЕ проверяет это поле вообще (остаётся доступен всегда).';
comment on column public.student_page_access.trainer_access_after_expiry is
  'Действует ТОЛЬКО когда subscription управляется (access_until IS NOT NULL), истекла, И manual_disabled=false — тогда Trainer сохраняет доступ, Family — нет. Пока subscription активна или не управляется, флаг не оказывает эффекта. Family это поле не касается ни в каком случае.';

create trigger trg_student_page_access_set_updated_at
  before update on public.student_page_access
  for each row execute function public.set_updated_at();

-- public.set_updated_at() уже существует (migration 20260720120001,
-- используется families/family_guardians/family_students/
-- student_technique_records) — переиспользуется, новый helper не создаётся.

alter table public.student_page_access enable row level security;

-- RLS enabled БЕЗ единой policy для anon/authenticated — тот же паттерн,
-- что families/family_guardians/family_students (migration
-- 20260720120003): ни одна из этих ролей не должна читать/писать таблицу
-- НАПРЯМУЮ ни при каких условиях, только через SECURITY DEFINER resolver
-- ниже. Explicit revoke — та же, дважды-трижды подтверждённая в этом
-- проекте необходимость (миграции 20260720120009/20260829120001/
-- 20260918140063): default privileges в этом Supabase-проекте оказываются
-- шире ожидаемого, полагаться на них нельзя.
revoke all on table public.student_page_access from public;
revoke all on table public.student_page_access from anon;
revoke all on table public.student_page_access from authenticated;

-- service_role — единственная роль с прямым доступом к таблице: будущий
-- Super Admin backend action (Phase 3, НЕ эта миграция) будет читать/писать
-- эту таблицу из Edge Function через service_role-клиент, тем же паттерном,
-- что уже manage-family-account делает для families/family_guardians/
-- family_students. DELETE не выдаётся — строки только создаются/
-- обновляются, физическое удаление вне объёма Phase 1.
grant select, insert, update on table public.student_page_access to service_role;

-- ── ЦЕНТРАЛЬНЫЙ RESOLVER ────────────────────────────────────────────────
-- public.get_student_page_access(p_student_id bigint) — ЧИСТОЕ вычисление
-- subscription state, НЕ access-check RPC (та же архитектурная роль, что
-- public.get_required_techniques_for_student, migration 20260918140063):
-- принимает ТОЛЬКО p_student_id, НЕ принимает p_family_id/p_trainer_id/
-- p_club_id/p_access_mode/role/текущую дату от клиента — сам читает
-- student_page_access и сам вычисляет ВСЕ поля контракта, включая ОБА
-- effective_*_access, независимо от того, кто вызывает. Relationship-
-- авторизация (can_family_access_student/can_trainer_access_student)
-- ОСТАЁТСЯ отдельным слоем — эта функция не пытается быть ни тем, ни
-- другим, только считает subscription.
--
-- EXECUTE — ТОЛЬКО postgres/service_role (НЕ authenticated) — вызывается
-- либо изнутри wrapper-функций ниже (SECURITY DEFINER chain — тот же
-- принцип, уже подтверждённый в 20260918140063: внутренний вызов проходит
-- в ролевом контексте ВЛАДЕЛЬЦА wrapper'а, не внешнего клиента), либо
-- в будущем НАПРЯМУЮ из service_role Edge Function (get-student-preview,
-- Phase 6, НЕ эта миграция, НЕ эта задача). Открытый публичный EXECUTE
-- превратил бы её в способ прочитать subscription-метаданные ЛЮБОГО
-- student_id без всякой relationship-проверки — прямое нарушение
-- anti-enumeration требования задания.
create or replace function public.get_student_page_access(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_access_until date;
  v_manual_disabled_raw boolean;
  v_trainer_exception_raw boolean;
  v_manual_disabled boolean;
  v_trainer_exception boolean;
  v_today date;
  v_subscription_managed boolean;
  v_is_expired boolean;
  v_days_remaining integer;
  v_warning_active boolean;
  v_family_allows boolean;
  v_trainer_allows boolean;
begin
  -- Скалярные target-переменные (не record) — 0 строк корректно и
  -- однозначно даёт NULL в каждой из трёх, без двусмысленности
  -- "record ещё не assigned" для record-переменных.
  select access_until, manual_disabled, trainer_access_after_expiry
    into v_access_until, v_manual_disabled_raw, v_trainer_exception_raw
  from public.student_page_access
  where student_id = p_student_id;

  -- ПОДТВЕРЖДЁННОЕ BUSINESS RULE: отсутствие строки ИЛИ access_until NULL
  -- => subscription_managed=false => НЕ ограничивает существующий доступ.
  v_manual_disabled := coalesce(v_manual_disabled_raw, false);
  v_trainer_exception := coalesce(v_trainer_exception_raw, false);
  v_subscription_managed := v_access_until is not null;

  -- Явная константная таймзона клуба (Europe/Berlin), НЕ таймзона сессии
  -- Postgres/сервера — единственный способ гарантировать корректную
  -- границу дня независимо от того, где физически исполняется запрос.
  v_today := (now() at time zone 'Europe/Berlin')::date;

  if v_subscription_managed then
    -- Включительно: access_until = today -> ещё НЕ истёк (day 0).
    v_is_expired := v_access_until < v_today;
    v_days_remaining := v_access_until - v_today;
    v_warning_active := (not v_is_expired) and v_days_remaining between 0 and 30;
  else
    v_is_expired := false;
    v_days_remaining := null;
    v_warning_active := false;
  end if;

  -- RULE 1 (manual_disabled — высший приоритет) / RULE 2 (unmanaged или
  -- managed-и-не-истёк — разрешено) / RULE 3 (managed-истёк, без trainer
  -- exception — оба запрещены) / RULE 4 (managed-истёк, trainer exception
  -- — только Trainer). Trainer exception НИКОГДА не влияет на Family.
  v_family_allows := (not v_manual_disabled)
    and (not v_subscription_managed or not v_is_expired);

  v_trainer_allows := (not v_manual_disabled)
    and (not v_subscription_managed or not v_is_expired or v_trainer_exception);

  return jsonb_build_object(
    'subscriptionManaged', v_subscription_managed,
    'accessUntil', v_access_until,
    'manualDisabled', v_manual_disabled,
    'trainerAccessAfterExpiry', v_trainer_exception,
    'isExpired', v_is_expired,
    'daysRemaining', v_days_remaining,
    'warningActive', v_warning_active,
    'familySubscriptionAllowsAccess', v_family_allows,
    'trainerSubscriptionAllowsAccess', v_trainer_allows
  );
end;
$$;

comment on function public.get_student_page_access(bigint) is
  'ЕДИНСТВЕННАЯ точка вычисления subscription state Student Page — НЕ access-check RPC, не проверяет auth.uid()/relationship, принимает только p_student_id (никаких club_id/family_id/trainer_id/access_mode/даты от клиента). Отсутствие строки ИЛИ access_until NULL => subscriptionManaged=false => familySubscriptionAllowsAccess/trainerSubscriptionAllowsAccess = true (backward-compatible legacy default, подтверждённое business rule). Дата включительно, граница дня — Europe/Berlin. EXECUTE закрыт для anon/authenticated/public — вызывается только из can_family_access_student_page/can_trainer_access_student_page ниже (SECURITY DEFINER chain) или в будущем напрямую из service_role.';

revoke all on function public.get_student_page_access(bigint) from public;
revoke all on function public.get_student_page_access(bigint) from anon;
revoke all on function public.get_student_page_access(bigint) from authenticated;
grant execute on function public.get_student_page_access(bigint) to service_role;

-- ── FAMILY WRAPPER ──────────────────────────────────────────────────────
-- can_family_access_student(bigint) (migration 20260914110055) — БЕЗ
-- ИЗМЕНЕНИЙ, продолжает означать ровно то же самое, что и сегодня (чистая
-- relationship-проверка). Эта функция — НОВАЯ, отдельная, комбинирует
-- relationship И subscription. Ни один существующий RPC/RLS/Storage policy
-- на неё в этой миграции НЕ переключается (Phase 2, отдельная
-- авторизация).
--
-- ANTI-ENUMERATION: relationship-проверка ИДЁТ ПЕРВОЙ и коротко замыкает
-- (return false) до вызова get_student_page_access — для student_id, к
-- которому у вызывающей семьи нет отношения, subscription-состояние
-- (access_until/manual_disabled/...) вообще НЕ вычисляется и НЕ может
-- просочиться ни в каком виде, наружу уходит только один голый boolean.
create or replace function public.can_family_access_student_page(p_student_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_access jsonb;
begin
  if not public.can_family_access_student(p_student_id) then
    return false;
  end if;

  v_access := public.get_student_page_access(p_student_id);

  return coalesce((v_access ->> 'familySubscriptionAllowsAccess')::boolean, false);
end;
$$;

comment on function public.can_family_access_student_page(bigint) is
  'relationship (can_family_access_student, БЕЗ ИЗМЕНЕНИЙ) AND subscription (get_student_page_access(...).familySubscriptionAllowsAccess). Короткое замыкание на relationship=false — anti-enumeration, subscription-состояние чужого ученика не вычисляется и не раскрывается. Phase 1: НЕ подключена ни к одному существующему RPC/RLS/Storage policy — подготовлена для Phase 2.';

-- ── TRAINER WRAPPER ─────────────────────────────────────────────────────
create or replace function public.can_trainer_access_student_page(p_student_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_access jsonb;
begin
  if not public.can_trainer_access_student(p_student_id) then
    return false;
  end if;

  v_access := public.get_student_page_access(p_student_id);

  return coalesce((v_access ->> 'trainerSubscriptionAllowsAccess')::boolean, false);
end;
$$;

comment on function public.can_trainer_access_student_page(bigint) is
  'relationship (can_trainer_access_student, БЕЗ ИЗМЕНЕНИЙ) AND subscription (get_student_page_access(...).trainerSubscriptionAllowsAccess, учитывает trainer_access_after_expiry). Короткое замыкание на relationship=false — anti-enumeration. Phase 1: НЕ подключена ни к одному существующему RPC/RLS/Storage policy (search_trainer_students/get_current_trainer_groups тоже НЕ трогаются — они не про Student Page) — подготовлена для Phase 2.';

-- EXECUTE на оба wrapper'а выдаётся authenticated УЖЕ СЕЙЧАС (хотя они
-- пока никуда не подключены) — то же самое, что migration
-- 20260918140063 сделала для get_family_required_techniques/
-- get_trainer_required_techniques: RLS policy USING-выражение исполняется
-- ролью authenticated, значит Phase 2 (переключение существующих policy на
-- эти wrapper'ы) должен остаться ЧИСТОЙ заменой имени функции в уже
-- существующих CREATE POLICY/RPC-телах, без отдельной grant-миграции.
-- Само по себе наличие EXECUTE не меняет никакого текущего поведения —
-- ни одна существующая policy/RPC не вызывает эти функции в Phase 1.
revoke all on function public.can_family_access_student_page(bigint) from public;
revoke all on function public.can_family_access_student_page(bigint) from anon;
grant execute on function public.can_family_access_student_page(bigint) to authenticated;

revoke all on function public.can_trainer_access_student_page(bigint) from public;
revoke all on function public.can_trainer_access_student_page(bigint) from anon;
grant execute on function public.can_trainer_access_student_page(bigint) to authenticated;
