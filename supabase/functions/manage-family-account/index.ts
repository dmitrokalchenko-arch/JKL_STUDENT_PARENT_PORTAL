// Edge Function: административное управление Familienzugänge (доступ семьи
// к Family Portal) — привязано к уже существующему public.students
// (JCL_Gruppen, чужая таблица — эта функция её не создаёт и не изменяет,
// только читает).
//
// МОДЕЛЬ АВТОРИЗАЦИИ — ДВА равноправных способа (обновлено 2026-08-07,
// см. docs/database/SUPER_ADMIN_PIN_SESSION.md): бизнес-требование теперь
// прямо запрещает делать легаси PIN-вход read-only/fallback-режимом —
// Super Admin, вошедший обычным username+PIN, должен иметь ПОЛНЫЙ доступ,
// без обязательного отдельного Supabase Auth.
//   A) Supabase Auth JWT — как раньше: Authorization: Bearer <access_token>,
//      supabaseAdmin.auth.getUser(token), СОБСТВЕННАЯ строка
//      super_admin_accounts вызывающего по auth_user_id, обязателен
//      is_active = true.
//   B) Super Admin PIN Session — НОВОЕ: тот же заголовок Authorization:
//      Bearer <opaque token>, выданный super-admin-pin-login. Токен
//      хешируется (SHA-256) и ищется в super_admin_pin_sessions; обязательны
//      revoked_at is null и expires_at > now(). last_used_at обновляется,
//      expires_at НЕ продлевается (фиксированный TTL, см. super-admin-pin-login).
// Резолвится сначала способ A, при неудаче — способ B; ни тот, ни другой —
// 401. Оба способа дают единый идентификатор актора — super_admin_id
// (bigint, значение-FK на чужую super_admins.id) — используемый везде ниже
// вместо прежнего callerAuthUserId, включая аудит-лог (см.
// family_account_audit_log, миграция 20260807110037).
//
// Прочее без изменений:
//   - studentId из тела запроса резолвится в students-строку СЕРВЕРОМ;
//      club_id ученика сверяется с реальной clubs-строкой (существует и
//      active = true) — Super Admin платформенный (не привязан к одному
//      клубу, в отличие от Trainer-admin в manage-trainer-account), поэтому
//      здесь нет сравнения "club администратора" — есть проверка, что
//      целевой клуб вообще существует и активен (защита от действий над
//      осиротевшими/удалёнными клубами).
//   - Пароль НИГДЕ не читается обратно — только auth.admin.updateUserById/
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
  | 'set_contact_email'
  | 'set_password'
  | 'activate'
  | 'deactivate'
  | 'send_recovery'
  | 'get_student_page_access'
  | 'set_access_until'
  | 'set_manual_disabled'
  | 'set_trainer_exception'
  | 'get_family_students'
  | 'add_family_student';

interface RequestBody {
  action: Action;
  studentId: number;
  nickname?: string;
  newNickname?: string;
  password?: string;
  contactEmail?: string;
  // STUDENT PAGE SUBSCRIPTION (Phase 3, задача "Student Page Access /
  // Subscription Management") — НЕ family account, см. комментарий у
  // блока новых actions ниже. accessUntil: 'YYYY-MM-DD' | null | не
  // передано вовсе (undefined — только для action='create', означает
  // "старый frontend, не трогать subscription"). manualDisabled/
  // trainerAccessAfterExpiry — только для соответствующих set_*-actions.
  accessUntil?: string | null;
  manualDisabled?: boolean;
  trainerAccessAfterExpiry?: boolean;
  // MULTI-CHILD FAMILY BACKEND (задача "Super Admin multi-child family
  // backend") — только для action='add_family_student'. studentId в теле
  // запроса остаётся КОНТЕКСТНЫМ студентом (резолвит family_id тем же уже
  // существующим путём, что и все остальные actions) — addStudentId это
  // ОТДЕЛЬНЫЙ студент, которого нужно добавить в это же family_id. Имя
  // сознательно НЕ "newStudentId" — эта операция НИКОГДА не создаёт нового
  // студента, только связывает уже существующего.
  addStudentId?: number;
}

const MIN_PASSWORD_LENGTH = 8;
const MAX_NICKNAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const PERMANENT_BAN_DURATION = '876000h'; // ~100 Jahre, faktisch "gesperrt bis manuell entsperrt"
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCESS_UNTIL_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// STUDENT PAGE SUBSCRIPTION — строгая проверка, что строка не только
// СИНТАКСИЧЕСКИ похожа на YYYY-MM-DD, но и является РЕАЛЬНОЙ календарной
// датой (без time-компонента) — new Date('2026-02-30') не бросает
// исключение, а молча "перекатывает" в 2026-03-02, поэтому сверяем
// компоненты после построения UTC-даты обратно с исходным вводом.
// Прошлые даты НЕ отклоняются намеренно (см. комментарий у actions
// set_access_until/create ниже) — только формат/реальность даты.
function isValidAccessUntilString(raw: string): boolean {
  if (!ACCESS_UNTIL_PATTERN.test(raw)) return false;
  const [year, month, day] = raw.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

// Возвращает {ok:true, value} с value === null или 'YYYY-MM-DD', либо
// {ok:false} — единая проверка, переиспользуемая и set_access_until, и
// action='create' (см. ниже). raw===null -> ok (сознательный возврат в
// legacy/unmanaged режим). raw===undefined никогда сюда не передаётся —
// вызывающий код сам решает, что undefined означает "не трогать".
function parseAccessUntilInput(raw: string | null): { ok: true; value: string | null } | { ok: false } {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string' || !isValidAccessUntilString(raw)) return { ok: false };
  return { ok: true, value: raw };
}

// CORS — ДОБАВЛЕНО (безопасный pre-deploy аудит Family Layer, 2026-08-29):
// изначально отсутствовало здесь полностью (ни CORS_HEADERS, ни обработки
// OPTIONS), в отличие от уже рабочих manage-trainer-account/admin-pin-login.
// Без этого браузерный вызов с jcl-gruppen.netlify.app блокировался бы CORS
// уже на preflight, тот же класс проблемы, что был найден и исправлен для
// admin-pin-login. Повторяет ровно тот же паттерн (тот же origin, те же
// заголовки, тот же список методов) — см. manage-trainer-account/index.ts.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://jcl-gruppen.netlify.app',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS }
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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

// STUDENT PAGE SUBSCRIPTION — вызывается ТОЛЬКО из action='create' (оба
// success-пути), ПОСЛЕ уже успешной family_students-привязки. Единственная
// ответственность — вызвать уже существующий атомарный UPSERT-RPC
// (migration 20260921100066) с уже провалидированным accessUntil и уже
// resolved server-side callerSuperAdminId (никогда не от клиента).
async function applyAccessUntilOnCreate(
  supabaseAdmin: ReturnType<typeof createClient>,
  studentId: number,
  accessUntil: string | null,
  superAdminId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseAdmin.rpc('set_student_page_access_until', {
    p_student_id: studentId,
    p_access_until: accessUntil,
    p_updated_by_super_admin_id: superAdminId
  });
  if (error) {
    console.error('[manage-family-account] set_student_page_access_until failed during create', error);
    return { ok: false, error: 'access_until_set_failed' };
  }
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

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
    'get_status', 'create', 'set_login', 'set_contact_email', 'set_password', 'activate', 'deactivate', 'send_recovery',
    'get_student_page_access', 'set_access_until', 'set_manual_disabled', 'set_trainer_exception',
    'get_family_students', 'add_family_student'
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

  // ── 1) Aufrufer auflösen — Weg A (Supabase Auth JWT) oder Weg B (PIN
  // Session), siehe Kommentar am Dateianfang. Ergebnis in beiden Fällen:
  // callerSuperAdminId (uuid — TYP KORRIGIERT, sicherer Pre-Deploy-Audit der
  // Family Layer, 2026-08-29: super_admins.id ist uuid, gegen production
  // bestätigt, nicht bigint — mit "number" hier wäre der Edge-Function-Deploy
  // selbst mit einem TypeScript-Fehler fehlgeschlagen, sobald ein echter
  // uuid-Wert zugewiesen wird) + optional callerAuthUserId (nur Weg A). ──
  let callerSuperAdminId: string | null = null;
  let callerAuthUserId: string | null = null;

  const { data: callerAuthData } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerAuthData?.user) {
    // ── Weg A: Eigener super_admin_accounts-Eintrag, muss aktiv sein ─────
    const { data: callerAccount, error: callerAccountError } = await supabaseAdmin
      .from('super_admin_accounts')
      .select('id, super_admin_id, is_active')
      .eq('auth_user_id', callerAuthData.user.id)
      .maybeSingle();

    if (callerAccountError) {
      return jsonResponse({ error: 'caller_lookup_failed', details: callerAccountError.message }, 500);
    }
    if (callerAccount && callerAccount.is_active) {
      callerSuperAdminId = callerAccount.super_admin_id;
      callerAuthUserId = callerAuthData.user.id;
    }
  }

  if (callerSuperAdminId === null) {
    // ── Weg B: Super Admin PIN Session (super_admin_pin_sessions) ────────
    const tokenHash = await sha256Hex(accessToken);
    const { data: pinSession, error: pinSessionError } = await supabaseAdmin
      .from('super_admin_pin_sessions')
      .select('id, super_admin_id, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (pinSessionError) {
      return jsonResponse({ error: 'pin_session_lookup_failed', details: pinSessionError.message }, 500);
    }
    if (
      pinSession &&
      !pinSession.revoked_at &&
      new Date(pinSession.expires_at).getTime() > Date.now()
    ) {
      // Defensive Prüfung: super_admins-Zeile muss noch existieren (fremde
      // Tabelle, kein FOREIGN KEY möglich, siehe Migrationskommentar).
      const { data: superAdminRow, error: superAdminError } = await supabaseAdmin
        .from('super_admins')
        .select('id')
        .eq('id', pinSession.super_admin_id)
        .maybeSingle();

      if (superAdminError) {
        return jsonResponse({ error: 'super_admin_lookup_failed', details: superAdminError.message }, 500);
      }
      if (superAdminRow) {
        callerSuperAdminId = pinSession.super_admin_id;
        // last_used_at ist rein informativ — expires_at wird NICHT verlängert.
        await supabaseAdmin
          .from('super_admin_pin_sessions')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', pinSession.id);
      }
    }
  }

  if (callerSuperAdminId === null) {
    return jsonResponse({ error: 'invalid_or_expired_token' }, 401);
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

  // targetStudentId ist optional und defaultet auf den Kontext-studentId
  // (unverändertes Verhalten für alle bestehenden Aufrufer). Für
  // add_family_student wird explizit der HINZUGEFÜGTE Schüler übergeben —
  // aussagekräftiger als der Kontext-Schüler, dessen Karte zufällig offen
  // war (siehe Kommentar bei add_family_student unten).
  async function logOperation(operation: string, familyId: string, targetStudentId: number = studentId) {
    await supabaseAdmin.rpc('log_family_account_operation', {
      p_performed_by_super_admin_id: callerSuperAdminId,
      p_performed_by_auth_user_id: callerAuthUserId,
      p_target_family_id: familyId,
      p_target_student_id: targetStudentId,
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

    // STUDENT PAGE SUBSCRIPTION (Phase 3) — accessUntil OPTIONAL для
    // backward compatibility: старый Block 1 frontend не отправляет это
    // поле вовсе (undefined) -> subscription вообще не трогается (missing
    // row уже означает legacy/unlimited, см. migration 20260919100064) —
    // НЕ создаём строку без необходимости. Явно переданное значение
    // (включая null — сознательный unmanaged-режим) валидируется здесь же,
    // ДО любых side-effects этого action.
    let parsedAccessUntilForCreate: string | null | undefined = undefined;
    if (body.accessUntil !== undefined) {
      const parsedAccessUntil = parseAccessUntilInput(body.accessUntil);
      if (!parsedAccessUntil.ok) return jsonResponse({ error: 'invalid_access_until' }, 400);
      parsedAccessUntilForCreate = parsedAccessUntil.value;
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

      // STUDENT PAGE SUBSCRIPTION — Familienzugang (Geschwister-Fall) ist
      // bereits vollständig und nutzbar angelegt; dieser Schritt ist eine
      // sekundäre Anreicherung. Ein Fehlschlag hier rollt den bereits
      // erfolgreichen link_existing NICHT zurück (unverhältnismäßig — die
      // Kernoperation ist bereits gültig) — die Antwort ist stattdessen
      // ehrlich und deterministisch (accessUntilSet/accessUntilError),
      // niemals stiller Erfolg. Siehe applyAccessUntilOnCreate.
      let accessUntilSet: boolean | undefined;
      let accessUntilError: string | undefined;
      if (parsedAccessUntilForCreate !== undefined) {
        const accessUntilResult = await applyAccessUntilOnCreate(
          supabaseAdmin,
          studentId,
          parsedAccessUntilForCreate,
          callerSuperAdminId
        );
        accessUntilSet = accessUntilResult.ok;
        if (!accessUntilResult.ok) accessUntilError = accessUntilResult.error;
      }

      await logOperation('link_existing', existingFamily.id);
      return jsonResponse({
        familyId: existingFamily.id,
        operation: 'link_existing',
        ...(accessUntilSet !== undefined ? { accessUntilSet } : {}),
        ...(accessUntilError ? { accessUntilError } : {})
      }, 200);
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

    // STUDENT PAGE SUBSCRIPTION — тот же принцип, что и в ветке
    // link_existing выше: Family account к этому моменту уже полностью
    // создан и рабочий (auth user + families + family_guardians +
    // family_students все успешны) — это вторичное обогащение, не часть
    // атомарного "создания аккаунта" (сам create-flow и без того НЕ единая
    // SQL-транзакция, см. комментарий в шапке файла про compensating
    // rollback). Ошибка здесь НЕ откатывает уже созданный Family account —
    // ответ честно и детерминированно сообщает о частичном результате
    // (accessUntilSet/accessUntilError), никогда не молчаливый full success.
    let accessUntilSet: boolean | undefined;
    let accessUntilError: string | undefined;
    if (parsedAccessUntilForCreate !== undefined) {
      const accessUntilResult = await applyAccessUntilOnCreate(
        supabaseAdmin,
        studentId,
        parsedAccessUntilForCreate,
        callerSuperAdminId
      );
      accessUntilSet = accessUntilResult.ok;
      if (!accessUntilResult.ok) accessUntilError = accessUntilResult.error;
    }

    await logOperation('create', insertedFamily.id);
    return jsonResponse({
      familyId: insertedFamily.id,
      operation: 'create',
      ...(accessUntilSet !== undefined ? { accessUntilSet } : {}),
      ...(accessUntilError ? { accessUntilError } : {})
    }, 201);
  }

  // ══════════════════════════════════════════════════════════════════════
  // STUDENT PAGE SUBSCRIPTION (Phase 3) — НАМЕРЕННО перед gate "familyRow/
  // guardianRow обязательны" ниже: platные Student Page-действия должны
  // работать ДАЖЕ для ученика, у которого ЕЩЁ НЕТ Familienzugang вообще
  // (архитектура Phase 1/2: "Student Page существует независимо от Family
  // account"). studentRow/clubRow уже провалидированы сервером выше (тот
  // же механизм, что и для всех остальных actions — studentId существует,
  // club существует и active) — никакой новой/отдельной club-scope
  // проверки не вводится (Super Admin здесь, как и везде в этом файле,
  // платформенный, не привязан к одному клубу). callerSuperAdminId — уже
  // resolved trusted server-side актор (Weg A/B выше), НИКОГДА не от
  // клиента — используется как updated_by_super_admin_id и в audit log.
  // ══════════════════════════════════════════════════════════════════════

  // ── get_student_page_access ─────────────────────────────────────────
  if (action === 'get_student_page_access') {
    const { data: access, error: accessError } = await supabaseAdmin.rpc('get_student_page_access', {
      p_student_id: studentId
    });
    if (accessError) {
      return jsonResponse({ error: 'student_page_access_lookup_failed', details: accessError.message }, 500);
    }
    return jsonResponse({ studentId: String(studentId), ...(access as Record<string, unknown>) }, 200);
  }

  // ── set_access_until ─────────────────────────────────────────────────
  if (action === 'set_access_until') {
    // Здесь (в отличие от action='create') accessUntil ОБЯЗАТЕЛЕН в теле
    // запроса — либо валидная 'YYYY-MM-DD', либо явный null (сознательный
    // возврат в unmanaged-режим). undefined означает "поле не передано" —
    // отклоняется, а не трактуется как null.
    if (body.accessUntil === undefined) {
      return jsonResponse({ error: 'invalid_access_until' }, 400);
    }
    const parsedAccessUntil = parseAccessUntilInput(body.accessUntil);
    if (!parsedAccessUntil.ok) {
      return jsonResponse({ error: 'invalid_access_until' }, 400);
    }

    const { data: oldAccess } = await supabaseAdmin.rpc('get_student_page_access', { p_student_id: studentId });

    const { error: setError } = await supabaseAdmin.rpc('set_student_page_access_until', {
      p_student_id: studentId,
      p_access_until: parsedAccessUntil.value,
      p_updated_by_super_admin_id: callerSuperAdminId
    });
    if (setError) {
      return jsonResponse({ error: 'access_until_update_failed', details: setError.message }, 500);
    }

    const { data: newAccess } = await supabaseAdmin.rpc('get_student_page_access', { p_student_id: studentId });

    await supabaseAdmin.rpc('log_student_page_access_operation', {
      p_performed_by_super_admin_id: callerSuperAdminId,
      p_performed_by_auth_user_id: callerAuthUserId,
      p_target_student_id: studentId,
      p_operation: 'set_access_until',
      p_old_value: oldAccess ?? null,
      p_new_value: newAccess ?? null
    });

    return jsonResponse({ studentId: String(studentId), operation: 'set_access_until', ...(newAccess as Record<string, unknown>) }, 200);
  }

  // ── set_manual_disabled ──────────────────────────────────────────────
  if (action === 'set_manual_disabled') {
    if (typeof body.manualDisabled !== 'boolean') {
      return jsonResponse({ error: 'invalid_manual_disabled' }, 400);
    }

    const { data: oldAccess } = await supabaseAdmin.rpc('get_student_page_access', { p_student_id: studentId });

    const { error: setError } = await supabaseAdmin.rpc('set_student_page_manual_disabled', {
      p_student_id: studentId,
      p_manual_disabled: body.manualDisabled,
      p_updated_by_super_admin_id: callerSuperAdminId
    });
    if (setError) {
      return jsonResponse({ error: 'manual_disabled_update_failed', details: setError.message }, 500);
    }

    const { data: newAccess } = await supabaseAdmin.rpc('get_student_page_access', { p_student_id: studentId });

    await supabaseAdmin.rpc('log_student_page_access_operation', {
      p_performed_by_super_admin_id: callerSuperAdminId,
      p_performed_by_auth_user_id: callerAuthUserId,
      p_target_student_id: studentId,
      p_operation: 'set_manual_disabled',
      p_old_value: oldAccess ?? null,
      p_new_value: newAccess ?? null
    });

    return jsonResponse({ studentId: String(studentId), operation: 'set_manual_disabled', ...(newAccess as Record<string, unknown>) }, 200);
  }

  // ── set_trainer_exception ────────────────────────────────────────────
  if (action === 'set_trainer_exception') {
    if (typeof body.trainerAccessAfterExpiry !== 'boolean') {
      return jsonResponse({ error: 'invalid_trainer_exception' }, 400);
    }

    const { data: oldAccess } = await supabaseAdmin.rpc('get_student_page_access', { p_student_id: studentId });

    const { error: setError } = await supabaseAdmin.rpc('set_student_page_trainer_exception', {
      p_student_id: studentId,
      p_trainer_access_after_expiry: body.trainerAccessAfterExpiry,
      p_updated_by_super_admin_id: callerSuperAdminId
    });
    if (setError) {
      return jsonResponse({ error: 'trainer_exception_update_failed', details: setError.message }, 500);
    }

    const { data: newAccess } = await supabaseAdmin.rpc('get_student_page_access', { p_student_id: studentId });

    await supabaseAdmin.rpc('log_student_page_access_operation', {
      p_performed_by_super_admin_id: callerSuperAdminId,
      p_performed_by_auth_user_id: callerAuthUserId,
      p_target_student_id: studentId,
      p_operation: 'set_trainer_exception',
      p_old_value: oldAccess ?? null,
      p_new_value: newAccess ?? null
    });

    return jsonResponse({ studentId: String(studentId), operation: 'set_trainer_exception', ...(newAccess as Record<string, unknown>) }, 200);
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

  // ── set_contact_email ───────────────────────────────────────────────
  // Getrennt von set_login: die Kontakt-E-Mail kann geändert werden, OHNE
  // dass sich der Familienlogin (nickname) ändert — set_login verlangt
  // explizit einen NEUEN Nicknamen (nickname_unchanged), was einen reinen
  // E-Mail-Wechsel dort blockieren würde.
  if (action === 'set_contact_email') {
    const contactEmail = (body.contactEmail ?? '').trim();
    if (contactEmail && (contactEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(contactEmail))) {
      return jsonResponse({ error: 'invalid_contact_email' }, 400);
    }

    const { error: updateError } = await supabaseAdmin
      .from('families')
      .update({ contact_email: contactEmail || null, contact_email_updated_at: new Date().toISOString() })
      .eq('id', familyRow.id);
    if (updateError) {
      return jsonResponse({ error: 'contact_email_update_failed', details: updateError.message }, 500);
    }

    await logOperation('set_contact_email', familyRow.id);
    return jsonResponse({ familyId: familyRow.id, contactEmail: contactEmail || null, operation: 'set_contact_email' }, 200);
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

    // families.status — ZWEITE, unabhängige Sperrschicht (siehe Migration
    // 20260914110055_enforce_family_status_in_access_checks.sql, Block 3):
    // public.can_family_access_student()/get_current_family_children()
    // prüfen jetzt families.status='active' bei JEDEM Aufruf — ein bereits
    // ausgestelltes, noch nicht abgelaufenes access token einer
    // deaktivierten Familie liefert ab dem nächsten Aufruf keine
    // Student-Daten mehr, unabhängig vom nativen Auth-Ban oben (der nur
    // neue Logins/Refreshes blockiert). Beide Schichten werden hier
    // atomar zusammen mit demselben Request geschrieben.
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

    const emailDispatched = await dispatchRecoveryEmail(familyRow.contact_email, linkData.properties.action_link);

    await logOperation('send_recovery', familyRow.id);
    // "recovery: requested" bleibt IMMER gleich (neutral gegenüber einem
    // möglichen Enumeration-Angriff auf contact_email) — emailDispatched ist
    // zusätzlich, NUR für den bereits authentifizierten Super Admin: ehrliche
    // Information, ob wirklich ein Provider konfiguriert ist und die Mail
    // technisch verschickt wurde, statt "Mail gesendet" vorzutäuschen, wenn
    // nur der Link geloggt wurde (siehe Kommentar am Dateianfang).
    return jsonResponse({ recovery: 'requested', emailDispatched }, 200);
  }

  // ══════════════════════════════════════════════════════════════════════
  // MULTI-CHILD FAMILY BACKEND (Audit vor Implementierung, read-only, siehe
  // Sitzungsverlauf) — get_family_students/add_family_student. BEWUSST NACH
  // dem "familyRow/guardianRow erforderlich"-Gate oben (anders als die
  // Student-Page-Subscription-Actions, die bewusst DAVOR liegen): ein
  // Familienkonto kann keine Kinder auflisten oder aufnehmen, wenn es noch
  // gar nicht existiert — dieselbe Semantik wie set_login/set_password/etc.
  // family_id kommt HIER NIEMALS vom Client — ausschließlich aus der bereits
  // oben (Schritt 4) servergeseitig aufgelösten familyRow, über denselben
  // Pfad, den auch get_status/set_login/... längst benutzen.
  // ══════════════════════════════════════════════════════════════════════

  // ── get_family_students ─────────────────────────────────────────────
  if (action === 'get_family_students') {
    const { data: children, error: childrenError } = await supabaseAdmin.rpc('get_family_students', {
      p_family_id: familyRow.id
    });
    if (childrenError) {
      return jsonResponse({ error: 'family_students_lookup_failed', details: childrenError.message }, 500);
    }
    return jsonResponse({ familyId: familyRow.id, students: children ?? [] }, 200);
  }

  // ── add_family_student ───────────────────────────────────────────────
  // Fügt einen BEREITS EXISTIERENDEN Schüler desselben Vereins zum bereits
  // aufgelösten Familienkonto hinzu. Erstellt NIEMALS einen neuen Schüler,
  // NIEMALS ein zweites Familienkonto und rührt student_page_access dieses
  // oder irgendeines anderen Kindes NICHT an (siehe Kommentar am
  // Dateianfang zur strikten Trennung Familienkonto <-> Student Page —
  // dieselbe Trennung gilt jetzt auch für Familienzugehörigkeit).
  if (action === 'add_family_student') {
    const addStudentId = body.addStudentId;
    if (!addStudentId || typeof addStudentId !== 'number') {
      return jsonResponse({ error: 'missing_add_student_id' }, 400);
    }

    const { data: addStudentRow, error: addStudentLookupError } = await supabaseAdmin
      .from('students')
      .select('id, club_id')
      .eq('id', addStudentId)
      .maybeSingle();
    if (addStudentLookupError) {
      return jsonResponse({ error: 'add_student_lookup_failed', details: addStudentLookupError.message }, 500);
    }
    if (!addStudentRow) {
      return jsonResponse({ error: 'add_student_not_found' }, 404);
    }
    // Freundliche Vorab-Prüfung — die eigentliche, maßgebliche Durchsetzung
    // bleibt trg_family_students_club_match (Migration 20260720120001),
    // unverändert. Diese Prüfung hier verhindert nur eine unnötige, weniger
    // aussagekräftige DB-Fehlermeldung für den häufigsten Fall.
    if (addStudentRow.club_id !== familyRow.club_id) {
      return jsonResponse({ error: 'add_student_club_mismatch' }, 403);
    }

    const { data: existingLink, error: existingLinkError } = await supabaseAdmin
      .from('family_students')
      .select('id, status')
      .eq('family_id', familyRow.id)
      .eq('student_id', addStudentId)
      .maybeSingle();
    if (existingLinkError) {
      return jsonResponse({ error: 'existing_link_lookup_failed', details: existingLinkError.message }, 500);
    }

    if (existingLink && existingLink.status === 'active') {
      return jsonResponse({ error: 'already_linked' }, 409);
    }

    if (existingLink) {
      // Bereits vorhandene, aber inaktive Verknüpfung -> reaktivieren statt
      // eines zweiten INSERT (würde unique(family_id, student_id) verletzen).
      const { error: reactivateError } = await supabaseAdmin
        .from('family_students')
        .update({ status: 'active' })
        .eq('id', existingLink.id);
      if (reactivateError) {
        return jsonResponse({ error: 'reactivate_link_failed', details: reactivateError.message }, 500);
      }
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('family_students')
        .insert({
          family_id: familyRow.id,
          student_id: addStudentId,
          club_id: familyRow.club_id,
          is_primary: true,
          linked_by: callerAuthUserId
        });
      if (insertError) {
        // trg_family_students_max_active (Migration 20260720120001) wirft
        // hier eine Exception, falls addStudentId bereits 2 aktive Familien
        // hat — dieselbe, bereits bestehende Regel, hier NICHT dupliziert,
        // nur ihre Fehlermeldung in einen sauberen 409 übersetzt.
        const message = insertError.message?.toLowerCase() ?? '';
        const status = message.includes('already linked to 2 active families') || message.includes('duplicate')
          ? 409
          : 500;
        return jsonResponse({ error: 'add_family_student_failed', details: insertError.message }, status);
      }
    }

    await logOperation('add_child', familyRow.id, addStudentId);

    const { data: children, error: childrenError } = await supabaseAdmin.rpc('get_family_students', {
      p_family_id: familyRow.id
    });
    if (childrenError) {
      // Schreiben war erfolgreich — ein Fehler beim anschließenden Re-Read
      // darf das nicht verschleiern, wird aber ehrlich gemeldet statt eines
      // stillen leeren students-Arrays.
      return jsonResponse({
        familyId: familyRow.id,
        addedStudentId: addStudentId,
        operation: 'add_family_student',
        studentsReloadError: childrenError.message
      }, 200);
    }

    return jsonResponse({
      familyId: familyRow.id,
      addedStudentId: addStudentId,
      operation: 'add_family_student',
      students: children ?? []
    }, 200);
  }

  return jsonResponse({ error: 'unhandled_action' }, 400);
});
