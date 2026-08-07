# Super Admin PIN Session — техническая заметка

Дата: 2026-08-07. Статус: реализовано локально, **не применено к production**.

## 1. Зачем

Бизнес-требование (подтверждено пользователем 2026-08-07): легаси PIN-вход
Super Admin (`username` + `PIN`, сравнение с `JCL_Gruppen.super_admins.pin`)
— это не read-only/fallback-режим. Super Admin, вошедший обычным способом,
должен иметь **полный** доступ к Familienzugänge-Verwaltung, без обязательной
отдельной регистрации в Supabase Auth. При этом нельзя доверять простому
client-side флагу — нужна серверно проверяемая сессия.

## 2. Что было раньше (аудит)

- `_superAdminLoginCore` (`JCL_Gruppen/app.js`) при отсутствии активной
  `super_admin_accounts`-строки делала: `select('id, username, name, pin')`
  через анон-ключ **в браузер**, затем `data.pin !== pin` — сравнение прямо
  в JS. Результат (`superAdminSession`) — обычная переменная в памяти, без
  какой-либо серверной проверки.
- `manage-family-account` принимала только Supabase Auth JWT
  (`super_admin_accounts.is_active = true`). Без него — 401/403, отсюда и
  блокирующий текст в UI (`saFamilienCallManageAccount`).
- `public.super_admins` — чужая таблица (JCL_Gruppen), колонки
  `id, username, name, pin` (подтверждено только статическим анализом кода,
  не диагностикой реальной БД — то же ограничение, что и у
  `super_admin_accounts.super_admin_id`, migration `20260806100027`).
  **Поля активности/статуса у `super_admins` нет** — проверено по всем
  местам использования в `app.js`, ни одно не читает и не проверяет
  такое поле. Значит, деактивировать конкретного Super Admin на уровне
  этой таблицы сегодня нечем; единственные доступные рычаги — TTL и
  явный logout PIN-сессии (см. ниже).

## 3. Новая модель

### 3.1 Таблица `super_admin_pin_sessions`

Migration `20260807110036_super_admin_pin_sessions.sql`.

| Колонка | Назначение |
|---|---|
| `id` | uuid PK |
| `super_admin_id` | bigint, значение-FK на `super_admins.id` (без формального FOREIGN KEY — чужая таблица, тип не подтверждён диагностикой) |
| `token_hash` | SHA-256 hex сессионного токена. Сам токен не хранится **нигде** |
| `expires_at` | фиксированный TTL — 30 минут от выдачи, не продлевается |
| `revoked_at` | ставится logout'ом |
| `last_used_at` | обновляется при каждой успешной privileged-операции, чисто информационно |

RLS включён, policy нет — единственный доступ: `service_role` изнутри Edge
Functions.

### 3.2 Edge Function `super-admin-pin-login`

`POST {username, pin}` → `service_role` читает `super_admins.pin`
**на сервере**, никогда не возвращает его и не логирует. При совпадении:
генерирует случайный opaque-токен (32 байта), сохраняет только его
SHA-256-хеш, возвращает `{success, superAdmin:{id,username,name}, token,
expiresAt}`. При несовпадении — единый `401 invalid_credentials`
(анти-enumeration, тот же принцип, что `resolve_family_login_email`).

### 3.3 Edge Function `super-admin-pin-logout`

`POST` с `Authorization: Bearer <token>` → best-effort, идемпотентно ставит
`revoked_at`. Всегда отвечает `{revoked:true}`, вне зависимости от того,
существовал ли токен — не раскрывает существование сессии.

### 3.4 `manage-family-account` — два равноправных способа авторизации

Один и тот же заголовок `Authorization: Bearer <token>`:

1. Сначала пробуется как Supabase Auth JWT → `super_admin_accounts`
   (`is_active = true`) — как раньше.
2. Если не подошло — хешируется и ищется в `super_admin_pin_sessions`
   (`revoked_at is null`, `expires_at > now()`), дополнительно проверяется,
   что соответствующая строка `super_admins` всё ещё существует.
3. Ни один из способов не подошёл → `401 invalid_or_expired_token`.

Оба способа дают единый `callerSuperAdminId` (bigint), используемый для
резолва актора во всех операциях и в аудит-логе.

### 3.5 Аудит-лог

Migration `20260807110037`: `family_account_audit_log` получает
`performed_by_super_admin_id bigint not null` (основной actor id, всегда
заполнен) и делает `performed_by_auth_user_id uuid` **nullable** (заполняется
только при JWT-пути, `NULL` при PIN-сессии — обратной совместимости с
Auth-путём ничего не сломано, ничего не удалено). `log_family_account_operation`
пересоздана с новым обязательным параметром (не `CREATE OR REPLACE` —
Postgres не позволяет добавить параметр этим способом, старая сигнатура
удалена явным `DROP FUNCTION`).

### 3.6 `JCL_Gruppen/app.js`

Изменения ограничены участком, относящимся к Super Admin PIN-логину и
Familienzugänge (см. обновлённое правило 1 в `.claude/CLAUDE.md`):

- `_superAdminLoginCore`, «старый PIN-путь»: вместо прямого
  `select(...pin...)` + сравнения в браузере — вызов
  `super-admin-pin-login` с тем же введённым PIN (без дополнительного
  запроса у пользователя); токен кладётся в `sessionStorage`
  (`jkl_superadmin_pin_session`), не в `localStorage`.
- `saFamilienCallManageAccount`: Bearer берётся из Supabase Auth сессии,
  если она есть, иначе — из `sessionStorage`-токена. Блокирующий текст
  «...ist mit einer PIN-Anmeldung nicht möglich» удалён.
- `superAdminLogout`: best-effort вызывает `super-admin-pin-logout`, затем
  безусловно чистит переменную и `sessionStorage`.
- Trainerportal-Zugang (строка ~13110) и подтверждение PIN перед удалением
  клуба (`saExecuteClubDelete`) **не изменялись** — вне рамок этой задачи.

## 4. Сознательно не сделано (не расширять объём задачи)

- Хранение `super_admins.pin` остаётся как есть (plaintext-колонка). Это
  предсуществующий, более широкий риск (PIN этой колонки используется и
  для входа в сам Dashboard, не только для Familienzugänge) — фиксируется
  как известный, непокрытый этой задачей риск, не исправляется в одностороннем
  порядке.
- Rate limiting на `super-admin-pin-login` не добавлен — тот же
  «ACCEPTED PILOT RISK» статус, что уже принят для
  `resolve_trainer_login_email` (`docs/database/TRAINER_AUTH_RATE_LIMITING.md`).
- Активность/статус Super Admin на уровне `super_admins` — поля нет,
  проверить нечего (см. раздел 2). Если оно появится в будущем — добавить
  проверку и в `super-admin-pin-login`, и в `manage-family-account`.
- Очистка просроченных строк `super_admin_pin_sessions` — нет cron/триггера,
  таблица будет расти. Индекс на `expires_at` подготовлен заранее для
  будущей периодической очистки, сама очистка не реализована (не запрошена).

## 5. Найдено фактическим локальным тестом (не предположение)

`service_role` не имел `SELECT` на `public.super_admins` и полных прав на
новую `super_admin_pin_sessions` — оба Edge Function читают/пишут их
напрямую через PostgREST-клиент, RLS не заменяет базовое право. Добавлено
migration `20260807110038_grant_super_admins_service_role.sql`. Это НЕ
чисто локальный артефакт (в отличие от аналогичного findings по
`trainers`/`clubs` в `.local-supabase-test`) — это тот же класс проблемы,
что уже был закрыт явными грантами для family-таблиц в migration
`20260806100034`, и требуется в production так же, как локально.

## 6. Локальные тесты — см. раздел 7 итогового отчёта в чате.

Стенд: `.local-supabase-test/` (Docker + `npx supabase`). Production
(`whorwleydkziejjafsea.supabase.co`) не затрагивался.
