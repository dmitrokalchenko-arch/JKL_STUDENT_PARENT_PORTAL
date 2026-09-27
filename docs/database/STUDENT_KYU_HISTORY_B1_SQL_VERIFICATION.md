# Student Kyu History (B1) — проверка migration 080

Migration: `supabase/migrations/20261004100080_create_student_kyu_history.sql`
(Rating Database Design, Migration B1). **Статус: применена в production
владельцем (PR #33); structural self-check + rollback-only поведенческий E2E
PASS, тестовых данных не осталось.**

## Модель

Одна линейная цепочка на `(student_id, kyu_lookup_id)`:
`recorded` (корень) → `corrected` / `retracted` через `supersedes_id`.
Действующий факт — терминальная строка цепочки, если она не `retracted`.
Ступень — любая строка `kyu_lookup` (Kyu **и** Dan); ученик должен иметь
`sport_id = 'judo'`. Неизвестная дата = строки нет.

| Гарантия | Механизм |
|---|---|
| один корень | `student_kyu_history_one_root_uidx` (partial UNIQUE WHERE recorded) |
| линейность, нет двойной замены | `student_kyu_history_supersedes_once` UNIQUE(supersedes_id) |
| замена в той же цепочке (ученик, клуб, ступень) | составной FK `student_kyu_history_supersedes_fk` |
| нет циклов | CHECK `not_self` + триггер: заменяемая строка уже существует |
| только Admin исправляет, причина обязательна | CHECK + триггер (текущая `portal_role`) |
| неизменяемость | триггеры UPDATE/DELETE (row) и TRUNCATE (statement) |
| история не исчезает каскадом | все FK `ON DELETE RESTRICT` |

## Устойчивые сообщения об ошибках

`student_kyu_history_unknown_student`, `_club_mismatch`, `_not_judo`,
`_unknown_grade`, `_invalid_grade`, `_snapshot_mismatch`, `_future_date`,
`_invalid_author`, `_author_club_mismatch`, `_author_role_mismatch`,
`_admin_required`, `_duplicate_root`, `_invalid_supersedes`, `_not_terminal`,
`_already_retracted`, `student_kyu_history_immutable`; при ненастроенном
поясе клуба — `club_timezone_not_configured` (079).

## Встроенная самопроверка

Только структурные инварианты самой B1 (каталог): владелец таблицы, 13
колонок, PK, 2 UNIQUE, 4 FK (все RESTRICT), 11 CHECK, частичный UNIQUE корня,
RLS без policies, права (клиенты — ничего, service_role — только SELECT),
3 триггера (включены, точные `tgtype` и `tgfoid`), свойства обеих функций
(owner, `search_path=''`, SECURITY DEFINER только у проверки вставки,
EXECUTE ни у кого).

Самопроверка **не** создаёт временных объектов и **не** проверяет отсутствие
чужих объектов (например, таблиц B2) — это не runtime-инварианты B1; то, что
B1 не создаёт объекты B2, подтверждается статическим ревью репозитория.

Поведение — UPDATE / DELETE / TRUNCATE отклоняются, логика проверки вставки
(ученик / ступень / автор / цепочка) — проверяется отдельным rollback-only
E2E SQL после применения в production.

## Post-apply проверки (только чтение)

```sql
select a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull
from pg_attribute a
where a.attrelid = 'public.student_kyu_history'::regclass and a.attnum > 0 and not a.attisdropped
order by a.attnum;

select k.conname, k.contype::text, k.confdeltype::text, pg_get_constraintdef(k.oid)
from pg_constraint k where k.conrelid = 'public.student_kyu_history'::regclass order by 1;

select indexrelid::regclass, pg_get_indexdef(indexrelid)
from pg_index where indrelid = 'public.student_kyu_history'::regclass;

select t.tgname, t.tgtype, t.tgenabled::text, t.tgfoid::regprocedure
from pg_trigger t where t.tgrelid = 'public.student_kyu_history'::regclass and not t.tgisinternal;

select r.role, p.priv, has_table_privilege(r.role, 'public.student_kyu_history', p.priv)
from (values ('anon'), ('authenticated'), ('service_role')) r(role),
     (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
order by 1, 2;
-- ожидается: true только service_role / SELECT

select count(*) from public.student_kyu_history;
-- ожидается: 0 (миграция строк не создаёт)
```
