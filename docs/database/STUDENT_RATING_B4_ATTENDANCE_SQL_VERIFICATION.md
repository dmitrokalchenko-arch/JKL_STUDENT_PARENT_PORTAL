# Rating B4 — Attendance → Rating Ledger (migration 084)

Migration: `supabase/migrations/20261008100084_create_attendance_rating_reconciliation.sql`

| Статус | Значение |
|---|---|
| Production apply | **НЕ ПРИМЕНЕНА** |
| Production dry-run / backfill | **НЕ ВЫПОЛНЯЛИСЬ** (записей журнала нет) |
| Поведенческий E2E | **НЕ ВЫПОЛНЯЛСЯ** |
| Локальное выполнение SQL | НЕ ВЫПОЛНЯЛОСЬ (локального PostgreSQL нет) |

Ожидание для последующей проверки (не часть логики): JCL — 227 строк JA,
227 уникальных дней ученика; 182 дня в 35 активных Kyu-этапах → dry-run
`wouldCreate = 182`; 9 учеников Dan без этапов → `NO_STAGE_FOR_STUDENT`.

## Правило

1 ученик + 1 местный день клуба + ≥ 1 строка `public.attendance` с
`anwesenheit = 'JA'` = ровно +1 (`attendance_day`), в этап, действующий в этот
день (`starts_on ≤ день ≤ coalesce(ends_on, день)`). Местный день —
`(attendance.datum AT TIME ZONE private.club_timezone(club_id))::date`;
неизвестный пояс → отказ. Будущие местные дни не начисляются. Несколько групп
в один день → одна награда.

## Схема (из 081, без изменений)

`student_rating_entries`: `club_id`, `student_id`, `stage_id` (составной FK на
этап того же ученика и клуба), `source_type = 'attendance_day'`,
`effective_on` = местный день, `points = 1`, `created_by_kind = 'system'`,
`reason` / `idempotency_key` / ссылки NULL. Запись объясняет себя: «+1 за
посещаемость ученика X в местный день YYYY-MM-DD» — новые колонки не нужны.

**Уникальность уже есть в 081:** `student_rating_entries_attendance_root_uidx`
— UNIQUE (`stage_id`, `effective_on`) WHERE `source_type = 'attendance_day'`
AND `reaward_after_entry_id IS NULL`. Повторное начисление того же дня
невозможно на уровне БД; новый индекс не добавляется. Триггер 081 принимает
записи только в `active` этап и только с `effective_on` в `[starts_on, club_today]`.

## Объекты

| Функция | Тип | Назначение |
|---|---|---|
| `private.attendance_rating_days(p_club_id text, p_student_id bigint default null)` → table | SQL, **STABLE**, INVOKER | **единственная** каноническая логика |
| `private.sync_student_attendance_rating(p_student_id bigint) → jsonb` | plpgsql, INVOKER | один ученик: блокировка → оценка → INSERT только `ELIGIBLE_MISSING` |
| `private.reconcile_club_attendance_rating(p_club_id text, p_dry_run boolean default true) → jsonb` | plpgsql, INVOKER | пакет владельца, dry-run по умолчанию |

Все: схема `private`, owner `postgres`, `search_path=''`, EXECUTE отозван у
PUBLIC / anon / authenticated / service_role. Вызывает только владелец
(postgres) в SQL Editor. Браузерного пути записи нет. RLS и права
`attendance` / `students` не меняются.

## Статусы канонической функции

| status | action | Смысл |
|---|---|---|
| `ELIGIBLE_MISSING` | AUTO | день допущен, этап active, награды нет → создать +1 |
| `ALREADY_REPRESENTED` | OK | чистая сумма attendance_day и их отмен за (этап, день) = 1 |
| `NO_STAGE_FOR_STUDENT` | SKIP | у ученика нет этапов (сейчас — Dan по политике клуба) |
| `DAY_OUTSIDE_STAGES` | SKIP | этапы есть, день вне границ |
| `NOT_JUDO` | SKIP | ученик не Judo |
| `REVERSED_AWARD` | MANUAL | награда была и отменена; повтор не создаётся автоматически |
| `STALE_AWARD` | MANUAL | награда есть, подтверждающей посещаемости для (этап, день) нет (например, JCL изменил JA → NEIN) |
| `CLOSED_STAGE_MISSING` | MANUAL | день в закрытом этапе без награды (081 не принимает записи в закрытый этап) |
| `AMBIGUOUS_STAGE` | MANUAL | день попадает в > 1 этапа |
| `FUTURE_DAY` | MANUAL | местный день позже `club_today` |
| `ORPHAN_ATTENDANCE` | MANUAL | `attendance.student_id` не равен ни одному `students.id::text` |
| `CLUB_MISMATCH` | MANUAL | клуб ученика ≠ клубу строки attendance |
| `INVALID_DATE` | MANUAL | `datum IS NULL` |
| `LEDGER_ANOMALY` | MANUAL | чистая сумма за (этап, день) не 0/1 |

V1 ничего из MANUAL не исправляет: журнал неизменяем (081), отмены и
повторные награды — будущий workflow. STALE_AWARD обнаруживается (JCL
действительно переводит JA → NEIN при снятии отметки).

## Конкурентность и идемпотентность

`sync_student_attendance_rating`: `pg_advisory_xact_lock(hashtext('jkl.student_rating'), hashtext(student_id::text))`
(тот же ключ, что 080–083) → каноническая оценка в новом операторе после
блокировки → INSERT. Гонки дополнительно закрывает уникальный индекс 081;
триггер 081 блокирует строку этапа. Повторный вызов создаёт 0 записей.

## Пакет и dry-run

`private.reconcile_club_attendance_rating(club, dry_run default true)`:
- предусловие: пояс клуба (`club_timezone` / `club_today`), иначе исключение;
- **dry-run** — только STABLE-чтение: ноль INSERT/UPDATE/DELETE, блокировки
  не берутся, триггеры не срабатывают;
- **реальный запуск** — `sync_student_attendance_rating` для учеников с
  `ELIGIBLE_MISSING` по возрастанию `id`; вся работа в транзакции вызывающего
  (любое исключение откатывает всё);
- отчёт: `clubId`, `dryRun`, `timezone`, `clubToday`, `eligibleUniqueDays`,
  `alreadyRepresented`, `wouldCreate`, `created`, `skipped`, `anomalies`,
  `countsByStatus`, `countsByAction`, `perStudent`, `days` (по каждому дню:
  ученик, день, строки attendance, этап, чистая сумма, статус), `syncs`,
  `afterCountsByStatus` (для реального запуска).

## Встроенная самопроверка (без записи данных)

3 функции (INVOKER, owner, `search_path=''`, EXECUTE ни у кого), каноническая —
STABLE; уникальный индекс 081 на месте (колонки, токены предиката);
`source_type` допускает `attendance_day`, форма `attendance_shape` на месте;
RLS обеих таблиц рейтинга, 0 policies, триггеры 081 (3 и 4) включены,
anon/authenticated без прав; у `public.attendance` есть нужные колонки;
миграция не создала записей, не создала/не закрыла этапы, не тронула
историю Kyu (нет строк с `created_at`/`closed_at >= now()`). Не зависит от
текущих количеств JCL.

## Чего 084 не делает

Не начисляет посещаемость при применении; не меняет `attendance` /
`students` / RLS legacy-таблиц / 079–083 / этапы / историю Kyu; нет отмен,
повторных наград, UI, Promote, Rebase, bonus/competition/event.

## План в production (владелец, вручную)

1. Применить 084 целиком.
2. Post-apply: `select count(*) from public.student_rating_entries;` → 0.
3. Dry-run: `select private.reconcile_club_attendance_rating('jcl', true);`
   ожидается `wouldCreate = 182`, `alreadyRepresented = 0`,
   `NO_STAGE_FOR_STUDENT` для 9 учеников Dan, MANUAL = 0.
4. Реальный backfill — **только после отдельного одобрения**:
   `begin; select private.reconcile_club_attendance_rating('jcl', false); … commit;`
   ожидается `created = 182`, после — `ELIGIBLE_MISSING = 0`,
   `ALREADY_REPRESENTED = 182`.
5. Повторный реальный запуск → `created = 0`.

## Rollback-only E2E (после применения, до реального backfill)

`BEGIN … ROLLBACK`: dry-run не меняет счётчики; реальный запуск → 182 записи
`attendance_day` (+1, system), сумма по этапам = число дней; повтор → 0;
несуществующий клуб → исключение; от `authenticated` вызов функций 084 →
permission denied; UPDATE/DELETE записи → `student_rating_entries_immutable`;
`ROLLBACK` → записей 0.
