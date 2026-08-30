-- Security hardening: закрывает permission-gap, найденный при post-migration
-- read-only проверках GROUP A (2026-08-29) — четыре функции семейного слоя
-- были доступны anon/authenticated напрямую через REST RPC, несмотря на
-- `revoke all ... from public` в исходных миграциях (001, 002). Причина
-- (диагностирована по факту, не предположение): у этих четырёх функций
-- REVOKE был выдан только роли PUBLIC, а не отдельно anon/authenticated —
-- судя по эмпирическому сравнению с public.get_current_family_children()
-- (migration 010, у неё ЕСТЬ явный `revoke ... from anon` и она РЕАЛЬНО
-- недоступна anon), в этом проекте на уровне default privileges execute на
-- новые функции public-схемы, по всей видимости, выдаётся anon/authenticated
-- напрямую (не только через членство в PUBLIC) — REVOKE FROM PUBLIC такую
-- прямую роль-специфичную привилегию не снимает, нужен явный REVOKE FROM
-- <role>. Эта миграция не меняет ни одну таблицу, ни одну RLS policy, не
-- пишет и не читает данные — только четыре REVOKE EXECUTE (плюс один
-- идемпотентный переподтверждающий GRANT для service_role, чтобы файл был
-- самодостаточным и не зависел от того, что migration 021 точно
-- отработала).
--
-- resolve_family_login_email(text,text) и get_current_family_children() —
-- НЕ трогаются: первая обязана остаться доступной anon/authenticated (это
-- единственная публичная точка входа login flow), вторая уже корректно
-- защищена.

-- ── family_club_exists(text) ────────────────────────────────────────────
-- Безопасно отозвать у anon/authenticated: единственный легитимный
-- вызывающий — служебный триггер enforce_families_club_exists (migration
-- 001), который сам НЕ SECURITY DEFINER, поэтому фактически требует
-- EXECUTE у той РОЛИ, что выполняет INSERT/UPDATE в families. Но по
-- migration 003 у anon/authenticated нет ни одной insert/update policy на
-- families/family_guardians/family_students — запись производится
-- исключительно service_role внутри Edge Function. Значит ни anon, ни
-- authenticated никогда легитимно не инициируют путь, где это право нужно.
-- Явный повторный GRANT service_role (уже выдан migration 021, здесь
-- переподтверждается идемпотентно) — это ровно тот вызывающий, что и
-- инициирует INSERT/UPDATE families из Edge Function.
revoke execute on function public.family_club_exists(text) from anon, authenticated;
grant execute on function public.family_club_exists(text) to service_role;

-- ── normalize_family_nickname(text) ─────────────────────────────────────
-- Безопасно отозвать у anon/authenticated: единственные вызывающие —
-- family_login_email(text,text) (обычный SQL-вызов внутри её тела) и
-- resolve_family_login_email(text,text) (SECURITY DEFINER, migration 002).
-- Ключевой момент безопасности: вызов SQL-функции ИЗ ТЕЛА SECURITY DEFINER
-- функции выполняется с правами ВЛАДЕЛЬЦА определившей функции (то же
-- effective-role окружение), а не с правами исходного внешнего вызывающего
-- — значит внутренний вызов normalize_family_nickname() из
-- resolve_family_login_email() продолжит работать даже без прямого EXECUTE
-- у anon/authenticated. Ломается только ПРЯМОЙ внешний RPC-вызов в обход
-- anti-enumeration обёртки — что и есть цель этой миграции.
revoke execute on function public.normalize_family_nickname(text) from anon, authenticated;

-- ── family_login_email(text,text) ───────────────────────────────────────
-- Тот же принцип и тот же вызывающий, что и normalize_family_nickname:
-- используется изнутри resolve_family_login_email(text,text) (SECURITY
-- DEFINER) — внутренний вызов не пострадает по той же причине (выполняется
-- с правами владельца определившей DEFINER-функции). Также вызывается
-- напрямую Edge Functions manage-family-account/create-family-account через
-- service_role (см. migration 033, GROUP C, ещё не применена) — эта
-- миграция service_role не трогает вообще, поэтому будущий explicit grant
-- из 033 ничем не блокируется и не дублируется здесь заранее.
revoke execute on function public.family_login_email(text, text) from anon, authenticated;

-- ── can_family_access_student(bigint) ───────────────────────────────────
-- anon отзывается: без auth.uid() (anon не аутентифицирован) функция и так
-- структурно всегда вернёт false — отзыв просто убирает саму возможность
-- зондировать endpoint неаутентифицированным клиентом, ничего не ломает.
-- authenticated НЕ трогается — это единственная из четырёх функций, прямо
-- предназначенная вызываться authenticated-сессией семьи (migration 002:
-- "Используется во всех RLS policies и в RPC" — рассчитана на прямое
-- использование залогиненным пользователем, а не только как внутренний
-- helper), поэтому её грант для authenticated сохраняется без изменений.
revoke execute on function public.can_family_access_student(bigint) from anon;
