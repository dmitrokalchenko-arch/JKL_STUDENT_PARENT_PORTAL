# Trainer Portal roles — protected `portal_role`

Статус: migration `20261002100078_add_protected_trainer_portal_roles.sql`
**применена в production** (post-migration verification V01–V18 PASS).
Первый Portal Admin **назначен** owner-controlled bootstrap (PASS; клуб `jcl`,
см. `memory/CURRENT_STATUS.md`). `manage-trainer-account` **остаётся
отключённой** (403, см. `docs/security/TRAINER_ACCOUNT_MANAGEMENT_HOTFIX.md`).
Frontend-этап (раздел 6) ещё не реализован.

## 1. Источник истины

| Что | Источник | Не используется |
|---|---|---|
| Роль в портале | `public.trainer_accounts.portal_role` (`trainer` \| `admin`) | legacy `public.trainers.rolle`, Admin PIN session, JWT/user metadata, параметры клиента |
| Активность | `public.trainer_accounts.is_active` | legacy `public.trainers.aktiv` |
| Клуб | `public.trainer_accounts.club_id` | club_id из запроса/токена |

Legacy `trainers.rolle` — только метаданные JCL_Gruppen. Buchhaltung не получает
портальных прав автоматически: права дают только явная активная строка
`trainer_accounts` и её `portal_role`. Club Admin ≠ Super Admin (отдельные системы).

## 2. Роли

| | Trainer | Admin |
|---|---|---|
| Вход | Trainer Portal | тот же Trainer Portal, тот же вход |
| Ученики | только через свои `trainer_groups` | **все ученики своего `club_id`**; другой клуб — никогда |
| Индивидуальные функции ученика (Required Techniques; позже Bonus) | да (по правилам Student Page) | да (наследует Trainer) |
| Club-wide: Student Page settings, Kyu program, DJB/Go Kyu templates | нет | да |
| Rating Settings, Events Calendar, Trainer Account management | нет | позже |
| Смена ролей | нет | позже (только через защищённый серверный путь) |

`trainer_access_after_expiry` по-прежнему даёт только ЧТЕНИЕ, никогда запись.

## 3. База данных (migration 078)

- `portal_role text NOT NULL DEFAULT 'trainer'` + `CHECK (portal_role IN ('trainer','admin'))`.
  `text` + CHECK вместо enum: в проекте нет enum; CHECK проще менять; нет отдельного
  объекта с собственными default privileges. Все существующие аккаунты → `trainer`.
- Клиентских прав на `trainer_accounts` нет (077) — колонку нельзя изменить ни
  anon, ни authenticated. RPC вида `set_my_role` / `set_trainer_role` не создаются.
- Хелперы (SECURITY DEFINER, `search_path = ''`, EXECUTE у PUBLIC/anon/authenticated
  отозван, вызываются только из SECURITY DEFINER функций):
  - `private.current_trainer_portal_role()` — роль текущего `auth.uid()` только для
    активного аккаунта, иначе NULL;
  - `private.is_current_trainer_portal_admin()` — `true` только для активного `admin`.
  - Отдельный `require_*` хелпер не нужен: существующие RPC отвечают на отказ
    `false` / пустым результатом (anti-enumeration), новый контракт не вводится.
- `get_current_trainer_profile()` дополнительно отдаёт **собственную** `portal_role`
  (DROP + CREATE, т.к. меняется тип результата; ACL восстановлен явно). Значение —
  только для UI, не авторизация.

### Admin: ученики своего клуба

Единая точка — `public.can_trainer_access_student(bigint)`: для Admin
`students.club_id = trainer_accounts.club_id` без `trainer_groups`. Через неё
Admin-scope автоматически и единообразно получают: `get_trainer_student_by_id`,
`can_trainer_access_student_page`, `private.can_trainer_edit_student_page`,
`get_trainer_required_techniques`, Save/Reset индивидуальной программы (Stage 2),
RLS `student_technique_records`, Storage-policy `student-technique-videos`.
Правила подписки Student Page не меняются. `search_trainer_students` имеет
собственную групповую логику — в неё добавлена отдельная ветка Admin (поиск по
клубу). `get_current_trainer_groups` не меняется.

### Club-wide — только Admin (сервер)

| RPC | Trainer | Admin |
|---|---|---|
| `save_trainer_student_page_config(jsonb)` | `false` | как раньше |
| `save_trainer_kyu_program(bigint,jsonb)` | `false` | как раньше |
| `save_trainer_kyu_template(bigint,text,jsonb)` | `false` | как раньше |
| `get_trainer_kyu_program(bigint)` (Admin-редактор) | пусто | как раньше |
| `get_trainer_kyu_template(bigint,text)` (Admin-редактор) | пусто | как раньше |
| `get_trainer_student_page_config()` (runtime Student Page) | **как раньше** | как раньше |

Runtime-резолвер Required Techniques (`get_required_techniques_for_student`,
только service_role / из definer-цепочек) от Admin-редакторов не зависит —
Trainer, Family и Super Admin Preview продолжают видеть эффективную программу.
У каждой функции одна перегрузка (проверено PRECHECK 6/7 и самопроверкой 078).

### Защита последнего активного Admin

Триггер `trg_trainer_accounts_last_active_admin` (BEFORE UPDATE OR DELETE) запрещает
переход клуба из «≥ 1 активный admin» в «0» (demote, deactivate, смена club_id,
delete — в т.ч. каскадом из `auth.users`). Состояние «0 admin» до bootstrap
допустимо; INSERT и повышение не проверяются.

Конкуренция: `pg_advisory_xact_lock` по `club_id` сериализует все такие переходы
клуба; проверка «есть ли другой активный admin» выполняется после lock и в
READ COMMITTED видит уже закоммиченное изменение конкурента (сценарий «A понижает B,
одновременно B деактивирует A» → вторая операция получает ошибку). Строки других
admin не блокируются `FOR UPDATE` (это дало бы deadlock со строкой, уже
заблокированной самим UPDATE). В REPEATABLE READ / SERIALIZABLE такие переходы
запрещены явной ошибкой (fail closed).

### Аудит

`trainer_account_audit_log.operation` дополнен `promote_admin` / `demote_admin`.
Писатель — только `log_trainer_account_operation` (EXECUTE только service_role, 077).

## 4. Первый Portal Admin — owner-controlled bootstrap (после проверки 078)

- Не автоматически, не по `trainers.rolle`, не по email/login/имени/`trainer_id`.
- Владелец выбирает конкретный `trainer_account_id` и выполняет в SQL Editor одну
  транзакцию: повышение ровно одной активной строки по точному `id` + `club_id` с
  проверкой `row_count = 1` и запись `promote_admin` в аудит. Шаблон с
  плейсхолдерами — `docs/database/PROTECTED_TRAINER_PORTAL_ROLES_SQL_VERIFICATION.md`
  (раздел D); в миграцию не включён.
- Если первым Admin должен стать человек без портального аккаунта — сначала
  создаётся аккаунт (Auth-пользователь с техническим email по формуле
  `resolve_trainer_login_email` + строка `trainer_accounts`, роль `trainer`), затем
  повышение. Пока `manage-trainer-account` отключена, это делает владелец вручную.

## 5. Будущее восстановление `manage-trainer-account` (не в 078)

Авторизация — только: Supabase Auth JWT → `auth.getUser` → активный
`trainer_accounts` вызывающего → `portal_role = 'admin'` → `club_id` из
`trainer_accounts` вызывающего; целевой аккаунт — только того же клуба. Legacy
`trainers.rolle` и Admin PIN session **никогда** не принимаются. Операции: create,
activate/deactivate, rename, смена пароля, promote/demote (аудит
`promote_admin`/`demote_admin`, ошибка триггера последнего admin → 409). Новый
аккаунт по умолчанию `trainer`.

## 6. Frontend (следующий этап, не реализован)

- Роль берётся из `get_current_trainer_profile().portal_role` (только UI).
- Дашборд: Trainer — только «Поиск ученика»; Admin — «Поиск ученика», Student Page
  settings, Kyu Program, Rating Settings, позже Events и Trainer Accounts.
- `AdminRouteGuard` для `/trainer/settings`, `/trainer/kyu-program`,
  `/trainer/kyu-program/djb/:kyuId`, `/trainer/kyu-program/go-kyu/:kyuId`,
  `/trainer/rating-settings`, позже `/trainer/events`: прямой переход Trainer →
  «нет доступа», страница не рендерится. Сервер остаётся авторитетным.

## 7. Вне этого этапа

Legacy `public.trainers` / `public.students` / PIN — Security Migration Block 1
(в т.ч. групповая видимость строится на legacy-данных `trainer_groups`,
`trainers.trainer_id`, `students.gruppe_id`, которые сейчас может менять anon).
Rating, Kyu History, Bonus Techniques / PR #19, Family и Super Admin авторизация
не меняются.
