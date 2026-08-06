-- Trainer Auth: таблица trainer_accounts — связь auth.users с тренером.
--
-- Спроектировано отдельным согласованным этапом (архитектурный анализ
-- Trainer Auth, backend-контракт с уточнениями). Ключевые инварианты:
--   - семейная модель (families/family_guardians/family_students) НЕ
--     затрагивается этой миграцией ни единой строкой;
--   - тренерский и семейный аккаунт — ВСЕГДА разные auth.users, даже если
--     это один и тот же реальный человек (родитель может быть и тренером,
--     но это две независимые записи auth.users, см. архитектурный анализ
--     "модель сессий");
--   - is_active по умолчанию false — активация доступа к /trainer только
--     явным, отдельным действием (иначе массовая миграция тренеров
--     автоматически открыла бы доступ всем разом).
--
-- ТИПЫ: auth_user_id/trainer_row_id/club_id ниже соответствуют уже
-- подтверждённой части реальной схемы (docs/database/EXISTING_DATABASE_AUDIT.md,
-- раздел 5.3): trainers.id — bigint PK (подтверждено). Точный тип и
-- nullable/not null именно trainers.club_id НЕ подтверждены напрямую
-- аудитом (только по аналогии с остальными club_id-колонками проекта,
-- которые везде text) — это осознанное, явно помеченное допущение,
-- требующее проверки на реальной базе перед применением этой миграции
-- к production JCL_Gruppen. См. также комментарий в
-- .local-supabase-test/supabase/migrations/00000000000000_local_jcl_baseline.sql
-- (расширяется этим же этапом для локального тестирования).

-- САМОСТОЯТЕЛЬНАЯ функция, НЕ обёртка над normalize_family_nickname().
-- Первая версия этой миграции была тонкой обёрткой над
-- normalize_family_nickname() — фактический прогон на реальном login_name
-- ('Иван П') показал баг: та функция вырезает всё вне диапазона [a-zA-Z0-9]
-- (regexp_replace(..., '[^a-zA-Z0-9]', '', 'g')), то есть уничтожает ЛЮБЫЕ
-- кириллические (и вообще не-латинские) символы — 'Иван П' превращался бы
-- в пустую строку. normalize_family_nickname() рассчитана на nickname,
-- который семья придумывает сама (латиница ожидаема); login_name тренера
-- строится из реальных ФИО на любом языке — это принципиально другой ввод,
-- требующий Unicode-safe нормализации (только регистр + пробелы, без
-- ограничения алфавита). Семейная функция НЕ меняется (запрещено правилом
-- проекта), вместо этого — независимая реализация здесь.
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
  'Источник истины для доступа именно к /trainer (не путать с активностью auth.users, управляемой Supabase Auth, и не с trainers.aktiv — полем чужой системы JCL_Gruppen, не синхronизируемым автоматически). default false — см. комментарий на таблице.';

create index idx_trainer_accounts_club_id on public.trainer_accounts(club_id);
create index idx_trainer_accounts_trainer_row_id on public.trainer_accounts(trainer_row_id);

create trigger trg_trainer_accounts_set_updated_at
  before update on public.trainer_accounts
  for each row execute function public.set_updated_at();

-- Immutability login_name: обычный UPDATE (клиент, миграция, ручной SQL)
-- всегда блокируется. Единственный контролируемый обход — сессионная GUC
-- 'trainer_accounts.allow_login_rename', выставляемая ТОЛЬКО внутри
-- rename_trainer_login() ниже (is_local=true — не переживает транзакцию,
-- значит не оставляет "открытой лазейки" после её завершения).
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

-- Соответствие club_id ↔ trainers.club_id (через trainer_row_id) — прямая
-- аналогия enforce_family_student_club_match() (migration 1). Составной FK
-- невозможен без UNIQUE(id, club_id) на чужой таблице trainers, которую
-- менять нельзя — поэтому проверка триггером. Явная защита от NULL
-- (v_trainer_club is null or ...) — тот же паттерн, что в
-- enforce_family_student_club_match, иначе "x <> null" тихо пропустило бы
-- несовпадение (в Postgres это даёт NULL, не TRUE).
--
-- ДОПУЩЕНИЕ (см. шапку файла): предполагается, что trainers.club_id — text
-- и NOT NULL, по аналогии с остальной схемой. Не подтверждено напрямую для
-- этой конкретной колонки — требует проверки на реальной базе.
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

-- Проверка существования клуба — ОТДЕЛЬНАЯ от триггера выше проверка
-- (та гарантирует только внутреннюю согласованность trainers/trainer_accounts,
-- не факт существования клуба как такового). Переиспользуем уже
-- существующую family_club_exists() — она не специфична семье по сути,
-- только по месту первого появления (migration 1).
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

-- Административная функция переименования — единственный контролируемый
-- способ изменить login_name (например при смене фамилии тренера).
-- SECURITY DEFINER, без GRANT никому — вызывается только вручную
-- (service_role/Dashboard), не из клиентского приложения. Пересчёт
-- технического email (auth.users.email) в этой функции НЕ выполняется —
-- это отдельная, более широкая операция (согласование входа тренера),
-- явно вне объёма этой функции.
-- ВАЖНО (найдено фактическим тестом, не предположением): set_config(...,
-- is_local=true) держит значение до конца ТРАНЗАКЦИИ, а не до конца
-- текущего вызова функции/оператора. Без явного сброса ниже GUC оставался
-- бы 'true' до конца всей транзакции, вызвавшей rename_trainer_login() —
-- то есть ЛЮБОЙ следующий обычный UPDATE login_name в той же транзакции
-- тоже прошёл бы без блокировки immutability-триггера. Явный сброс сразу
-- после UPDATE закрывает эту лазейку немедленно, а не полагается на конец
-- транзакции. found сохраняется в переменную ДО сброса — set_config сам
-- является PERFORM-вызовом и иначе перезаписал бы FOUND.
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

-- RLS: включаем, но НЕ создаём ни одной policy для authenticated/anon —
-- это намеренный, полный запрет прямого доступа по умолчанию. Единственный
-- путь к данным этой таблицы — RPC следующих шагов (resolve_trainer_login_email,
-- get_current_trainer_profile), оба SECURITY DEFINER. Никакого GRANT
-- SELECT/INSERT/UPDATE/DELETE на trainer_accounts клиентским ролям здесь
-- не выдаётся — по умолчанию Postgres и так их не даёт (тот же принцип,
-- что уже применён к families/family_guardians/family_students).
alter table public.trainer_accounts enable row level security;
