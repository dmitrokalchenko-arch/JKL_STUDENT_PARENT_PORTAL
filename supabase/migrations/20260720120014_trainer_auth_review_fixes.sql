-- Corrective migration: закрывает Major-замечания code review Trainer Auth
-- (#1 и #3). Migrations 011–013 уже применены (полный db reset +
-- функциональное тестирование) — не редактируются задним числом, по уже
-- установленной в проекте конвенции (см. migration 008, поправившую
-- migration 003 тем же способом).

-- =====================================================================
-- Замечание #1 (SECURITY DEFINER "несогласованность") — перепроверено
-- против фактического кода, а не по памяти предыдущего отчёта. ЛОЖНАЯ
-- ТРЕВОГА, функциональных изменений не требуется:
--
--   enforce_trainer_accounts_club_match() (migration 011, SECURITY
--   DEFINER) читает ЧУЖУЮ таблицу public.trainers напрямую — тот же
--   класс проверки, что public.enforce_family_student_club_match()
--   (migration 001), тоже SECURITY DEFINER по той же причине ("не должна
--   зависеть от RLS-политик students у JCL_Gruppen").
--
--   enforce_trainer_accounts_club_exists() (migration 011, БЕЗ SECURITY
--   DEFINER) вызывает уже-SECURITY-DEFINER family_club_exists() — тот же
--   класс, что public.enforce_families_club_exists() (migration 001),
--   тоже без SECURITY DEFINER по той же причине.
--
-- Это не два несогласованных решения, а два разных, уже
-- задокументированных в migration 001 класса проверок, применённые
-- корректно. Отдельно эмпирически подтверждено (не предположение):
-- функции с RETURNS TRIGGER физически не вызываемы напрямую через RPC
-- ни при каких GRANT/REVOKE — Postgres блокирует это на уровне типа
-- функции ("trigger functions can only be called as triggers",
-- SQLSTATE 0A000), проверка ACL до этой ошибки не доходит. Поэтому
-- дополнительный revoke/grant на сами триггерные функции не нужен и не
-- добавляется — они и так не могут стать публичным API.
comment on function public.enforce_trainer_accounts_club_exists() is
  'Не требует SECURITY DEFINER — вызывает уже-SECURITY-DEFINER family_club_exists(), тот же паттерн, что public.enforce_families_club_exists() (migration 001). RETURNS TRIGGER исключает прямой вызов через RPC независимо от GRANT (подтверждено эмпирически). Пересмотрено code review Trainer Auth — см. migration 014.';

comment on function public.enforce_trainer_accounts_club_match() is
  'SECURITY DEFINER необходим — читает чужую таблицу public.trainers (JCL_Gruppen) напрямую, тот же паттерн, что public.enforce_family_student_club_match() (migration 001). RETURNS TRIGGER исключает прямой вызов через RPC независимо от GRANT (подтверждено эмпирически). Пересмотрено code review Trainer Auth — см. migration 014.';

-- =====================================================================
-- Замечание #3 — структурный helper активности тренера.
--
-- Выбран вариант B: возвращает trainer_account_id (не boolean). NULL
-- служит тем же отрицательным сигналом, что дал бы boolean=false
-- (`if current_active_trainer_account_id() is null then ... отказ`), но
-- дополнительно даёт будущим RPC готовый идентификатор для scoping —
-- boolean-вариант потребовал бы отдельного повторного запроса к
-- trainer_accounts для получения этого же id. Понижение до чистого
-- boolean тривиально на стороне вызывающего (`is not null`), обратное
-- было бы отдельным запросом — вариант B строго не менее полезен, чем A,
-- при той же простоте реализации.
--
-- SECURITY DEFINER обязателен: public.trainer_accounts — НАША СОБСТВЕННАЯ
-- таблица (не чужая, в отличие от enforce_trainer_accounts_club_match
-- выше), но она намеренно заперта (RLS enabled без единой policy, нет
-- base table GRANT ни одной клиентской роли — migration 011) — SECURITY
-- DEFINER здесь единственный санкционированный путь чтения, по той же
-- причине, что уже применена к get_current_trainer_profile (migration
-- 013), а не по аналогии с "чужой таблицей" (это другое обоснование,
-- специфичное для этого случая).
--
-- АРХИТЕКТУРНОЕ ПРАВИЛО (обязательно к соблюдению): любой будущий RPC,
-- возвращающий тренерские бизнес-данные (группы, ученики, посещаемость и
-- т.п.), ОБЯЗАН вызывать private.current_active_trainer_account_id() и
-- отклонять запрос (или возвращать пустой результат), если она вернула
-- NULL — не полагаться только на факт наличия auth.uid() или валидной
-- сессии. Это единственный структурно закреплённый механизм проверки
-- is_active для будущих RPC — комментарий в TrainerAuthGuard.jsx (frontend)
-- дублирует это правило для UX-слоя, но именно эта функция — источник
-- истины для backend.
create or replace function private.current_active_trainer_account_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ta.id
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;
$$;

comment on function private.current_active_trainer_account_id() is
  'SECURITY DEFINER: trainer_account_id ТЕКУЩЕГО auth.uid(), только если у него есть активная (is_active=true) запись trainer_accounts; иначе NULL. Не принимает параметров — подмена чужого аккаунта невозможна. Не возвращает профильные поля (club_id/display_name/email/login_name) — только сам факт активности + id для scoping. ОБЯЗАТЕЛЕН к использованию во всех будущих RPC, возвращающих тренерские бизнес-данные (см. комментарий выше). НЕ заменяет get_current_trainer_profile() — та показывает состояние ЛЮБОГО профиля (включая неактивный, для UX), эта — строгий security-gate только для активных.';

revoke all on function private.current_active_trainer_account_id() from public;
revoke all on function private.current_active_trainer_account_id() from anon;
grant execute on function private.current_active_trainer_account_id() to authenticated;

-- get_current_trainer_profile() НЕ делегирует этому helper'у и не
-- рефакторится функционально — у них разный контракт (helper: 0/1 только
-- для активных, NULL иначе; profile: 0 строк = нет профиля вообще, 1
-- строка с is_active=false = профиль есть, но неактивен — эта разница
-- обязана сохраниться для UX, см. TrainerAuthGuard.jsx). Дублирования
-- логики маппинга полей нет — helper вообще не возвращает профильные
-- поля. Комментарий обновлён для явной перекрёстной ссылки.
comment on function public.get_current_trainer_profile() is
  'SECURITY DEFINER: минимальный профиль ТЕКУЩЕГО auth.uid() (без параметров — подмена чужого профиля невозможна). 0 строк = не тренер (не ошибка). 1 строка с is_active=false = доступ к /trainer приостановлен (отличается от "не тренер" для UX). email/login_name/trainer_row_id намеренно не возвращаются. НЕ используется как security-gate для бизнес-RPC — для этого см. private.current_active_trainer_account_id() (migration 014), которая строго возвращает NULL для неактивных/отсутствующих профилей.';
