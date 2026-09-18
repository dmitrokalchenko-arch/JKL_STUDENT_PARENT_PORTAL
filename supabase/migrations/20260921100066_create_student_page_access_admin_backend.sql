-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- НАЗНАЧЕНИЕ: Phase 3 задачи "Student Page Access / Subscription
-- Management" — backend для управления `student_page_access` (миграция
-- 20260919100064) ИСКЛЮЧИТЕЛЬНО Super Admin, через новые actions
-- manage-family-account (см. supabase/functions/manage-family-account/
-- index.ts, тот же коммит). Frontend/Block 1 UI НЕ реализуется.
--
-- Ничего из Phase 1/2 (миграции 064/065) не меняется — ни
-- student_page_access.RLS/grants, ни get_student_page_access, ни
-- can_family_access_student_page/can_trainer_access_student_page, ни
-- get_current_family_children/get_trainer_student_by_id/*_required_
-- techniques/RLS/Storage policies.
--
-- ══════════════════════════════════════════════════════════════════════
-- ПОЧЕМУ НОВАЯ AUDIT-ТАБЛИЦА, А НЕ family_account_audit_log
-- ══════════════════════════════════════════════════════════════════════
-- Прочитан весь supabase/functions/manage-family-account/index.ts и
-- family_account_audit_log (migration 20260806100031 + 20260807110037):
-- её target_family_id — `uuid NOT NULL REFERENCES public.families(id)`.
-- Subscription-действия (set_access_until/set_manual_disabled/
-- set_trainer_exception) ДОЛЖНЫ работать и для ученика, у которого ЕЩЁ
-- НЕТ ни одной family_students-связи вообще (архитектура Phase 1
-- специально это гарантирует — "Student Page существует даже без Family
-- account", подтверждено test-кейсами B1/C1 этой задачи: manual_disabled/
-- trainer_exception можно установить на строке БЕЗ family вообще). NOT
-- NULL + FK на families(id) делает family_account_audit_log структурно
-- непригодной для этого — либо INSERT физически провалился бы (NOT
-- NULL/FK violation) именно в самом важном случае (управление подпиской
-- ДО создания Family account), либо пришлось бы придумывать фиктивный
-- family_id, ломая смысл и целостность уже существующей таблицы для ВСЕХ
-- её текущих потребителей. Поэтому — отдельная, узкая
-- student_page_access_audit_log, keyed ТОЛЬКО по student_id (никакой
-- family-зависимости), прямая структурная аналогия family_account_audit_log
-- (тот же dual-actor патторн performed_by_super_admin_id всегда +
-- performed_by_auth_user_id nullable для PIN-сессий, та же полностью
-- закрытая RLS без единой policy, тот же единственный вход через
-- SECURITY DEFINER log-функцию, вызываемую исключительно service_role).
create table public.student_page_access_audit_log (
  id uuid primary key default gen_random_uuid(),
  performed_by_super_admin_id uuid not null,
  performed_by_auth_user_id uuid references auth.users(id) on delete restrict,
  target_student_id bigint not null references public.students(id) on delete restrict,
  operation text not null check (operation in (
    'set_access_until', 'set_manual_disabled', 'set_trainer_exception'
  )),
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

comment on table public.student_page_access_audit_log is
  'Журнал привилегированных Super Admin действий над public.student_page_access. Отдельно от family_account_audit_log НАМЕРЕННО (см. комментарий выше в файле) — subscription не зависит от family account. performed_by_super_admin_id — первичный actor (uuid, значение-FK на чужую super_admins.id, оба auth-пути — JWT/PIN-сессия — его знают); performed_by_auth_user_id — NULL при авторизации через PIN-сессию (тот же паттерн, что family_account_audit_log, migration 20260807110037). old_value/new_value — снимок public.get_student_page_access(student_id) ДО и ПОСЛЕ операции (jsonb, тот же контракт, что уже возвращает resolver) — пароль/JWT/PIN сюда никогда не попадают, они этой таблицы вообще не касаются.';
comment on column public.student_page_access_audit_log.performed_by_auth_user_id is
  'NULLABLE — заполняется только при авторизации через Supabase Auth JWT (Weg A в manage-family-account); NULL при авторизации через Super Admin PIN Session (Weg B) — для неё нет строки auth.users.';

alter table public.student_page_access_audit_log enable row level security;

create index idx_student_page_access_audit_log_target_student_id on public.student_page_access_audit_log(target_student_id);

-- RLS enabled БЕЗ единой policy — та же защита, что family_account_audit_log:
-- ни одна authenticated/anon роль не должна читать/писать этот журнал
-- напрямую, единственный вход — SECURITY DEFINER функция ниже.
revoke all on table public.student_page_access_audit_log from public;
revoke all on table public.student_page_access_audit_log from anon;
revoke all on table public.student_page_access_audit_log from authenticated;

create or replace function public.log_student_page_access_operation(
  p_performed_by_super_admin_id uuid,
  p_performed_by_auth_user_id uuid,
  p_target_student_id bigint,
  p_operation text,
  p_old_value jsonb,
  p_new_value jsonb
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.student_page_access_audit_log (
    performed_by_super_admin_id, performed_by_auth_user_id,
    target_student_id, operation, old_value, new_value
  ) values (
    p_performed_by_super_admin_id, p_performed_by_auth_user_id,
    p_target_student_id, p_operation, p_old_value, p_new_value
  );
end;
$$;

comment on function public.log_student_page_access_operation(uuid, uuid, bigint, text, jsonb, jsonb) is
  'Единственный способ записать в student_page_access_audit_log. Вызывается только manage-family-account Edge Function от имени service_role, тем же паттерном, что log_family_account_operation.';

revoke all on function public.log_student_page_access_operation(uuid, uuid, bigint, text, jsonb, jsonb) from public;
grant execute on function public.log_student_page_access_operation(uuid, uuid, bigint, text, jsonb, jsonb) to service_role;

-- ══════════════════════════════════════════════════════════════════════
-- ТОЧНЫЕ UPSERT-ФУНКЦИИ — по одной на изменяемое поле
-- ══════════════════════════════════════════════════════════════════════
-- ПОЧЕМУ НЕ обычный supabase-js .upsert(): generic upsert перезаписывает
-- ВСЕ переданные колонки при конфликте — чтобы задать access_until, не
-- трогая manual_disabled/trainer_access_after_expiry (прямое требование
-- задания: "продление НЕ реактивирует ручную блокировку"), пришлось бы
-- либо сначала читать строку в JS (TOCTOU-гонка между SELECT и записью),
-- либо писать точный `INSERT ... ON CONFLICT DO UPDATE SET <только одна
-- колонка>` — то, что делают эти три функции. Каждая — ОДИН атомарный SQL
-- statement (никакой гонки), затрагивает РОВНО одно поле при конфликте,
-- остальные два поля используют DEFAULT (false) ТОЛЬКО при первой вставке
-- строки (ON CONFLICT их не трогает вообще — сохраняются какими были).
-- EXECUTE — только service_role (те же вызывающие права, что и на саму
-- таблицу, migration 20260919100064) — authenticated НЕ может вызвать эти
-- функции напрямую, единственный путь записи — manage-family-account.
create or replace function public.set_student_page_access_until(
  p_student_id bigint,
  p_access_until date,
  p_updated_by_super_admin_id uuid
)
returns public.student_page_access
language sql
security definer
set search_path to ''
as $$
  insert into public.student_page_access (student_id, access_until, updated_by_super_admin_id)
  values (p_student_id, p_access_until, p_updated_by_super_admin_id)
  on conflict (student_id) do update
    set access_until = excluded.access_until,
        updated_by_super_admin_id = excluded.updated_by_super_admin_id
  returning *;
$$;

comment on function public.set_student_page_access_until(bigint, date, uuid) is
  'Единственный способ задать/изменить/очистить (NULL) student_page_access.access_until. NULL разрешён НАМЕРЕННО — сознательный возврат Student Page в legacy/unmanaged режим (административное восстановление), задокументировано в задании. Затрагивает ТОЛЬКО access_until при конфликте — manual_disabled/trainer_access_after_expiry не меняются. Если строки ещё нет — создаётся с manual_disabled=false/trainer_access_after_expiry=false (DEFAULT колонок). EXECUTE только service_role.';

create or replace function public.set_student_page_manual_disabled(
  p_student_id bigint,
  p_manual_disabled boolean,
  p_updated_by_super_admin_id uuid
)
returns public.student_page_access
language sql
security definer
set search_path to ''
as $$
  insert into public.student_page_access (student_id, manual_disabled, updated_by_super_admin_id)
  values (p_student_id, p_manual_disabled, p_updated_by_super_admin_id)
  on conflict (student_id) do update
    set manual_disabled = excluded.manual_disabled,
        updated_by_super_admin_id = excluded.updated_by_super_admin_id
  returning *;
$$;

comment on function public.set_student_page_manual_disabled(bigint, boolean, uuid) is
  'Единственный способ задать student_page_access.manual_disabled. Затрагивает ТОЛЬКО это поле при конфликте — access_until/trainer_access_after_expiry не меняются. Если строки ещё нет — создаётся с access_until=NULL/trainer_access_after_expiry=false (DEFAULT/NULL колонок), т.е. unmanaged-строка с ручной блокировкой поверх. EXECUTE только service_role.';

create or replace function public.set_student_page_trainer_exception(
  p_student_id bigint,
  p_trainer_access_after_expiry boolean,
  p_updated_by_super_admin_id uuid
)
returns public.student_page_access
language sql
security definer
set search_path to ''
as $$
  insert into public.student_page_access (student_id, trainer_access_after_expiry, updated_by_super_admin_id)
  values (p_student_id, p_trainer_access_after_expiry, p_updated_by_super_admin_id)
  on conflict (student_id) do update
    set trainer_access_after_expiry = excluded.trainer_access_after_expiry,
        updated_by_super_admin_id = excluded.updated_by_super_admin_id
  returning *;
$$;

comment on function public.set_student_page_trainer_exception(bigint, boolean, uuid) is
  'Единственный способ задать student_page_access.trainer_access_after_expiry. Затрагивает ТОЛЬКО это поле при конфликте — access_until/manual_disabled не меняются. Если строки ещё нет — создаётся с access_until=NULL/manual_disabled=false; пока access_until NULL (unmanaged), флаг не имеет наблюдаемого эффекта (см. public.get_student_page_access) — это ожидаемо. EXECUTE только service_role.';

revoke all on function public.set_student_page_access_until(bigint, date, uuid) from public;
revoke all on function public.set_student_page_access_until(bigint, date, uuid) from anon;
revoke all on function public.set_student_page_access_until(bigint, date, uuid) from authenticated;
grant execute on function public.set_student_page_access_until(bigint, date, uuid) to service_role;

revoke all on function public.set_student_page_manual_disabled(bigint, boolean, uuid) from public;
revoke all on function public.set_student_page_manual_disabled(bigint, boolean, uuid) from anon;
revoke all on function public.set_student_page_manual_disabled(bigint, boolean, uuid) from authenticated;
grant execute on function public.set_student_page_manual_disabled(bigint, boolean, uuid) to service_role;

revoke all on function public.set_student_page_trainer_exception(bigint, boolean, uuid) from public;
revoke all on function public.set_student_page_trainer_exception(bigint, boolean, uuid) from anon;
revoke all on function public.set_student_page_trainer_exception(bigint, boolean, uuid) from authenticated;
grant execute on function public.set_student_page_trainer_exception(bigint, boolean, uuid) to service_role;
