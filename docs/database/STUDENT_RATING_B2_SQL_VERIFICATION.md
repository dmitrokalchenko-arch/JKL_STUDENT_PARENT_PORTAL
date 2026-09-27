# Student Rating B2 — Rating Stages + Immutable Ledger (migration 081)

Migration: `supabase/migrations/20261005100081_create_student_rating_stages_ledger.sql`
(Rating Database Design, Migration B2). Зависит от 079 (`private.club_today`)
и 080 (`student_kyu_history`), обе применены в production.

## Статус production (2026-09-27)

- **Migration 081 применена в production** вручную владельцем
  (SHA-256 `cd7a16947e1ff6ca917f846da915ba3549c3d015c37cdf9b76cb51abd5ba73bc`).
- **Структурная проверка production: 30/30 PASS** — обе таблицы существуют,
  21 / 15 колонок, RLS включён на обеих, policies нет, private-функции и
  триггеры B2 на месте, service_role — только SELECT (записать не может);
  сама миграция создала 0 этапов и 0 записей; фундамент 079/080 доступен.
- **Rollback-only поведенческий E2E в production: PASS** (итог
  `B2_BEHAVIORAL_E2E_PASS`). После финального `ROLLBACK`:
  `student_rating_stages = 0`, `student_rating_entries = 0`,
  `student_kyu_history = 0` (тестовых строк не осталось), `jcl_today = 2026-09-27`.
  Более ранние неудачные попытки E2E — ошибки тестового скрипта, откатаны,
  данных не оставили.
- **Bootstrap/backfill НЕ выполнялся.** Реальных Rating Stages и Rating
  Entries пока нет.
- Будущая работа: bootstrap, сверка/генерация посещаемости, прикладные RPC,
  Promote, Rebase, Rating UI.
- PR #19 не затронут.

## Модель данных

### `public.student_rating_stages` — период рейтинга на одной ступени Judo

| Группа | Колонки |
|---|---|
| идентичность | `id uuid` PK, `club_id text`, `student_id bigint` → `students`, `kyu_lookup_id bigint` → `kyu_lookup`, `kyu_grad_snapshot text` |
| начало | `starts_on date`, `starts_on_basis` (`kyu_obtained` \| `club_rating_start`), `kyu_history_id uuid` |
| цепочка | `previous_stage_id uuid` (UNIQUE) |
| состояние | `status` (`active` \| `closed`), `ends_on date` |
| закрытие (аудит) | `closed_reason` (`promotion` \| `rebase`), `closed_note`, `closed_at`, `closed_by_kind` (`system` \| `trainer_account`), `closed_by_trainer_account_id`, `closed_by_portal_role` |
| создание (аудит) | `created_by_kind`, `created_by_trainer_account_id`, `created_by_portal_role`, `created_at` |

Семантика:
- `kyu_obtained` ⇒ `kyu_history_id` обязателен; составной FK
  `(kyu_history_id, student_id, club_id, kyu_lookup_id)` → `student_kyu_history`
  (та же цепочка); на момент вставки факт **действующий** (терминальный, не
  `retracted`) и `starts_on = obtained_on`.
- `club_rating_start` ⇒ `kyu_history_id IS NULL`; `starts_on` — технический
  старт рейтинга клуба (для JCL будет 2026-06-22), **не** дата ступени.
  Схема дату не хардкодит — её задаст будущий bootstrap.
- Не более одного `active` на ученика (`student_rating_stages_one_active_uidx`).
  Ученик принадлежит одному клубу, V1 — только Judo, поэтому `student_id` —
  минимальный корректный ключ.
- Цепочка этапов линейна: один корень на ученика
  (`student_rating_stages_one_root_uidx`), `UNIQUE(previous_stage_id)`,
  составной FK на этап того же ученика/клуба; предыдущий этап должен быть
  `closed`.
- **Этапы не перекрываются.** Инвариант: для любого этапа с
  `previous_stage_id` — `starts_on > previous.ends_on` (строго: `ends_on` —
  последний включённый день предыдущего этапа). Равенство
  `starts_on = previous.ends_on + 1` **не** требуется — промежуток допустим
  (будущий audited rebase / bootstrap policy). Нарушение →
  `student_rating_stages_overlapping_previous`. Проверяется триггером вставки
  (`private.enforce_student_rating_stages_insert`); отдельного ограничения/
  индекса нет, поэтому структурная самопроверка его не покрывает — покрывает
  поведенческий E2E. Семантику дня повышения это не решает.
- `ends_on` — последний **включённый** день закрытого этапа, `NULL` у active.
- Единственное изменение строки — `active → closed` (триггер): прочие поля
  неизменны, `closed_at = now()`, `ends_on <= club_today`, в журнале нет
  записей после `ends_on`; для `rebase` обязателен `closed_note`.

### `public.student_rating_entries` — неизменяемый журнал

`id`, `club_id`, `student_id`, `stage_id`, `source_type`, `effective_on date`,
`points integer`, `reversal_of_entry_id`, `reaward_after_entry_id`,
`idempotency_key uuid`, `reason`, `created_by_kind`,
`created_by_trainer_account_id`, `created_by_portal_role`, `created_at`.

Авторитетный итог этапа = `SUM(points)` по `stage_id`. Хранимого итога нет,
ограничения «на чтении» нет.

| source_type | Правила |
|---|---|
| `attendance_day` | `points = 1`, `system`, без причины; корень дня уникален на `(stage_id, effective_on)`; повтор — только через `reaward_after_entry_id` |
| `admin_adjustment` | Admin (`portal_role = admin`, активный, тот же клуб), `points <> 0`, `abs(points) <= 1000`, причина, `idempotency_key` (UNIQUE на этап) |
| `reversal` | `reversal_of_entry_id` → запись того же этапа и дня; не отмена отмены; `points = -target.points`; одна отмена на запись; причина; посещаемость отменяет `system`, корректировку — Admin |

`effective_on` у reversal равен `effective_on` отменяемой записи (составной
FK); момент отмены — `created_at`.

## Посещаемость: уникальность и цепочка

Местный день = `(attendance.datum AT TIME ZONE private.club_timezone(club_id))::date`
(вычисляет будущая сверка; B2 attendance не читает). Неизвестный пояс →
отказ (`club_timezone_not_configured`).

```
E1 attendance_day +1  effective_on=2026-09-10  (корень дня)
E2 reversal       -1  reversal_of=E1           (effective_on=2026-09-10)
E3 attendance_day +1  reaward_after=E2         (effective_on=2026-09-10)
E4 reversal       -1  reversal_of=E3
SUM = 0
```

| Защита | Механизм |
|---|---|
| второй корень дня | `student_rating_entries_attendance_root_uidx` |
| двойная отмена | `UNIQUE(reversal_of_entry_id)` |
| два повтора после одной отмены | `UNIQUE(reaward_after_entry_id)` |
| повтор/отмена другого этапа или дня | составные FK `(…, stage_id, effective_on)` |
| отмена отмены, неверные points, reaward не после отмены посещаемости | триггер вставки |

Цепочка дня линейна ⇒ в любой момент не более одной действующей награды.

## Итог ≥ 0 и конкурентность

Триггер вставки записи:
1. `SELECT … FROM student_rating_stages WHERE id = stage_id FOR UPDATE` —
   сериализует все записи журнала этапа и его закрытие;
2. проверяет этап (`active`, ученик/клуб, `effective_on` в
   `[starts_on, club_today]`);
3. `SUM(points) + new.points >= 0`, иначе `student_rating_entries_negative_total`.

Отмена, делающая итог отрицательным (в т.ч. отмена посещаемости после
отрицательной корректировки), **отклоняется** — это конфликт сверки; будущий
Admin-workflow его разрешит. Отрицательные записи и закрытие этапа требуют
READ COMMITTED (как 078): при REPEATABLE READ снимок мог бы не увидеть
запись, закоммиченную до получения блокировки.

| Что защищает | Чем |
|---|---|
| итог ≥ 0 при параллельных корректировках | row lock этапа + SUM после блокировки |
| запись в этап, который закрывается | row lock: после ожидания триггер видит `closed` |
| дубли корня / отмены / повтора / idempotency | UNIQUE-ограничения |
| два active этапа, ветвление цепочки | частичные UNIQUE + `UNIQUE(previous_stage_id)` |
| изменения нескольких сущностей ученика (Promote, Rebase, сверка, история Kyu) | будущие RPC: `pg_advisory_xact_lock(hashtext('jkl.student_rating'), hashtext(student_id::text))` (ключ B1) |

## Неизменяемость

- `student_rating_entries`: UPDATE / DELETE (row) и TRUNCATE (statement)
  отклоняются для всех ролей → `student_rating_entries_immutable`.
- `student_rating_stages`: DELETE / TRUNCATE отклоняются →
  `student_rating_stages_immutable`; UPDATE — только `active → closed`.
- Все FK — `ON DELETE RESTRICT`.

## Права

Обе таблицы: RLS включён, policies нет; PUBLIC / anon / authenticated — нет
прав; service_role — только SELECT. Функции `private.*`: owner `postgres`,
`search_path=''`, EXECUTE ни у кого; SECURITY DEFINER — три проверяющие
(читают `students`, `kyu_lookup`, `trainer_accounts`, `student_kyu_history`,
`private.club_today`), `reject_student_rating_mutation` — без definer.

## Встроенная самопроверка (только структура B2)

Таблицы, владелец, RLS, 0 policies, права; 21 / 15 колонок (имена, типы,
NOT NULL); PK/UNIQUE по колонкам; 10 FK (цель, колонки, RESTRICT); 15 / 12
CHECK по именам; наборы `source_type` и `starts_on_basis` ровно V1; 3
частичных UNIQUE (колонки + токены предиката, без хрупкого точного
сравнения); 7 триггеров (`tgtype`, `tgfoid`, включены); 4 функции.
Не создаёт временных объектов и не проверяет отсутствие чужих объектов.

## Что B2 намеренно НЕ делает

Нет bootstrap/backfill, этапов и записей; не читает attendance; не
импортирует `students.kyu_grad`; нет RPC, Promote, Rebase, сверки, UI;
нет competition/camp/event/exam/bonus; не меняет students, attendance,
kyu_lookup, student_kyu_history, 079/080.

## Отложенные решения

1. **Bootstrap policy** — источник технической даты старта клуба (сейчас
   нигде не хранится: Rating Settings из PR #31 — только UI-макет); что
   делать, если известная `obtained_on` раньше технического старта; выбор
   текущей ступени (`students.kyu_grad` → `kyu_lookup`).
2. **Граница дня повышения** — `ends_on` старого и `starts_on` нового этапа
   задаёт будущий Promote RPC; схема не требует ни одного варианта.
3. **Записи в закрытый этап** — сейчас запрещены (консервативно; поздняя
   правка посещаемости по закрытому этапу станет конфликтом сверки). Ослабить
   позже можно без переделки данных.
4. **Роль для Promote / закрытия этапа** — не ограничена схемой (проверяются
   только активность, клуб и совпадение снимка роли); решит Promote RPC.
5. **Rebase** — архитектурно возможен (`closed_reason = 'rebase'` +
   `closed_note` + новый этап с `previous_stage_id`), workflow не реализован.
6. **Admin-resolution конфликтов сверки** — не реализован; схема не мешает
   (отклонённая отмена не оставляет следов в журнале).

## Rollback-only поведенческий E2E (после применения)

В одной транзакции с финальным `ROLLBACK`, на реальном ученике jcl (judo) и
активном Admin-аккаунте:
1. этап `club_rating_start` → OK; второй active → `…_active_exists`;
2. этап `kyu_obtained` с действующим фактом истории → OK; с `retracted`/
   нетерминальным → `…_kyu_history_not_effective`; `starts_on ≠ obtained_on` → отказ;
3. `attendance_day` → OK; второй корень того же дня → отказ; reversal → OK;
   reaward → OK; второй reaward после той же отмены → отказ; reversal отмены → отказ;
4. `admin_adjustment -N` сверх итога → `…_negative_total`; в пределах → OK;
   повтор `idempotency_key` → отказ;
5. reversal посещаемости, делающий итог < 0 → `…_negative_total`;
6. `effective_on` до `starts_on` / после сегодня → `…_outside_stage`;
7. закрытие `active → closed` → OK; изменение других полей → `…_immutable`;
   запись в закрытый этап → `…_stage_closed`; закрытие с `ends_on` раньше
   существующей записи → `…_entries_after_end`;
7a. последовательность этапов: предыдущий закрыт с `ends_on = X`;
   новый этап с `previous_stage_id` и `starts_on <= X` (включая `= X`) →
   `…_overlapping_previous`; новый этап с `starts_on > X` → OK (и с
   промежутком, например `X + 5`, → OK);
8. UPDATE / DELETE / TRUNCATE entries и DELETE / TRUNCATE stages → `…_immutable`;
9. `ROLLBACK`.

## Известная существующая проблема

Super Admin «удалить клуб» в JCL удаляет данные клуба и строку `clubs`, но
удаление `students` падает на RESTRICT FK (уже сейчас — из-за family/technique/
kyu-program/kyu-history таблиц) и лишь логируется → остаются ученики и история
без клуба. B2 не исправляет и не усугубляет класс проблемы (только добавляет
ещё одну RESTRICT-зависимость).
