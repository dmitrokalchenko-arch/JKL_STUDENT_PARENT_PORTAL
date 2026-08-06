// Edge Function: создание семейного аккаунта (auth.users + families + family_guardians).
//
// НЕ вызывается с anon-ключом из браузера напрямую. Регистрация семьи
// самостоятельно через публичную форму на этом этапе не делается
// (docs/architecture/FAMILY_ACCOUNT_CONCEPT.md, раздел 15, п.1: "аккаунт
// создаёт клуб"). Вызов защищён отдельным секретом ADMIN_FUNCTION_SECRET —
// полноценной админ-роли/интерфейса ещё нет (это этап 4 роадмапа), поэтому
// сейчас это ручной/скриптовый процесс сотрудника клуба, не встроенный в
// FamilyDashboard UI.
//
// ⚠️ ВАЖНО (аудит этапа 2.1): ADMIN_FUNCTION_SECRET — ОДИН общий секрет на
// все клубы. clubId передаётся телом запроса и НЕ проверяется против
// личности вызывающего (полноценной модели "администратор клуба X" ещё нет —
// это этап 4). Держатель секрета технически может создать семью для ЛЮБОГО
// clubId, не только "своего". Поэтому секрет нужно выдавать только
// доверенным операторам уровня платформы (по аналогии с существующей
// таблицей JCL_Gruppen.super_admins), НЕ раздавать персоналу отдельных
// клубов как "свой" пароль. Это документированное ограничение текущей
// модели, не забытая проверка — устранить полноценно можно только вместе с
// админ-интерфейсом на этапе 4.
//
// Секреты (SUPABASE_SERVICE_ROLE_KEY, ADMIN_FUNCTION_SECRET) задаются только
// через `supabase secrets set` — никогда не попадают во frontend-бандл.
//
// Запуск (после согласования и настройки secrets):
//   supabase functions deploy create-family-account
//
// Пример запроса (аудит этапа 2.2: clubId — text slug clubs.club_id, напр.
// 'jcl', НЕ uuid; studentIds — bigint students.id, НЕ uuid):
//   POST /functions/v1/create-family-account
//   headers: { "x-admin-secret": "<ADMIN_FUNCTION_SECRET>" }
//   body: {
//     "clubId": "jcl",
//     "nickname": "muellerfamily",
//     "password": "минимум 8 символов",
//     "displayName": "Семья Мюллер",
//     "studentIds": [123456]  // опционально, bigint id ученика (students.id)
//   }

import { createClient } from 'npm:@supabase/supabase-js@2';

interface CreateFamilyAccountBody {
  clubId: string; // text slug, clubs.club_id (напр. 'jcl'), НЕ uuid
  nickname: string;
  password: string;
  displayName: string;
  studentIds?: number[]; // bigint students.id, НЕ uuid
}

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

  const adminSecret = Deno.env.get('ADMIN_FUNCTION_SECRET');
  const requestSecret = req.headers.get('x-admin-secret');
  if (!adminSecret || requestSecret !== adminSecret) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let body: CreateFamilyAccountBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const { clubId, nickname, password, displayName, studentIds } = body;
  if (!clubId || !nickname || !password || !displayName) {
    return jsonResponse({ error: 'missing_required_fields' }, 400);
  }
  if (password.length < 8) {
    return jsonResponse({ error: 'password_too_short' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: normalizedData, error: normalizeError } = await supabaseAdmin.rpc(
    'normalize_family_nickname',
    { p_nickname: nickname }
  );
  if (normalizeError || !normalizedData) {
    return jsonResponse({ error: 'nickname_normalize_failed', details: normalizeError?.message }, 500);
  }
  const normalizedNickname = normalizedData as string;

  // ИСПРАВЛЕНО (аудит этапа 2.1): уникальность nickname проверяется ДО
  // создания auth.users — раньше проверка происходила только через
  // unique-constraint при insert в families, ПОСЛЕ того как auth-пользователь
  // уже был создан, что означало лишнее создание-и-откат auth.users на
  // каждую повторную попытку с занятым nickname (функционально не опасно,
  // но не нужно и повышает риск гонки при повторных запросах).
  const { data: existingFamily, error: existingFamilyError } = await supabaseAdmin
    .from('families')
    .select('id')
    .eq('club_id', clubId)
    .eq('normalized_nickname', normalizedNickname)
    .maybeSingle();
  if (existingFamilyError) {
    return jsonResponse({ error: 'nickname_check_failed', details: existingFamilyError.message }, 500);
  }
  if (existingFamily) {
    return jsonResponse({ error: 'nickname_already_taken' }, 409);
  }

  // Технический email строится ЧЕРЕЗ ТУ ЖЕ SQL-функцию, что использует
  // resolve_family_login_email при входе — единый источник форматирования,
  // не дублируем формат строки в двух местах.
  const { data: emailData, error: emailError } = await supabaseAdmin.rpc('family_login_email', {
    p_club_id: clubId,
    p_nickname: nickname
  });
  if (emailError || !emailData) {
    return jsonResponse({ error: 'email_build_failed', details: emailError?.message }, 500);
  }
  const technicalEmail = emailData as string;

  const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
    email: technicalEmail,
    password,
    email_confirm: true
  });
  if (createUserError || !createdUser?.user) {
    // "already registered" здесь означает: тот же clubId+nickname уже имеет
    // auth-пользователя, но по какой-то причине не прошёл проверку выше
    // (например, families-строка была удалена вручную без удаления
    // auth.users) — отдельный код ответа, чтобы не путать с прочими 500.
    const status = createUserError?.message?.toLowerCase().includes('already registered') ? 409 : 500;
    return jsonResponse({ error: 'auth_user_create_failed', details: createUserError?.message }, status);
  }

  const authUserId = createdUser.user.id;

  const { data: familyRow, error: familyInsertError } = await supabaseAdmin
    .from('families')
    .insert({
      club_id: clubId,
      nickname,
      normalized_nickname: normalizedNickname,
      display_name: displayName
    })
    .select('id, club_id, nickname, display_name')
    .single();

  if (familyInsertError || !familyRow) {
    // Best-effort откат: не оставлять "повисший" auth.users без семьи.
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return jsonResponse({ error: 'family_insert_failed', details: familyInsertError?.message }, 500);
  }

  const { error: guardianInsertError } = await supabaseAdmin.from('family_guardians').insert({
    auth_user_id: authUserId,
    family_id: familyRow.id,
    club_id: clubId,
    display_name: displayName
  });

  if (guardianInsertError) {
    await supabaseAdmin.from('families').delete().eq('id', familyRow.id);
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return jsonResponse({ error: 'guardian_insert_failed', details: guardianInsertError.message }, 500);
  }

  const linkResults: Array<{ studentId: number; ok: boolean; error?: string }> = [];
  for (const studentId of studentIds ?? []) {
    const { error: linkError } = await supabaseAdmin.from('family_students').insert({
      family_id: familyRow.id,
      student_id: studentId,
      club_id: clubId,
      is_primary: true,
      linked_at: new Date().toISOString()
    });
    linkResults.push({ studentId, ok: !linkError, error: linkError?.message });
  }

  return jsonResponse(
    {
      familyId: familyRow.id,
      clubId: familyRow.club_id,
      nickname: familyRow.nickname,
      displayName: familyRow.display_name,
      authUserId,
      linkedStudents: linkResults
    },
    201
  );
});
