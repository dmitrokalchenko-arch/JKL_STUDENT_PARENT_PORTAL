# Rating B3 — Club Rating Config + initial stage bootstrap (migration 083)

Migration: `supabase/migrations/20261007100083_create_club_rating_config_bootstrap.sql`

| Статус | Значение |
|---|---|
| Production PRECHECK B3 | выполнен владельцем: 44 ученика Judo JCL (35 Kyu, 9 Dan), все `B1_NO_HISTORY`; history / stages / entries = 0; имена 083 свободны; хелперы 082 согласованы |
| Production apply | **НЕ ПРИМЕНЕНА** |
| Production dry-run | **НЕ ВЫПОЛНЯЛСЯ** |
| Production bootstrap | **НЕ ВЫПОЛНЯЛСЯ** (этапов не создано) |
| Поведенческий E2E | **НЕ ВЫПОЛНЯЛСЯ** |
| Локальное выполнение SQL | НЕ ВЫПОЛНЯЛОСЬ (локального PostgreSQL нет) |

## Решения владельца (зафиксированы)

1. Начальные этапы — **только Kyu** для JCL; Dan пропускаются **политикой клуба**
   (`rating_includes_dan = false`), а не глобальным правилом.
2. Технический старт рейтинга JCL — **2026-06-22** (не дата ступени).
3. Отдельная таблица `public.club_rating_config` (не `club_portal_settings`).
4. Строка только `jcl / 2026-06-22 / false`; других клубов нет.
5. Нет конфигурации — отказ, без запасных значений.
6. Конфигурация неизменяема (UPDATE / DELETE / TRUNCATE запрещены).
7. Отдельного журнала запусков нет: неизменяемые этапы + сохранённый отчёт.
8. Пакетная функция — в схеме `private`, не RPC.
9. Миграция bootstrap **не запускает**.

## Объекты

| Объект | Тип | Права |
|---|---|---|
| `public.club_rating_config (club_id text PK, rating_start_on date NOT NULL, rating_includes_dan boolean NOT NULL, created_at, updated_at timestamptz NOT NULL default now(), note text NULL)` | таблица, RLS без policies | anon/authenticated — нет; service_role — только SELECT |
| `private.enforce_club_rating_config_valid()` | триггер BEFORE INSERT, DEFINER | EXECUTE ни у кого |
| триггеры `trg_club_rating_config_immutable` (UPDATE/DELETE) и `trg_club_rating_config_no_truncate` | используют `private.reject_student_rating_mutation()` из 081 → `club_rating_config_immutable` | — |
| `private.club_rating_start(text) → date` | DEFINER, STABLE | ни у кого |
| `private.club_rating_includes_dan(text) → boolean` | DEFINER, STABLE | ни у кого |
| `private.classify_student_rating_bootstrap(bigint) → jsonb` | INVOKER, STABLE | ни у кого |
| `private.ensure_initial_rating_stage(bigint) → jsonb` | INVOKER | ни у кого |
| `private.bootstrap_club_rating_stages(text, boolean default true) → jsonb` | INVOKER | ни у кого |

Все функции: owner `postgres`, `search_path=''`, EXECUTE отозван у PUBLIC, anon,
authenticated, service_role (у authenticated есть USAGE на `private`, поэтому
отзыв EXECUTE обязателен). FK на `public.clubs` нет — `clubs.club_id` не
подтверждён UNIQUE; существование клуба и наличие пояса (079) проверяет триггер.
Переиспользуются хелперы 082: `private.judo_grade_rank`,
`private.resolve_judo_grade_lookup_id`, `private.student_kyu_history_chronology_ok`;
и 079: `private.club_today`.

## Классификация (порядок проверки)

| Категория | Условие | action |
|---|---|---|
| `F_STUDENT_NOT_FOUND` | ученика нет | MANUAL |
| `N_NOT_JUDO` | `sport_id` ≠ judo | SKIP |
| *(исключение)* | нет `club_rating_config` → `club_rating_config_not_configured` | fail closed |
| `E1_ACTIVE_STAGE_EXISTS` | есть активный этап | SKIP (`already_exists`) |
| `F_STAGE_ANOMALY` | этапы есть, активного нет | MANUAL |
| `D1_NO_CURRENT_GRADE` | `kyu_grad` пуст | MANUAL |
| `D2_UNRESOLVED_GRADE` | 0 совпадений в `kyu_lookup` | MANUAL |
| `F_AMBIGUOUS_GRADE` | >1 совпадения | MANUAL |
| `F_UNRANKABLE_GRADE` | ранг не разбирается | MANUAL |
| `F_HISTORY_ANOMALY` | цепочка с ≠1 корнем или ≠1 последней строкой; `club_id` истории ≠ клубу ученика; действующий факт с неразбираемым рангом | MANUAL |
| `C_HISTORY_CONFLICT` | действующий факт выше текущей ступени, или дата факта текущей ступени противоречит другим действующим фактам (`chronology_ok` из 082) | MANUAL |
| `N_DAN_POLICY_EXCLUDED` | текущая ступень Dan и `rating_includes_dan = false` | SKIP |
| `F_RATING_NOT_STARTED` | `rating_start_on` > `club_today` | MANUAL |
| `A1_KNOWN_DATE_ON_OR_AFTER_START` | действующий факт текущей ступени, `obtained_on ≥ start` | AUTO: `obtained_on` / `kyu_obtained` / id факта |
| `A2_KNOWN_DATE_BEFORE_START` | действующий факт, `obtained_on < start` | AUTO: `start` / `club_rating_start` / NULL |
| `B2_CURRENT_GRADE_RETRACTED` | цепочка текущей ступени отозвана | AUTO: `start` / `club_rating_start` / NULL |
| `B1_NO_HISTORY` | цепочки текущей ступени нет | AUTO: `start` / `club_rating_start` / NULL |

Политика Dan проверяется **после** структурных проверок и конфликтов: повреждённый
ученик с Dan получает MANUAL-категорию, а не маскируется политикой. Действующий
факт = последняя строка цепочки (на неё никто не ссылается через `supersedes_id`)
и не `retracted`. Ответ классификатора содержит только технические поля
(`studentId`, `clubId`, категория, причина, ступень, предложение) — без имён.

Dan расширяется без переделки схемы: новая строка конфигурации (отдельной
миграцией владельца) с `rating_includes_dan = true` — и те же функции создадут
этапы для Dan.

## Идемпотентность и конкурентность

`ensure_initial_rating_stage`: `pg_advisory_xact_lock(hashtext('jkl.student_rating'), hashtext(student_id::text))`
→ классификация **после** блокировки → `INSERT` только для AUTO
(`created_by_kind = 'system'`, `status = 'active'`, `previous_stage_id = NULL`).
Результаты: `created` / `already_exists` / `skipped` / `manual`. Повторный
вызов для ученика с этапом — `already_exists`, без исключения. Инварианты 081
(один active, один корень, проверки вставки) не обходятся; триггеры не
отключаются; записи журнала не создаются.

## Пакетный запуск

`private.bootstrap_club_rating_stages(p_club_id, p_dry_run default true)`:
- предусловия (fail closed): пояс клуба (`private.club_today`), конфигурация,
  `club_today ≥ rating_start_on`;
- ученики клуба с `sport_id = 'judo'` по возрастанию `id`;
- **dry-run** — только `classify_…` (STABLE), **ноль записей**, блокировки не
  берутся; `result` = `would_create` / `already_exists` / `skipped` / `manual`;
- **реальный запуск** — `ensure_initial_rating_stage` для каждого ученика;
  выполняется в транзакции вызывающего: любое исключение откатывает весь
  запуск; повторный запуск идемпотентен;
- отчёт: `clubId`, `dryRun`, `clubToday`, `ratingStartOn`, `ratingIncludesDan`,
  `considered`, `countsByAction`, `countsByCategory`, `countsByResult`,
  `students[]` (только `studentId`, категория, action, причина, `gradeKind`,
  предложение, результат, `stageId`).

Ожидание для JCL по PRECHECK: 44 рассмотрено, 35 AUTO (`B1_NO_HISTORY`, Kyu),
9 SKIP (`N_DAN_POLICY_EXCLUDED`).

## Встроенная самопроверка (только 083, без записи данных)

Таблица и владелец; 6 колонок (тип, NOT NULL), defaults `now()`; PK `club_id`;
2 CHECK; RLS, 0 policies; права (клиенты — нет, PUBLIC — нет, service_role —
только SELECT); 3 триггера (`tgtype`, `tgfoid`, включены); 6 функций
(DEFINER/INVOKER, `search_path=''`, owner, EXECUTE ни у кого); строка ровно
`jcl / 2026-06-22 / false` и единственная (таблица создана этой транзакцией);
миграция не создала этапов и записей (нет строк с `created_at >= now()`).

## Известные ограничения (не решаются в B3)

- **Будущий Rebase.** Ученик получил этап от технического старта; позже внесена
  реальная дата текущей ступени **позже** старта → этап начал копить слишком
  рано. После появления записей журнала (B4) после новой границы правило 081
  `entries_after_end` может запретить закрытие этапа. B3 ничего не удаляет и не
  перезаписывает: этап (`starts_on`, basis, `kyu_history_id`, `created_at`),
  неизменяемая история и журнал сохраняют всё нужное будущему Rebase.
  Рекомендация: собрать реальные даты текущих ступеней через RPC 082 **до** B4.
- **Повышение в тот же день** — отложено до Promote.

## Чего B3 не делает

Нет начисления посещаемости и backfill (B4), Promote, Rebase, сверки, UI
рейтинга и семейного UI, competition/camp/event/exam/bonus; не меняет
`students` / `kyu_grad` / историю Kyu / `attendance` / `kyu_lookup` / 079–082;
не создаёт этапы при миграции; нет публичных RPC.

## План применения в production (владелец, вручную)

1. Применить миграцию 083 целиком (самопроверка внутри транзакции).
2. Post-apply (только чтение):
   ```sql
   select * from public.club_rating_config;
   select count(*) from public.student_rating_stages;   -- ожидается 0
   select count(*) from public.student_rating_entries;  -- ожидается 0
   ```
3. Dry-run (ничего не пишет):
   ```sql
   select private.bootstrap_club_rating_stages('jcl', true);
   ```
   Проверить `countsByCategory` / `countsByAction` и список учеников.
4. Реальный bootstrap — **только после отдельного одобрения владельца**:
   ```sql
   begin;
   select private.bootstrap_club_rating_stages('jcl', false);
   -- сверить отчёт и count(*) этапов; затем commit или rollback
   commit;
   ```

## Rollback-only поведенческий E2E (после применения, до реального bootstrap)

В одной транзакции `BEGIN … ROLLBACK`, как владелец:
- `private.bootstrap_club_rating_stages('jcl', true)` — счётчики этапов до и
  после не меняются (dry-run без записей);
- `private.bootstrap_club_rating_stages('jcl', false)` → 35 `created`,
  9 `skipped`; повторный вызов → 35 `already_exists`, 9 `skipped`, новых этапов нет;
- у созданных этапов `starts_on = 2026-06-22`, `starts_on_basis = club_rating_start`,
  `kyu_history_id` NULL, `created_by_kind = system`; записей журнала 0;
- `private.bootstrap_club_rating_stages('unknown_club', true)` →
  исключение (нет пояса / конфигурации);
- UPDATE / DELETE `club_rating_config` → `club_rating_config_immutable`;
- от роли `authenticated`: вызов любой функции B3 → permission denied;
- `ROLLBACK`; этапов 0.
