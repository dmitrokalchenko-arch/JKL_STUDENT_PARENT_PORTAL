-- Club Calendar Foundation (Rating Database Design, Migration A).
--
-- Единый календарь клуба: IANA-часовой пояс на уровне клуба. Это фундамент
-- для будущих расчётов по «местному дню клуба» (Rating и др.), но САМА
-- миграция Rating НЕ реализует: нет таблиц истории Kyu / этапов / журнала /
-- настроек рейтинга, нет публичных RPC, нет bootstrap.
--
-- Что делает миграция:
--   1. public.club_portal_settings (club_id PK, timezone NOT NULL, created_at,
--      updated_at, updated_note).
--   2. Триггер валидации: club_id существует в public.clubs.club_id,
--      timezone — имя из pg_catalog.pg_timezone_names (никаких фиксированных
--      списков и UTC-смещений вроде '+01:00').
--   3. updated_at обновляется существующим public.set_updated_at() (001).
--   4. RLS включён без policies; у PUBLIC/anon/authenticated прав нет;
--      service_role — только SELECT (тот же паттерн, что таблицы 076).
--      Запись — только владелец (postgres) отдельной owner-controlled
--      миграцией/операцией; authenticated RPC для смены пояса нет.
--   5. private.club_timezone(text) — fail closed: нет строки ->
--      exception 'club_timezone_not_configured'. Никакого fallback,
--      никакого Europe/Berlin внутри хелпера.
--   6. private.club_today(text) — (now() AT TIME ZONE club_timezone)::date.
--   7. Единственная строка: ('jcl', 'Europe/Berlin') — после проверки, что
--      клуб 'jcl' существует (иначе миграция падает, orphan не создаётся).
--      Для остальных клубов строк НЕТ (пояс не подтверждён -> fail closed).
--   8. Самопроверка — любое расхождение откатывает всё.
--
-- НЕ делает: не меняет get_student_page_access (остаётся на константе
-- Europe/Berlin), public.clubs, attendance, students, trainers, JCL
-- todayBerlin(), Student Page, frontend.
--
-- Проверка: docs/database/CLUB_CALENDAR_FOUNDATION_SQL_VERIFICATION.md

begin;

-- ── 1. Таблица ───────────────────────────────────────────────────────────
-- club_id — text slug (clubs.club_id, напр. 'jcl'), НЕ clubs.id (uuid).
-- Формального FOREIGN KEY нет по той же причине, что во всём проекте
-- (clubs.club_id не подтверждён как UNIQUE в production, см. 001) —
-- существование клуба проверяет триггер ниже.
create table public.club_portal_settings (
  club_id text primary key,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_note text null,
  constraint club_portal_settings_club_id_format_check
    check (club_id = btrim(club_id) and club_id <> ''),
  constraint club_portal_settings_timezone_format_check
    check (timezone = btrim(timezone) and timezone <> ''),
  constraint club_portal_settings_updated_note_check
    check (updated_note is null or btrim(updated_note) <> '')
);

comment on table public.club_portal_settings is
  'Общие портальные настройки клуба (календарь). timezone — IANA-имя из pg_timezone_names; используется для «местного дня клуба». Нет строки -> пояс не настроен -> зависимые расчёты fail closed (private.club_timezone). Запись только владельцем (owner-controlled migration); клиентских прав нет.';
comment on column public.club_portal_settings.club_id is
  'clubs.club_id (text slug, напр. ''jcl''), НЕ clubs.id (uuid). Существование проверяет trg_club_portal_settings_validate.';
comment on column public.club_portal_settings.timezone is
  'IANA-часовой пояс клуба (напр. Europe/Berlin). Только имена из pg_catalog.pg_timezone_names; смещения вроде +01:00 запрещены.';

-- ── 2. Валидация club_id / timezone ──────────────────────────────────────
-- SECURITY DEFINER + search_path = '': проверка не должна зависеть от
-- RLS/прав на legacy public.clubs (тот же класс, что
-- enforce_trainer_accounts_club_match в 011/014). Legacy
-- public.family_club_exists() не вызывается: у неё search_path = public
-- (не '') — новый код не наследует это допущение. RETURNS TRIGGER — прямой
-- вызов через RPC невозможен; REVOKE всё равно явный (default privileges).
create function private.enforce_club_portal_settings_valid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.clubs c where c.club_id = new.club_id
  ) then
    raise exception 'club_portal_settings_unknown_club'
      using detail = format('club_id %L does not exist in public.clubs.club_id', new.club_id);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name = new.timezone
  ) then
    raise exception 'club_portal_settings_invalid_timezone'
      using detail = format('timezone %L is not a pg_timezone_names name', new.timezone);
  end if;

  return new;
end;
$$;

comment on function private.enforce_club_portal_settings_valid() is
  'Триггер club_portal_settings: club_id существует в public.clubs.club_id; timezone есть в pg_catalog.pg_timezone_names. SECURITY DEFINER, search_path=''''. Без клиентского EXECUTE.';

revoke all on function private.enforce_club_portal_settings_valid() from public, anon, authenticated;
revoke all on function private.enforce_club_portal_settings_valid() from service_role;

create trigger trg_club_portal_settings_validate
  before insert or update on public.club_portal_settings
  for each row execute function private.enforce_club_portal_settings_valid();

-- updated_at — существующая общая триггерная функция (001), без дублирования.
create trigger trg_club_portal_settings_set_updated_at
  before update on public.club_portal_settings
  for each row execute function public.set_updated_at();

-- ── 3. RLS / права ───────────────────────────────────────────────────────
-- Default privileges проекта открывают новые таблицы клиентским ролям —
-- поэтому явный REVOKE. Policies не создаются. service_role — только
-- SELECT (как таблицы 076): ни один сервер не пишет эту таблицу; смена пояса
-- — owner-controlled операция владельца (postgres). Sequence нет (PK text).
alter table public.club_portal_settings enable row level security;

revoke all on table public.club_portal_settings from public, anon, authenticated;
revoke all on table public.club_portal_settings from service_role;
grant select on table public.club_portal_settings to service_role;

-- ── 4. private-хелперы ───────────────────────────────────────────────────
-- Паттерн существующих private-хелперов (014/076/078): SECURITY DEFINER,
-- search_path = '', owner postgres, EXECUTE отозван у PUBLIC/anon/
-- authenticated, service_role EXECUTE НЕ выдаётся — вызываются только
-- изнутри SECURITY DEFINER функций (owner postgres). Ни один существующий
-- private-хелпер не выдаёт EXECUTE service_role; будущие серверные операции
-- тоже будут definer-функциями — прямой вызов не требуется.
create function private.club_timezone(p_club_id text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
begin
  select s.timezone into v_timezone
  from public.club_portal_settings s
  where s.club_id = p_club_id;

  if v_timezone is null then
    raise exception 'club_timezone_not_configured'
      using detail = format('club_id %L has no club_portal_settings row', p_club_id),
            hint = 'Timezone is configured only by an owner-controlled migration; no fallback.';
  end if;

  return v_timezone;
end;
$$;

comment on function private.club_timezone(text) is
  'IANA-пояс клуба из public.club_portal_settings. Нет строки (или NULL club_id) -> exception club_timezone_not_configured. Fail closed: никакого fallback/default. Только для вызова из SECURITY DEFINER функций.';

revoke all on function private.club_timezone(text) from public, anon, authenticated;
revoke all on function private.club_timezone(text) from service_role;

create function private.club_today(p_club_id text)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (pg_catalog.now() at time zone private.club_timezone(p_club_id))::date;
$$;

comment on function private.club_today(text) is
  'Текущая местная дата клуба: (now() AT TIME ZONE private.club_timezone(club_id))::date. Не настроен пояс -> exception club_timezone_not_configured. Только для вызова из SECURITY DEFINER функций.';

revoke all on function private.club_today(text) from public, anon, authenticated;
revoke all on function private.club_today(text) from service_role;

-- ── 5. JCL ───────────────────────────────────────────────────────────────
-- Europe/Berlin для 'jcl' подтверждён владельцем (решение C3). Для других
-- клубов пояс не подтверждён — строки не создаются.
do $$
begin
  if not exists (select 1 from public.clubs c where c.club_id = 'jcl') then
    raise exception '079: club jcl does not exist in public.clubs.club_id — refusing to create orphan setting';
  end if;
end;
$$;

insert into public.club_portal_settings (club_id, timezone, updated_note)
values ('jcl', 'Europe/Berlin', 'Migration 079: owner-confirmed club timezone (Rating design decision C3)');

-- ── 6. Самопроверка ──────────────────────────────────────────────────────
-- Каталог + функциональные проверки. Негативные INSERT выполняются во
-- вложенных блоках с EXCEPTION (savepoint) — их эффекты откатываются всегда.
-- Любое расхождение — exception -> COMMIT ниже выполняется как ROLLBACK.
do $$
declare
  v_tbl regclass := to_regclass('public.club_portal_settings');
  v_fn regprocedure;
  v_sig text;
  v_role text;
  v_priv text;
  v_count integer;
  v_text text;
  v_probe text;
  v_failed boolean;
begin
  if v_tbl is null then
    raise exception '079 check: public.club_portal_settings missing';
  end if;

  -- Колонки / типы / NOT NULL
  select count(*) into v_count
  from pg_attribute a
  where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped;
  if v_count <> 5 then
    raise exception '079 check: expected 5 columns, found %', v_count;
  end if;

  if (
    select count(*) from pg_attribute a
    where a.attrelid = v_tbl and not a.attisdropped
      and (a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull) in (
        ('club_id', 'text', true),
        ('timezone', 'text', true),
        ('created_at', 'timestamp with time zone', true),
        ('updated_at', 'timestamp with time zone', true),
        ('updated_note', 'text', false)
      )
  ) <> 5 then
    raise exception '079 check: column names/types/nullability mismatch';
  end if;

  -- PK (club_id)
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = v_tbl and c.contype = 'p'
      and c.conkey = array[(select a.attnum from pg_attribute a
                            where a.attrelid = v_tbl and a.attname = 'club_id')]::smallint[]
  ) then
    raise exception '079 check: primary key is not (club_id)';
  end if;

  -- RLS включён, policies нет
  if not (select c.relrowsecurity from pg_class c where c.oid = v_tbl) then
    raise exception '079 check: RLS is not enabled';
  end if;
  select count(*) into v_count from pg_policy p where p.polrelid = v_tbl;
  if v_count <> 0 then
    raise exception '079 check: % policies exist', v_count;
  end if;

  -- Клиентские роли без прав; service_role — только SELECT
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, v_tbl, v_priv) then
        raise exception '079 check: % has % on public.club_portal_settings', v_role, v_priv;
      end if;
    end loop;
  end loop;
  if exists (
    select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = v_tbl and a.grantee = 0
  ) then
    raise exception '079 check: PUBLIC has privileges on public.club_portal_settings';
  end if;
  if not has_table_privilege('service_role', v_tbl, 'SELECT') then
    raise exception '079 check: service_role lacks SELECT';
  end if;
  foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
    if has_table_privilege('service_role', v_tbl, v_priv) then
      raise exception '079 check: service_role unexpectedly has %', v_priv;
    end if;
  end loop;

  -- Триггеры на месте и включены
  select count(*) into v_count
  from pg_trigger t
  where t.tgrelid = v_tbl and not t.tgisinternal and t.tgenabled::text = 'O'
    and t.tgname in ('trg_club_portal_settings_validate', 'trg_club_portal_settings_set_updated_at');
  if v_count <> 2 then
    raise exception '079 check: expected 2 enabled triggers, found %', v_count;
  end if;

  -- Функции: SECURITY DEFINER, search_path = '', owner postgres, без EXECUTE
  -- у PUBLIC/anon/authenticated и без EXECUTE у service_role
  foreach v_sig in array array[
    'private.enforce_club_portal_settings_valid()',
    'private.club_timezone(text)',
    'private.club_today(text)'
  ] loop
    v_fn := to_regprocedure(v_sig);
    if v_fn is null then
      raise exception '079 check: % not found', v_sig;
    end if;
    if not (select p.prosecdef and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
                   and pg_get_userbyid(p.proowner) = 'postgres'
            from pg_proc p where p.oid = v_fn) then
      raise exception '079 check: % is not SECURITY DEFINER / search_path="" / owner postgres', v_sig;
    end if;
    if exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception '079 check: PUBLIC EXECUTE on %', v_sig;
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception '079 check: % has EXECUTE on %', v_role, v_sig;
      end if;
    end loop;
  end loop;

  -- Данные: ровно одна строка, только jcl / Europe/Berlin
  select count(*) into v_count from public.club_portal_settings;
  if v_count <> 1 then
    raise exception '079 check: expected exactly 1 row, found %', v_count;
  end if;
  if not exists (
    select 1 from public.club_portal_settings s
    where s.club_id = 'jcl' and s.timezone = 'Europe/Berlin'
  ) then
    raise exception '079 check: jcl row missing or timezone is not Europe/Berlin';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names tz where tz.name = 'Europe/Berlin') then
    raise exception '079 check: Europe/Berlin is not in pg_timezone_names';
  end if;

  -- Хелперы
  if private.club_timezone('jcl') is distinct from 'Europe/Berlin' then
    raise exception '079 check: club_timezone(jcl) is not Europe/Berlin';
  end if;
  if pg_typeof(private.club_today('jcl')) <> 'date'::regtype
     or private.club_today('jcl') is distinct from (now() at time zone 'Europe/Berlin')::date then
    raise exception '079 check: club_today(jcl) is not the Europe/Berlin date';
  end if;

  -- Ненастроенный / несуществующий клуб -> fail closed
  v_probe := '__079_unconfigured_' || md5(clock_timestamp()::text);
  foreach v_text in array array[v_probe, null] loop
    v_failed := false;
    begin
      perform private.club_timezone(v_text);
    exception when others then
      v_failed := sqlerrm = 'club_timezone_not_configured';
    end;
    if not v_failed then
      raise exception '079 check: club_timezone(%) did not fail closed', coalesce(v_text, 'NULL');
    end if;

    v_failed := false;
    begin
      perform private.club_today(v_text);
    exception when others then
      v_failed := sqlerrm = 'club_timezone_not_configured';
    end;
    if not v_failed then
      raise exception '079 check: club_today(%) did not fail closed', coalesce(v_text, 'NULL');
    end if;
  end loop;

  -- Невалидный пояс (включая UTC-смещение) -> ошибка
  foreach v_text in array array['Mars/Olympus_Mons', '+01:00', 'europe/berlin'] loop
    v_failed := false;
    begin
      update public.club_portal_settings set timezone = v_text where club_id = 'jcl';
    exception when others then
      v_failed := sqlerrm = 'club_portal_settings_invalid_timezone';
    end;
    if not v_failed then
      raise exception '079 check: invalid timezone % was accepted', v_text;
    end if;
  end loop;

  -- Orphan-клуб -> ошибка
  if exists (select 1 from public.clubs c where c.club_id = v_probe) then
    raise exception '079 check: probe club id unexpectedly exists';
  end if;
  v_failed := false;
  begin
    insert into public.club_portal_settings (club_id, timezone) values (v_probe, 'Europe/Berlin');
  exception when others then
    v_failed := sqlerrm = 'club_portal_settings_unknown_club';
  end;
  if not v_failed then
    raise exception '079 check: orphan club insert was accepted';
  end if;

  -- После негативных проверок состояние не изменилось
  if (select count(*) from public.club_portal_settings) <> 1
     or private.club_timezone('jcl') is distinct from 'Europe/Berlin' then
    raise exception '079 check: state changed by negative probes';
  end if;

  -- Rating core НЕ создан этой миграцией
  foreach v_text in array array[
    'public.club_rating_config',
    'public.student_kyu_history',
    'public.student_rating_stages',
    'public.student_rating_entries',
    'public.club_rating_settings_versions',
    'public.club_rating_settings_items'
  ] loop
    if to_regclass(v_text) is not null then
      raise exception '079 check: unexpected Rating table % exists', v_text;
    end if;
  end loop;
end;
$$;

commit;
