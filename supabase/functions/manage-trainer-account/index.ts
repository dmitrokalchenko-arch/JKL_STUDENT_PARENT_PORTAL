// Edge Function: создание/обновление доступа тренера к Trainer Area
// (auth.users + trainer_accounts), привязанного к уже существующей строке
// public.trainers (чужая таблица JCL_Gruppen — эта функция её не создаёт и
// не изменяет, только читает).
//
// МОДЕЛЬ АВТОРИЗАЦИИ: Supabase Auth JWT вызывающего администратора, НЕ общий
// секрет. Вызывающий передаёт `Authorization: Bearer <свой access_token>`.
// Сервер:
//   1) проверяет токен через supabaseAdmin.auth.getUser(token);
//   2) находит СОБСТВЕННУЮ строку trainer_accounts вызывающего по
//      auth_user_id, требует is_active = true;
//   3) находит связанную строку trainers, требует rolle === 'Admin';
//   4) берёт club_id вызывающего ИСКЛЮЧИТЕЛЬНО из этой строки trainers —
//      клиент НЕ передаёт clubId вообще, его нельзя подделать телом запроса;
//   5) ищет целевого тренера (trainerId) СРАЗУ в рамках club_id вызывающего
//      (WHERE trainer_id = ... AND club_id = <club администратора>) — тренер
//      из чужого клуба структурно не найдётся этим запросом, поэтому
//      "не найден" и "не в вашем клубе" — один и тот же ответ (анти-
//      энумерация чужих клубов).
// `currentTrainer.role === 'Admin'` во frontend JCL_Gruppen — это только
// UI-состояние (подделываемое), оно НИГДЕ не используется здесь как источник
// прав; единственная граница доверия — проверки 1–5 выше, целиком на сервере.
//
// Секреты (SUPABASE_SERVICE_ROLE_KEY) — только через `supabase secrets set`,
// никогда во frontend-бандле ни одного из двух проектов.
//
// Локальный запуск (после `supabase start` в .local-supabase-test):
//   supabase functions serve manage-trainer-account
//
// Пример запроса:
//   POST /functions/v1/manage-trainer-account
//   headers: { "Authorization": "Bearer <access_token администратора>" }
//   body: {
//     "trainerId": "T-DEMO",           // text, trainers.trainer_id (бизнес-идентификатор JCL_Gruppen, не PK)
//     "loginName": "Trainer Demo",     // отображаемый логин для Trainer Area
//     "displayName": "Trainer Demo",
//     "password": "минимум 8 символов", // обязателен при создании; пусто/отсутствует при обновлении = не менять
//     "isActive": true
//   }

import { createClient } from 'npm:@supabase/supabase-js@2';

interface ManageTrainerAccountBody {
  trainerId: string;
  loginName: string;
  displayName: string;
  password?: string;
  isActive: boolean;
}

const MIN_PASSWORD_LENGTH = 8;
const MAX_LOGIN_NAME_LENGTH = 100;
const MAX_DISPLAY_NAME_LENGTH = 200;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'missing_bearer_token' }, 401);
  }
  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) {
    return jsonResponse({ error: 'missing_bearer_token' }, 401);
  }

  let body: ManageTrainerAccountBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const { trainerId, loginName, displayName, password, isActive } = body;

  if (!trainerId || !loginName || !displayName) {
    return jsonResponse({ error: 'missing_required_fields' }, 400);
  }
  if (typeof isActive !== 'boolean') {
    return jsonResponse({ error: 'is_active_must_be_boolean' }, 400);
  }
  if (password !== undefined && password !== '' && password.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse({ error: 'password_too_short' }, 400);
  }
  // Найдено ручным ревью (пункт "ограничения длины login_name/password"):
  // resolve_trainer_login_email кодирует login_name в hex и встраивает в
  // email — без ограничения длины на входе аномально длинная строка дошла
  // бы до этой RPC и породила бы либо ошибку Postgres/GoTrue, либо
  // непредсказуемо длинный email. Лимиты ниже — обычные разумные пределы
  // для имени/логина человека, не влияют ни на один существующий тест.
  if (loginName.length > MAX_LOGIN_NAME_LENGTH) {
    return jsonResponse({ error: 'login_name_too_long' }, 400);
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return jsonResponse({ error: 'display_name_too_long' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // ── 1) Проверка JWT вызывающего ───────────────────────────────────────
  const { data: callerAuthData, error: callerAuthError } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerAuthError || !callerAuthData?.user) {
    return jsonResponse({ error: 'invalid_or_expired_token' }, 401);
  }
  const callerAuthUserId = callerAuthData.user.id;

  // ── 2) Собственный trainer_accounts вызывающего, должен быть активен ──
  const { data: callerAccount, error: callerAccountError } = await supabaseAdmin
    .from('trainer_accounts')
    .select('id, trainer_row_id, is_active')
    .eq('auth_user_id', callerAuthUserId)
    .maybeSingle();

  if (callerAccountError) {
    return jsonResponse({ error: 'caller_lookup_failed', details: callerAccountError.message }, 500);
  }
  if (!callerAccount || !callerAccount.is_active) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  // ── 3) Связанная строка trainers вызывающего, должна быть rolle=Admin ─
  const { data: callerTrainerRow, error: callerTrainerError } = await supabaseAdmin
    .from('trainers')
    .select('id, club_id, rolle')
    .eq('id', callerAccount.trainer_row_id)
    .maybeSingle();

  if (callerTrainerError) {
    return jsonResponse({ error: 'caller_trainer_lookup_failed', details: callerTrainerError.message }, 500);
  }
  if (!callerTrainerRow || callerTrainerRow.rolle !== 'Admin') {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  // ── 4) club_id вызывающего — ИСКЛЮЧИТЕЛЬНО из БД, клиент его не передаёт
  const adminClubId = callerTrainerRow.club_id;

  // ВАЖНО (найдено фактическим тестом локального прогона, не предположением):
  // public.normalize_login_name(text) намеренно закрыта от прямого вызова
  // (`revoke all ... from public`, migration 011, без последующего grant
  // даже authenticated/service_role) — она предназначена ТОЛЬКО для
  // внутреннего использования как GENERATED-выражение колонки
  // trainer_accounts.normalized_login_name и внутри resolve_trainer_login_email,
  // прямой RPC-вызов (в т.ч. от service_role клиента Edge Function) получает
  // "permission denied". Поэтому здесь нормализация не вызывается вообще —
  // достаточно сравнить СЫРУЮ строку login_name с уже сохранённым значением
  // (см. ниже, ветка обновления): если она не изменилась, generated-колонка
  // normalized_login_name детерминированно останется прежней без участия
  // этой функции; если изменилась — вызывается rename_trainer_login(),
  // которая пересчитает normalized_login_name сама (обычный UPDATE внутри
  // SECURITY DEFINER функции, тот же принцип, что уже применён в проекте).

  // ── 5) Целевой тренер по business-идентификатору (без клубного фильтра
  // в самом запросе — это намеренно: club_id администратора сравнивается
  // ЯВНО ниже, чтобы отличать "тренер не существует" (404) от "тренер
  // существует, но в чужом клубе" (403), как и требует тестовый сценарий D.
  const { data: trainerRow, error: trainerLookupError } = await supabaseAdmin
    .from('trainers')
    .select('id, club_id')
    .eq('trainer_id', trainerId)
    .maybeSingle();

  if (trainerLookupError) {
    return jsonResponse({ error: 'trainer_lookup_failed', details: trainerLookupError.message }, 500);
  }
  if (!trainerRow) {
    return jsonResponse({ error: 'trainer_not_found' }, 404);
  }

  // club_id администратора взят ТОЛЬКО из БД (шаг 4) — клиент не может
  // подделать это сравнение, передав другой clubId, потому что clubId
  // вообще не читается из тела запроса.
  if (trainerRow.club_id !== adminClubId) {
    return jsonResponse({ error: 'trainer_club_mismatch' }, 403);
  }

  // Технический email строится ЧЕРЕЗ ТУ ЖЕ SQL RPC, что использует
  // signInTrainer при входе (resolve_trainer_login_email, migration 012) —
  // единый источник форматирования email, не дублируем формулу здесь.
  // RPC принимает club_short_name, не club_id — обратный lookup ниже.
  const { data: clubRow, error: clubLookupError } = await supabaseAdmin
    .from('clubs')
    .select('club_short_name')
    .eq('club_id', adminClubId)
    .maybeSingle();

  if (clubLookupError) {
    return jsonResponse({ error: 'club_lookup_failed', details: clubLookupError.message }, 500);
  }
  if (!clubRow?.club_short_name) {
    return jsonResponse({ error: 'club_short_name_missing' }, 500);
  }

  const { data: technicalEmail, error: emailError } = await supabaseAdmin.rpc(
    'resolve_trainer_login_email',
    { p_club_short_name: clubRow.club_short_name, p_login_name: loginName }
  );
  if (emailError || !technicalEmail) {
    return jsonResponse({ error: 'email_build_failed', details: emailError?.message }, 500);
  }

  // Один тренер (trainer_row_id) — не более одной строки trainer_accounts
  // на практике (не обеспечено отдельным UNIQUE-ограничением в migration
  // 011, но это существующий пробел схемы вне объёма этой задачи — здесь
  // просто ищем первую и работаем с ней как с канонической).
  const { data: existingAccount, error: existingLookupError } = await supabaseAdmin
    .from('trainer_accounts')
    .select('id, auth_user_id, login_name, is_active')
    .eq('trainer_row_id', trainerRow.id)
    .maybeSingle();

  if (existingLookupError) {
    return jsonResponse({ error: 'account_lookup_failed', details: existingLookupError.message }, 500);
  }

  // ── ОБНОВЛЕНИЕ существующего аккаунта ────────────────────────────────
  if (existingAccount) {
    const authUserId = existingAccount.auth_user_id;
    const loginNameChanged = existingAccount.login_name !== loginName;

    if (loginNameChanged) {
      // login_name неизменяем обычным UPDATE (immutability-триггер,
      // migration 011) — единственный контролируемый путь смены,
      // rename_trainer_login(), она же обновляет normalized_login_name
      // (generated column) согласованно.
      const previousLoginName = existingAccount.login_name;
      const { error: renameError } = await supabaseAdmin.rpc('rename_trainer_login', {
        p_trainer_account_id: existingAccount.id,
        p_new_login_name: loginName
      });
      if (renameError) {
        return jsonResponse({ error: 'login_name_rename_failed', details: renameError.message }, 500);
      }

      // email зависит от login_name — при смене login_name пересчитанный
      // technicalEmail (уже вычислен выше на основе НОВОГО loginName)
      // нужно записать и в auth.users, иначе вход по новому login_name не
      // найдёт этот auth-аккаунт.
      const { error: emailUpdateError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        email: technicalEmail
      });
      if (emailUpdateError) {
        // Найдено ручным ревью (пункт "БД обновилась, а Auth нет"): rename
        // выше УЖЕ закоммичен в БД — без компенсирующего отката login_name в
        // trainer_accounts и email в auth.users разойдутся, и тренер не
        // сможет войти ни старым, ни новым логином. Пытаемся откатить
        // rename обратно; если и это не удаётся — явно сообщаем, что нужно
        // ручное вмешательство, вместо тихого рассинхрона.
        const { error: rollbackRenameError } = await supabaseAdmin.rpc('rename_trainer_login', {
          p_trainer_account_id: existingAccount.id,
          p_new_login_name: previousLoginName
        });
        if (rollbackRenameError) {
          return jsonResponse(
            {
              error: 'auth_email_update_failed_and_rollback_failed',
              details: 'trainer_accounts.login_name and auth.users email are now out of sync — manual fix required'
            },
            500
          );
        }
        return jsonResponse({ error: 'auth_email_update_failed', details: emailUpdateError.message }, 500);
      }
    }

    // Пустой/отсутствующий пароль при обновлении = "не менять" (п. G).
    if (password) {
      const { error: passwordUpdateError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        password
      });
      if (passwordUpdateError) {
        return jsonResponse({ error: 'auth_password_update_failed', details: passwordUpdateError.message }, 500);
      }
    }

    const { error: accountUpdateError } = await supabaseAdmin
      .from('trainer_accounts')
      .update({ display_name: displayName, is_active: isActive })
      .eq('id', existingAccount.id);

    if (accountUpdateError) {
      return jsonResponse({ error: 'account_update_failed', details: accountUpdateError.message }, 500);
    }

    const operation = existingAccount.is_active === isActive
      ? 'update'
      : (isActive ? 'activate' : 'deactivate');

    await supabaseAdmin.rpc('log_trainer_account_operation', {
      p_performed_by_auth_user_id: callerAuthUserId,
      p_target_trainer_row_id: trainerRow.id,
      p_target_trainer_id: trainerId,
      p_club_id: adminClubId,
      p_operation: operation
    });

    return jsonResponse(
      {
        accountId: existingAccount.id,
        trainerId,
        loginName,
        isActive,
        operation
      },
      200
    );
  }

  // ── СОЗДАНИЕ нового аккаунта ──────────────────────────────────────────
  if (!password) {
    return jsonResponse({ error: 'password_required_for_new_account' }, 400);
  }

  const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
    email: technicalEmail,
    password,
    email_confirm: true
  });
  if (createUserError || !createdUser?.user) {
    const status = createUserError?.message?.toLowerCase().includes('already registered') ? 409 : 500;
    return jsonResponse({ error: 'auth_user_create_failed', details: createUserError?.message }, status);
  }

  const authUserId = createdUser.user.id;

  const { data: insertedAccount, error: insertError } = await supabaseAdmin
    .from('trainer_accounts')
    .insert({
      auth_user_id: authUserId,
      trainer_row_id: trainerRow.id,
      club_id: adminClubId,
      login_name: loginName,
      display_name: displayName,
      is_active: isActive
    })
    .select('id')
    .single();

  if (insertError || !insertedAccount) {
    // Не оставлять "повисший" auth.users без trainer_accounts — тот же
    // паттерн отката, что в create-family-account.
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    const status = insertError?.message?.toLowerCase().includes('duplicate') ? 409 : 500;
    return jsonResponse({ error: 'account_insert_failed', details: insertError?.message }, status);
  }

  await supabaseAdmin.rpc('log_trainer_account_operation', {
    p_performed_by_auth_user_id: callerAuthUserId,
    p_target_trainer_row_id: trainerRow.id,
    p_target_trainer_id: trainerId,
    p_club_id: adminClubId,
    p_operation: 'create'
  });

  return jsonResponse(
    {
      accountId: insertedAccount.id,
      trainerId,
      loginName,
      isActive,
      operation: 'create'
    },
    201
  );
});
