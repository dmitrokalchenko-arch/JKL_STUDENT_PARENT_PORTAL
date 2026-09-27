# Student Kyu History RPCs — migration 082

Migration: `supabase/migrations/20261006100082_create_student_kyu_history_rpcs.sql`

| Статус | Значение |
|---|---|
| Production PRECHECK для 082 | выполнен владельцем, все требуемые проверки PASS (см. ниже) |
| Production apply | **НЕ ПРИМЕНЕНА** |
| Структурная самопроверка в production | НЕ ВЫПОЛНЯЛАСЬ (выполнится при применении) |
| Поведенческий E2E | **НЕ ВЫПОЛНЯЛСЯ**; путь Trainer заблокирован отсутствием тестового Trainer-аккаунта |
| Локальное выполнение SQL | НЕ ВЫПОЛНЯЛОСЬ (локального PostgreSQL нет) |

## Назначение и объём

Серверные RPC для записи **реальных известных** дат ступеней Judo (Kyu и Dan)
в `public.student_kyu_history` (080). Никаких выдуманных дат: неизвестная дата
= нет строки; технический старт рейтинга 2026-06-22 в историю не пишется.
Триггеры и ограничения 080 остаются финальной защитой.

## Функции

| Сигнатура | Тип | EXECUTE |
|---|---|---|
| `public.record_student_kyu_date(p_student_id bigint, p_kyu_lookup_id bigint, p_obtained_on date) → jsonb` | SECURITY DEFINER | authenticated |
| `public.correct_student_kyu_date(p_student_id bigint, p_supersedes_history_id uuid, p_new_obtained_on date, p_reason text) → jsonb` | SECURITY DEFINER | authenticated |
| `public.retract_student_kyu_date(p_student_id bigint, p_supersedes_history_id uuid, p_reason text) → jsonb` | SECURITY DEFINER | authenticated |
| `public.get_trainer_student_kyu_history(p_student_id bigint) → jsonb` | SECURITY DEFINER, STABLE | authenticated |
| `private.judo_grade_rank(text) → integer` | INVOKER, IMMUTABLE | никто |
| `private.resolve_judo_grade_lookup_id(text) → bigint` | INVOKER, STABLE | никто |
| `private.student_kyu_history_chronology_ok(bigint, bigint, integer, date) → boolean` | INVOKER, STABLE | никто |

Все: owner `postgres`, `search_path=''`. У публичных RPC EXECUTE отозван у
PUBLIC, anon и service_role. Private-хелперы вызываются только изнутри
definer-RPC (выполняются как `postgres`). Права на `student_kyu_history` не
меняются: anon/authenticated — нет, service_role — только SELECT.

## Авторизация

| | Trainer (свой ученик) | Trainer/Admin (чужой ученик/клуб, несуществующий) | Admin (свой клуб) |
|---|---|---|---|
| record | ✅ | `not_allowed` | ✅ |
| correct / retract | `admin_required` | `not_allowed` | ✅ |
| read | действующие даты | `not_allowed` | полная цепочка |

- Активный аккаунт: `private.current_active_trainer_account_id()`.
- Доступ к ученику: `public.can_trainer_access_student(bigint)` — Admin: весь
  свой клуб; Trainer: ученики своих групп. **Оплаченная Student Page не
  требуется** (`can_trainer_access_student_page` / `can_trainer_edit_student_page`
  не используются).
- Admin: `private.is_current_trainer_portal_admin()`. Legacy `trainers.rolle`
  не используется.
- Проверка доступа идёт первой; недоступный и несуществующий ученик дают
  одинаковый `not_allowed`.
- Клиент не передаёт `club_id`, автора, роль, снимок ступени — сервер берёт
  их из `auth.uid()`, `students`, `trainer_accounts`, `kyu_lookup`.

## Ответы

`{ok:true, historyId, entryKind, obtainedOn?}` или `{ok:false, reason}`:
`not_allowed`, `admin_required`, `reason_required`, `invalid_date`,
`future_date`, `not_judo`, `unknown_grade`, `current_grade_unresolved`,
`grade_above_current`, `chain_exists` (+ `terminalHistoryId`), `stale_target`
(+ `currentTerminalId`), `already_retracted`, `no_change`, `chronology_conflict`.
Ошибки инвариантов 080 (триггер) **не** перехватываются — транзакция падает.

## Правила

- **Текущая ступень** — `students.kyu_grad`, сопоставленная с `kyu_lookup`
  по `lower(btrim())` ровно в одну строку; иначе `current_grade_unresolved`.
- **Ранг** — `private.judo_grade_rank`: `N. Kyu` → −N, `N. Dan` → +N (из
  текста, не из `kyu_lookup.id`).
- Записывать можно текущую и **прежние** ступени; ступень **выше текущей** →
  `grade_above_current`.
- **Хронология** (record и correct): для ступени ранга G и даты D относительно
  **других** действующих фактов (последняя строка цепочки, не `retracted`):
  младшая ступень — дата ≤ D, старшая — дата ≥ D; равные даты допустимы;
  отсутствующие ступени не придумываются. При исправлении исправляемая цепочка
  исключается. Нарушение → `chronology_conflict`.
- **record**: корень `recorded`, `source='manual_entry'`, причина не нужна;
  существующая цепочка → `chain_exists` (исправление — только Admin).
- **correct**: только Admin, причина обязательна; цель — текущая последняя
  строка цепочки (иначе `stale_target`); поверх `retracted` — восстановление
  факта; та же дата → `no_change`.
- **retract**: только Admin, причина обязательна; `obtained_on = NULL`; уже
  отозвано → `already_retracted`.
- Дата не позже `private.club_today(club)`; ненастроенный пояс — отказ (079).

## Чтение

`{ok, currentGrade:{raw, kyuLookupId, kyuGrad, resolved}, grades:[…], canCorrect}`.
Каждая ступень с историей: `kyuLookupId`, `kyuGrad`, `isCurrentGrade`,
`effectiveObtainedOn`, `terminalKind`, `hasAuditHistory`. Admin дополнительно
получает `terminalHistoryId` и `rows` (historyId, entryKind, obtainedOn,
kyuGradSnapshot, supersedesId, isTerminal, isEffective, createdAt, reason,
author {displayName, portalRole}). Trainer строк аудита, причин и авторов не
получает. `auth_user_id` не раскрывается. Порядок: ступени по рангу, строки
по `created_at, id`.

## Блокировка

`pg_advisory_xact_lock(hashtext('jkl.student_rating'), hashtext(student_id::text))`
— тот же ключ, что у будущих bootstrap / rebase / создания этапов. Доступ,
роль, ученик, цель и цепочки перечитываются **после** блокировки. Гонки:
второй корень — блокировка + `one_root_uidx`; двойное исправление/отзыв —
блокировка + проверка последней строки (`stale_target`) + `UNIQUE(supersedes_id)`.

## Встроенная самопроверка (структура, без записи данных)

7 функций: наличие, SECURITY DEFINER/INVOKER, `search_path=''`, owner, EXECUTE
(PUBLIC/anon/service_role — нет; authenticated — только публичные RPC);
детерминированные значения `judo_grade_rank`; `student_kyu_history`: RLS,
0 policies, права клиентов и service_role, 3 триггера B1.

## Production PRECHECK (выполнен владельцем до реализации)

`student_kyu_history` 13/13 колонок, RLS, 0 policies, права без изменений,
3 триггера включены; все функции-зависимости на месте; `trainer_accounts` —
нужные колонки есть, активный Admin jcl = 1, **активных не-Admin Trainer с
привязкой к `trainers` = 0**; пояс jcl = Europe/Berlin; 44 ученика Judo,
текущая ступень распознаётся у всех; ранги `kyu_lookup` разбираются;
history / stages / entries = 0 / 0 / 0; конфликтов имён нет.

## Чего 082 не делает

Не меняет `students`/`kyu_grad`/`kyu_lookup`/`trainer_accounts`; не создаёт и
не меняет Rating Stages/Entries; нет bootstrap, Promote, Rebase,
`club_rating_config`; нет UPDATE/DELETE истории; не меняет 079/080/081 и права
на `student_kyu_history`; не создаёт RLS policies; нет UI.

## Будущий rollback-only E2E (НЕ выполнялся)

Одна транзакция `BEGIN … ROLLBACK`, подмена пользователя:
`set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', '<auth_user_id>', 'role', 'authenticated')::text, true);`

- Admin: record (текущая и прежняя ступень) → ok; повтор → `chain_exists`;
  будущая дата → `future_date`; ступень выше текущей → `grade_above_current`;
  нарушение хронологии → `chronology_conflict`; неизвестный `kyu_lookup_id` →
  `unknown_grade`; correct без причины → `reason_required`; correct → ok (старая
  строка на месте); повтор со старой целью → `stale_target`; та же дата →
  `no_change`; retract → ok; повтор → `already_retracted`/`stale_target`;
  correct поверх retracted → факт восстановлен; read Admin — полная цепочка.
- Чужой ученик — нет в jcl другого клуба: кросс-клубный тест требует ученика
  другого клуба; иначе «не проверено».
- Безопасность: прямой INSERT/UPDATE/DELETE от `authenticated` → permission
  denied; `anon` не может вызвать RPC.
- Итог: `students.kyu_grad` не изменился; stages/entries = 0; после ROLLBACK
  счётчики равны исходным.
- **Путь Trainer** (`record` ok, `correct`/`retract` → `admin_required`, чтение
  без аудита): **заблокирован** — в production нет активного не-Admin
  Trainer-аккаунта jcl с привязкой к `trainers` и группам. Реальный Admin
  понижать нельзя.
