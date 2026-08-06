-- =====================================================================
-- TRAINER_AUTH_PRODUCTION_PREFLIGHT_SINGLE_QUERY.sql
-- =====================================================================
--
-- НАЗНАЧЕНИЕ: объединённый READ-ONLY preflight для единой авторизации
-- тренеров (миграции 011-026) перед их применением на production.
--
-- ⚠️ ТОЛЬКО ДЛЯ РУЧНОГО ЗАПУСКА ВЛАДЕЛЬЦЕМ В PRODUCTION SQL EDITOR.
-- Этот файл НЕ выполнялся против production в рамках подготовки. Ни один
-- SELECT из него не был отправлен на сервер whorwleydkziejjafsea.
--
-- ЭТОТ СКРИПТ ЯВЛЯЕТСЯ READ-ONLY:
--   - содержит только SELECT/WITH...SELECT/UNION ALL;
--   - не содержит INSERT/UPDATE/DELETE/MERGE/CREATE/ALTER/DROP/TRUNCATE/
--     GRANT/REVOKE/CALL/DO/COPY/VACUUM/ANALYZE;
--   - не создаёт временных таблиц, функций, процедур;
--   - не вызывает Edge Functions;
--   - не создаёт и не изменяет auth.users;
--   - не выводит email/UUID/trainer_id/login_name/ФИО/PIN/pin_hash/JWT/ключи
--     (только агрегаты, метаданные схемы и типы объектов).
--
-- ПЕРЕД ЗАПУСКОМ:
--   1. Визуально убедитесь, что в Supabase Dashboard выбран ИМЕННО проект
--      с project ref "whorwleydkziejjafsea" (проверьте URL страницы и/или
--      название проекта в шапке Dashboard) — НЕ локальный стенд, НЕ другой
--      проект.
--   2. Результат выполнения нужно сохранить (экспорт CSV или копирование
--      таблицы результата) и передать для анализа готовности миграций
--      019-026 — не изменяйте найденные проблемы вручную по ходу проверки.
--
-- Скрипт НЕ применяет миграции и не изменяет данные ни при каких условиях.
--
-- =====================================================================
-- ТЕХНИЧЕСКОЕ ОГРАНИЧЕНИЕ (честно, не скрывается):
-- =====================================================================
-- PostgreSQL резолвит имена таблиц в FROM-предложении НА ЭТАПЕ РАЗБОРА
-- запроса — если конкретная таблица (например public.trainer_accounts)
-- ещё не существует, ЛЮБОЙ SELECT, читающий из неё СТРОКИ ДАННЫХ, упадёт
-- с ошибкой "relation does not exist" НЕЗАВИСИМО от любых CASE/WHERE-
-- условий вокруг него. Это ограничение СУБД, не обойти его можно только
-- динамическим SQL (EXECUTE/DO) — а он здесь намеренно не используется,
-- чтобы скрипт оставался очевидно read-only и статически проверяемым.
--
-- Поэтому скрипт разделён на ПЯТЬ ЧАСТЕЙ:
--
--   ЧАСТЬ 1 (ниже) — ПОЛНОСТЬЮ БЕЗОПАСНА при любом состоянии базы. Не
--   падает, даже если trainer_accounts/trainer_account_audit_log/
--   supabase_migrations.schema_migrations/любая функция ещё не созданы.
--   Построена ИСКЛЮЧИТЕЛЬНО через to_regclass(), to_regprocedure(),
--   has_table_privilege()/has_function_privilege() с oid-аргументом
--   (безопасно возвращают NULL/false на отсутствующий объект, В ОТЛИЧИЕ
--   от приведения типа ::regclass, которое падает) и information_schema/
--   pg_catalog по строковому имени (тоже безопасно — просто не находит
--   строк). Покрывает: окружение, существование объектов (включая саму
--   таблицу истории миграций — только факт существования, БЕЗ чтения её
--   строк), структуру/constraints/triggers trainer_accounts, совместимость
--   типов, функции и их гранты, RLS и права на таблицы, предварительную
--   (структурную) готовность миграций 019-026.
--
--   БЫВШЕЕ ДОПУЩЕНИЕ ПРО supabase_migrations.schema_migrations СНЯТО:
--   фактический прогон в production SQL Editor вернул
--   "ERROR: 42P01: relation supabase_migrations.schema_migrations does not
--   exist" — то есть эта таблица НЕ гарантированно существует на реальном
--   production (в отличие от изначального предположения в предыдущей
--   версии этого файла). Часть 1 теперь проверяет её существование ТОЛЬКО
--   через to_regclass(), никогда не читает её строки напрямую.
--
--   ЧАСТЬ 1Б — итоговые счётчики только по базовому окружению Части 1.
--   Полностью безопасна, той же природы, что и Часть 1.
--
--   ЧАСТЬ 1В (MIGRATION HISTORY OPTIONAL) — ЯВНО ОПЦИОНАЛЬНА. Читает
--   РЕАЛЬНЫЕ СТРОКИ из supabase_migrations.schema_migrations (версии
--   011-026 конкретно). ЗАПУСКАТЬ ТОЛЬКО ЕСЛИ Часть 1 показала
--   "B_MIGRATIONS / migration_history_table" = GREEN. Если YELLOW
--   ("missing") — эта часть гарантированно упадёт с той же ошибкой, что
--   уже наблюдалась в production; НЕ запускайте её в этом случае.
--
--   ЧАСТЬ 2 (после Части 1В, отдельный statement) — читает ФАКТИЧЕСКИЕ
--   СТРОКИ данных (count(*) из trainer_accounts/trainers/clubs) для
--   агрегатной проверки дублей/сирот/лимитов длины и bootstrap-
--   администратора. ЭТУ ЧАСТЬ МОЖНО ЗАПУСКАТЬ ТОЛЬКО ЕСЛИ Часть 1
--   подтвердила, что public.trainer_accounts существует (строка
--   "A_ENVIRONMENT / table public.trainer_accounts exists" = GREEN).
--   Если Часть 1 показала MISSING — НЕ запускайте Часть 2, она гарантированно
--   завершится ошибкой Postgres "relation does not exist"; это ожидаемо и
--   означает то же самое, что "миграции ещё не применялись", просто через
--   явную ошибку СУБД вместо строки в результате.
--
--   ЧАСТЬ 2Б — итоговые счётчики по Части 2. Той же природы, что и Часть 2
--   (запускать только вместе с ней).
--
-- ВАЖНО про готовность миграций (I_MIGRATION_READINESS в Части 1):
-- отсутствие или недоступность таблицы истории миграций САМА ПО СЕБЕ
-- НЕ является RED — это YELLOW/INFO. Определяющий сигнал для readiness —
-- фактическое наличие объектов схемы (функций/таблиц/constraints),
-- проверенное через to_regclass()/to_regprocedure() — это доступно
-- ВСЕГДА, даже если история миграций недоступна. Часть 1В (если её можно
-- запустить) лишь ДОПОЛНЯЕТ эту картину явной регистрацией версии, не
-- заменяет её.
--
-- Каждая часть возвращает ОДИН result grid с одинаковыми колонками:
--   section | check_name | status | actual_value | expected_value | details
-- status: GREEN / YELLOW / RED / INFO.
-- Сортировка внутри каждой части: RED, затем YELLOW, затem GREEN, затем
-- INFO; внутри статуса — по section, затем check_name.
-- =====================================================================


-- =====================================================================
-- ЧАСТЬ 1 — безопасные catalog-проверки (один SELECT, не падает никогда)
-- =====================================================================

with checks as (

  -- ── A_ENVIRONMENT ────────────────────────────────────────────────
  select 'A_ENVIRONMENT'::text as section, 'current_database'::text as check_name,
         'INFO'::text as status, current_database()::text as actual_value,
         'whorwleydkziejjafsea (проверить визуально в Dashboard)'::text as expected_value,
         'Подтвердите, что это НЕ локальный стенд и НЕ другой проект'::text as details
  union all
  select 'A_ENVIRONMENT', 'current_user', 'INFO', current_user::text, 'роль с правами на information_schema/pg_catalog',
         'Обычно роль SQL Editor имеет достаточно прав для всех проверок ниже'
  union all
  select 'A_ENVIRONMENT', 'current_schema', 'INFO', current_schema::text, 'public', ''
  union all
  select 'A_ENVIRONMENT', 'server_version', 'INFO', current_setting('server_version'), 'любая поддерживаемая Supabase версия', ''
  union all
  select 'A_ENVIRONMENT', 'schema public exists', case when exists(select 1 from pg_namespace where nspname='public') then 'GREEN' else 'RED' end,
         exists(select 1 from pg_namespace where nspname='public')::text, 'true', ''
  union all
  select 'A_ENVIRONMENT', 'schema auth exists', case when exists(select 1 from pg_namespace where nspname='auth') then 'GREEN' else 'RED' end,
         exists(select 1 from pg_namespace where nspname='auth')::text, 'true', ''
  union all
  select 'A_ENVIRONMENT', 'schema supabase_migrations exists', case when exists(select 1 from pg_namespace where nspname='supabase_migrations') then 'GREEN' else 'YELLOW' end,
         exists(select 1 from pg_namespace where nspname='supabase_migrations')::text, 'true',
         'Если false — миграции не отслеживаются стандартным механизмом Supabase CLI, часть B ниже неприменима'
  union all
  select 'A_ENVIRONMENT', 'table public.trainers exists', case when to_regclass('public.trainers') is not null then 'GREEN' else 'RED' end,
         (to_regclass('public.trainers') is not null)::text, 'true',
         'Собственная таблица JCL_Gruppen — должна существовать независимо от миграций 011-026'
  union all
  select 'A_ENVIRONMENT', 'table public.clubs exists', case when to_regclass('public.clubs') is not null then 'GREEN' else 'RED' end,
         (to_regclass('public.clubs') is not null)::text, 'true', ''
  union all
  select 'A_ENVIRONMENT', 'table public.trainer_accounts exists', case when to_regclass('public.trainer_accounts') is not null then 'GREEN' else 'INFO' end,
         (to_regclass('public.trainer_accounts') is not null)::text, 'true или false — оба варианта штатны до применения миграций',
         'false = migration 011 ещё не применена (ожидаемо на первом прогоне preflight); true = уже применена, сверить структуру ниже'
  union all
  select 'A_ENVIRONMENT', 'table auth.users exists', case when to_regclass('auth.users') is not null then 'GREEN' else 'RED' end,
         (to_regclass('auth.users') is not null)::text, 'true', 'Системная таблица Supabase Auth'
  union all
  select 'A_ENVIRONMENT', 'table public.trainer_account_audit_log exists', case when to_regclass('public.trainer_account_audit_log') is not null then 'GREEN' else 'INFO' end,
         (to_regclass('public.trainer_account_audit_log') is not null)::text, 'true или false',
         'false = migration 024 ещё не применена (ожидаемо)'

  -- ── B_MIGRATIONS ─────────────────────────────────────────────────
  -- НАЙДЕНО ФАКТИЧЕСКИМ ЗАПУСКОМ В PRODUCTION SQL EDITOR (не предположением):
  -- "ERROR: 42P01: relation supabase_migrations.schema_migrations does not
  -- exist". Прямое чтение СТРОК из этой таблицы здесь и в I_MIGRATION_READINESS
  -- ниже — небезопасно (см. шапку файла, "ТЕХНИЧЕСКОЕ ОГРАНИЧЕНИЕ"): FROM-
  -- предложение резолвится на этапе разбора запроса независимо от CASE/WHERE.
  -- Единственная безопасная проверка здесь — существование объекта через
  -- to_regclass(), которое возвращает NULL, а не ошибку, если объекта нет.
  -- Фактическое чтение версий 019-026 вынесено в отдельный, явно опциональный
  -- блок ЧАСТЬ 1В ниже (после Части 1Б) — запускать его только если строка
  -- "migration_history_table" ниже показала GREEN.
  union all
  select 'B_MIGRATIONS', 'migration_history_table',
         case when to_regclass('supabase_migrations.schema_migrations') is not null then 'GREEN' else 'YELLOW' end,
         case when to_regclass('supabase_migrations.schema_migrations') is not null then 'present' else 'missing' end,
         'supabase_migrations.schema_migrations',
         case when to_regclass('supabase_migrations.schema_migrations') is not null
              then 'История миграций доступна — версии 019-026 можно проверить в отдельном опциональном блоке ЧАСТЬ 1В'
              else 'История миграций недоступна по ожидаемому пути; версии 019-026 нельзя подтвердить автоматически'
         end
  union all
  select 'B_MIGRATIONS', 'migration_history_table_alt_public',
         case when to_regclass('public.schema_migrations') is not null then 'YELLOW' else 'INFO' end,
         case when to_regclass('public.schema_migrations') is not null then 'present (неожиданно)' else 'not present' end,
         'ожидается отсутствие — альтернативное расположение не используется этим проектом',
         'Проверка альтернативного пути, упомянутая явно, чтобы не предполагать единственное расположение молча'
  union all
  select 'B_MIGRATIONS', 'tables with "migration" in name (any schema)', 'INFO',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind = 'r' and c.relname ilike '%migration%'),
         'обычно 1 (schema_migrations) или 2 (+ seed_migrations на некоторых установках)',
         'Только имена объектов через каталог (pg_class/pg_namespace) — строки НЕ читаются автоматически ни из одной найденной таблицы; при необходимости владелец проверяет вручную'

  -- ── C_STRUCTURE_TRAINER_ACCOUNTS (колонки) ──────────────────────
  union all
  select 'C_STRUCTURE_TRAINER_ACCOUNTS', 'column ' || col_name,
         case when data_type is null then 'RED' else 'GREEN' end,
         coalesce(data_type || ', nullable=' || is_nullable || ', default=' || coalesce(column_default,'-') || ', generated=' || is_generated, 'MISSING'),
         expected_type, ''
  from (values
    ('trainer_row_id','bigint (совместимо с trainers.id)'),
    ('auth_user_id','uuid'),
    ('club_id','text'),
    ('login_name','text'),
    ('normalized_login_name','text, generated'),
    ('is_active','boolean'),
    ('created_at','timestamptz'),
    ('updated_at','timestamptz')
  ) as expected(col_name, expected_type)
  left join information_schema.columns c
    on c.table_schema='public' and c.table_name='trainer_accounts' and c.column_name = expected.col_name

  -- ── C_STRUCTURE_TRAINER_ACCOUNTS (constraints, safe via to_regclass) ─
  union all
  select 'C_STRUCTURE_TRAINER_ACCOUNTS', 'primary key exists',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype='p') then 'GREEN' else 'RED' end,
         exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype='p')::text,
         'true', ''
  union all
  select 'C_STRUCTURE_TRAINER_ACCOUNTS', 'FK trainer_row_id -> trainers.id',
         case when exists(
           select 1 from pg_constraint
           where conrelid = to_regclass('public.trainer_accounts') and contype='f' and confrelid = to_regclass('public.trainers')
         ) then 'GREEN' else 'RED' end,
         coalesce((
           select 'exists, on delete ' || case confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default' else confdeltype::text end
           from pg_constraint
           where conrelid = to_regclass('public.trainer_accounts') and contype='f' and confrelid = to_regclass('public.trainers')
           limit 1
         ), 'missing'),
         'exists, ON DELETE RESTRICT (ожидаемое поведение по дизайну)', ''
  union all
  select 'C_STRUCTURE_TRAINER_ACCOUNTS', 'FK auth_user_id -> auth.users.id',
         case when exists(
           select 1 from pg_constraint
           where conrelid = to_regclass('public.trainer_accounts') and contype='f' and confrelid = to_regclass('auth.users')
         ) then 'GREEN' else 'RED' end,
         coalesce((
           select 'exists, on delete ' || case confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default' else confdeltype::text end
           from pg_constraint
           where conrelid = to_regclass('public.trainer_accounts') and contype='f' and confrelid = to_regclass('auth.users')
           limit 1
         ), 'missing'),
         'exists, ON DELETE CASCADE (ожидаемое поведение по дизайну)', ''
  union all
  select 'C_STRUCTURE_TRAINER_ACCOUNTS', 'UNIQUE(auth_user_id)',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype='u' and pg_get_constraintdef(oid) ilike '%(auth_user_id)%') then 'GREEN' else 'RED' end,
         exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype='u' and pg_get_constraintdef(oid) ilike '%(auth_user_id)%')::text,
         'true', ''
  union all
  select 'C_STRUCTURE_TRAINER_ACCOUNTS', 'UNIQUE(club_id, normalized_login_name)',
         case when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype='u' and pg_get_constraintdef(oid) ilike '%club_id%normalized_login_name%') then 'GREEN' else 'RED' end,
         exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype='u' and pg_get_constraintdef(oid) ilike '%club_id%normalized_login_name%')::text,
         'true', ''
  union all
  select 'C_STRUCTURE_TRAINER_ACCOUNTS', 'UNIQUE(trainer_row_id) [migration 026]',
         case
           when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype='u' and pg_get_constraintdef(oid) ilike '%(trainer_row_id)%') then 'GREEN'
           when to_regclass('public.trainer_accounts') is null then 'INFO'
           else 'YELLOW'
         end,
         coalesce((select pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype='u' and pg_get_constraintdef(oid) ilike '%(trainer_row_id)%' limit 1), 'not found'),
         'GREEN если уже есть (под любым именем) / YELLOW если trainer_accounts существует, но ограничения ещё нет — тогда СНАЧАЛА проверить дубли в Части 2, ПОТОМ применять migration 026',
         'Ищет UNIQUE именно по (trainer_row_id) под ЛЮБЫМ именем ограничения, не только "trainer_accounts_trainer_row_id_key"'
  union all
  select 'C_STRUCTURE_TRAINER_ACCOUNTS', 'CHECK constraints count', 'INFO',
         (select count(*)::text from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype='c'),
         'любое', ''
  union all
  select 'C_STRUCTURE_TRAINER_ACCOUNTS', 'triggers count', 'INFO',
         (select count(*)::text from information_schema.triggers where event_object_schema='public' and event_object_table='trainer_accounts'),
         '4 (club_exists, club_match, login_name_immutable, set_updated_at) — если trainer_accounts уже существует', ''

  -- ── D_TYPE_COMPATIBILITY ─────────────────────────────────────────
  union all
  select 'D_TYPE_COMPATIBILITY', 'trainers.id type (для trainer_row_id)', 'INFO',
         coalesce((select data_type from information_schema.columns where table_schema='public' and table_name='trainers' and column_name='id'), 'MISSING'),
         'bigint или integer', 'Должен быть совместим с trainer_accounts.trainer_row_id (bigint)'
  union all
  select 'D_TYPE_COMPATIBILITY', 'trainers.club_id type', 'INFO',
         coalesce((select data_type from information_schema.columns where table_schema='public' and table_name='trainers' and column_name='club_id'), 'MISSING'),
         'text', ''
  union all
  select 'D_TYPE_COMPATIBILITY', 'clubs.club_id type', 'INFO',
         coalesce((select data_type from information_schema.columns where table_schema='public' and table_name='clubs' and column_name='club_id'), 'MISSING'),
         'text', 'Ключевая колонка, используемая resolve_trainer_login_email и всеми проверками club_id'
  union all
  select 'D_TYPE_COMPATIBILITY', 'trainer_accounts.auth_user_id is uuid',
         case when (select data_type from information_schema.columns where table_schema='public' and table_name='trainer_accounts' and column_name='auth_user_id') = 'uuid' then 'GREEN'
              when to_regclass('public.trainer_accounts') is null then 'INFO' else 'RED' end,
         coalesce((select data_type from information_schema.columns where table_schema='public' and table_name='trainer_accounts' and column_name='auth_user_id'), 'MISSING'),
         'uuid', ''
  union all
  select 'D_TYPE_COMPATIBILITY', 'trainer_accounts.is_active is boolean',
         case when (select data_type from information_schema.columns where table_schema='public' and table_name='trainer_accounts' and column_name='is_active') = 'boolean' then 'GREEN'
              when to_regclass('public.trainer_accounts') is null then 'INFO' else 'RED' end,
         coalesce((select data_type from information_schema.columns where table_schema='public' and table_name='trainer_accounts' and column_name='is_active'), 'MISSING'),
         'boolean', ''

  -- ── E_FUNCTIONS ──────────────────────────────────────────────────
  union all
  select 'E_FUNCTIONS', f.label || ': exists + signature',
         case when to_regprocedure(f.sig) is not null then 'GREEN' else 'INFO' end,
         coalesce((
           select pg_get_function_identity_arguments(p.oid) || ' returns ' || pg_get_function_result(p.oid)
           from pg_proc p where p.oid = to_regprocedure(f.sig)
         ), 'MISSING'),
         f.expected_sig, f.note
  from (values
    ('normalize_login_name', 'public.normalize_login_name(text)', '(p_value text) returns text', 'migration 011, IMMUTABLE'),
    ('resolve_trainer_login_email', 'public.resolve_trainer_login_email(text,text)', '(p_club_short_name text, p_login_name text) returns text', 'migration 012'),
    ('family_club_exists', 'public.family_club_exists(text)', '(p_club_id text) returns boolean', 'migration 001'),
    ('rename_trainer_login', 'public.rename_trainer_login(uuid,text)', '(p_trainer_account_id uuid, p_new_login_name text) returns void', 'migration 011'),
    ('trainer_has_active_account', 'public.trainer_has_active_account(text,text)', '(p_trainer_id text, p_club_id text) returns boolean', 'migration 019'),
    ('trainer_has_any_account', 'public.trainer_has_any_account(text,text)', '(p_trainer_id text, p_club_id text) returns boolean', 'migration 025'),
    ('log_trainer_account_operation', 'public.log_trainer_account_operation(uuid,bigint,text,text,text)', '(p_performed_by_auth_user_id uuid, p_target_trainer_row_id bigint, p_target_trainer_id text, p_club_id text, p_operation text) returns void', 'migration 024')
  ) as f(label, sig, expected_sig, note)
  union all
  select 'E_FUNCTIONS', f.label || ': security/owner/search_path', 'INFO',
         coalesce((
           select (case when p.prosecdef then 'DEFINER' else 'INVOKER' end)
                  || ', owner=' || pg_get_userbyid(p.proowner)
                  || ', config=' || coalesce(array_to_string(p.proconfig, ';'), '(none)')
           from pg_proc p where p.oid = to_regprocedure(f.sig)
         ), 'MISSING — see previous row'),
         'DEFINER, search_path пуст (задан явно, в коде функции)', ''
  from (values
    ('normalize_login_name', 'public.normalize_login_name(text)'),
    ('resolve_trainer_login_email', 'public.resolve_trainer_login_email(text,text)'),
    ('family_club_exists', 'public.family_club_exists(text)'),
    ('rename_trainer_login', 'public.rename_trainer_login(uuid,text)'),
    ('trainer_has_active_account', 'public.trainer_has_active_account(text,text)'),
    ('trainer_has_any_account', 'public.trainer_has_any_account(text,text)'),
    ('log_trainer_account_operation', 'public.log_trainer_account_operation(uuid,bigint,text,text,text)')
  ) as f(label, sig)
  union all
  select 'E_FUNCTIONS', f.label || ': EXECUTE grant to ' || r.display_name,
         case
           when to_regprocedure(f.sig) is null then 'INFO'
           when has_function_privilege(r.role_name, to_regprocedure(f.sig), 'EXECUTE') then
             case when r.role_name = 'public' then 'YELLOW' else 'GREEN' end
           else case when r.role_name = 'service_role' then 'YELLOW' else 'INFO' end
         end,
         case when to_regprocedure(f.sig) is null then 'function missing'
              else has_function_privilege(r.role_name, to_regprocedure(f.sig), 'EXECUTE')::text end,
         case r.display_name
           when 'PUBLIC' then 'false (не должно быть грантов PUBLIC)'
           when 'service_role' then 'true (обязательно для Edge Function — см. миграции 020-024)'
           else 'true для anon/authenticated только там, где предусмотрено дизайном (has_active_account/has_any_account/resolve_trainer_login_email — да; остальные — как правило нет)'
         end,
         ''
  from (values
    ('normalize_login_name', 'public.normalize_login_name(text)'),
    ('resolve_trainer_login_email', 'public.resolve_trainer_login_email(text,text)'),
    ('family_club_exists', 'public.family_club_exists(text)'),
    ('rename_trainer_login', 'public.rename_trainer_login(uuid,text)'),
    ('trainer_has_active_account', 'public.trainer_has_active_account(text,text)'),
    ('trainer_has_any_account', 'public.trainer_has_any_account(text,text)'),
    ('log_trainer_account_operation', 'public.log_trainer_account_operation(uuid,bigint,text,text,text)')
  ) as f(label, sig)
  cross join (values ('anon','anon'),('authenticated','authenticated'),('service_role','service_role'),('public','PUBLIC')) as r(role_name, display_name)

  -- ── H_RLS_GRANTS ─────────────────────────────────────────────────
  union all
  select 'H_RLS_GRANTS', 'RLS enabled on trainer_accounts',
         case when to_regclass('public.trainer_accounts') is null then 'INFO'
              when (select relrowsecurity from pg_class where oid = to_regclass('public.trainer_accounts')) then 'GREEN' else 'RED' end,
         coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.trainer_accounts')), 'table missing'),
         'true', ''
  union all
  select 'H_RLS_GRANTS', 'policy count on trainer_accounts', 'INFO',
         (select count(*)::text from pg_policies where schemaname='public' and tablename='trainer_accounts'),
         '0 (RLS enabled без единой policy — доступ только через SECURITY DEFINER функции, по дизайну)', ''
  union all
  select 'H_RLS_GRANTS', 'RLS enabled on trainer_account_audit_log',
         case when to_regclass('public.trainer_account_audit_log') is null then 'INFO'
              when (select relrowsecurity from pg_class where oid = to_regclass('public.trainer_account_audit_log')) then 'GREEN' else 'RED' end,
         coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.trainer_account_audit_log')), 'table missing'),
         'true', ''
  union all
  select 'H_RLS_GRANTS', 'policy count on trainer_account_audit_log', 'INFO',
         (select count(*)::text from pg_policies where schemaname='public' and tablename='trainer_account_audit_log'),
         '0 (та же логика — только через log_trainer_account_operation)', ''
  union all
  select 'H_RLS_GRANTS', 'table ' || t.table_name || ' privileges for ' || r.role_name,
         case when to_regclass('public.' || t.table_name) is null then 'INFO' else 'INFO' end,
         coalesce((
           select string_agg(priv, ',') from (
             select 'SELECT' as priv where has_table_privilege(r.role_name, to_regclass('public.' || t.table_name), 'SELECT')
             union all select 'INSERT' where has_table_privilege(r.role_name, to_regclass('public.' || t.table_name), 'INSERT')
             union all select 'UPDATE' where has_table_privilege(r.role_name, to_regclass('public.' || t.table_name), 'UPDATE')
             union all select 'DELETE' where has_table_privilege(r.role_name, to_regclass('public.' || t.table_name), 'DELETE')
           ) x
         ), case when to_regclass('public.' || t.table_name) is null then 'table missing' else '(none)' end),
         'см. описание конкретной таблицы в TRAINER_AUTH_ARCHITECTURE.md', ''
  from (values ('trainers'),('clubs'),('trainer_accounts'),('trainer_account_audit_log')) as t(table_name)
  cross join (values ('anon'),('authenticated'),('service_role')) as r(role_name)

  -- ── I_MIGRATION_READINESS (структурная часть — без данных) ───────
  union all
  select 'I_MIGRATION_READINESS', '019 trainer_has_active_account_rpc',
         case when to_regprocedure('public.trainer_has_active_account(text,text)') is not null then 'YELLOW'
              else 'GREEN' end,
         '', 'SAFE TO APPLY, если функция отсутствует',
         'Отсутствие записи в истории миграций само по себе НЕ является RED — определяющий сигнал здесь это фактическое наличие объекта схемы (функции), проверенное через to_regprocedure. YELLOW = функция уже существует — сверить регистрацию версии в опциональном блоке ЧАСТЬ 1В (если история миграций доступна) перед повторным применением. Если ЧАСТЬ 1В недоступна (см. B_MIGRATIONS/migration_history_table) — считать наличие функции достаточным основанием не применять migration 019 повторно.'
  union all
  select 'I_MIGRATION_READINESS', '020-023 grants service_role',
         case when to_regprocedure('public.resolve_trainer_login_email(text,text)') is null then 'INFO'
              when has_function_privilege('service_role', to_regprocedure('public.resolve_trainer_login_email(text,text)'), 'EXECUTE')
               and has_function_privilege('service_role', to_regprocedure('public.family_club_exists(text)'), 'EXECUTE')
               and has_function_privilege('service_role', to_regprocedure('public.normalize_login_name(text)'), 'EXECUTE')
               and has_function_privilege('service_role', to_regprocedure('public.rename_trainer_login(uuid,text)'), 'EXECUTE')
              then 'GREEN' else 'YELLOW' end,
         '', 'все 4 гранта уже присутствуют (ALREADY PRESENT) либо будут добавлены этим пакетом (SAFE TO APPLY)',
         'YELLOW = хотя бы одного гранта не хватает — детали см. в E_FUNCTIONS построчно'
  union all
  select 'I_MIGRATION_READINESS', '024 trainer_account_audit_log', 'INFO', '',
         'SAFE TO APPLY, если отсутствует', 'см. строку A_ENVIRONMENT / table trainer_account_audit_log exists'
  union all
  select 'I_MIGRATION_READINESS', '025 trainer_has_any_account_rpc', 'INFO', '',
         'SAFE TO APPLY, если отсутствует', 'Закрывает найденный в этой сессии баг обхода деактивации через legacy PIN — см. E_FUNCTIONS'
  union all
  select 'I_MIGRATION_READINESS', '026 UNIQUE(trainer_row_id)',
         case
           when exists(select 1 from pg_constraint where conrelid = to_regclass('public.trainer_accounts') and contype='u' and pg_get_constraintdef(oid) ilike '%(trainer_row_id)%') then 'GREEN'
           else 'INFO'
         end,
         '', 'ALREADY PRESENT / SAFE TO APPLY — НО требует Части 2 для финального вердикта',
         'Окончательный статус (SAFE / BLOCKED) зависит от количества дублей trainer_row_id — см. F_DATA_INTEGRITY в Части 2. Если там duplicate_trainer_row_id_groups > 0 — статус этой строки нужно читать как RED, миграция упадёт.'

  -- ── J_SUMMARY (только по Части 1) ─────────────────────────────────
  union all
  select 'J_SUMMARY', 'total_red (Часть 1 only)', 'INFO', '(см. итог ниже отдельным запросом)', '', 'Автоматически посчитан в отдельном итоговом SELECT после этой таблицы'

)

select section, check_name, status, actual_value, expected_value, details
from checks
order by
  case status when 'RED' then 1 when 'YELLOW' then 2 when 'GREEN' then 3 else 4 end,
  section, check_name;


-- =====================================================================
-- ЧАСТЬ 1Б — итоговые счётчики ТОЛЬКО по Части 1 (отдельный statement,
-- полностью безопасен, не читает trainer_accounts напрямую)
-- =====================================================================

with checks as (
  -- та же самая логика, что и выше — Postgres не позволяет переиспользовать
  -- CTE между отдельными statement'ами, поэтому для итогов ниже достаточно
  -- пересчитать статусы компактно через ту же структуру. Чтобы не дублировать
  -- десятки строк дважды в файле, здесь считается ТОЛЬКО сводка по тем же
  -- существование-ориентированным проверкам раздела A (самые информативные
  -- для быстрого решения "можно ли вообще начинать").
  select 'A_ENVIRONMENT'::text as section,
         case when to_regclass('public.trainers') is not null then 'GREEN' else 'RED' end as status
  union all
  select 'A_ENVIRONMENT', case when to_regclass('public.clubs') is not null then 'GREEN' else 'RED' end
  union all
  select 'A_ENVIRONMENT', case when to_regclass('auth.users') is not null then 'GREEN' else 'RED' end
  union all
  select 'A_ENVIRONMENT', case when exists(select 1 from pg_namespace where nspname='supabase_migrations') then 'GREEN' else 'YELLOW' end
)
select
  'J_SUMMARY' as section,
  'quick_environment_summary' as check_name,
  case when count(*) filter (where status='RED') > 0 then 'RED'
       when count(*) filter (where status='YELLOW') > 0 then 'YELLOW'
       else 'GREEN' end as status,
  'red=' || count(*) filter (where status='RED') || ', yellow=' || count(*) filter (where status='YELLOW') || ', green=' || count(*) filter (where status='GREEN') as actual_value,
  'red=0, yellow=0' as expected_value,
  'Быстрая сводка ТОЛЬКО по базовому окружению (A_ENVIRONMENT: trainers/clubs/auth.users/supabase_migrations). Полную сводку по ВСЕМ строкам Части 1 посчитайте вручную по количеству RED/YELLOW/GREEN/INFO в основной таблице результата выше — SQL Editor не объединяет результаты нескольких statement''ов в одну сводку автоматически.' as details
from checks;


-- =====================================================================
-- ЧАСТЬ 1В — MIGRATION HISTORY OPTIONAL (отдельный statement).
--
-- ⚠️ ОПЦИОНАЛЬНЫЙ БЛОК. ЗАПУСКАТЬ ТОЛЬКО ЕСЛИ В ЧАСТИ 1 СТРОКА
--     "B_MIGRATIONS / migration_history_table" = GREEN
--     (то есть to_regclass('supabase_migrations.schema_migrations') IS NOT NULL).
-- Если та строка показала YELLOW ("missing") — НЕ запускайте этот блок:
-- он читает РЕАЛЬНЫЕ СТРОКИ из supabase_migrations.schema_migrations и
-- гарантированно упадёт с той же ошибкой "relation does not exist", что и
-- была получена при фактическом прогоне в production SQL Editor. Отсутствие
-- этого блока НЕ мешает завершить preflight — готовность миграций 019-026
-- (I_MIGRATION_READINESS в Части 1) определяется прежде всего по фактическому
-- наличию объектов схемы (функции/таблицы/constraints), не по записи в
-- истории миграций — см. пояснение в каждой строке I_MIGRATION_READINESS.
-- =====================================================================

with checks as (
  select 'B_MIGRATIONS'::text as section, 'registered versions matching 20260720120%'::text as check_name,
         'INFO'::text as status,
         (select count(*)::text from supabase_migrations.schema_migrations where version like '20260720120%') as actual_value,
         'от 0 до 26'::text as expected_value,
         'Общее число уже зарегистрированных версий этого пакета'::text as details
  union all
  select 'B_MIGRATIONS', 'migration ' || v || ' applied',
         case when exists(select 1 from supabase_migrations.schema_migrations where version = v) then 'GREEN' else 'INFO' end,
         exists(select 1 from supabase_migrations.schema_migrations where version = v)::text,
         'true (применена) или false (ещё нет)', ''
  from (values
    ('20260720120011'),('20260720120012'),('20260720120013'),('20260720120014'),
    ('20260720120015'),('20260720120016'),('20260720120017'),('20260720120018'),
    ('20260720120019'),('20260720120020'),('20260720120021'),('20260720120022'),
    ('20260720120023'),('20260720120024'),('20260720120025'),('20260720120026')
  ) as m(v)
)
select section, check_name, status, actual_value, expected_value, details
from checks
order by
  case status when 'RED' then 1 when 'YELLOW' then 2 when 'GREEN' then 3 else 4 end,
  section, check_name;


-- =====================================================================
-- ЧАСТЬ 2 — агрегатные проверки ДАННЫХ (отдельный statement).
--
-- ⚠️ ЗАПУСКАТЬ ТОЛЬКО ЕСЛИ В ЧАСТИ 1 СТРОКА
--     "A_ENVIRONMENT / table public.trainer_accounts exists" = GREEN.
-- Если она INFO (таблица отсутствует) — этот блок гарантированно упадёт
-- с ошибкой "relation does not exist". Это ожидаемо и означает то же
-- самое: миграции 011+ ещё не применялись, агрегатные проверки данных
-- пока неприменимы.
-- =====================================================================

with checks as (

  -- ── F_DATA_INTEGRITY ─────────────────────────────────────────────
  select 'F_DATA_INTEGRITY'::text as section, 'duplicate_trainer_row_id_groups'::text as check_name,
         case when count(*) > 0 then 'RED' else 'GREEN' end as status,
         count(*)::text as actual_value, '0'::text as expected_value,
         'Блокирует migration 026 (UNIQUE trainer_row_id), если > 0'::text as details
  from (select trainer_row_id from public.trainer_accounts group by trainer_row_id having count(*) > 1) x

  union all
  select 'F_DATA_INTEGRITY', 'duplicate_normalized_login_name_groups',
         case when count(*) > 0 then 'RED' else 'GREEN' end, count(*)::text, '0',
         'Нарушение уже существующего UNIQUE(club_id, normalized_login_name) — не должно быть возможно физически, RED = повреждение данных'
  from (select club_id, normalized_login_name from public.trainer_accounts group by club_id, normalized_login_name having count(*) > 1) x

  union all
  select 'F_DATA_INTEGRITY', 'duplicate_auth_user_id_groups',
         case when count(*) > 0 then 'RED' else 'GREEN' end, count(*)::text, '0',
         'Нарушение уже существующего UNIQUE(auth_user_id) — не должно быть возможно физически'
  from (select auth_user_id from public.trainer_accounts group by auth_user_id having count(*) > 1) x

  union all
  select 'F_DATA_INTEGRITY', 'orphaned_trainer_accounts_without_trainer',
         case when count(*) > 0 then 'RED' else 'GREEN' end, count(*)::text, '0',
         'trainer_accounts без соответствующей строки trainers — не должно быть возможно (FK RESTRICT), RED = повреждение данных'
  from public.trainer_accounts ta left join public.trainers t on t.id = ta.trainer_row_id where t.id is null

  union all
  select 'F_DATA_INTEGRITY', 'orphaned_trainer_accounts_without_auth_user',
         case when count(*) > 0 then 'RED' else 'GREEN' end, count(*)::text, '0',
         'Не должно быть возможно (FK CASCADE), RED = повреждение данных'
  from public.trainer_accounts ta left join auth.users u on u.id = ta.auth_user_id where u.id is null

  union all
  select 'F_DATA_INTEGRITY', 'club_id_mismatch_trainer_accounts_vs_trainers',
         case when count(*) > 0 then 'RED' else 'GREEN' end, count(*)::text, '0',
         'Нарушение trg_trainer_accounts_club_match — не должно быть возможно при обычной работе триггера'
  from public.trainer_accounts ta join public.trainers t on t.id = ta.trainer_row_id where ta.club_id is distinct from t.club_id

  union all
  select 'F_DATA_INTEGRITY', 'empty_or_null_login_name',
         case when count(*) > 0 then 'YELLOW' else 'GREEN' end, count(*)::text, '0', ''
  from public.trainer_accounts where login_name is null or btrim(login_name) = ''

  union all
  select 'F_DATA_INTEGRITY', 'login_name_over_100_chars',
         case when count(*) > 0 then 'YELLOW' else 'GREEN' end, count(*)::text, '0',
         'Edge Function отклоняет новые значения > 100 симв., но уже существующие строки этим не затрагиваются'
  from public.trainer_accounts where length(login_name) > 100

  union all
  select 'F_DATA_INTEGRITY', 'trainer_name_over_200_chars',
         case when count(*) > 0 then 'YELLOW' else 'GREEN' end, count(*)::text, '0', 'public.trainers.name'
  from public.trainers where length(name) > 200

  union all
  select 'F_DATA_INTEGRITY', 'trainer_account_display_name_over_200_chars',
         case when count(*) > 0 then 'YELLOW' else 'GREEN' end, count(*)::text, '0', 'public.trainer_accounts.display_name'
  from public.trainer_accounts where length(display_name) > 200

  union all
  select 'F_DATA_INTEGRITY', 'active_account_for_inactive_or_deleted_trainer',
         case when count(*) > 0 then 'YELLOW' else 'GREEN' end, count(*)::text, '0',
         'trainer_accounts.is_active=true, но trainers.aktiv <> ''JA'' — бизнес-аномалия, не блокер миграций'
  from public.trainer_accounts ta join public.trainers t on t.id = ta.trainer_row_id
  where ta.is_active = true and coalesce(t.aktiv, '') <> 'JA'

  union all
  select 'F_DATA_INTEGRITY', 'inactive_admin_accounts',
         'INFO', count(*)::text, 'любое',
         'Администраторы (rolle=Admin) с trainer_accounts.is_active=false — информационное, не проблема сама по себе'
  from public.trainer_accounts ta join public.trainers t on t.id = ta.trainer_row_id
  where t.rolle = 'Admin' and ta.is_active = false

  union all
  select 'F_DATA_INTEGRITY', 'migrated_trainers_with_retained_pin_hash',
         'INFO', count(*)::text, 'любое',
         'Мигрированные тренеры (есть trainer_accounts), у которых ещё жив pin_hash — ДОПУСТИМО при постепенной миграции, не ошибка сама по себе'
  from public.trainer_accounts ta join public.trainers t on t.id = ta.trainer_row_id
  where t.pin_hash is not null

  union all
  select 'F_DATA_INTEGRITY', 'deactivated_migrated_trainers_with_retained_pin_hash',
         case when count(*) > 0 then 'YELLOW' else 'GREEN' end, count(*)::text, '0',
         'ЧИСЛО тренеров, которые ДО применения migration 025 могли бы обойти деактивацию через legacy PIN (см. TRAINER_AUTH_THREAT_MODEL.md, 4.6). После применения migration 025 + обновлённого app.js риск закрыт для ВСЕХ них — это не блокер применения миграций, а подтверждение того, что 025 нужна именно на production, не только локально.'
  from public.trainer_accounts ta join public.trainers t on t.id = ta.trainer_row_id
  where t.pin_hash is not null and ta.is_active = false

  union all
  select 'F_DATA_INTEGRITY', 'duplicate_club_short_name',
         case when count(*) > 0 then 'RED' else 'GREEN' end, count(*)::text, '0',
         'Блокирует migration 015 (UNIQUE club_short_name), если > 0'
  from (select club_short_name from public.clubs group by club_short_name having count(*) > 1) x

  -- ── G_BOOTSTRAP ──────────────────────────────────────────────────
  union all
  select 'G_BOOTSTRAP', 'active_auth_admins',
         case when count(*) > 0 then 'GREEN' else 'YELLOW' end, count(*)::text, '>= 1',
         'GREEN = уже есть хотя бы один рабочий Auth-вход, bootstrap может не требоваться; YELLOW = bootstrap нужен (см. рекомендацию, вариант A через Dashboard)'
  from public.trainer_accounts ta join public.trainers t on t.id = ta.trainer_row_id
  where ta.is_active = true and t.rolle = 'Admin'

  union all
  select 'G_BOOTSTRAP', 'clubs_with_active_auth_admin', 'INFO', count(distinct t.club_id)::text, 'любое', ''
  from public.trainer_accounts ta join public.trainers t on t.id = ta.trainer_row_id
  where ta.is_active = true and t.rolle = 'Admin'

  union all
  select 'G_BOOTSTRAP', 'clubs_without_active_auth_admin', 'INFO', count(*)::text, 'любое',
         'Каждый такой клуб потребует отдельного bootstrap перед началом миграции именно этого клуба'
  from public.clubs c
  where not exists (
    select 1 from public.trainer_accounts ta
    join public.trainers t on t.id = ta.trainer_row_id
    where t.club_id = c.club_id and ta.is_active = true and t.rolle = 'Admin'
  )

)

select section, check_name, status, actual_value, expected_value, details
from checks
order by
  case status when 'RED' then 1 when 'YELLOW' then 2 when 'GREEN' then 3 else 4 end,
  section, check_name;


-- =====================================================================
-- ЧАСТЬ 2Б — итоговые счётчики по Части 2
-- =====================================================================

with checks as (
  select case when count(*) > 0 then 'RED' else 'GREEN' end as status
  from (select trainer_row_id from public.trainer_accounts group by trainer_row_id having count(*) > 1) x
  union all
  select case when count(*) > 0 then 'RED' else 'GREEN' end
  from (select club_id, normalized_login_name from public.trainer_accounts group by club_id, normalized_login_name having count(*) > 1) x
  union all
  select case when count(*) > 0 then 'RED' else 'GREEN' end
  from (select auth_user_id from public.trainer_accounts group by auth_user_id having count(*) > 1) x
  union all
  select case when count(*) > 0 then 'RED' else 'GREEN' end
  from public.trainer_accounts ta left join public.trainers t on t.id = ta.trainer_row_id where t.id is null
  union all
  select case when count(*) > 0 then 'RED' else 'GREEN' end
  from public.trainer_accounts ta left join auth.users u on u.id = ta.auth_user_id where u.id is null
  union all
  select case when count(*) > 0 then 'RED' else 'GREEN' end
  from public.trainer_accounts ta join public.trainers t on t.id = ta.trainer_row_id where ta.club_id is distinct from t.club_id
  union all
  select case when count(*) > 0 then 'RED' else 'GREEN' end
  from (select club_short_name from public.clubs group by club_short_name having count(*) > 1) x
)
select
  'J_SUMMARY' as section,
  'production_preflight_summary (Часть 1 + Часть 2, объединить вручную)' as check_name,
  case when count(*) filter (where status='RED') > 0 then 'RED' else 'GREEN' end as status,
  'Часть 2 blockers: red=' || count(*) filter (where status='RED') || ', green=' || count(*) filter (where status='GREEN') as actual_value,
  'red=0' as expected_value,
  'ИТОГОВОЕ правило: production_preflight_summary = RED, если хотя бы один RED встретился в ЛЮБОЙ из двух частей; иначе YELLOW, если встретился хотя бы один YELLOW в любой из частей; иначе GREEN. SQL Editor не считает это автоматически одной цифрой по обеим частям сразу — посчитайте по количеству строк со статусом RED/YELLOW в обоих result grid''ах (Части 1 и Части 2) и примените это правило вручную либо передайте оба результата для анализа.' as details
from checks;

-- =====================================================================
-- ИНСТРУКЦИЯ ДЛЯ ВЛАДЕЛЬЦА
-- =====================================================================
--  1. Войти в Supabase Dashboard.
--  2. Проверить project ref: whorwleydkziejjafsea (в URL и/или в шапке
--     Dashboard — визуально, до открытия SQL Editor).
--  3. Открыть SQL Editor.
--  4. Создать New query.
--  5. Скопировать ВЕСЬ этот файл целиком.
--  6. Ещё раз убедиться, что в скрипте нет write-команд (сам скрипт
--     сопровождается статическим аудитом — см. отчёт после его создания;
--     тем не менее проверить самостоятельно перед запуском — стандартная
--     практика перед выполнением любого стороннего SQL в production).
--  7. СНАЧАЛА выполнить только Часть 1 и Часть 1Б (безопасны всегда — можно
--     выделить текст от начала файла до конца Части 1Б и запустить только
--     его). Посмотреть результат строки "B_MIGRATIONS / migration_history_table"
--     и строки "A_ENVIRONMENT / table public.trainer_accounts exists".
--  8. Часть 1В (MIGRATION HISTORY OPTIONAL) — запускать ТОЛЬКО если
--     migration_history_table = GREEN. Если YELLOW ("missing") — пропустить
--     этот блок целиком, не запускать.
--  9. Часть 2 и Часть 2Б — запускать ТОЛЬКО если
--     "A_ENVIRONMENT / table public.trainer_accounts exists" = GREEN. Если
--     INFO ("отсутствует") — пропустить обе, не запускать.
-- 10. Результат будет НЕСКОЛЬКО отдельных result grid'ов (Часть 1, Часть 1Б,
--     Часть 1В — если запускалась, Часть 2 — если запускалась, Часть 2Б) —
--     не один. Supabase SQL Editor обычно показывает результат ПОСЛЕДНЕГО
--     выполненного statement'а по умолчанию — чтобы увидеть результат каждой
--     части, выполняйте их по одной (выделяя нужный блок и запуская только
--     его), либо используйте вкладки результатов, если редактор их
--     поддерживает в вашей версии Dashboard.
-- 11. Экспортировать или скопировать результат КАЖДОЙ фактически запущенной части.
-- 12. Не изменять найденные проблемы вручную.
-- 13. Передать все фактически полученные результаты (минимум Часть 1 и
--     Часть 1Б; Часть 1В и/или Часть 2+2Б — если запускались) для анализа
--     готовности миграций 019-026.
-- =====================================================================
