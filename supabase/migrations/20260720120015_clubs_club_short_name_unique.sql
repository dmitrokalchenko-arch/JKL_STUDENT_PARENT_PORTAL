-- Corrective migration: гарантирует однозначность public.clubs.club_short_name
-- на уровне базы данных перед production-развёртыванием Trainer Auth.
--
-- КОНТЕКСТ: resolve_trainer_login_email() (migration 012) и
-- resolve_family_login_email() (migration 002) читают public.clubs через
-- обычный, НЕ STRICT, `SELECT ... INTO v_club_id FROM public.clubs WHERE
-- club_short_name = ...` в PL/pgSQL. Точная семантика такого SELECT INTO:
-- если запрос вернёт больше одной строки, Postgres НЕ бросает ошибку — он
-- молча берёт значение из ПРОИЗВОЛЬНОЙ подходящей строки (порядок без
-- ORDER BY не гарантирован) и отбрасывает остальные. Это значит, что при
-- дубликате club_short_name технический email мог бы детерминированно (по
-- алгоритму), но НЕПРЕДСКАЗУЕМО (по выбору строки) резолвиться в чужой
-- клуб — реальный риск, а не гипотетический, следствие точного SQL этих
-- функций, не текущего состояния данных.
--
-- Production-диагностика (supabase/diagnostics/check_trainer_club_id_compatibility.sql,
-- запросы 23/24) на момент создания этой миграции дубликатов НЕ нашла —
-- ни точных, ни после lower(trim(...)). Но ничто в схеме их не запрещало
-- ВПРЕДЬ — фактическое отсутствие дубликатов сегодня не то же самое, что
-- гарантия отсутствия дубликатов завтра.
--
-- НЕ применяется этой миграцией автоматически (только файл, применение —
-- отдельное решение владельца). НЕ изменяет migrations 011-014 задним
-- числом — та же конвенция, что уже применена в migration 014 (см. её
-- шапку) и migration 008 до неё. НЕ изменяет существующие значения
-- clubs.club_short_name — только добавляет ограничения; если реальные
-- данные им не удовлетворяют, DDL ниже сам вернёт понятную стандартную
-- ошибку Postgres и НИЧЕГО не применит (обе команды — часть одной
-- транзакции миграции).
--
-- НОРМАЛИЗАЦИЯ: resolve_trainer_login_email/resolve_family_login_email
-- сравнивают club_short_name БЕЗ lower()/trim() — точное равенство `=`.
-- Ограничение ниже СОЗНАТЕЛЬНО строже фактического поведения этих RPC:
-- уникальность гарантируется по lower(btrim(club_short_name)), а не только
-- по точному значению. Это defense-in-depth (запрещает будущие
-- вводящие-в-заблуждение почти-дубликаты вроде 'JCL' и 'jcl '), не меняет
-- поведение существующих RPC (они по-прежнему делают точное сравнение и
-- останутся корректны — уникальность по нормализованному значению строго
-- влечёт уникальность и по точному) и не блокирует текущие данные —
-- production-диагностика уже подтвердила отсутствие дубликатов в обеих
-- формах.
--
-- Безопасно для повторного review: обе команды идемпотентны (IF NOT
-- EXISTS/DO-guard) — повторное применение к уже исправленной схеме не
-- падает и ничего не меняет повторно.

-- Явно запрещаем пустые и состоящие только из пробелов club_short_name —
-- такое значение не должно участвовать в разрешении технического email
-- логина (WHERE club_short_name = p_club_short_name никогда не должен
-- совпасть с "пустым" вводом).
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

-- Гарантия однозначности club_short_name на уровне БД (не только на
-- уровне "сейчас дубликатов нет"). CREATE UNIQUE INDEX сам по себе
-- транзакционный и откажет с понятной стандартной ошибкой Postgres
-- ("could not create unique index ... DETAIL: Key ... is duplicated"),
-- если production-данные на момент применения содержат нарушающие
-- строки — никакие данные при этом не меняются и не удаляются.
create unique index if not exists clubs_club_short_name_normalized_unique
  on public.clubs (lower(btrim(club_short_name)));

comment on index public.clubs_club_short_name_normalized_unique is
  'Гарантирует однозначность разрешения club_short_name -> club_id для resolve_trainer_login_email()/resolve_family_login_email() (обычный SELECT INTO в PL/pgSQL молча берёт произвольную строку при дубликате, не бросает ошибку). Уникальность по lower(btrim(...)) — строже точного сравнения, которое реально делают эти RPC, осознанно (defense-in-depth против будущих почти-дубликатов), не меняет их поведение и не блокирует существующие данные (production-диагностика подтвердила отсутствие дубликатов до применения).';

comment on constraint clubs_club_short_name_not_blank on public.clubs is
  'Запрещает пустой/состоящий из пробелов club_short_name — такое значение не должно участвовать в разрешении технического email логина (resolve_trainer_login_email/resolve_family_login_email).';
