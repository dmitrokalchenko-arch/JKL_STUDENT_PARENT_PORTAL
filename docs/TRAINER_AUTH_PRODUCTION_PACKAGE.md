# Production Package Manifest — единая авторизация тренеров

Статус: манифест подготовлен, ничего не применялось к production.

## 1. Миграции, входящие в production package

Из `JKL_STUDENT_PARENT_PORTAL/supabase/migrations/` (боевая ветка, НЕ
`.local-supabase-test/`):

- `20260720120011_create_trainer_accounts.sql`
- `20260720120012_trainer_login_email.sql`
- `20260720120013_get_current_trainer_profile.sql`
- `20260720120014_trainer_auth_review_fixes.sql`
- `20260720120015_clubs_club_short_name_unique.sql`
- `20260720120016_trainer_groups_rpc.sql`
- `20260720120017_trainer_student_access_helper.sql`
- `20260720120018_search_trainer_students_rpc.sql`
- `20260720120019_trainer_has_active_account_rpc.sql`
- `20260720120020_grant_resolve_trainer_login_email_service_role.sql`
- `20260720120021_grant_family_club_exists_service_role.sql`
- `20260720120022_grant_normalize_login_name_service_role.sql`
- `20260720120023_grant_rename_trainer_login_service_role.sql`
- `20260720120024_trainer_account_audit_log.sql`
- `20260720120025_trainer_has_any_account_rpc.sql` — **добавлена в этой сессии** (фикс деактивации, см. итоговый отчёт)
- `20260720120026_trainer_accounts_unique_trainer_row.sql` — **добавлена в этой сессии** (фикс race condition)

Если на production миграции 011–018 уже применены из более ранней стадии
работы над Trainer Area (Этапы 1–2) — сверить по `TRAINER_AUTH_PRODUCTION_RUNBOOK.md`,
раздел 4, не предполагать.

## 2. Порядок применения

Строго по номеру версии в имени файла, см. `TRAINER_AUTH_PRODUCTION_RUNBOOK.md`,
раздел 9 — единственный источник истины по порядку, не дублируется здесь
во избежание рассинхрона двух документов.

## 3. Local-only миграции, НЕ входящие в package

Из `.local-supabase-test/supabase/migrations/`, существуют ТОЛЬКО для
эмуляции окружения локального стенда, не описывают реальную production-схему:

- `00000000000000_local_jcl_baseline.sql` — создаёт эмуляцию чужих таблиц `trainers`/`clubs`/`groups`/`students`/`trainer_groups` (на production эти таблицы уже существуют, принадлежат JCL_Gruppen)
- `00000000000001_local_baseline_add_gruppe_id.sql`
- `00000000000002_local_baseline_add_trainer_pin_fields.sql`
- `00000000000003_local_baseline_service_role_grants.sql` — компенсирует то, что локальный стенд не наследует существующие production-гранты
- `00000000000004_local_baseline_anon_grants.sql` — аналогично
- `00000000000005_local_baseline_clubs_full_columns.sql`

**Важно:** пункты 20260720120020–024 (гранты `service_role` на конкретные
функции) выглядят похоже на local-only патчи, но входят в production
package — они обнаружены фактическим тестом как реальный пробел в
migration 011/012 (см. threat model), а не как компенсация локального
окружения. Не путать с `00000000000003`/`00000000000004`, которые
компенсируют ИМЕННО отсутствие базовых grants на локальной эмуляции таблиц
JCL_Gruppen — на production эти базовые гранты на `trainers`/`clubs` уже
существуют (созданы владельцем JCL_Gruppen ранее, вне этой задачи).

## 4. Edge Functions, входящие в package

- `supabase/functions/manage-trainer-account/index.ts` — единственная функция этой задачи.

Не входят (не создавались/не менялись этой задачей):
- `supabase/functions/create-family-account/index.ts` — отдельная, существующая функция, вне объёма.

## 5. Secrets, требуемые для деплоя (без значений)

| Переменная | Источник | Комментарий |
|---|---|---|
| `SUPABASE_URL` | Автоматически из окружения Edge Function | Не задаётся вручную |
| `SUPABASE_SERVICE_ROLE_KEY` | Автоматически из окружения Edge Function | Не задаётся вручную, никогда не публикуется |

Больше НИЧЕГО не требуется — `ADMIN_FUNCTION_SECRET` полностью выведен из
употребления этой сессией, не должен задаваться через `supabase secrets set`
для `manage-trainer-account`.

## 6. Файлы JCL_Gruppen, которые должны публиковаться одновременно

- `app.js` (ветвление `login()` + `submitTrainerPortalAccess()` + удаление секрета)
- `index.html` (блоки Trainerportal-Zugang в формах добавления/редактирования тренера, изменённый label/placeholder поля PIN)
- `.gitignore` (новый — предотвращает будущую утечку `supabase.js.PROD_BACKUP_DO_NOT_COMMIT`/`.backup/`)

Деплой Edge Function БЕЗ одновременного обновления `app.js` безопасен (форма
Trainerportal-Zugang просто не появится/не будет работать со старым
секретным заголовком, если бы он ещё был — но его уже нет ни в одном
варианте). Деплой `app.js` БЕЗ обновлённой Edge Function приведёт к ошибкам
401 на любую попытку управления доступом — функциональность деградирует
контролируемо (ошибка, не крах), но публиковать раздельно не рекомендуется.

## 7. Файлы, которые нельзя публиковать

- `JCL_Gruppen/supabase.js.PROD_BACKUP_DO_NOT_COMMIT` — исключён `.gitignore`, содержит реальные production-значения.
- `JCL_Gruppen/.backup/*` — исключён `.gitignore`, старые бэкапы.
- `.local-supabase-test/**` целиком — тестовый стенд, локальные секреты, демо-пароли в `C:\Users\dmitr\AppData\Local\Temp\*.txt` (уже удалены из временной директории по ходу этой сессии).
- Любой файл, содержащий значения `service_role`/`anon key`/пароли/PIN — подтверждено отсутствие таковых в изменённых файлах (см. Часть 7, secret scan).

## 8. Какая версия должна быть сохранена для rollback

- Текущее (pre-deploy) состояние Edge Function `manage-trainer-account` на production, если она там уже существует в какой-то форме (проверить перед деплоем, раздел 4 runbook).
- `git tag` или отдельная ветка на коммите ПЕРЕД публикацией `app.js`/`index.html`/`.gitignore` в JCL_Gruppen — для быстрого `git revert`.
- Backup БД из runbook, раздел 2.

## 9. Проверки, которые должны быть зелёными перед запуском

- [ ] Runbook, разделы 3–8 (read-only preflight) — все запросы вернули ожидаемые результаты (0 дублей, все нужные гранты присутствуют или будут добавлены пакетом).
- [ ] Локальные тесты A–J (плюс регрессионные тесты этой сессии — деактивация/PIN, race condition, rename-rollback, лимит длины) — все пройдены на `.local-supabase-test` (выполнено).
- [ ] Secret scan обоих репозиториев — чисто (выполнено, Часть 7).
- [ ] `JCL_Gruppen/supabase.js` содержит production-значения (не локальные) перед публикацией.

## 10. Действия, требующие отдельного подтверждения владельца

- Момент реального `supabase db push`/`supabase functions deploy` на production (раздел 9–10 runbook).
- Выбор клуба и конкретного тренера для пилота (раздел 14 runbook).
- Способ и момент bootstrap первого администратора (Dashboard vs owner-only скрипт — см. итоговый отчёт).
- Момент и масштаб массовой миграции (раздел 20 runbook).
- Условия и момент отключения legacy PIN-flow (раздел 21 runbook) — необратимое для UX решение.
- Любой `git commit`/`git push` в обоих репозиториях — не выполнялось в этой сессии.
