// Edge Function: административное управление Familienzugänge (доступ семьи
// к Family Portal) — привязано к уже существующему public.students
// (JCL_Gruppen, чужая таблица — эта функция её не создаёт и не изменяет,
// только читает).
//
// МОДЕЛЬ АВТОРИЗАЦИИ — прямая копия manage-trainer-account, адаптированная
// под платформенного (не клубного) актора:
//   1) Authorization: Bearer <access_token> вызывающего Super Admin, НЕ общий
//      секрет (в отличие от устаревшей create-family-account с
//      x-admin-secret — та НЕ используется здесь, см. её задокументированную
//      уязвимость "clubId не проверяется против вызывающего").
//   2) supabaseAdmin.auth.getUser(token) — проверка токена.
//   3) СОБСТВЕННАЯ строка super_admin_accounts вызывающего по auth_user_id,
//      обязателен is_active = true.
//   4) studentId из тела запроса резолвится в students-строку СЕРВЕРОМ;
//      club_id ученика сверяется с реальной clubs-строкой (существует и
//      active = true) — Super Admin платформенный (не привязан к одному
//      клубу, в отличие от Trainer-admin в manage-trainer-account), поэтому
//      здесь нет сравнения "club администратора" — есть проверка, что
//      целевой клуб вообще существует и активен (защита от действий над
//      осиротевшими/удалёнными клубами).
//   5) Пароль НИГДЕ не читается обратно — только auth.admin.updateUserById/
//      createUser (структурно исключает чтение текущего пароля).
//
// ЧТО НЕ РЕАЛИЗОВАНО (см. финальный отчёт задачи): реальная отправка письма
// в действии send_recovery. Ссылка восстановления генерируется через
// supabaseAdmin.auth.admin.generateLink() — это готовая, использующая
// нативный механизм GoTrue часть. Фактическая доставка на contact_email
// требует внешнего email-провайдера (Resend/Postmark/SMTP), которого в этом
// проекте сегодня нет ни в каком виде (проверено аудитом) — dispatchEmail()
// ниже читает RESEND_API_KEY/EMAIL_FROM из секретов функции; если не
// настроено, ссылка только логируется на сервере (никогда не возвращается
// клиенту), действие всё равно завершается нейтральным успехом.
//
// Секреты (SUPABASE_SERVICE_ROLE_KEY, опционально RESEND_API_KEY/EMAIL_FROM,
// FAMILY_PORTAL_RESET_URL) — только через `supabase secrets set`, никогда во
// frontend-бандле ни одного из двух проектов.
//
// Локальный запуск (после `supabase start` в .local-supabase-test):
//   supabase functions serve manage-family-account

import { createClient } from 'npm:@supabase/supabase-js@2';

type Action =
  | 'get_status'
  | 'create'
  | 'set_login'
  | 'set_password'
  | 'activate'
  | 'deactivate'
  | 'send_recovery';

interface RequestBody {
  action: Action;
  studentId: number;
  nickname?: string;
  newNickname?: string;
  password?: string;
  contactEmail?: string;
}

const MIN_PASSWORD_LENGTH = 8;
const MAX_NICKNAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const PERMANENT_BAN_DURATION = '876000h'; // ~100 Jahre, faktisch "gesperrt bis manuell entsperrt"
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

// Bestes Bemühen: sendet die Wiederherstellungs-Mail über Resend, falls
// konfiguriert. Kein Fehler nach außen, wenn nicht konfiguriert — siehe
// Kommentar am Dateianfang. Gibt zurück, ob wirklich versendet wurde (nur
// für Server-Logs, nie an den Client zurückgegeben, um keine internen
// Konfigurationsdetails preiszugeben).
async function dispatchRecoveryEmail(toEmail: string, actionLink: string): Promise<boolean> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const emailFrom = Deno.env.get('EMAIL_FROM');
  if (!resendApiKey || !emailFrom) {
    console.log('[manage-family-account] E-Mail-Provider nicht konfiguriert — Link nur geloggt:', actionLink);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: emailFrom,
        to: toEmail,
        subject: 'Passwort-Wiederherstellung — Family Portal',
        html: `<p>Zum Zurücksetzen Ihres Passworts klicken Sie bitte auf folgenden Link:</p><p><a href="${actionLink}">${actionLink}</a></p><p>Dieser Link ist zeitlich begrenzt gültig.</p>`
      })
    });
    return res.ok;
  } catch (e) {
    console.error('[manage-family-account] E-Mail-Versand fehlgeschlagen:', e);
    return false;
  }
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

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const { action, studentId } = body;
  const validActions: Action[] = [
    'get_status', 'create', 'set_login', 'set_password', 'activate', 'deactivate', 'send_recovery'
  ];
  if (!action || !validActions.includes(action)) {
    return jsonResponse({ error: 'invalid_action' }, 400);
  }
  if (!studentId || typeof studentId !== 'number') {
    return jsonResponse({ error: 'missing_student_id' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // ── 1) JWT des Aufrufers prüfen ────────────────────────────────────────
  const { data: callerAuthData, error: callerAuthError } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerAuthError || !callerAuthData?.user) {
    return jsonResponse({ error: 'invalid_or_expired_token' }, 401);
  }
  const callerAuthUserId = callerAuthData.user.id;

  // ── 2) Eigener super_admin_accounts-Eintrag, muss aktiv sein ───────────
  const { data: callerAccount, error: callerAccountError } = await supabaseAdmin
    .from('super_admin_accounts')
    .select('id, super_admin_id, is_active')
    .eq('auth_user_id', callerAuthUserId)
    .maybeSingle();

  if (callerAccountError) {
    return jsonResponse({ error: 'caller_lookup_failed', details: callerAccountError.message }, 500);
  }
  if (!callerAccount || !callerAccount.is_active) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  // ── 3) Zielschüler serverseitig auflösen (Client kann club_id nicht
  // vortäuschen — sie wird nie aus dem Request-Body gelesen). ────────────
  const { data: studentRow, error: studentLookupError } = await supabaseAdmin
    .from('students')
    .select('id, club_id, vorname, nachname')
    .eq('id', studentId)
    .maybeSingle();

  if (studentLookupError) {
    return jsonResponse({ error: 'student_lookup_failed', details: studentLookupError.message }, 500);
  }
  if (!studentRow) {
    return jsonResponse({ error: 'student_not_found' }, 404);
  }

  const { data: clubRow, error: clubLookupError } = await supabaseAdmin
    .from('clubs')
    .select('club_id, club_short_name, active')
    .eq('club_id', studentRow.club_id)
    .maybeSingle();

  if (clubLookupError) {
    return jsonResponse({ error: 'club_lookup_failed', details: clubLookupError.message }, 500);
  }
  if (!clubRow || !clubRow.active) {
    return jsonResponse({ error: 'student_club_invalid' }, 403);
  }

  // ── 4) Bestehende aktive Familienverknüpfung dieses Schülers ───────────
  const { data: familyStudentRow, error: familyStudentError } = await supabaseAdmin
    .from('family_students')
    .select('id, family_id')
    .eq('student_id', studentId)
    .eq('status', 'active')
    .maybeSingle();

  if (familyStudentError) {
    return jsonResponse({ error: 'family_student_lookup_failed', details: familyStudentError.message }, 500);
  }

  let familyRow: { id: string; club_id: string; nickname: string; normalized_nickname: string; status: string; contact_email: string | null; contact_email_updated_at: string | null } | null = null;
  let guardianRow: { id: string; auth_user_id: string; credentials_updated_at: string | null } | null = null;

  if (familyStudentRow) {
    const { data: fRow, error: fErr } = await supabaseAdmin
      .from('families')
      .select('id, club_id, nickname, normalized_nickname, status, contact_email, contact_email_updated_at')
      .eq('id', familyStudentRow.family_id)
      .maybeSingle();
    if (fErr) return jsonResponse({ error: 'family_lookup_failed', details: fErr.message }, 500);
    familyRow = fRow ?? null;

    if (familyRow) {
      // Ein Login pro Familie in diesem MVP — der zuerst angelegte guardian
      // gilt als kanonisch (siehe Kommentar in der Migration
      // rename_family_nickname).
      const { data: gRow, error: gErr } = await supabaseAdmin
        .from('family_guardians')
        .select('id, auth_user_id, credentials_updated_at')
        .eq('family_id', familyRow.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (gErr) return jsonResponse({ error: 'guardian_lookup_failed', details: gErr.message }, 500);
      guardianRow = gRow ?? null;
    }
  }

  async function logOperation(operation: string, familyId: string) {
    await supabaseAdmin.rpc('log_family_account_operation', {
      p_performed_by_auth_user_id: callerAuthUserId,
      p_target_family_id: familyId,
      p_target_student_id: studentId,
      p_club_id: studentRow.club_id,
      p_operation: operation
    });
  }

  // ── get_status ───────────────────────────────────────────────────────
  if (action === 'get_status') {
    if (!familyRow || !guardianRow) {
      return jsonResponse({ status: 'not_set_up' }, 200);
    }

    const { data: authUser, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(guardianRow.auth_user_id);
    if (authUserError || !authUser?.user) {
      return jsonResponse({ error: 'auth_user_lookup_failed', details: authUserError?.message }, 500);
    }

    const bannedUntil = (authUser.user as unknown as { banned_until?: string | null }).banned_until ?? null;
    const isBanned = Boolean(bannedUntil) && bannedUntil !== 'none' && new Date(bannedUntil as string).getTime() > Date.now();

    return jsonResponse({
      status: isBanned ? 'blocked' : 'active',
      familyId: familyRow.id,
      nickname: familyRow.nickname,
      contactEmail: familyRow.contact_email,
      contactEmailUpdatedAt: familyRow.contact_email_updated_at,
      lastSignInAt: authUser.user.last_sign_in_at ?? null,
      credentialsUpdatedAt: guardianRow.credentials_updated_at
    }, 200);
  }

  // ── create ───────────────────────────────────────────────────────────
  if (action === 'create') {
    if (familyStudentRow) {
      return jsonResponse({ error: 'family_access_already_exists' }, 409);
    }
    const nickname = (body.nickname ?? '').trim();
    const password = body.password ?? '';
    const contactEmail = (body.contactEmail ?? '').trim();

    if (!nickname) return jsonResponse({ error: 'missing_nickname' }, 400);
    if (nickname.length > MAX_NICKNAME_LENGTH) return jsonResponse({ error: 'nickname_too_long' }, 400);
    if (contactEmail && (contactEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(contactEmail))) {
      return jsonResponse({ error: 'invalid_contact_email' }, 400);
    }

    // Normalisierung IMMER über dieselbe SQL-Funktion wie beim Login
    // (resolve_family_login_email) — keine duplizierte Formel im Edge-
    // Function-Code, gleiches Prinzip wie create-family-account.
    const { data: normalizedNicknameData, error: normalizeError } = await supabaseAdmin.rpc(
      'normalize_family_nickname',
      { p_nickname: nickname }
    );
    if (normalizeError || !normalizedNicknameData) {
      return jsonResponse({ error: 'nickname_normalize_failed', details: normalizeError?.message }, 500);
    }
    const normalizedNickname = normalizedNicknameData as string;

    // Existiert in diesem Club bereits eine Familie mit diesem Nickname? Dann
    // NICHT dupliziert, sondern der Schüler wird mit ihr verknüpft
    // (Geschwister-Fall) — erfüllt "keine doppelte Familie, wenn die
    // Verknüpfung schon existiert".
    const { data: existingFamily, error: existingFamilyError } = await supabaseAdmin
      .from('families')
      .select('id')
      .eq('club_id', studentRow.club_id)
      .eq('normalized_nickname', normalizedNickname)
      .maybeSingle();

    if (existingFamilyError) {
      return jsonResponse({ error: 'existing_family_lookup_failed', details: existingFamilyError.message }, 500);
    }

    if (existingFamily) {
      const { error: linkError } = await supabaseAdmin
        .from('family_students')
        .insert({
          family_id: existingFamily.id,
          student_id: studentId,
          club_id: studentRow.club_id,
          is_primary: true,
          linked_by: callerAuthUserId
        });
      if (linkError) {
        const status = linkError.message?.toLowerCase().includes('duplicate') ? 409 : 500;
        return jsonResponse({ error: 'link_existing_family_failed', details: linkError.message }, status);
      }
      await logOperation('link_existing', existingFamily.id);
      return jsonResponse({ familyId: existingFamily.id, operation: 'link_existing' }, 200);
    }

    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return jsonResponse({ error: 'password_too_short' }, 400);
    }

    const { data: technicalEmail, error: emailError } = await supabaseAdmin.rpc('family_login_email', {
      p_club_id: studentRow.club_id,
      p_nickname: nickname
    });
    if (emailError || !technicalEmail) {
      return jsonResponse({ error: 'email_build_failed', details: emailError?.message }, 500);
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

    const { data: insertedFamily, error: familyInsertError } = await supabaseAdmin
      .from('families')
      .insert({
        club_id: studentRow.club_id,
        nickname,
        normalized_nickname: normalizedNickname,
        display_name: `${studentRow.nachname ?? ''} ${studentRow.vorname ?? ''}`.trim() || nickname,
        contact_email: contactEmail || null,
        contact_email_updated_at: contactEmail ? new Date().toISOString() : null
      })
      .select('id')
      .single();

    if (familyInsertError || !insertedFamily) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      const status = familyInsertError?.message?.toLowerCase().includes('duplicate') ? 409 : 500;
      return jsonResponse({ error: 'family_insert_failed', details: familyInsertError?.message }, status);
    }

    const { error: guardianInsertError } = await supabaseAdmin
      .from('family_guardians')
      .insert({
        auth_user_id: authUserId,
        family_id: insertedFamily.id,
        club_id: studentRow.club_id,
        display_name: nickname,
        credentials_updated_at: new Date().toISOString()
      });
    if (guardianInsertError) {
      await supabaseAdmin.from('families').delete().eq('id', insertedFamily.id);
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      return jsonResponse({ error: 'guardian_insert_failed', details: guardianInsertError.message }, 500);
    }

    const { error: studentLinkError } = await supabaseAdmin
      .from('family_students')
      .insert({
        family_id: insertedFamily.id,
        student_id: studentId,
        club_id: studentRow.club_id,
        is_primary: true,
        linked_by: callerAuthUserId
      });
    if (studentLinkError) {
      await supabaseAdmin.from('families').delete().eq('id', insertedFamily.id);
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      return jsonResponse({ error: 'student_link_failed', details: studentLinkError.message }, 500);
    }

    await logOperation('create', insertedFamily.id);
    return jsonResponse({ familyId: insertedFamily.id, operation: 'create' }, 201);
  }

  // Ab hier: alle übrigen Aktionen benötigen einen bereits eingerichteten Zugang.
  if (!familyRow || !guardianRow) {
    return jsonResponse({ error: 'family_access_not_set_up' }, 404);
  }

  // ── set_login ────────────────────────────────────────────────────────
  if (action === 'set_login') {
    const newNickname = (body.newNickname ?? '').trim();
    if (!newNickname) return jsonResponse({ error: 'missing_new_nickname' }, 400);
    if (newNickname.length > MAX_NICKNAME_LENGTH) return jsonResponse({ error: 'nickname_too_long' }, 400);

    if (newNickname === familyRow.nickname) {
      return jsonResponse({ error: 'nickname_unchanged' }, 400);
    }

    const { data: newTechnicalEmail, error: newEmailError } = await supabaseAdmin.rpc('family_login_email', {
      p_club_id: familyRow.club_id,
      p_nickname: newNickname
    });
    if (newEmailError || !newTechnicalEmail) {
      return jsonResponse({ error: 'email_build_failed', details: newEmailError?.message }, 500);
    }

    const { error: renameError } = await supabaseAdmin.rpc('rename_family_nickname', {
      p_family_id: familyRow.id,
      p_new_nickname: newNickname
    });
    if (renameError) {
      const status = renameError.message?.toLowerCase().includes('duplicate') ? 409 : 500;
      return jsonResponse({ error: 'nickname_rename_failed', details: renameError.message }, status);
    }

    const { error: emailUpdateError } = await supabaseAdmin.auth.admin.updateUserById(guardianRow.auth_user_id, {
      email: newTechnicalEmail
    });
    if (emailUpdateError) {
      // Kompensierender Rollback — gleiches Muster wie manage-trainer-account.
      const { error: rollbackError } = await supabaseAdmin.rpc('rename_family_nickname', {
        p_family_id: familyRow.id,
        p_new_nickname: familyRow.nickname
      });
      if (rollbackError) {
        return jsonResponse({
          error: 'auth_email_update_failed_and_rollback_failed',
          details: 'families.nickname and auth.users email are now out of sync — manual fix required'
        }, 500);
      }
      return jsonResponse({ error: 'auth_email_update_failed', details: emailUpdateError.message }, 500);
    }

    await supabaseAdmin
      .from('family_guardians')
      .update({ credentials_updated_at: new Date().toISOString() })
      .eq('id', guardianRow.id);

    if (body.contactEmail !== undefined) {
      const contactEmail = body.contactEmail.trim();
      if (contactEmail && (contactEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(contactEmail))) {
        return jsonResponse({ error: 'invalid_contact_email' }, 400);
      }
      await supabaseAdmin
        .from('families')
        .update({ contact_email: contactEmail || null, contact_email_updated_at: new Date().toISOString() })
        .eq('id', familyRow.id);
    }

    await logOperation('set_login', familyRow.id);
    return jsonResponse({ familyId: familyRow.id, nickname: newNickname, operation: 'set_login' }, 200);
  }

  // ── set_password ─────────────────────────────────────────────────────
  if (action === 'set_password') {
    const password = body.password ?? '';
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return jsonResponse({ error: 'password_too_short' }, 400);
    }

    const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(guardianRow.auth_user_id, { password });
    if (pwError) {
      return jsonResponse({ error: 'auth_password_update_failed', details: pwError.message }, 500);
    }

    await supabaseAdmin
      .from('family_guardians')
      .update({ credentials_updated_at: new Date().toISOString() })
      .eq('id', guardianRow.id);

    await logOperation('set_password', familyRow.id);
    return jsonResponse({ familyId: familyRow.id, operation: 'set_password' }, 200);
  }

  // ── activate / deactivate ───────────────────────────────────────────
  if (action === 'activate' || action === 'deactivate') {
    const banDuration = action === 'activate' ? 'none' : PERMANENT_BAN_DURATION;
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(guardianRow.auth_user_id, {
      ban_duration: banDuration
    });
    if (banError) {
      return jsonResponse({ error: 'auth_ban_update_failed', details: banError.message }, 500);
    }

    // families.status ist nur informativ (siehe Migration 001-Audit: wird
    // aktuell nirgends enforced) — die eigentliche Sperre ist der native
    // Supabase-Auth-Ban oben, unabhängig vom Login-Flow in Block 3.
    await supabaseAdmin
      .from('families')
      .update({ status: action === 'activate' ? 'active' : 'suspended' })
      .eq('id', familyRow.id);

    await logOperation(action, familyRow.id);
    return jsonResponse({ familyId: familyRow.id, operation: action }, 200);
  }

  // ── send_recovery ────────────────────────────────────────────────────
  if (action === 'send_recovery') {
    if (!familyRow.contact_email) {
      return jsonResponse({ error: 'no_contact_email' }, 200);
    }

    const { data: authUser, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(guardianRow.auth_user_id);
    if (authUserError || !authUser?.user?.email) {
      return jsonResponse({ error: 'auth_user_lookup_failed', details: authUserError?.message }, 500);
    }

    const redirectTo = Deno.env.get('FAMILY_PORTAL_RESET_URL') || undefined;
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: authUser.user.email,
      options: redirectTo ? { redirectTo } : undefined
    });
    if (linkError || !linkData?.properties?.action_link) {
      return jsonResponse({ error: 'recovery_link_generation_failed', details: linkError?.message }, 500);
    }

    await dispatchRecoveryEmail(familyRow.contact_email, linkData.properties.action_link);

    await logOperation('send_recovery', familyRow.id);
    // Neutrale Antwort unabhängig vom tatsächlichen Zustellstatus — siehe
    // Kommentar am Dateianfang.
    return jsonResponse({ recovery: 'requested' }, 200);
  }

  return jsonResponse({ error: 'unhandled_action' }, 400);
});
