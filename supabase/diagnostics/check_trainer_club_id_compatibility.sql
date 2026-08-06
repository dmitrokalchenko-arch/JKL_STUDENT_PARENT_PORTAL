-- ⚠️ ЗАПУСТИТЬ ПЕРЕД ПРИМЕНЕНИЕМ migration 011 (create_trainer_accounts) К
-- РЕАЛЬНОМУ ПРОЕКТУ JCL_Gruppen. Не относится к локальному тестовому стенду
-- (.local-supabase-test) — там trainers.club_id уже явно эмулирован как
-- text not null для целей локального тестирования, это не подтверждение
-- реальной схемы.
--
-- СТРОГО READ-ONLY. Каждый из 16 запросов ниже — либо SELECT из
-- information_schema/pg_catalog (метаданные: типы, ограничения, индексы),
-- либо обычный SELECT/COUNT без предикатов записи. Файл не содержит ни
-- одной команды INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, TRUNCATE,
-- GRANT, REVOKE — проверено вручную построчно. Не вызывает никаких
-- функций с побочными эффектами (RPC/SECURITY DEFINER функции проекта
-- здесь не вызываются вообще). Безопасно выполнить в SQL Editor реального
-- Supabase-проекта JCL_Gruppen.
--
-- ЗАЧЕМ: migration 011 (public.trainer_accounts) содержит триггеры
-- enforce_trainer_accounts_club_match() и enforce_trainer_accounts_club_exists(),
-- сверяющие trainer_accounts.club_id с public.trainers.club_id и
-- public.clubs.club_id. Точный тип, nullable, ограничения и фактическое
-- содержимое этих колонок НЕ подтверждены документированным аудитом
-- (docs/database/EXISTING_DATABASE_AUDIT.md) — только предположены по
-- аналогии с остальной схемой (везде text). Этот файл закрывает пробел.
--
-- ЧЕГО ЗДЕСЬ НЕТ (сознательно): ФИО тренеров, email, телефоны, адреса или
-- любые другие персональные данные не выбираются НИ В ОДНОМ запросе —
-- только club_id/club_short_name (идентификаторы клуба, не человека),
-- типы колонок, количества и имена ограничений/индексов. Результат
-- запроса 6 (примеры несовпадающих club_id) — это идентификаторы клубов,
-- не тренеров; если владелец системы всё равно считает club_id
-- чувствительным, можно опубликовать только количество из запроса 5,
-- не сами значения из запроса 6 — на усмотрение владельца.
--
-- Каждый запрос пронумерован и соответствует одноимённому пункту в
-- docs/database/TRAINER_AUTH_PRODUCTION_CHECK.md — оттуда же критерии
-- PASS/BLOCKER для каждого пункта.

-- 1. Существуют ли вообще таблицы public.trainers и public.clubs (базовая
-- проверка перед всем остальным — если false, все следующие запросы
-- по этой таблице неприменимы).
select
  to_regclass('public.trainers') is not null as trainers_table_exists,
  to_regclass('public.clubs') is not null as clubs_table_exists;

-- 2. Существует ли trainers.club_id, и если да — точный data_type,
-- udt_name, nullable, default. Пустой результат = колонки не существует
-- под этим именем (см. пункт 1 выше, чтобы отличить от "таблицы нет").
select table_name, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'trainers'
  and column_name = 'club_id';

-- 3. Общее число строк trainers — для контекста масштаба (не персональные
-- данные, только количество).
select count(*) as total_trainers from public.trainers;

-- 4. Сколько строк trainers имеют club_id IS NULL (фактически, а не
-- только по метаданным nullable из запроса 2).
select count(*) as trainers_with_null_club_id
from public.trainers
where club_id is null;

-- 5. Сколько значений trainers.club_id НЕ имеют соответствующей строки в
-- clubs.club_id — количество (без самих значений, см. запрос 6).
select count(*) as orphaned_trainers_count
from public.trainers t
left join public.clubs c on c.club_id = t.club_id
where c.club_id is null
  and t.club_id is not null;

-- 6. Примеры (максимум 20) конкретных несовпадающих значений club_id —
-- идентификаторы клуба, не тренера. Пусто = несовпадений нет.
select distinct t.club_id as orphaned_trainer_club_id
from public.trainers t
left join public.clubs c on c.club_id = t.club_id
where c.club_id is null
  and t.club_id is not null
limit 20;

-- 7. Тип public.clubs.club_id (для сравнения с trainers.club_id из
-- запроса 2 и students.club_id из запроса 8).
select table_name, column_name, data_type, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'clubs'
  and column_name = 'club_id';

-- 8. Совпадают ли типы club_id между trainers/students/clubs — если нет,
-- триггер enforce_trainer_accounts_club_match (text-сравнение new.club_id
-- <> v_trainer_club) может дать неожиданный результат при неявном
-- приведении типов.
select table_name, column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('trainers', 'students', 'clubs')
  and column_name = 'club_id'
order by table_name;

-- 9. Дубликаты clubs.club_id — если они есть, join по club_id в запросах
-- 5/6 и в самих триггерах становится неоднозначным (клуб может
-- "случайно" совпасть не с тем клубом). Пусто = дубликатов нет (ожидаемо,
-- т.к. club_id обычно PK/UNIQUE, но это НЕ подтверждено аудитом —
-- проверяем фактические данные, а не предположение).
select club_id, count(*) as duplicate_count
from public.clubs
group by club_id
having count(*) > 1;

-- 10. Индексы по trainers.club_id — важно для производительности триггера
-- enforce_trainer_accounts_club_match (SELECT ... WHERE trainers.id = ...
-- не требует индекса на club_id, но enforce_trainer_accounts_club_exists
-- через family_club_exists читает clubs по club_id — см. запрос 11 для
-- clubs). Этот запрос — для trainers.club_id конкретно, на случай
-- будущих запросов/RPC, фильтрующих трeнеров по клубу.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'trainers'
  and indexdef ilike '%club_id%';

-- 11. FK-ограничения на trainers, упоминающие club_id — если такой FK уже
-- существует (например, на clubs), это меняет допущения migration 011
-- (которая ставит собственный trigger-based enforcement именно потому,
-- что составной FK предполагался невозможным без изменения чужой таблицы).
select
  con.conname,
  con.contype,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'trainers'
  and pg_get_constraintdef(con.oid) ilike '%club_id%';

-- 12. Ограничение уникальности (или PK) на clubs.club_short_name — если
-- его нет, resolve_family_login_email/resolve_trainer_login_email могут
-- столкнуться с неоднозначностью при построении технического email по
-- club_short_name.
select
  con.conname,
  con.contype,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'clubs'
  and pg_get_constraintdef(con.oid) ilike '%club_short_name%';

-- 13. Сколько строк clubs имеют club_short_name IS NULL (фактически, вне
-- зависимости от того, есть ли ограничение NOT NULL по метаданным).
select count(*) as clubs_with_null_short_name
from public.clubs
where club_short_name is null;

-- 14. Дубликаты club_short_name среди НЕ-NULL значений — критично для
-- анти-enumeration технического email (resolve_*_login_email строит email
-- через club_short_name; дубликат означает, что два разных клуба получат
-- пересекающееся пространство технических email).
select club_short_name, count(*) as duplicate_count
from public.clubs
where club_short_name is not null
group by club_short_name
having count(*) > 1;

-- 15. Существующие RLS policies на trainers/clubs (не персональные данные —
-- только структура policy). Нужно понять, ограничит ли RLS чтение этих
-- таблиц изнутри SECURITY DEFINER функций проекта (обычно нет, т.к. они
-- SECURITY DEFINER и владелец таблицы применяет свои полномочия, но важно
-- зафиксировать факт, а не предполагать).
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('trainers', 'clubs');

-- 16. Включён ли RLS на trainers/clubs в принципе (дополняет запрос 15 —
-- pg_policies может быть пуст и потому, что RLS выключен, и потому, что
-- включён, но без единой policy — это разные состояния).
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('trainers', 'clubs');
