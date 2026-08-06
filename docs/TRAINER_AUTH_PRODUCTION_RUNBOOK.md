# Production Runbook — единая авторизация тренеров

⚠️ Это ИНСТРУКЦИЯ для владельца системы. Ни одна команда из этого документа
не была выполнена против production в рамках данной сессии. Все SQL —
read-only, если не помечено иначе явным заголовком «ИЗМЕНЯЕТ ДАННЫЕ». Все
идентификаторы — placeholders (`<...>`), не реальные значения.

## Краткая итоговая последовательность (после успешного preflight и conflict-check)

Production preflight и `TRAINER_AUTH_FINAL_CONFLICT_CHECK.sql` уже пройдены
(GREEN) — далее ТОЛЬКО:

1. Визуально проверить project ref `whorwleydkziejjafsea` в Supabase Dashboard.
2. Открыть SQL Editor.
3. Выполнить `TRAINER_AUTH_PRODUCTION_DEPLOY.sql` целиком (раздел 9).
4. Убедиться, что запрос завершился без ошибки (`COMMIT`, не `ROLLBACK`/ошибка).
5. При необходимости создать Auth user штатным способом (Dashboard → Authentication → Add user).
6. Выполнить `TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE.sql` с подставленными значениями (раздел 12).
7. Выполнить `TRAINER_AUTH_POST_DEPLOY_SMOKE_TEST.sql` (раздел 13).
8. При GREEN — инфраструктурная фаза Trainer Auth завершена.
9. Перейти к разработке страниц тренера и семейных страниц — не к новому preflight/conflict-check.

Отдельно, вне этой последовательности (не входит в SQL-пакет выше, но
по-прежнему необходимо для полной работоспособности системы) — деплой
самой Edge Function `manage-trainer-account` и проверка `verify_jwt`, см.
разделы 10-11.

## 1. Preconditions

- [ ] Доступ к production Supabase Dashboard (роль owner/admin проекта).
- [ ] Доступ к Supabase CLI, залогиненному в правильный production-проект (`supabase link --project-ref <PROD_PROJECT_REF>`).
- [ ] Подтверждено: `JCL_Gruppen/supabase.js` содержит production `SUPABASE_URL`/`SUPABASE_ANON_KEY` (не локальные значения) — обязательно перепроверить перед любым шагом.
- [ ] Согласовано окно обслуживания с владельцем клуба(ов), участвующих в пилоте (раздел 14).
- [ ] Прочитан `TRAINER_AUTH_THREAT_MODEL.md` и `TRAINER_AUTH_ARCHITECTURE.md`.

## 2. Полный backup production

```bash
# Через Supabase Dashboard: Database → Backups → создать ручной backup ПЕРЕД началом.
# Либо через CLI (если доступен pg_dump с правами):
pg_dump "postgresql://postgres:<PROD_DB_PASSWORD>@<PROD_DB_HOST>:5432/postgres" \
  --schema=public --schema=auth -F c -f "backup_pre_trainer_auth_<YYYY-MM-DD>.dump"
```
Хранить backup минимум до подтверждённого успеха пилота (раздел 14) + 30 дней.

## 3. Read-only preflight

```sql
-- Подтвердить, что migration-таблица Supabase видит текущее состояние
select version, name from supabase_migrations.schema_migrations order by version desc limit 30;
```

## 4. Проверка текущего состояния миграций 011–026

```sql
-- Сверить, какие из ожидаемых версий УЖЕ применены на production
-- (могло случиться частичное применение в прошлом — не предполагать, проверить)
select version from supabase_migrations.schema_migrations
where version like '20260720120%'
order by version;
```
Сравнить результат со списком файлов в `supabase/migrations/` (см.
`TRAINER_AUTH_PRODUCTION_PACKAGE.md`, раздел 1) — вручную, построчно.

## 5. Проверка типов и внешних ключей

```sql
-- trainers.id — тип, на который будет ссылаться trainer_accounts.trainer_row_id
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='trainers' and column_name in ('id','trainer_id','club_id','rolle');

-- clubs.club_id / club_short_name — типы и NOT NULL
select column_name, data_type, is_nullable from information_schema.columns
where table_schema='public' and table_name='clubs' and column_name in ('club_id','club_short_name');
```
Ожидается: `trainers.id` — bigint или совместимый integer-тип (если отличается
от локального стенда — миграции 011/026 нужно адаптировать ДО применения,
не после).

## 6. Проверка дублей `club_short_name`

```sql
select club_short_name, count(*) from public.clubs
group by club_short_name having count(*) > 1;
```
Ожидается 0 строк. Migration 015 предполагает `UNIQUE(club_short_name)` —
если на production уже есть дубли, миграция 015 упадёт при применении.

## 7. Проверка дублей `trainer_row_id`/`login_name`

```sql
-- Актуально только если trainer_accounts на production уже существует
-- (например, из более раннего частичного прогона)
select trainer_row_id, count(*) from public.trainer_accounts
group by trainer_row_id having count(*) > 1;

select club_id, normalized_login_name, count(*) from public.trainer_accounts
group by club_id, normalized_login_name having count(*) > 1;
```
Ожидается 0 строк в обоих запросах — иначе migration 026 (`UNIQUE(trainer_row_id)`)
и существующий `UNIQUE(club_id, normalized_login_name)` (migration 011) упадут.

## 8. Проверка `service_role` grants

```sql
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema='public'
  and routine_name in (
    'normalize_login_name','resolve_trainer_login_email','family_club_exists',
    'rename_trainer_login','log_trainer_account_operation'
  )
  and grantee = 'service_role';
```
На локальном стенде ВСЕ пять требовали явного `grant execute ... to
service_role` (миграции 020–024) — production мог иметь другие default-права
(`auto_expose_new_tables` может отличаться). Если запрос вернул НЕ 5 строк —
недостающие гранты должны применяться миграциями 020–024/026, не вручную
(держать порядок применения, раздел 9).

## 9. Точный порядок применения миграций

**Актуальный способ (используется вместо `supabase db push`):** все миграции
011-026 объединены в один файл —
[`TRAINER_AUTH_PRODUCTION_DEPLOY.sql`](TRAINER_AUTH_PRODUCTION_DEPLOY.sql),
единая транзакция (`BEGIN...COMMIT`), с защитным блоком, проверяющим
предпосылки вне диапазона 011-026 (family-слой) ДО создания первого
объекта. Содержимое каждой миграции взято дословно из
`supabase/migrations/`, порядок внутри файла — тот же порядок зависимостей,
что и ниже:

```
20260720120011_create_trainer_accounts.sql
20260720120012_trainer_login_email.sql
20260720120013_get_current_trainer_profile.sql
20260720120014_trainer_auth_review_fixes.sql
20260720120015_clubs_club_short_name_unique.sql
20260720120016_trainer_groups_rpc.sql
20260720120017_trainer_student_access_helper.sql
20260720120018_search_trainer_students_rpc.sql
20260720120019_trainer_has_active_account_rpc.sql
20260720120020_grant_resolve_trainer_login_email_service_role.sql
20260720120021_grant_family_club_exists_service_role.sql
20260720120022_grant_normalize_login_name_service_role.sql
20260720120023_grant_rename_trainer_login_service_role.sql
20260720120024_trainer_account_audit_log.sql
20260720120025_trainer_has_any_account_rpc.sql
20260720120026_trainer_accounts_unique_trainer_row.sql
```

Выполнить `TRAINER_AUTH_PRODUCTION_DEPLOY.sql` целиком одним запуском в
SQL Editor (только после успешного прохождения разделов 3-8 и
`TRAINER_AUTH_FINAL_CONFLICT_CHECK.sql`) — единая транзакция сама
гарантирует «всё или ничего»: при любой ошибке откатываются абсолютно все
объекты этого пакета, частично применённого состояния не остаётся.

## 10. Деплой `manage-trainer-account`

```bash
# ПРИМЕНЯЕТ ИЗМЕНЕНИЯ
supabase functions deploy manage-trainer-account --project-ref <PROD_PROJECT_REF>
```
`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_URL` берутся автоматически из
окружения проекта — убедиться, что НИКАКИЕ дополнительные секреты
(`ADMIN_FUNCTION_SECRET` и подобные) не заданы через `supabase secrets set`
для этой функции — они больше не нужны и не используются кодом.

## 11. Проверка `verify_jwt`

```bash
supabase functions list --project-ref <PROD_PROJECT_REF>
```
Убедиться, что `manage-trainer-account` имеет `verify_jwt = true` (значение
по умолчанию) — платформенный гейт ДОЛЖЕН отклонять синтаксически
некорректные JWT ДО кода функции (см. threat model 4.5, тест F).

## 12. Bootstrap первого администратора

Актуальный файл —
[`TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE.sql`](TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE.sql).
Два варианта создания самого `auth.users` (Dashboard / owner-only скрипт) —
см. итоговый отчёт сессии, решение принимает владелец; сам шаблон работает
одинаково для обоих вариантов (принимает уже существующий `AUTH_USER_ID`).

- [ ] Supabase Dashboard → Authentication → Add user — создать пользователя, скопировать User UID.
- [ ] Выбрана существующая строка `trainers` с `rolle='Admin'` для первого клуба пилота — узнать её `id` (`TRAINER_ROW_ID`) и `club_id` (`CLUB_ID`).
- [ ] Подставить `<AUTH_USER_ID>`/`<TRAINER_ROW_ID>`/`<CLUB_ID>`/`<LOGIN_NAME>` в `TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE.sql` и выполнить файл целиком (защитный блок остановит выполнение с понятной ошибкой, если что-то не заменено или не проходит проверку).
- [ ] Пароль передан администратору лично (не по email/SMS), нигде не сохранён в открытом виде.

## 13. Post-deploy smoke test (read-only)

Актуальный файл —
[`TRAINER_AUTH_POST_DEPLOY_SMOKE_TEST.sql`](TRAINER_AUTH_POST_DEPLOY_SMOKE_TEST.sql).
Выполнить целиком ПОСЛЕ раздела 12 (bootstrap) — read-only, один result
grid, итоговая строка `POST_DEPLOY_SMOKE_TEST` со статусом
GREEN/YELLOW/RED. При GREEN — инфраструктурный этап Trainer Auth завершён,
переходить к разработке страниц тренера и семейных страниц (не к новому
preflight/conflict-check).
```bash
# Единственный контролируемый POST — под наблюдением, на пилотном тренере
curl -s -X POST "https://<PROD_PROJECT_REF>.supabase.co/functions/v1/manage-trainer-account" \
  -H "apikey: <PROD_ANON_KEY>" \
  -H "Authorization: Bearer <ACCESS_TOKEN первого администратора>" \
  -H "Content-Type: application/json" \
  -d '{"trainerId":"<PILOT_TRAINER_ID>","loginName":"<Vorname Nachname>","displayName":"<Vorname Nachname>","password":"<пароль, не логировать>","isActive":true}'
```

## 14. Пилот на одном тренере

- [ ] Выбран ОДИН реальный (согласованный с владельцем клуба) тренер для пилота.
- [ ] Администратор клуба создаёт ему Trainerportal-Zugang через реальный UI JCL_Gruppen (не curl) — это и есть проверка полного пути UI → Edge Function → БД.
- [ ] Пароль передан тренеру лично.

## 15. Проверка входа в JCL_Gruppen

- [ ] Пилотный тренер логинится в JCL_Gruppen новым паролем — вход должен пройти через Auth-ветку (не PIN).
- [ ] Старый PIN этого тренера (если помнит) — при попытке входа с PIN вместо пароля должен получить `Login oder PIN falsch` (Auth-ветка не даёт отката на PIN, см. architecture, раздел 5).

## 16. Проверка входа в Trainer Area

- [ ] Тот же логин/пароль на `https://<PROD_TRAINER_AREA_DOMAIN>/trainer` — должен показать Trainer Dashboard.

## 17. Проверка legacy PIN другого тренера

- [ ] Любой ДРУГОЙ, немигрированный тренер того же клуба логинится в JCL_Gruppen старым PIN — должен пройти без изменений (регрессия).

## 18. Проверка аудита

```sql
select performed_by_auth_user_id, target_trainer_id, club_id, operation, created_at
from public.trainer_account_audit_log
order by created_at desc limit 5;
```
Должна появиться ровно одна строка `operation='create'` для пилотного
действия из раздела 14, без пароля/JWT/email в таблице.

## 19. Мониторинг после пилота

- [ ] Согласовать период наблюдения (рекомендация: минимум 3–7 дней) без расширения на других тренеров.
- [ ] Периодически (раз в день на период наблюдения) сверочный запрос на orphaned auth.users (threat model 4.10):
```sql
select id, email, created_at from auth.users
where email like 'trainer_%@internal.jkl'
  and id not in (select auth_user_id from public.trainer_accounts);
```
- [ ] Проверить логи Edge Function (`supabase functions logs manage-trainer-account --project-ref <PROD_PROJECT_REF>`) на неожиданные 500-ошибки.

## 20. Массовая миграция

Только после успешного периода наблюдения (раздел 19) и явного решения
владельца — миграция per-клуб, не одномоментно для всех:
- [ ] Один клуб полностью — все активные тренеры получают Trainerportal-Zugang.
- [ ] Наблюдение (аналогично разделу 19) перед переходом к следующему клубу.
- [ ] Массовость — решение владельца, не автоматизированный процесс в объёме этой задачи.

## 21. Условия отключения legacy PIN

См. `TRAINER_AUTH_ARCHITECTURE.md`, раздел 15 — не раньше 100% миграции всех
клубов + минимум одного полного биллинг-цикла без инцидентов + явного
решения владельца.

## 22. Rollback для каждого шага

| Шаг | Rollback |
|---|---|
| Миграции 011–026 | `supabase migration repair` / ручной `DROP` в обратном порядке (026→011); каждая миграция в этом пакете писала конкретный `DROP`-эквивалент в своём заголовке — свериться перед откатом |
| Деплой `manage-trainer-account` | Передеплой предыдущей версии функции (если была) либо `supabase functions delete manage-trainer-account` |
| Bootstrap первого администратора | Удалить `trainer_accounts` (SQL DELETE) + `auth.users` через Admin API (`DELETE /auth/v1/admin/users/{id}`), НЕ прямым SQL по `auth.users` |
| Пилот (раздел 14) | Деактивировать (`isActive:false` через функцию) ИЛИ полностью удалить аккаунт пилотного тренера тем же путём, что bootstrap |
| Массовая миграция | Поклубный откат — деактивация всех trainer_accounts созданных в конкретном клубе за период миграции (по `created_at`/`club_id` в audit-логе) |

Откат кода НЕ удаляет уже созданные `auth.users`/`trainer_accounts` — это
осознанно (см. Часть 8 итогового отчёта, «план отката»).

## 23. Emergency stop

Если в проде обнаружено критическое поведение (например, тренер получил
доступ к чужому клубу):
1. Немедленно отключить функцию: `supabase functions delete manage-trainer-account --project-ref <PROD_PROJECT_REF>` (JCL_Gruppen получит сетевую ошибку при попытке управления доступом — форма покажет generic-ошибку, ничего не сломается для остальных экранов).
2. `login()` в JCL_Gruppen НЕ зависит от наличия функции для ЧТЕНИЯ (`trainer_has_active_account`/`trainer_has_any_account`/`resolve_trainer_login_email` — это отдельные RPC, не сама функция) — уже мигрированные тренеры продолжат входить, если инцидент НЕ в этих RPC.
3. Если инцидент в самих RPC — `revoke execute on function public.trainer_has_active_account(text,text) from anon, authenticated;` (и аналогично для `trainer_has_any_account`) откатит ВСЕХ, включая уже мигрированных, на... ничего — `login()` перестанет мочь определить ветку и провалится в try/catch → безопасный fallback на PIN-flow (см. app.js, `catch (e) { hasPortalAccount = false; }`) — то есть emergency stop RPC безопасен по дизайну, мигрированные тренеры временно потеряют Auth-вход, но НЕ получат чужой доступ.
4. Уведомить владельца, зафиксировать инцидент, восстановить из backup (раздел 2) только если данные реально повреждены (не просто временная недоступность функции).
