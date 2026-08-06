-- =====================================================================
-- TRAINER_AUTH_PRODUCTION_DEPLOY.sql
-- =====================================================================
--
-- НАЗНАЧЕНИЕ: единый production deploy package для единой авторизации
-- тренеров — объединяет миграции 011-026 в правильном порядке зависимостей
-- в ОДНУ транзакцию. Содержимое каждой миграции взято ДОСЛОВНО из файлов
-- supabase/migrations/2026072012001[1-9].sql и 202607201200[20-26].sql —
-- ничего не придумано и не переписано по памяти.
--
-- ⚠️ ТОЛЬКО ДЛЯ РУЧНОГО ВЫПОЛНЕНИЯ ВЛАДЕЛЬЦЕМ В PRODUCTION SQL EDITOR.
-- Этот файл НЕ выполнялся против production. Ни один statement из него не
-- был отправлен на сервер whorwleydkziejjafsea.
--
-- ПРЕДПОСЫЛКА: production conflict-check (TRAINER_AUTH_FINAL_CONFLICT_CHECK.sql)
-- уже подтверждён владельцем как GREEN (red=0, yellow=0, green=23) — ни
-- одна из таблиц/функций/constraints/triggers/types, создаваемых этим
-- пакетом, не существует и не конфликтует с чем-либо на production. Именно
-- поэтому ниже НЕ добавлены дополнительные "IF NOT EXISTS"/"IF EXISTS" сверх
-- тех, что уже были в исходных файлах миграций 011-026 — они бы маскировали
-- реальную ошибку там, где чистое состояние уже подтверждено фактом.
--
-- ⚠️ ЗАВИСИМОСТИ ВНЕ ДИАПАЗОНА 011-026 — ТЕПЕРЬ САМОДОСТАТОЧНЫ:
--   - migration 011 использует public.family_club_exists(text) и
--     public.set_updated_at() (семейный слой, migration 001);
--   - migration 012 использует public.normalize_family_nickname(text)
--     (migration 002);
--   - migration 014 создаёт private.current_active_trainer_account_id() —
--     требует, чтобы схема private УЖЕ существовала с правильными правами
--     (создаётся в migration 008, USAGE для authenticated выдаётся в
--     migration 009).
-- Production conflict-check ИСКАЛ public.family_club_exists среди прочего и
-- НЕ НАШЁЛ её на production — подтверждённый факт, не предположение (схема
-- private conflict-check'ом не проверялась — она не входила в список
-- искомых имён). Вместо того чтобы останавливать deploy на известных
-- блокерах, пакет теперь САМ создаёт схему private (с её правами) и все три
-- функции — см. раздел «FAMILY LAYER PREREQUISITES (schema + functions)»
-- сразу после защитного блока, ниже. Точные определения взяты дословно из
-- migrations 001-002 и 008-009 (LANGUAGE/volatility/SECURITY DEFINER или
-- INVOKER/search_path/revoke/grant — без изменений). Семейные ТАБЛИЦЫ/
-- constraints/triggers/policies/данные (families/family_guardians/
-- family_students и связанные с ними объекты) этим пакетом НЕ создаются и
-- НЕ трогаются — только схема private и три функции, требуемые кодом
-- миграций 011-014.
--
-- ТРАНЗАКЦИОННАЯ СТРУКТУРА: ОДНА фаза (BEGIN...COMMIT). Все операции всех
-- 16 миграций плюс схема private с правами и три prerequisite-функции —
-- обычный транзакционный DDL (CREATE SCHEMA/TABLE/FUNCTION/TRIGGER/INDEX
-- без CONCURRENTLY, ALTER TABLE, GRANT/REVOKE, COMMENT ON, один DO-блок в
-- migration 015 — уже был в исходном файле, не добавлен здесь) — ни одна
-- команда не требует выполнения вне транзакции. Одна транзакция даёт то
-- самое свойство «либо всё, либо ничего»: при любой ошибке на любом шаге
-- откатываются АБСОЛЮТНО ВСЕ созданные до этого объекты этого пакета, включая
-- prerequisite-функции и уже отработавшие более ранние миграции —
-- частично применённого состояния не остаётся.
--
-- Порядок 011 → 026 — это порядок зависимостей, не только порядок номеров
-- файлов: 012 использует normalize_login_name (011); 013 использует
-- trainer_accounts (011); 014 использует функции/триггеры из 011 и
-- get_current_trainer_profile (013); 016-018 используют
-- private.current_active_trainer_account_id() (014); 019/025/026 работают
-- с trainer_accounts (011); 020-023 — гранты service_role на функции из
-- 001/011/012; 024 — независимая новая таблица аудита.
--
-- Не включает: локальные тестовые данные, реальные email/UUID/пароли/PIN/
-- JWT/секреты, создание тестовых пользователей, изменение существующих
-- строк trainers/clubs, удаление каких-либо production-данных — пакет
-- целиком состоит из DDL (CREATE/ALTER/GRANT/REVOKE/COMMENT), ни одного
-- INSERT/UPDATE/DELETE по пользовательским данным.
-- =====================================================================

BEGIN;

-- ── Защитный блок: РЕАЛЬНЫЕ внешние предпосылки (не создаваемые этим
-- пакетом ни в каком виде) ──────────────────────────────────────────
-- family_club_exists/set_updated_at/normalize_family_nickname больше НЕ
-- проверяются здесь — deploy создаёт их сам в разделе
-- «FAMILY LAYER FUNCTION PREREQUISITES» ниже.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'active'
  ) THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_PRODUCTION_DEPLOY: остановлено ДО создания объектов. '
      'Колонка public.clubs.active не найдена — требуется resolve_trainer_login_email (migration 012).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clubs' AND column_name = 'club_short_name'
  ) THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_PRODUCTION_DEPLOY: остановлено ДО создания объектов. '
      'Колонка public.clubs.club_short_name не найдена — требуется resolve_trainer_login_email '
      '(migration 012) и migration 015.';
  END IF;

  IF to_regclass('public.trainers') IS NULL THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_PRODUCTION_DEPLOY: остановлено ДО создания объектов. '
      'public.trainers не найдена — собственная таблица JCL_Gruppen, обязательный prerequisite.';
  END IF;

  IF to_regclass('public.clubs') IS NULL THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_PRODUCTION_DEPLOY: остановлено ДО создания объектов. '
      'public.clubs не найдена — собственная таблица JCL_Gruppen, обязательный prerequisite.';
  END IF;

  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_PRODUCTION_DEPLOY: остановлено ДО создания объектов. '
      'auth.users не найдена — системная таблица Supabase Auth, обязательный prerequisite.';
  END IF;

  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_PRODUCTION_DEPLOY: остановлено ДО создания объектов. '
      'auth.uid() не найдена — базовая функция Supabase Auth, используется 013/014/016-019/025.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_PRODUCTION_DEPLOY: остановлено ДО создания объектов. '
      'Роль anon не найдена — платформенная роль Supabase, требуется для GRANT в 012/019/025.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_PRODUCTION_DEPLOY: остановлено ДО создания объектов. '
      'Роль authenticated не найдена — платформенная роль Supabase, требуется для GRANT в 012/013/016-019/025.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_PRODUCTION_DEPLOY: остановлено ДО создания объектов. '
      'Роль service_role не найдена — платформенная роль Supabase, требуется для GRANT в 020-024.';
  END IF;
END $$;


-- =====================================================================
-- FAMILY LAYER PREREQUISITES (schema + functions)
-- Назначение: обеспечить наличие ВНЕШНИХ объектов вне диапазона 011-026,
-- от которых зависит код миграций 011-014 — схема private (нужна migration
-- 014 для private.current_active_trainer_account_id()) и три функции
-- семейного слоя (public.family_club_exists, public.set_updated_at,
-- public.normalize_family_nickname, нужны миграциям 011-012). Определения
-- взяты ДОСЛОВНО:
--   - схема private + revoke/grant — из
--     supabase/migrations/20260720120008_fix_family_guardians_rls_recursion.sql
--     (create schema/revoke) и .../20260720120009_fix_family_module_privileges.sql
--     (grant usage authenticated);
--   - три функции — из .../20260720120001_create_family_layer.sql и
--     .../20260720120002_family_auth_helpers.sql.
-- LANGUAGE, volatility, SECURITY DEFINER/INVOKER, search_path и revoke/grant
-- сохранены без изменений. НЕ включает migrations 008-009/001-002 целиком —
-- НЕ создаёт семейные таблицы (families/family_guardians/family_students),
-- их constraints/triggers/policies, RLS-политики или иные объекты схемы
-- private сверх того, что непосредственно требуется коду 011-026, и не
-- содержит семейных пользовательских данных. CREATE SCHEMA IF NOT EXISTS —
-- дословно из исходной migration 008, не добавлено при сборке пакета.
-- CREATE OR REPLACE FUNCTION безопасен для этой задачи: Postgres сам
-- откажет с ошибкой, если на production уже существует одноимённая функция
-- с ТЕМ ЖЕ набором аргументов, но ДРУГИМ типом возврата — silent-
-- перезаписи возвращаемого типа произойти не может. production conflict-
-- check уже подтвердил прямым фактом, что public.family_club_exists(text)
-- на production не существует вовсе.
-- =====================================================================

create schema if not exists private;

-- Явно закрытая схема. По умолчанию новая схема и так не даёт доступа
-- PUBLIC/anon/authenticated — эти revoke подтверждают намерение явно, а не
-- отменяют ранее выданные права (их не было). Дословно из migration 008.
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

-- Дословно из migration 009 — без USAGE на схему authenticated не сможет
-- обратиться к private.current_active_trainer_account_id() (migration 014),
-- даже имея EXECUTE на саму функцию.
grant usage on schema private to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.family_club_exists(p_club_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.clubs where club_id = p_club_id);
$$;

comment on function public.family_club_exists(text) is
  'true, если p_club_id существует в clubs.club_id. Используется вместо FOREIGN KEY (clubs.club_id не подтверждён UNIQUE).';

revoke all on function public.family_club_exists(text) from public;

create or replace function public.normalize_family_nickname(p_nickname text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(p_nickname), '[^a-zA-Z0-9]', '', 'g'));
$$;

comment on function public.normalize_family_nickname(text) is
  'Приводит nickname (или club_id — переиспользуется в family_login_email для безопасного построения email) к каноническому виду: нижний регистр, без разделителей.';

revoke all on function public.normalize_family_nickname(text) from public;


-- =====================================================================
-- MIGRATION 011 — create_trainer_accounts
-- Назначение: таблица public.trainer_accounts (связь auth.users с тренером
-- JCL_Gruppen), нормализация login_name, immutability/club_match/club_exists
-- триггеры, rename_trainer_login(), RLS enabled без policy.
-- =====================================================================

create or replace function public.normalize_login_name(p_value text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(p_value), '\s+', '', 'g'));
$$;

comment on function public.normalize_login_name(text) is
  'Unicode-safe нормализация login_name тренера: нижний регистр + удаление всех пробельных символов, БЕЗ ограничения алфавита (в отличие от normalize_family_nickname(), которая для этого не подходит — вырезает всё вне [a-zA-Z0-9], уничтожая кириллицу и др.). Независимая реализация, семейная функция не переиспользуется и не изменяется.';

revoke all on function public.normalize_login_name(text) from public;

create table public.trainer_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  trainer_row_id bigint not null references public.trainers(id) on delete restrict,
  club_id text not null,
  login_name text not null,
  normalized_login_name text generated always as (public.normalize_login_name(login_name)) stored,
  display_name text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, normalized_login_name)
);

comment on table public.trainer_accounts is
  'Связь auth.users с тренером (public.trainers, чужая таблица JCL_Gruppen). ВСЕГДА отдельная от family_guardians запись auth.users, даже для одного и того же человека. is_active=false по умолчанию — доступ к /trainer включается только явным административным действием, не автоматически при создании строки.';
comment on column public.trainer_accounts.trainer_row_id is
  'FK на public.trainers(id) — bigint PK чужой таблицы, подтверждено аудитом. ON DELETE RESTRICT: не даём чужой системе тихо оборвать связь (тот же принцип, что family_students.student_id -> students(id) on delete restrict).';
comment on column public.trainer_accounts.club_id is
  'Денормализовано (как family_guardians.club_id) — источник истины на момент создания строки, проверяется и поддерживается в согласованности с trainers.club_id триггером ниже (составной FK физически невозможен без изменения чужой таблицы trainers).';
comment on column public.trainer_accounts.login_name is
  'Отображаемый вид логина (например "Иван П"). Immutable после создания — обеспечивается триггером ниже, не только RLS (RLS не действует на service_role/миграции/ручной SQL). Единственный контролируемый способ изменить — rename_trainer_login() ниже.';
comment on column public.trainer_accounts.normalized_login_name is
  'GENERATED ALWAYS AS ... STORED — структурная гарантия согласованности с login_name при ЛЮБОЙ операции (включая service_role и ручной SQL), не может рассинхронизироваться.';
comment on column public.trainer_accounts.is_active is
  'Источник истины для доступа именно к /trainer (не путать с активностью auth.users, управляемой Supabase Auth, и не с trainers.aktiv — полем чужой системы JCL_Gruppen, не синхронизируемым автоматически). default false — см. комментарий на таблице.';

create index idx_trainer_accounts_club_id on public.trainer_accounts(club_id);
create index idx_trainer_accounts_trainer_row_id on public.trainer_accounts(trainer_row_id);

create trigger trg_trainer_accounts_set_updated_at
  before update on public.trainer_accounts
  for each row execute function public.set_updated_at();

create or replace function public.enforce_trainer_accounts_login_name_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.login_name <> old.login_name
     and coalesce(current_setting('trainer_accounts.allow_login_rename', true), 'false') <> 'true' then
    raise exception 'trainer_accounts.login_name is immutable; use rename_trainer_login() instead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_trainer_accounts_login_name_immutable
  before update on public.trainer_accounts
  for each row execute function public.enforce_trainer_accounts_login_name_immutable();

create or replace function public.enforce_trainer_accounts_club_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trainer_club text;
begin
  select club_id into v_trainer_club from public.trainers where id = new.trainer_row_id;

  if v_trainer_club is null or new.club_id <> v_trainer_club then
    raise exception 'trainer_accounts.club_id must match trainers.club_id for trainer_row_id %', new.trainer_row_id;
  end if;

  return new;
end;
$$;

create trigger trg_trainer_accounts_club_match
  before insert or update on public.trainer_accounts
  for each row execute function public.enforce_trainer_accounts_club_match();

create or replace function public.enforce_trainer_accounts_club_exists()
returns trigger
language plpgsql
as $$
begin
  if not public.family_club_exists(new.club_id) then
    raise exception 'trainer_accounts.club_id % does not exist in clubs.club_id', new.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_trainer_accounts_club_exists
  before insert or update on public.trainer_accounts
  for each row execute function public.enforce_trainer_accounts_club_exists();

create or replace function public.rename_trainer_login(
  p_trainer_account_id uuid,
  p_new_login_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  perform set_config('trainer_accounts.allow_login_rename', 'true', true);

  update public.trainer_accounts
  set login_name = p_new_login_name
  where id = p_trainer_account_id;

  v_updated := found;

  perform set_config('trainer_accounts.allow_login_rename', 'false', true);

  if not v_updated then
    raise exception 'trainer_accounts.id % not found', p_trainer_account_id;
  end if;
end;
$$;

comment on function public.rename_trainer_login(uuid, text) is
  'Единственный контролируемый способ изменить trainer_accounts.login_name в обход immutability-триггера. Административная функция — GRANT никому не выдан, вызывается вручную (service_role/Dashboard), не из клиентского приложения. Не пересчитывает технический email в auth.users — это отдельная операция.';

revoke all on function public.rename_trainer_login(uuid, text) from public;

alter table public.trainer_accounts enable row level security;


-- =====================================================================
-- MIGRATION 012 — trainer_login_email
-- Назначение: resolve_trainer_login_email(club_short_name, login_name) —
-- построение детерминированного технического email тренера для входа.
-- =====================================================================

create or replace function public.resolve_trainer_login_email(
  p_club_short_name text,
  p_login_name text
)
returns text
language plpgsql
security definer
set search_path = ''
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

  return 'trainer_'
    || public.normalize_family_nickname(v_club_id)
    || '_'
    || encode(convert_to(public.normalize_login_name(p_login_name), 'UTF8'), 'hex')
    || '@internal.jkl';
end;
$$;

comment on function public.resolve_trainer_login_email(text, text) is
  'SECURITY DEFINER: строит технический email тренера БЕЗ проверки существования trainer_accounts (анти-enumeration, как у resolve_family_login_email). p_club_short_name временно совместим с существующей конфигурацией frontend (PORTAL_CLUB_ID), не долгосрочный стандарт. is_active НЕ проверяется здесь — только в get_current_trainer_profile после входа.';

revoke all on function public.resolve_trainer_login_email(text, text) from public;
grant execute on function public.resolve_trainer_login_email(text, text) to anon, authenticated;


-- =====================================================================
-- MIGRATION 013 — get_current_trainer_profile
-- Назначение: минимальный профиль ТЕКУЩЕГО тренера (auth.uid()) для
-- проверки доступа к /trainer.
-- =====================================================================

create or replace function public.get_current_trainer_profile()
returns table (
  trainer_account_id uuid,
  club_id text,
  display_name text,
  is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ta.id as trainer_account_id,
    ta.club_id,
    ta.display_name,
    ta.is_active
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid());
$$;

comment on function public.get_current_trainer_profile() is
  'SECURITY DEFINER: минимальный профиль ТЕКУЩЕГО auth.uid() (без параметров — подмена чужого профиля невозможна). 0 строк = не тренер (не ошибка). 1 строка с is_active=false = доступ к /trainer приостановлен (отличается от "не тренер" для UX). email/login_name/trainer_row_id намеренно не возвращаются.';

revoke all on function public.get_current_trainer_profile() from public;
revoke all on function public.get_current_trainer_profile() from anon;
grant execute on function public.get_current_trainer_profile() to authenticated;


-- =====================================================================
-- MIGRATION 014 — trainer_auth_review_fixes
-- Назначение: private.current_active_trainer_account_id() — единый
-- security-gate для всех будущих RPC с тренерскими бизнес-данными;
-- уточняющие комментарии на функциях из 011/013 (без функциональных
-- изменений).
-- =====================================================================

comment on function public.enforce_trainer_accounts_club_exists() is
  'Не требует SECURITY DEFINER — вызывает уже-SECURITY-DEFINER family_club_exists(), тот же паттерн, что public.enforce_families_club_exists() (migration 001). RETURNS TRIGGER исключает прямой вызов через RPC независимо от GRANT (подтверждено эмпирически). Пересмотрено code review Trainer Auth — см. migration 014.';

comment on function public.enforce_trainer_accounts_club_match() is
  'SECURITY DEFINER необходим — читает чужую таблицу public.trainers (JCL_Gruppen) напрямую, тот же паттерн, что public.enforce_family_student_club_match() (migration 001). RETURNS TRIGGER исключает прямой вызов через RPC независимо от GRANT (подтверждено эмпирически). Пересмотрено code review Trainer Auth — см. migration 014.';

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

comment on function public.get_current_trainer_profile() is
  'SECURITY DEFINER: минимальный профиль ТЕКУЩЕГО auth.uid() (без параметров — подмена чужого профиля невозможна). 0 строк = не тренер (не ошибка). 1 строка с is_active=false = доступ к /trainer приостановлен (отличается от "не тренер" для UX). email/login_name/trainer_row_id намеренно не возвращаются. НЕ используется как security-gate для бизнес-RPC — для этого см. private.current_active_trainer_account_id() (migration 014), которая строго возвращает NULL для неактивных/отсутствующих профилей.';


-- =====================================================================
-- MIGRATION 015 — clubs_club_short_name_unique
-- Назначение: гарантирует однозначность public.clubs.club_short_name на
-- уровне БД (defense-in-depth для resolve_trainer_login_email/
-- resolve_family_login_email). DO-блок и "if not exists" ниже — часть
-- ИСХОДНОГО файла миграции (идемпотентность заложена автором миграции,
-- не добавлена при сборке этого пакета).
-- =====================================================================

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class rel on rel.oid = con.conrelid
    join pg_catalog.pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'clubs'
      and con.conname = 'clubs_club_short_name_not_blank'
  ) then
    alter table public.clubs
      add constraint clubs_club_short_name_not_blank
      check (btrim(club_short_name) <> '');
  end if;
end;
$$;

create unique index if not exists clubs_club_short_name_normalized_unique
  on public.clubs (lower(btrim(club_short_name)));

comment on index public.clubs_club_short_name_normalized_unique is
  'Гарантирует однозначность разрешения club_short_name -> club_id для resolve_trainer_login_email()/resolve_family_login_email() (обычный SELECT INTO в PL/pgSQL молча берёт произвольную строку при дубликате, не бросает ошибку). Уникальность по lower(btrim(...)) — строже точного сравнения, которое реально делают эти RPC, осознанно (defense-in-depth против будущих почти-дубликатов), не меняет их поведение и не блокирует существующие данные (production-диагностика подтвердила отсутствие дубликатов до применения).';

comment on constraint clubs_club_short_name_not_blank on public.clubs is
  'Запрещает пустой/состоящий из пробелов club_short_name — такое значение не должно участвовать в разрешении технического email логина (resolve_trainer_login_email/resolve_family_login_email).';


-- =====================================================================
-- MIGRATION 016 — trainer_groups_rpc
-- Назначение: get_current_trainer_groups() — список групп текущего
-- активного тренера (чужие таблицы trainers/trainer_groups/groups,
-- только SELECT).
-- =====================================================================

create or replace function public.get_current_trainer_groups()
returns table (
  group_id text,
  group_name text,
  category text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_trainer_account_id uuid;
  v_trainer_row_id bigint;
  v_club_id text;
  v_trainer_text_id text;
begin
  v_trainer_account_id := private.current_active_trainer_account_id();

  if v_trainer_account_id is null then
    return;
  end if;

  select ta.trainer_row_id, ta.club_id
    into v_trainer_row_id, v_club_id
  from public.trainer_accounts ta
  where ta.id = v_trainer_account_id;

  select t.trainer_id into v_trainer_text_id
  from public.trainers t
  where t.id = v_trainer_row_id;

  if v_trainer_text_id is null then
    return;
  end if;

  return query
  select
    g.gruppe_id::text as group_id,
    g.gruppenname as group_name,
    g.alter as category,
    g.aktiv as is_active
  from public.trainer_groups tg
  join public.groups g on g.gruppe_id = tg.gruppe_id
  where tg.trainer_id = v_trainer_text_id
    and tg.club_id = v_club_id
    and g.club_id = v_club_id;
end;
$$;

comment on function public.get_current_trainer_groups() is
  'SECURITY DEFINER: группы ТЕКУЩЕГО активного тренера (auth.uid() -> private.current_active_trainer_account_id(), без параметров — подмена чужих групп/клуба с клиента невозможна). 0 строк = не тренер, неактивен, или групп нет — не ошибка. Читает чужие таблицы trainers/trainer_groups/groups (JCL_Gruppen) только на SELECT, ничего не изменяет и не создаёт прямой клиентский GRANT на них. Персональные данные детей/семей не возвращает и не читает.';

revoke all on function public.get_current_trainer_groups() from public;
revoke all on function public.get_current_trainer_groups() from anon;
grant execute on function public.get_current_trainer_groups() to authenticated;


-- =====================================================================
-- MIGRATION 017 — trainer_student_access_helper
-- Назначение: can_trainer_access_student(student_id) — проверка доступа
-- текущего активного тренера к конкретному ученику через членство в группе.
-- =====================================================================

create or replace function public.can_trainer_access_student(p_student_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_trainer_account_id uuid;
  v_club_id text;
  v_trainer_text_id text;
  v_student_club_id text;
  v_student_gruppe_id text;
  v_group_ids text[];
begin
  v_trainer_account_id := private.current_active_trainer_account_id();

  if v_trainer_account_id is null then
    return false;
  end if;

  select ta.club_id into v_club_id
  from public.trainer_accounts ta
  where ta.id = v_trainer_account_id;

  select t.trainer_id into v_trainer_text_id
  from public.trainers t
  join public.trainer_accounts ta on ta.trainer_row_id = t.id
  where ta.id = v_trainer_account_id;

  if v_trainer_text_id is null then
    return false;
  end if;

  select s.club_id, s.gruppe_id
    into v_student_club_id, v_student_gruppe_id
  from public.students s
  where s.id = p_student_id;

  if v_student_club_id is null or v_student_club_id <> v_club_id then
    return false;
  end if;

  select array_agg(trim(g))
    into v_group_ids
  from regexp_split_to_table(coalesce(v_student_gruppe_id, ''), '[;,]') as g
  where trim(g) <> '';

  if v_group_ids is null or array_length(v_group_ids, 1) is null then
    return false;
  end if;

  return exists (
    select 1
    from public.trainer_groups tg
    where tg.trainer_id = v_trainer_text_id
      and tg.club_id = v_club_id
      and tg.gruppe_id::text = any(v_group_ids)
  );
end;
$$;

comment on function public.can_trainer_access_student(bigint) is
  'SECURITY DEFINER: true, если auth.uid() — активный тренер (current_active_trainer_account_id()), у которого ученик p_student_id состоит хотя бы в одной из его групп (students.gruppe_id разобран по ;/,, сравнение точное, не substring), и club_id совпадает. false для любого другого случая, включая отсутствие тренерской сессии. Используется будущими RPC тренерской страницы ученика (Trainer Family Block) как единая точка проверки доступа.';

revoke all on function public.can_trainer_access_student(bigint) from public;
revoke all on function public.can_trainer_access_student(bigint) from anon;
grant execute on function public.can_trainer_access_student(bigint) to authenticated;


-- =====================================================================
-- MIGRATION 018 — search_trainer_students_rpc
-- Назначение: search_trainer_students(query) — read-only поиск учеников
-- только в группах текущего активного тренера.
-- =====================================================================

create or replace function public.search_trainer_students(p_query text)
returns table (
  id text,
  vorname text,
  nachname text,
  geburtsdatum date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_trainer_account_id uuid;
  v_club_id text;
  v_trainer_text_id text;
  v_query text := trim(coalesce(p_query, ''));
begin
  v_trainer_account_id := private.current_active_trainer_account_id();

  if v_trainer_account_id is null or v_query = '' then
    return;
  end if;

  select ta.club_id into v_club_id
  from public.trainer_accounts ta
  where ta.id = v_trainer_account_id;

  select t.trainer_id into v_trainer_text_id
  from public.trainers t
  join public.trainer_accounts ta on ta.trainer_row_id = t.id
  where ta.id = v_trainer_account_id;

  if v_trainer_text_id is null then
    return;
  end if;

  return query
  select distinct s.id::text as id, s.vorname, s.nachname, s.geburtsdatum
  from public.students s
  where s.club_id = v_club_id
    and (s.nachname ilike '%' || v_query || '%' or s.vorname ilike '%' || v_query || '%')
    and exists (
      select 1
      from regexp_split_to_table(coalesce(s.gruppe_id, ''), '[;,]') as g
      join public.trainer_groups tg
        on tg.gruppe_id::text = trim(g)
       and tg.trainer_id = v_trainer_text_id
       and tg.club_id = v_club_id
      where trim(g) <> ''
    )
  order by s.nachname, s.vorname
  limit 10;
end;
$$;

comment on function public.search_trainer_students(text) is
  'SECURITY DEFINER: read-only поиск учеников (ilike по nachname/vorname), ограниченный ТОЛЬКО группами текущего активного тренера (auth.uid() -> current_active_trainer_account_id() -> trainer_groups). Пустой запрос или неактивный/отсутствующий тренер -> 0 строк, не ошибка. limit 10, сортировка по nachname/vorname. Персональные данные семьи/договора не читаются и не возвращаются.';

revoke all on function public.search_trainer_students(text) from public;
revoke all on function public.search_trainer_students(text) from anon;
grant execute on function public.search_trainer_students(text) to authenticated;


-- =====================================================================
-- MIGRATION 019 — trainer_has_active_account_rpc
-- Назначение: trainer_has_active_account(trainer_id, club_id) — anon-
-- вызываемый boolean-RPC для ветвления PIN/Auth flow в JCL_Gruppen ДО входа.
-- =====================================================================

create or replace function public.trainer_has_active_account(
  p_trainer_id text,
  p_club_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trainer_accounts ta
    join public.trainers t on t.id = ta.trainer_row_id
    where t.trainer_id = p_trainer_id
      and t.club_id = p_club_id
      and ta.club_id = p_club_id
      and ta.is_active = true
  );
$$;

comment on function public.trainer_has_active_account(text, text) is
  'SECURITY DEFINER: true, если у тренера (по trainer_id+club_id — бизнес-идентификаторы JCL_Gruppen, не PK) есть активная строка trainer_accounts. Возвращает ТОЛЬКО boolean — email/auth_user_id/login_name никогда не раскрываются. Используется JCL_Gruppen ДО входа для ветвления PIN/Auth flow, вызывается анонимно.';

revoke all on function public.trainer_has_active_account(text, text) from public;
grant execute on function public.trainer_has_active_account(text, text) to anon, authenticated;


-- =====================================================================
-- MIGRATION 020 — grant_resolve_trainer_login_email_service_role
-- Назначение: EXECUTE для service_role (Edge Function manage-trainer-account
-- строит тот же технический email, что и вход).
-- =====================================================================

grant execute on function public.resolve_trainer_login_email(text, text) to service_role;


-- =====================================================================
-- MIGRATION 021 — grant_family_club_exists_service_role
-- Назначение: EXECUTE для service_role (нужен триггеру
-- enforce_trainer_accounts_club_exists при INSERT от Edge Function).
-- =====================================================================

grant execute on function public.family_club_exists(text) to service_role;


-- =====================================================================
-- MIGRATION 022 — grant_normalize_login_name_service_role
-- Назначение: EXECUTE для service_role (вычисление GENERATED-колонки
-- normalized_login_name при INSERT от Edge Function).
-- =====================================================================

grant execute on function public.normalize_login_name(text) to service_role;


-- =====================================================================
-- MIGRATION 023 — grant_rename_trainer_login_service_role
-- Назначение: EXECUTE для service_role (Edge Function вызывает
-- rename_trainer_login при смене login_name).
-- =====================================================================

grant execute on function public.rename_trainer_login(uuid, text) to service_role;


-- =====================================================================
-- MIGRATION 024 — trainer_account_audit_log
-- Назначение: таблица аудита операций manage-trainer-account (только ID +
-- тип операции + timestamp, без секретов) и SECURITY DEFINER RPC
-- log_trainer_account_operation — единственный вход в таблицу.
-- =====================================================================

create table public.trainer_account_audit_log (
  id uuid primary key default gen_random_uuid(),
  performed_by_auth_user_id uuid not null references auth.users(id) on delete restrict,
  target_trainer_row_id bigint not null references public.trainers(id) on delete restrict,
  target_trainer_id text not null,
  club_id text not null,
  operation text not null check (operation in ('create', 'update', 'activate', 'deactivate')),
  created_at timestamptz not null default now()
);

alter table public.trainer_account_audit_log enable row level security;

create or replace function public.log_trainer_account_operation(
  p_performed_by_auth_user_id uuid,
  p_target_trainer_row_id bigint,
  p_target_trainer_id text,
  p_club_id text,
  p_operation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.trainer_account_audit_log (
    performed_by_auth_user_id, target_trainer_row_id, target_trainer_id, club_id, operation
  ) values (
    p_performed_by_auth_user_id, p_target_trainer_row_id, p_target_trainer_id, p_club_id, p_operation
  );
end;
$$;

revoke all on function public.log_trainer_account_operation(uuid, bigint, text, text, text) from public;
grant execute on function public.log_trainer_account_operation(uuid, bigint, text, text, text) to service_role;


-- =====================================================================
-- MIGRATION 025 — trainer_has_any_account_rpc
-- Назначение: trainer_has_any_account(trainer_id, club_id) — отличает
-- "никогда не мигрирован" от "мигрирован, но деактивирован", закрывает
-- обход деактивации через legacy PIN.
-- =====================================================================

create or replace function public.trainer_has_any_account(
  p_trainer_id text,
  p_club_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trainer_accounts ta
    join public.trainers t on t.id = ta.trainer_row_id
    where t.trainer_id = p_trainer_id
      and t.club_id = p_club_id
      and ta.club_id = p_club_id
  );
$$;

comment on function public.trainer_has_any_account(text, text) is
  'SECURITY DEFINER: true, если у тренера (по trainer_id+club_id) есть строка trainer_accounts ВНЕ ЗАВИСИМОСТИ от is_active. Используется JCL_Gruppen, чтобы отличить "никогда не мигрирован" (безопасный откат на legacy PIN) от "мигрирован, но деактивирован" (доступ должен быть заблокирован целиком, а не откатываться на PIN). Возвращает только boolean.';

revoke all on function public.trainer_has_any_account(text, text) from public;
grant execute on function public.trainer_has_any_account(text, text) to anon, authenticated;


-- =====================================================================
-- MIGRATION 026 — trainer_accounts_unique_trainer_row
-- Назначение: UNIQUE(trainer_row_id) — закрывает race condition при
-- параллельном создании двух аккаунтов одному тренеру.
-- =====================================================================

alter table public.trainer_accounts
  add constraint trainer_accounts_trainer_row_id_key unique (trainer_row_id);


COMMIT;

-- =====================================================================
-- ПОСЛЕ COMMIT: следующий шаг — TRAINER_AUTH_POST_DEPLOY_SMOKE_TEST.sql
-- (read-only). Если требуется bootstrap первого администратора (обычно
-- требуется — см. TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE.sql) — выполнить
-- его ПЕРЕД smoke test, чтобы соответствующая проверка в smoke test также
-- прошла.
-- =====================================================================
