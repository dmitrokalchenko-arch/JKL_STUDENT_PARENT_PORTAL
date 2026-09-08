-- ⚠️ ТОЛЬКО ДЛЯ РУЧНОГО ЗАПУСКА ВЛАДЕЛЬЦЕМ (Dashboard SQL Editor). Не
-- выполнялся против production в этой сессии — у сессии нет service_role/
-- Dashboard-доступа, только анонимный (публичный) ключ, а
-- public.trainer_accounts имеет RLS без единой policy для anon (см. аудит
-- этой же сессии: прямой SELECT анонимным ключом вернул `[]`, не данные).
--
-- READ-ONLY: единственная операция — SELECT/agregation. Не изменяет
-- никаких данных, не создаёт и не удаляет никаких объектов.
--
-- НАЗНАЧЕНИЕ: проверить инвариант, на котором строится
-- get_current_trainer_write_context() (migration 20260908140044) —
-- "не более одной активной (is_active=true) строки trainer_accounts на
-- один auth_user_id". Результат — ДВЕ агрегированные строки, БЕЗ единого
-- UUID/auth_user_id в выводе (по прямому требованию задания).

-- 1) Сколько auth_user_id имеют больше одной активной строки
--    trainer_accounts, и какой максимальный размер такой группы.
select
  count(*) as auth_user_ids_with_multiple_active_trainer_accounts,
  coalesce(max(active_count), 0) as max_active_trainer_accounts_per_auth_user_id
from (
  select auth_user_id, count(*) as active_count
  from public.trainer_accounts
  where is_active = true
  group by auth_user_id
  having count(*) > 1
) duplicates;

-- 2) Тот же инвариант, сформулированный через связанные trainer_row_id
--    (на случай, если дубли — это на самом деле одна и та же строка
--    trainer_accounts, случайно посчитанная дважды из-за JOIN где-то
--    в другом месте, а не два РАЗНЫХ trainer_row_id на одного auth_user_id).
select
  count(*) as auth_user_ids_with_multiple_distinct_trainer_row_ids,
  coalesce(max(distinct_trainer_row_id_count), 0) as max_distinct_trainer_row_ids_per_auth_user_id
from (
  select auth_user_id, count(distinct trainer_row_id) as distinct_trainer_row_id_count
  from public.trainer_accounts
  where is_active = true
  group by auth_user_id
  having count(distinct trainer_row_id) > 1
) duplicates_by_trainer_row_id;

-- Ожидаемый GREEN-результат для обоих запросов: 0 строк-нарушителей
-- (auth_user_ids_with_... = 0, max_... = 0). Если оба запроса вернули 0 —
-- production сейчас чист от этой аномалии; RAISE EXCEPTION в
-- get_current_trainer_write_context() при count>1 в этом случае никогда
-- не сработает на реальных данных сегодня, но остаётся защитой на
-- будущее (задание прямо просило не полагаться на "сейчас чисто" как на
-- постоянную гарантию).
