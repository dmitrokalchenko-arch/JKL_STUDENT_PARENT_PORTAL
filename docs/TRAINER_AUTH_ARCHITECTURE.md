# Архитектура — единая авторизация тренеров (JCL_Gruppen ↔ Trainer Area)

## 1. Общая цель

Один логин и один пароль тренера должны работать в обеих системах:
- **JCL_Gruppen** (легаси vanilla-JS панель клуба, вход по PIN исторически);
- **Trainer Area** (`JKL_STUDENT_PARENT_PORTAL`, React, часть общего Family Portal).

Пароль назначает только администратор клуба в JCL_Gruppen. Тренер не может
сам сменить пароль. Supabase Auth — единственный механизм проверки пароля
для мигрированных тренеров; PIN остаётся для немигрированных, без изменений.

## 2. Почему старый PIN нельзя перенести в Supabase Auth напрямую

- PIN хранится как PBKDF2-хеш (`pin_hash`/`pin_salt`), рассчитанный **клиентским** JS-кодом JCL_Gruppen (Web Crypto), с собственной солью и параметрами — это не bcrypt/scrypt формат, который использует GoTrue для `auth.users.encrypted_password`. Прямой перенос хеша невозможен: Supabase Auth не умеет проверять пароль по чужому алгоритму хеширования.
- Расшифровать существующий PIN из хеша нельзя (это и есть смысл хеширования) — единственный безопасный путь миграции конкретного тренера: администратор **назначает новый пароль** через `manage-trainer-account`, тренер получает его лично (не по email/SMS в объёме этой задачи).
- Поэтому выбрана модель **сосуществования**: PIN-flow и Auth-flow работают параллельно, тренер переходит на Auth только когда администратор явно создаёт ему `trainer_accounts`.

## 3. Почему единая база, а не двусторонняя синхронизация

- `trainer_accounts` живёт в БД `JKL_STUDENT_PARENT_PORTAL`, но ссылается на `trainers` — таблицу, принадлежащую JCL_Gruppen, **в той же физической Supabase-базе** (оба проекта работают с одной боевой БД, это подтверждено ещё на этапе аудита, не предположение).
- Синхронизация между двумя ОТДЕЛЬНЫМИ базами данных потребовала бы репликации/очередей/eventual consistency — новый класс отказов (рассинхрон, задержки, конфликты) ради задачи, которая решается тривиально, если это одна база: `trainer_accounts` просто хранит внешнюю ссылку (`trainer_row_id bigint`) на чужую таблицу `trainers` через FK — без всякой отдельной синхронизации, за счёт того, что обе стороны читают ОДНУ И ТУ ЖЕ строку `trainers` напрямую.

## 4. Связи между таблицами

```
auth.users (Supabase Auth, id uuid)
    │ 1:1 (UNIQUE auth_user_id)
    ▼
trainer_accounts (JKL_STUDENT_PARENT_PORTAL)
    id uuid PK
    auth_user_id uuid  ──► auth.users.id            (ON DELETE CASCADE)
    trainer_row_id bigint ──► trainers.id            (ON DELETE RESTRICT, UNIQUE — migration 026)
    club_id text                                     (должен совпадать с trainers.club_id — триггер)
    login_name text                                  (immutable кроме rename_trainer_login())
    normalized_login_name text GENERATED             (для UNIQUE(club_id, normalized_login_name))
    display_name text
    is_active boolean
    │
    │ (bigint FK, чужая таблица — JCL_Gruppen)
    ▼
trainers (JCL_Gruppen, id bigint PK)
    trainer_id text        (бизнес-идентификатор, НЕ PK — используется во всех RPC)
    club_id text
    name text               ("Nachname Vorname")
    pin_hash / pin_salt / pin   (legacy, НЕ трогается этой системой)
    rolle text               ('Trainer' | 'Admin' | 'Buchhaltung')
    │
    │ club_id
    ▼
clubs (JCL_Gruppen)
    club_id text PK
    club_short_name text     (используется для построения технического email)
    ...

trainer_groups (JCL_Gruppen) ──► trainers.trainer_id, groups.gruppe_id
groups (JCL_Gruppen)         ──► students через gruppe_id (текстовый разделитель ";"/",")
students (JCL_Gruppen)       ──► читается Trainer Area только через can_trainer_access_student()

trainer_account_audit_log (JKL_STUDENT_PARENT_PORTAL, новая)
    performed_by_auth_user_id uuid ──► auth.users.id
    target_trainer_row_id bigint   ──► trainers.id
    operation text ('create'|'update'|'activate'|'deactivate')
```

## 5. Поток нового входа тренера (Auth-flow)

```
JCL_Gruppen login()
  1. Пользователь вводит loginText + pinValue (то же поле, что раньше было "только PIN")
  2. matchTrainerByLogin(loginText, candidates) → находит trainers-строку по имени
     (конвенция: DB "Nachname Vorname", ввод "Vorname [Nachname|сокращение]")
  3. trainer_has_active_account(trainer_id, club_id) — RPC, anon, только boolean
     ├─ true  → ветка Auth (ниже)
     └─ false → trainer_has_any_account(trainer_id, club_id)
                 ├─ true  → "Zugang deaktiviert" (блок, НЕ откат на PIN — фикс этой сессии)
                 └─ false → откат на legacy PIN-flow (без изменений)
  4. [ветка Auth] resolve_trainer_login_email(club_short_name, loginText) → технический email
  5. db.auth.signInWithPassword({email, password: pinValue})
     ├─ успех → currentTrainer + currentTrainer._portalAuthSession = session
     └─ ошибка → "Login oder PIN falsch" (НЕ откат на PIN — во избежание двусмысленности)
```

## 6. Legacy PIN-flow (без изменений)

```
[ветка PIN, только если trainer_has_any_account = false]
  1. Сравнение pinValue с trainers.pin_hash/pin_salt (PBKDF2, Web Crypto, клиентский расчёт)
  2. Если только legacy-plaintext trainers.pin существует — сверка напрямую,
     затем migratePinToHash() тихо мигрирует его в hash при успешном входе
  3. currentTrainer заполняется БЕЗ _portalAuthSession (признак "нет Auth-сессии")
```

## 7. Поток входа администратора

Идентичен потоку тренера (раздел 5) — администратор ничем не отличается на
уровне логина, разница только в `trainers.rolle`, которую сервер (Edge
Function) проверяет отдельно при попытке административных операций.
`currentTrainer.role === 'Admin'` во frontend используется ТОЛЬКО чтобы
показать кнопки "Trainer hinzufügen"/"Trainerportal-Zugang" — не является
источником прав.

## 8. Поток создания аккаунта тренера

```
Админ открывает "Neuen Trainer hinzufügen" → сохраняет тренера (обычная
JCL_Gruppen-логика, создаёт строку trainers) → заполняет блок
"Trainerportal-Zugang" (login/password) → submitTrainerPortalAccess()

submitTrainerPortalAccess({isEdit:false}):
  1. db.auth.getSession() → accessToken администратора
     └─ нет сессии (админ вошёл по PIN) → понятное сообщение, запрос НЕ отправляется
  2. POST /functions/v1/manage-trainer-account
     Authorization: Bearer <accessToken>
     body: { trainerId, loginName, displayName, password, isActive }
     (БЕЗ clubId — сервер берёт club администратора только из БД)

Edge Function:
  1. getUser(accessToken) → callerAuthUserId
  2. trainer_accounts вызывающего (auth_user_id=callerAuthUserId, is_active=true)
  3. trainers вызывающего (rolle='Admin') → adminClubId (ТОЛЬКО из БД)
  4. trainers целевого (trainer_id=trainerId) → сравнение club_id с adminClubId
  5. resolve_trainer_login_email(club_short_name, loginName) → technicalEmail
  6. существующего trainer_accounts нет → createUser(email, password) → INSERT trainer_accounts
     ├─ ошибка INSERT → deleteUser(только что созданного) — откат
     └─ успех → log_trainer_account_operation(..., 'create')
```

## 9. Поток смены пароля тренера

Тот же вызов `manage-trainer-account` с `isEdit:true`, существующий
`trainer_accounts` найден → если `password` непустой →
`auth.admin.updateUserById(authUserId, {password})`. Пустой пароль = "не
менять" (проверено тестом B).

## 10. Поток деактивации

`manage-trainer-account` с `isActive:false` на существующем аккаунте →
`trainer_accounts.update({is_active:false})` → `log_trainer_account_operation(...,
'deactivate')`. Действует немедленно для ВСЕХ бизнес-RPC (fresh check на
каждый вызов, см. threat model 4.6) и для `login()` JCL_Gruppen (после
фикса этой сессии — блокирует, не откатывается на PIN).

## 11. Поток переименования login_name

`login_name` в `trainer_accounts` **иммутабелен** для обычного UPDATE
(триггер `enforce_trainer_accounts_login_name_immutable`, migration 011).
Единственный путь смены — RPC `rename_trainer_login()`, вызываемый Edge
Function при обнаружении `existingAccount.login_name !== loginName`, сразу
за которым синхронизируется `auth.users.email` (см. TRAINER_AUTH_THREAT_MODEL.md,
4.17 — компенсирующий откат при частичном сбое, добавлено в этой сессии).

## 12. Аудит операций

Каждая успешная операция (`create`/`update`/`activate`/`deactivate`) пишется
в `trainer_account_audit_log` через SECURITY DEFINER RPC
`log_trainer_account_operation` (единственный вход в таблицу — прямых
грантов на таблицу никому не выдано). Хранятся только ID (кто/кого),
тип операции и timestamp — без пароля/JWT/email.

## 13. Bootstrap первого администратора

`manage-trainer-account` структурно НЕ может создать первого администратора
(для её вызова уже нужен существующий активный администратор). Первый
администратор клуба создаётся отдельным процессом — см.
`TRAINER_AUTH_PRODUCTION_RUNBOOK.md`, раздел Bootstrap, и обсуждение двух
вариантов (Dashboard vs owner-only скрипт) в итоговом отчёте этой сессии.

## 14. Модель миграции существующих тренеров

Миграция per-тренер, не массовая: администратор ОСОЗНАННО переводит
конкретного тренера на Auth, заполняя блок "Trainerportal-Zugang" в его
карточке. `trainers.pin_hash`/`pin_salt`/`pin` НЕ очищаются автоматически
при миграции — тренер формально продолжает иметь legacy-креды в БД, но
`trainer_has_active_account` = true направляет его вход по Auth-ветке,
поэтому PIN фактически перестаёт использоваться для входа (кроме описанного
в threat model кейса 4.6 деактивации — уже закрыт фиксом этой сессии).

## 15. Когда и как можно удалить legacy PIN-flow

Не раньше, чем:
1. Все активные тренеры всех клубов получат `trainer_accounts` (100% миграция, проверяется SQL-запросом "trainers без активного trainer_accounts, но с aktiv='JA'");
2. Production отработает единую авторизацию минимум один полный биллинг-цикл без инцидентов (эмпирический критерий стабильности, не формальный SLA);
3. Явное решение владельца системы — удаление legacy-кода PIN-flow является необратимым UX-изменением для всех клубов одновременно, требует отдельного подтверждения, не технического решения агента.

До этого момента PIN-flow остаётся полностью нетронутым (как и сейчас).

## 16. Source of truth

| Данные | Источник истины |
|---|---|
| Пароль тренера (мигрированного) | `auth.users` (GoTrue), только там |
| PIN тренера (немигрированного) | `trainers.pin_hash`/`pin_salt` (JCL_Gruppen) |
| Есть ли у тренера доступ к порталу | `trainer_accounts.is_active` |
| Роль тренера (Admin/Trainer/Buchhaltung) | `trainers.rolle` (чужая таблица, читается, не дублируется) |
| Принадлежность к клубу | `trainers.club_id` (для определения прав администратора — читается напрямую, НЕ из `trainer_accounts.club_id`, которая может отставать, см. threat model 4.12) |
| Кто какую операцию выполнил | `trainer_account_audit_log` |

## Схема архитектуры (ASCII)

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│      JCL_Gruppen         │         │   JKL_STUDENT_PARENT_PORTAL   │
│   (vanilla JS, admin)     │         │      (React, /trainer)        │
│                          │         │                                │
│  login()                │         │  TrainerAuthGuard              │
│   ├─ matchTrainerByLogin │         │   └─ get_current_trainer_profile│
│   ├─ trainer_has_active_ │         │                                │
│   │   account (RPC)      │         │  search_trainer_students        │
│   ├─ trainer_has_any_    │         │  can_trainer_access_student     │
│   │   account (RPC, new) │         │   └─ private.current_active_    │
│   ├─ resolve_trainer_    │         │       trainer_account_id()      │
│   │   login_email (RPC)  │         │       (fresh is_active check)   │
│   └─ signInWithPassword  │         │                                │
│                          │         │                                │
│  submitTrainerPortalAccess│───┐    │                                │
│   └─ db.auth.getSession()│   │    │                                │
└──────────────┬───────────┘   │    └───────────────┬────────────────┘
               │ Bearer JWT     │                     │ Bearer JWT
               │                │                     │
               ▼                ▼                     ▼
        ┌──────────────────────────────────────────────────┐
        │         Supabase (ОДНА боевая база)                │
        │                                                     │
        │  Kong / verify_jwt ── платформенный гейт            │
        │         │                                           │
        │         ▼                                           │
        │  Edge Function: manage-trainer-account               │
        │   1. getUser(JWT) → callerAuthUserId                 │
        │   2. trainer_accounts вызывающего (is_active)         │
        │   3. trainers вызывающего (rolle='Admin') → club_id   │
        │   4. trainers цели → сравнение club_id                │
        │   5. create/update auth.users + trainer_accounts      │
        │   6. log_trainer_account_operation()                  │
        │         │                                           │
        │         ▼                                           │
        │  auth.users ── trainer_accounts ── trainers ── clubs  │
        │                (chужая, JCL_Gruppen)                 │
        │                     │                                │
        │                     ▼                                │
        │         trainer_groups ── groups ── students          │
        │                                                     │
        │  trainer_account_audit_log (только через RPC)         │
        └──────────────────────────────────────────────────┘
```
