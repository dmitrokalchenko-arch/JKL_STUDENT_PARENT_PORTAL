-- =====================================================================
-- TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE.sql
-- =====================================================================
--
-- НАЗНАЧЕНИЕ: связать ОДНУ конкретную, уже проверенную строку
-- public.trainers (trainer_row_id=39, trainer_id='TR-531323', club_id='jcl',
-- rolle='Trainer') с Supabase Auth. Это НЕ bootstrap администратора
-- (TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE.sql требует rolle='Admin' — этот
-- шаблон намеренно НЕ использует его и НЕ требует Admin).
--
-- ЧТО ЭТОТ ШАБЛОН НЕ ДЕЛАЕТ:
--   - НЕ создаёт новую строку в public.trainers — работает ИСКЛЮЧИТЕЛЬНО
--     с уже существующей trainer_row_id=39;
--   - НЕ меняет trainer_id/rolle/aktiv/club_id/name существующей строки —
--     эти значения только ПРОВЕРЯЮТСЯ (сверка), ни один UPDATE по
--     public.trainers в этом файле не выполняется;
--   - НЕ меняет rolle на 'Admin' и не выдаёт никаких административных
--     прав — trainers.rolle остаётся 'Trainer', как и было; Trainer
--     Portal просто получает доступ по паролю вместо/вместе с PIN, роль
--     тренера в JCL Gruppen от этого не меняется;
--   - НЕ читает и не использует pin_hash/pin_salt/pin — legacy PIN-вход
--     этой строки этим шаблоном не затрагивается и продолжит работать
--     независимо (см. TRAINER_AUTH_ARCHITECTURE.md, раздел про
--     сосуществование PIN/Auth);
--   - НЕ создаёт auth.users прямым SQL — Auth-пользователь должен быть
--     СОЗДАН ЗАРАНЕЕ штатным способом (Supabase Dashboard →
--     Authentication → Users), сюда подставляется только уже
--     существующий User UID.
--
-- ⚠️ ТОЛЬКО ДЛЯ РУЧНОГО ВЫПОЛНЕНИЯ ВЛАДЕЛЬЦЕМ В PRODUCTION SQL EDITOR,
-- ПОСЛЕ подстановки двух значений ниже. Этот файл НЕ выполнялся против
-- production. Ни один statement из него не был отправлен на сервер.
--
-- Подставить (заменить целиком, включая угловые скобки):
--   <AUTH_USER_ID> — User UID уже созданного Auth-пользователя
--                    (Supabase Dashboard → Authentication → Users)
--   <LOGIN_NAME>   — строка, которую тренер будет реально набирать при
--                    входе в JCL Gruppen. Архитектурная особенность:
--                    trainers.name хранится как "Nachname Vorname"
--                    (здесь: "Kalchenko Dmytro" — то есть Nachname=
--                    "Kalchenko", Vorname="Dmytro"), а вход печатается
--                    как "Vorname Nachname" — то есть ожидаемое значение
--                    login_name, вероятно, "Dmytro Kalchenko", но точное
--                    значение подтверждает владелец, не этот шаблон.
--
-- Все проверки перед INSERT — read-only (SELECT), сам INSERT — ровно один,
-- вся операция в единой транзакции BEGIN...COMMIT: при любом несоответствии
-- откатывается всё, ничего не остаётся частично применённым.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  -- Жёстко заданные, уже проверенные значения этой конкретной строки —
  -- НЕ placeholders, изменять не нужно и не следует.
  c_trainer_row_id  constant bigint := 39;
  c_trainer_id      constant text  := 'TR-531323';
  c_club_id         constant text  := 'jcl';
  c_expected_name   constant text  := 'Kalchenko Dmytro';
  c_expected_rolle  constant text  := 'Trainer';
  c_expected_aktiv  constant text  := 'JA';

  v_auth_user_id_raw text := '<AUTH_USER_ID>';
  v_login_name        text := '<LOGIN_NAME>';
  v_auth_user_id       uuid;

  v_trainer_id      text;
  v_trainer_club_id text;
  v_trainer_name    text;
  v_trainer_rolle   text;
  v_trainer_aktiv   text;

  v_existing_account_for_trainer uuid;
  v_existing_account_for_auth    uuid;
BEGIN
  -- ── 1. Placeholder'ы не заменены ────────────────────────────────────
  -- Проверка по наличию "<"/">" (а не буквальным сравнением со строкой
  -- placeholder'а) — устойчиво к обычной замене "найти и заменить везде"
  -- в редакторе (см. урок из TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE.sql).
  IF v_auth_user_id_raw ~ '[<>]' OR v_login_name ~ '[<>]' THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: placeholder-значения не заменены. '
      'Отредактируйте файл: замените <AUTH_USER_ID> и <LOGIN_NAME> на реальные '
      'значения перед запуском. Ничего не записано в базу.';
  END IF;

  -- ── 2. Формат AUTH_USER_ID (понятная ошибка вместо сырого приведения) ─
  BEGIN
    v_auth_user_id := v_auth_user_id_raw::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: <AUTH_USER_ID> = "%" — не является '
      'корректным UUID. Проверьте User UID, скопированный из Supabase Dashboard.', v_auth_user_id_raw;
  END;

  -- ── 3. LOGIN_NAME не пустой ──────────────────────────────────────────
  IF btrim(v_login_name) = '' THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: <LOGIN_NAME> пуст после обрезки пробелов.';
  END IF;

  -- ── 4. auth.users с AUTH_USER_ID существует ─────────────────────────
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_auth_user_id) THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: auth.users с id = <AUTH_USER_ID> не найден. '
      'Сначала создайте пользователя штатным способом (Supabase Dashboard → '
      'Authentication → Users), затем подставьте его реальный User UID.';
  END IF;

  -- ── 5. public.trainers.id = 39 существует ───────────────────────────
  SELECT trainer_id, club_id, name, rolle, aktiv
    INTO v_trainer_id, v_trainer_club_id, v_trainer_name, v_trainer_rolle, v_trainer_aktiv
  FROM public.trainers
  WHERE id = c_trainer_row_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: public.trainers с id = % не найден. '
      'Строка могла быть удалена или id указан неверно — остановлено без изменений.', c_trainer_row_id;
  END IF;

  -- ── 6. trainer_id точно совпадает ───────────────────────────────────
  IF v_trainer_id IS DISTINCT FROM c_trainer_id THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: trainers.id=% имеет trainer_id="%", '
      'ожидалось "%". Строка изменилась с момента проверки — остановлено без изменений.',
      c_trainer_row_id, v_trainer_id, c_trainer_id;
  END IF;

  -- ── 7. club_id точно совпадает ───────────────────────────────────────
  IF v_trainer_club_id IS DISTINCT FROM c_club_id THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: trainers.id=% имеет club_id="%", '
      'ожидалось "%". Остановлено без изменений.', c_trainer_row_id, v_trainer_club_id, c_club_id;
  END IF;

  -- ── 8. name точно совпадает ──────────────────────────────────────────
  IF v_trainer_name IS DISTINCT FROM c_expected_name THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: trainers.id=% имеет name="%", '
      'ожидалось "%". Возможно, это уже не та строка — остановлено без изменений.',
      c_trainer_row_id, v_trainer_name, c_expected_name;
  END IF;

  -- ── 9. rolle точно совпадает (Trainer, НЕ Admin) ─────────────────────
  IF v_trainer_rolle IS DISTINCT FROM c_expected_rolle THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: trainers.id=% имеет rolle="%", '
      'ожидалось "%". Остановлено без изменений — этот шаблон рассчитан именно на '
      'rolle=Trainer и не проверяет/не меняет права администратора.',
      c_trainer_row_id, v_trainer_rolle, c_expected_rolle;
  END IF;

  -- ── 10. aktiv точно совпадает ─────────────────────────────────────────
  IF v_trainer_aktiv IS DISTINCT FROM c_expected_aktiv THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: trainers.id=% имеет aktiv="%", '
      'ожидалось "%". Остановлено без изменений.', c_trainer_row_id, v_trainer_aktiv, c_expected_aktiv;
  END IF;

  -- ── 11. У trainer_row_id=39 ещё нет trainer_accounts ─────────────────
  SELECT id INTO v_existing_account_for_trainer
  FROM public.trainer_accounts
  WHERE trainer_row_id = c_trainer_row_id;

  IF v_existing_account_for_trainer IS NOT NULL THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: у trainer_row_id=% уже есть '
      'trainer_accounts (id=%). Повторная привязка не требуется — используйте '
      'manage-trainer-account (через уже действующего администратора) для дальнейшего '
      'управления этим аккаунтом.', c_trainer_row_id, v_existing_account_for_trainer;
  END IF;

  -- ── 12. AUTH_USER_ID ещё не связан с другим trainer_accounts ─────────
  SELECT id INTO v_existing_account_for_auth
  FROM public.trainer_accounts
  WHERE auth_user_id = v_auth_user_id;

  IF v_existing_account_for_auth IS NOT NULL THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: <AUTH_USER_ID> уже связан с другой '
      'строкой trainer_accounts (id=%). Один auth.users — один trainer_accounts, '
      'выберите другого Auth-пользователя или проверьте, не был ли этот тренер уже '
      'подключён ранее.', v_existing_account_for_auth;
  END IF;

  -- ── 13. Нормализованный login_name не конфликтует внутри club 'jcl' ──
  IF EXISTS (
    SELECT 1 FROM public.trainer_accounts
    WHERE club_id = c_club_id
      AND normalized_login_name = public.normalize_login_name(v_login_name)
  ) THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_LINK_EXISTING_TRAINER_TEMPLATE: <LOGIN_NAME>="%" (в нормализованном '
      'виде) уже занят другим тренером в club_id=%. Выберите другое значение LOGIN_NAME.',
      v_login_name, c_club_id;
  END IF;

  -- ── Собственно привязка: одна строка trainer_accounts, is_active=true ─
  -- rolle НЕ трогается — это единственная операция записи в этом файле,
  -- и она не затрагивает public.trainers ни в одном столбце.
  INSERT INTO public.trainer_accounts (
    auth_user_id, trainer_row_id, club_id, login_name, display_name, is_active
  ) VALUES (
    v_auth_user_id, c_trainer_row_id, c_club_id, v_login_name, c_expected_name, true
  );

  RAISE NOTICE 'Тренер trainer_row_id=% (trainer_id=%) успешно связан с Supabase Auth.',
    c_trainer_row_id, c_trainer_id;
END $$;

COMMIT;

-- =====================================================================
-- READ-ONLY VERIFY (выполнить отдельно, после COMMIT) — только
-- нечувствительные поля, без email/UUID/пароля/PIN/хэшей.
-- =====================================================================

select
  t.id as trainer_row_id,
  t.trainer_id,
  ta.club_id,
  ta.display_name,
  ta.is_active
from public.trainer_accounts ta
join public.trainers t on t.id = ta.trainer_row_id
where t.id = 39;
