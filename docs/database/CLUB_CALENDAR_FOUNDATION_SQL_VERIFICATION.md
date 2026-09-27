# Club Calendar Foundation — проверка migration 079

Migration: `supabase/migrations/20261003100079_club_calendar_foundation.sql`
(Rating Database Design, Migration A). **Статус: применена в production
владельцем (PR #32); post-apply проверка 16/16 PASS.**

## Что создаёт

| Объект | Назначение |
|---|---|
| `public.club_portal_settings` | `club_id text PK`, `timezone text NOT NULL`, `created_at`, `updated_at`, `updated_note` |
| `private.enforce_club_portal_settings_valid()` | триггер: клуб существует в `public.clubs.club_id`, пояс есть в `pg_catalog.pg_timezone_names` |
| `trg_club_portal_settings_set_updated_at` | существующий `public.set_updated_at()` |
| `private.club_timezone(text)` | пояс клуба; нет строки → `club_timezone_not_configured` |
| `private.club_today(text)` | `(now() AT TIME ZONE club_timezone(club))::date` |
| строка `('jcl', 'Europe/Berlin')` | только после проверки существования `jcl`; других клубов нет |

Безопасность: RLS включён, policies нет; у PUBLIC/anon/authenticated нет прав
на таблицу; service_role — только SELECT; все три функции SECURITY DEFINER,
`search_path=''`, owner `postgres`, EXECUTE нет ни у PUBLIC/anon/authenticated,
ни у service_role (как у всех существующих private-хелперов). Authenticated RPC
для смены пояса нет — изменение только owner-controlled операцией.

Встроенная самопроверка (DO-блок перед COMMIT) проверяет только инварианты
самой миграции — пункты V01–V15 ниже, включая негативные пробы в
savepoint'ах; любое расхождение откатывает всю миграцию. Она не требует,
чтобы в таблице была только строка `jcl`, и не проверяет отсутствие
посторонних объектов базы. V16 (scope: Rating-таблицы не созданы) —
статическая проверка репозитория / ручной post-apply запрос, не runtime-инвариант.

## Ожидаемые ошибки (устойчивые сообщения)

| Ситуация | SQLERRM |
|---|---|
| пояс клуба не настроен / NULL club_id | `club_timezone_not_configured` |
| невалидный пояс (`+01:00`, `Mars/...`, неканоничный регистр) | `club_portal_settings_invalid_timezone` |
| club_id отсутствует в `public.clubs` | `club_portal_settings_unknown_club` |
| `jcl` отсутствует при применении | `079: club jcl does not exist ...` (миграция падает целиком) |

## Post-apply проверки (только чтение, выполняет владелец)

```sql
-- V01–V06: таблица, колонки, PK, RLS, policies, права
select a.attname, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull
from pg_attribute a
where a.attrelid = 'public.club_portal_settings'::regclass and a.attnum > 0 and not a.attisdropped
order by a.attnum;

select c.conname, c.contype::text, pg_get_constraintdef(c.oid)
from pg_constraint c where c.conrelid = 'public.club_portal_settings'::regclass order by 1;

select c.relrowsecurity,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c where c.oid = 'public.club_portal_settings'::regclass;

select r.role, p.priv, has_table_privilege(r.role, 'public.club_portal_settings', p.priv) as has
from (values ('anon'), ('authenticated'), ('service_role')) r(role),
     (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
order by 1, 2;
-- ожидается: true только для service_role / SELECT

-- V07–V09: данные
select club_id, timezone,
       exists (select 1 from pg_timezone_names tz where tz.name = s.timezone) as tz_valid
from public.club_portal_settings s;
-- ожидается: строка jcl | Europe/Berlin | true присутствует ровно один раз (PK).
-- Сразу после применения 079 других строк нет (миграция создаёт только jcl),
-- но таблица их не запрещает — это не инвариант миграции.

-- V10–V11: хелперы (выполняется как postgres в SQL Editor)
select private.club_timezone('jcl') as tz, private.club_today('jcl') as today,
       pg_typeof(private.club_today('jcl')) as today_type;

-- V12: fail closed (ожидается ERROR club_timezone_not_configured)
-- select private.club_timezone('__not_configured__');

-- V15: EXECUTE хелперов
select f.sig, r.role, has_function_privilege(r.role, f.sig, 'EXECUTE') as has
from (values ('private.club_timezone(text)'), ('private.club_today(text)'),
             ('private.enforce_club_portal_settings_valid()')) f(sig),
     (values ('anon'), ('authenticated'), ('service_role')) r(role)
order by 1, 2;
-- ожидается: false везде

-- V16 (scope, не входит в самопроверку миграции): Rating core не создан 079
select to_regclass('public.club_rating_config'), to_regclass('public.student_kyu_history'),
       to_regclass('public.student_rating_stages'), to_regclass('public.student_rating_entries'),
       to_regclass('public.club_rating_settings_versions'), to_regclass('public.club_rating_settings_items');
-- ожидается: все NULL
```

V13 (невалидный пояс) и V14 (orphan-клуб) — негативные записи; выполняются
только встроенной самопроверкой миграции внутри savepoint'ов, вручную в
production не повторяются.

## Замечания

- Локальный `supabase db reset` без legacy-схемы JCL (`public.clubs` с `jcl`)
  эту миграцию не пройдёт — намеренно (orphan-настройка запрещена). Так же,
  как и все предыдущие миграции, она предполагает существующую legacy-схему.
- `get_student_page_access` не изменён и продолжает использовать константу
  `Europe/Berlin`; перевод на `private.club_today` — отдельное решение.
