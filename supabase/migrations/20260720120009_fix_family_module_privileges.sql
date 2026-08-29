-- Исправление privilege-пробелов Family Layer, обнаруженных фактическим
-- локальным прогоном (этап H/I, не статическим анализом):
--
-- 1) private.is_current_user_family_guardian(uuid) (миграция 08) выдавала
--    EXECUTE роли authenticated, но не выдавала USAGE на саму схему
--    private — вызов функции падал с "permission denied for schema
--    private" (SQLSTATE 42501), поскольку Postgres требует ОБА права
--    (schema USAGE + function EXECUTE) для вызова функции в
--    нестандартной схеме.
--
-- 2) Ни одна из миграций 01-08 никогда не выдавала base table privileges
--    (GRANT SELECT/INSERT/UPDATE/DELETE) ролям authenticated/anon ни на
--    одной таблице модуля — RLS-policies были написаны в предположении,
--    что такие grants уже существуют (как это принято по умолчанию у
--    системных схем storage/realtime), но применительно к public-схеме
--    этого модуля их никто не выдавал. RLS фильтрует СТРОКИ, но не
--    заменяет базовое право на операцию — без GRANT запрос падает ДО
--    того, как Postgres вообще успевает применить RLS-policy.
--
-- ИЗМЕНЕНО (безопасный pre-deploy аудит Family Layer, 2026-08-29): исходная
-- версия этой миграции ТАКЖЕ выдавала grant на public.student_technique_progress
-- (Technique Module, миграции 004-007) — вынесено в отдельную миграцию
-- 20260829120001_technique_progress_privileges.sql, чтобы Family Layer можно
-- было развернуть в production независимо от Technique Module (который
-- сейчас не разворачивается). Ничего из технического модуля не удалено из
-- проекта — только перенесено в собственную миграцию с собственным сроком
-- применения.
--
-- Grants здесь НАМЕРЕННО минимальны и построены по privilege map (этап
-- I1): только то, что подтверждено фактическим прямым обращением —
-- либо из supabase/tests/rls_scenarios.sql, либо из явно запланированных
-- точечных проверок этого этапа. Таблицы, к которым обращаются
-- ИСКЛЮЧИТЕЛЬНО изнутри SECURITY DEFINER RPC (club_belts,
-- club_technique_progress_settings, club_techniques,
-- club_belt_techniques, club_belt_technique_settings, а также baseline
-- clubs/students/trainers), сюда не включены — SECURITY DEFINER
-- выполняется с правами владельца функции и не требует grant'а для
-- вызывающей роли. public.families тоже не включена — у неё есть
-- SELECT-policy, но ни фронтенд (src/services/*.js), ни тестовый
-- сценарий A-J, ни точечные проверки этого этапа не делают прямой SELECT
-- к ней от имени authenticated — наличие policy само по себе не
-- является достаточным основанием для grant (см. отчёт этапа I1).
--
-- USAGE на схему private выдаётся ТОЛЬКО для вызова конкретной функции
-- ниже — сама по себе схема private не открывает доступ ни к каким
-- другим объектам без отдельных, специально выданных object privileges
-- (в private сегодня всего одна функция, и никаких новых туда не
-- добавляется). CREATE на схему private роли authenticated не
-- выдаётся ни здесь, ни где-либо ещё.

grant usage on schema private to authenticated;

-- Сигнатура подтверждена запросом к pg_proc в реальной локальной базе
-- (этап I1), не предполагается.
revoke all on function private.is_current_user_family_guardian(uuid) from public;
grant execute on function private.is_current_user_family_guardian(uuid) to authenticated;

-- Семейный слой: SELECT нужен только для family_guardians и
-- family_students — обе таблицы читаются НАПРЯМУЮ (не только через RPC)
-- тестовым сценарием rls_scenarios.sql (A/B/D/J) и точечными проверками
-- этого этапа. INSERT/UPDATE/DELETE не выдаются ни на одну из трёх
-- таблиц семейного слоя — ни одна insert/update/delete policy для
-- authenticated не существует (миграция 3 сознательно не создаёт их),
-- запись выполняется только сотрудником клуба через service_role.
grant select on table public.family_guardians to authenticated;
grant select on table public.family_students to authenticated;

-- Прогресс техник (student_technique_progress) — ВЫНЕСЕНО в отдельную
-- миграцию 20260829120001_technique_progress_privileges.sql (безопасный
-- pre-deploy аудит Family Layer, 2026-08-29): Family Login должен
-- разворачиваться независимо от Technique Module (миграции 004-007), а
-- эта миграция изначально смешивала грант для family_guardians/
-- family_students (нужен для Family Layer) с грантом для
-- student_technique_progress (нужен только Technique Module, миграции
-- 004-007, которые сейчас НЕ разворачиваются). Применять новую миграцию
-- нужно вместе с Technique Module, не вместе с Group A Family Layer —
-- сама student_technique_progress создаётся только в migration 004, без
-- неё этот GRANT упал бы с "relation does not exist".

-- anon: ни одна policy в этом модуле не выдана роли anon (подтверждено
-- pg_policies), поэтому ни один base table grant роли anon здесь не
-- добавляется — включая public.families, несмотря на то, что
-- rls_scenarios.sql (сценарий E) сегодня, по-видимому, ожидает у anon
-- базовый SELECT platform-default. Если это приведёт к отказу сценария
-- E, это отдельный, самостоятельно фиксируемый результат, а не
-- основание расширять доступ anon без подтверждённой необходимости.
