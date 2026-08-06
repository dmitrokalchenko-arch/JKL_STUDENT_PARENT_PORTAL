-- =====================================================================
-- TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE.sql
-- =====================================================================
--
-- НАЗНАЧЕНИЕ: создать ПЕРВУЮ строку public.trainer_accounts (первого
-- Auth-администратора) для одного клуба, ПОСЛЕ применения
-- TRAINER_AUTH_PRODUCTION_DEPLOY.sql. Эта операция принципиально не может
-- быть выполнена через manage-trainer-account (Edge Function требует уже
-- существующего активного администратора для своего вызова — bootstrap-
-- проблема, см. TRAINER_AUTH_ARCHITECTURE.md, раздел 13).
--
-- ⚠️ ЭТОТ ШАБЛОН НЕЛЬЗЯ ЗАПУСКАТЬ КАК ЕСТЬ. Требуется ручная подстановка
-- четырёх значений (см. ниже), иначе выполнение остановится с понятной
-- ошибкой ДО какой-либо записи в базу.
--
-- ЧТО ЭТОТ ФАЙЛ НЕ ДЕЛАЕТ:
--   - НЕ создаёт пользователя в auth.users прямым INSERT — это запрещено
--     (Supabase Auth хранит пароль в собственном, отдельном от обычных
--     таблиц формате — bcrypt через GoTrue, прямой INSERT в auth.users
--     не создаёт рабочий, входибельный аккаунт). Пользователь Supabase
--     Auth должен быть создан ШТАТНЫМ способом (Supabase Dashboard →
--     Authentication → Add user), см. TRAINER_AUTH_PRODUCTION_RUNBOOK.md,
--     раздел Bootstrap.
--   - НЕ содержит реальных значений (email/пароль/UUID/login_name) —
--     только placeholder'ы, которые владелец подставляет вручную.
--   - НЕ является read-only — это ЕДИНСТВЕННАЯ операция в этом пакете
--     файлов, вставляющая одну реальную строку данных (bootstrap
--     администратора структурно не может быть read-only).
--
-- ПОРЯДОК ДЕЙСТВИЙ ВЛАДЕЛЬЦА ПЕРЕД ЗАПУСКОМ ЭТОГО ФАЙЛА:
--   1. Supabase Dashboard → Authentication → Add user — создать нового
--      пользователя (email в любом валидном формате, пароль — сгенерировать
--      надёжный, передать администратору лично, нигде не сохранять в
--      открытом виде). Скопировать полученный User UID.
--   2. Определить существующую строку public.trainers с rolle='Admin' для
--      клуба, которому назначается этот администратор — это и есть
--      TRAINER_ROW_ID (trainers.id, bigint) и CLUB_ID (trainers.club_id).
--   3. Выбрать LOGIN_NAME — строку, которую администратор будет набирать
--      на экране входа JCL_Gruppen. ВАЖНО (архитектурная особенность,
--      см. TRAINER_AUTH_ARCHITECTURE.md): JCL_Gruppen хранит trainers.name
--      как "Nachname Vorname", а вход печатается как "Vorname [Nachname|
--      сокращение]" — LOGIN_NAME должен точно соответствовать тому, что
--      администратор реально наберёт (рекомендация — полное "Vorname
--      Nachname").
--   4. Подставить все четыре значения ниже вместо placeholder'ов и только
--      затем выполнить этот файл целиком.
--
-- Подставить (заменить целиком, включая угловые скобки):
--   <AUTH_USER_ID>    — User UID из шага 1 (Supabase Dashboard)
--   <TRAINER_ROW_ID>  — trainers.id (bigint) существующей строки rolle='Admin'
--   <CLUB_ID>         — trainers.club_id этой же строки
--   <LOGIN_NAME>       — строка входа, см. пункт 3 выше
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_auth_user_id_raw   text := '<AUTH_USER_ID>';
  v_trainer_row_id_raw  text := '<TRAINER_ROW_ID>';
  v_club_id             text := '<CLUB_ID>';
  v_login_name          text := '<LOGIN_NAME>';
  v_auth_user_id        uuid;
  v_trainer_row_id      bigint;
  v_trainer_club_id     text;
  v_trainer_rolle       text;
  v_existing_account_id uuid;
BEGIN
  -- ── Защитный блок: placeholder'ы не заменены ────────────────────────
  -- ВАЖНО: проверка сделана НЕЗАВИСИМОЙ от точного текста placeholder'а
  -- (наличие символов "<"/">" в значении), а НЕ повторным сравнением со
  -- строкой '<AUTH_USER_ID>' и т.п. — если бы сравнение дублировало
  -- литерал placeholder'а где-то ещё в файле, обычная замена "найти и
  -- заменить везде" (Find & Replace All в редакторе) переписала бы и его
  -- тоже, и проверка сравнивала бы "заменённое значение" само с собой,
  -- всегда получая true и ложно блокируя корректно заполненный файл. Ни
  -- один placeholder ниже не встречается в файле больше одного раза.
  IF v_auth_user_id_raw ~ '[<>]'
     OR v_trainer_row_id_raw ~ '[<>]'
     OR v_club_id ~ '[<>]'
     OR v_login_name ~ '[<>]' THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE: placeholder-значения не заменены. '
      'Отредактируйте файл: замените <AUTH_USER_ID>, <TRAINER_ROW_ID>, <CLUB_ID>, '
      '<LOGIN_NAME> на реальные значения перед запуском. Ничего не записано в базу.';
  END IF;

  -- ── Проверка формата (понятная ошибка вместо сырого приведения типа) ─
  BEGIN
    v_auth_user_id := v_auth_user_id_raw::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE: <AUTH_USER_ID> = "%" — не является корректным UUID. '
      'Проверьте значение User UID, скопированное из Supabase Dashboard.', v_auth_user_id_raw;
  END;

  BEGIN
    v_trainer_row_id := v_trainer_row_id_raw::bigint;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE: <TRAINER_ROW_ID> = "%" — не является корректным целым числом. '
      'Проверьте значение trainers.id.', v_trainer_row_id_raw;
  END;

  -- ── Проверка: указанный auth.users действительно существует ─────────
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_auth_user_id) THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE: auth.users с id = <AUTH_USER_ID> не найден. '
      'Сначала создайте пользователя штатным способом (Supabase Dashboard → '
      'Authentication → Add user), затем подставьте его реальный User UID.';
  END IF;

  -- ── Проверка: указанный trainers действительно существует, в нужном
  -- клубе, и это именно Admin ──────────────────────────────────────────
  SELECT club_id, rolle INTO v_trainer_club_id, v_trainer_rolle
  FROM public.trainers
  WHERE id = v_trainer_row_id;

  IF v_trainer_club_id IS NULL THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE: public.trainers с id = <TRAINER_ROW_ID> не найден.';
  END IF;

  IF v_trainer_club_id <> v_club_id THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE: указанный <CLUB_ID> ("%") не совпадает с '
      'фактическим trainers.club_id ("%") для trainer_row_id <TRAINER_ROW_ID>. '
      'Проверьте оба значения.', v_club_id, v_trainer_club_id;
  END IF;

  IF v_trainer_rolle IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE: trainers.rolle для trainer_row_id <TRAINER_ROW_ID> '
      'равен "%", а не "Admin". Bootstrap-администратор обязан иметь rolle=''Admin'' — '
      'выберите другую строку trainers или сначала измените роль в JCL_Gruppen.', v_trainer_rolle;
  END IF;

  -- ── Проверка: у этого тренера ещё нет trainer_accounts (не дублировать
  -- bootstrap случайно) ────────────────────────────────────────────────
  SELECT id INTO v_existing_account_id
  FROM public.trainer_accounts
  WHERE trainer_row_id = v_trainer_row_id;

  IF v_existing_account_id IS NOT NULL THEN
    RAISE EXCEPTION
      'TRAINER_AUTH_BOOTSTRAP_ADMIN_TEMPLATE: у trainer_row_id <TRAINER_ROW_ID> уже есть '
      'trainer_accounts (id = %). Bootstrap не требуется повторно — используйте '
      'manage-trainer-account для дальнейшего управления этим аккаунтом.', v_existing_account_id;
  END IF;

  -- ── Собственно bootstrap: одна строка trainer_accounts, is_active=true ─
  -- display_name по умолчанию = login_name (в шаблоне только 4 placeholder'а
  -- по заданию); при необходимости отдельного display_name отредактируйте
  -- INSERT ниже вручную перед запуском.
  INSERT INTO public.trainer_accounts (
    auth_user_id, trainer_row_id, club_id, login_name, display_name, is_active
  ) VALUES (
    v_auth_user_id, v_trainer_row_id, v_club_id, v_login_name, v_login_name, true
  );

  RAISE NOTICE 'Bootstrap-администратор создан для trainer_row_id=%, club_id=%.', v_trainer_row_id, v_club_id;
END $$;

COMMIT;

-- =====================================================================
-- ПОСЛЕ COMMIT: передать пароль администратору лично (не по email/SMS),
-- нигде не сохранять в открытом виде. Затем выполнить
-- TRAINER_AUTH_POST_DEPLOY_SMOKE_TEST.sql.
-- =====================================================================
