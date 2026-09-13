// Edge Function: выдача одноразового короткоживущего Super Admin Preview
// токена для конкретного ученика (Block 1, JCL_Gruppen, кнопка
// «👁 Family-Seite ansehen» → saFamilienPreview()).
//
// НЕ создаёт и не использует family-сессию/пароль семьи — только
// подтверждает, что вызывающий прямо сейчас является активным Super Admin
// (та же дуальная модель авторизации, что уже проверена в
// manage-family-account, СКОПИРОВАНА сюда БЕЗ изменений: способ A —
// Supabase Auth JWT (super_admin_accounts.is_active), способ B — Super
// Admin PIN Session (super_admin_pin_sessions, token_hash/expires_at/
// revoked_at)), и выдаёт токен для КОНКРЕТНОГО studentId.
//
// НЕ зависит от family_students.status/families.status — активация
// Familienzugang НЕ является правом на Preview, право даёт только сама
// личность Super Admin. Целевой ученик и его club_id резолвятся сервером
// (клиент передаёт только studentId, не club_id — тот же принцип, что в
// manage-family-account).
//
// Токен: 32 случайных байта (crypto.getRandomValues), base64url — та же
// generateOpaqueToken()/sha256Hex(), что уже используется в
// super-admin-pin-login. Хранится ТОЛЬКО хеш (student_preview_tokens.
// token_hash), сырой токен возвращается вызывающему один раз в ответе и
// нигде на сервере не сохраняется. TTL — 5 минут, не продлевается.
//
// ⚠️ Деплой этой функции требует отключённой JWT-проверки на уровне
// Supabase API Gateway (verify_jwt = false / "Enforce JWT Verification"
// выключено в Dashboard) — ЭТА функция сама проверяет вызывающего (способ
// A/B выше), но САМ вызов идёт с Bearer PIN-Session-токеном, который не
// является Supabase Auth JWT (способ B) — то же самое ограничение, что уже
// решено для manage-family-account/admin-pin-login.
//
// CORS: вызывается ТОЛЬКО с Block 1 (JCL_Gruppen), тот же origin, что и
// manage-family-account.

import { createClient } from 'npm:@supabase/supabase-js@2';

interface RequestBody {
  studentId: number;
}

const PREVIEW_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 минут, фиксировано — не продлевается.

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

// Идентична generateOpaqueToken() в super-admin-pin-login — тот же формат,
// то же намерение (unauffällig в headers/JSON, без символов, требующих
// URL-encoding).
function generateOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

  const { studentId } = body;
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
  // Session) — IDENTISCH zu manage-family-account, siehe dortigen Kommentar
  // für die vollständige Begründung. Ergebnis: callerSuperAdminId (uuid). ──
  let callerSuperAdminId: string | null = null;

  const { data: callerAuthData } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerAuthData?.user) {
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
    }
  }

  if (callerSuperAdminId === null) {
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
      }
    }
  }

  if (callerSuperAdminId === null) {
    return jsonResponse({ error: 'invalid_or_expired_token' }, 401);
  }

  // ── 2) Zielschüler serverseitig auflösen — club_id kommt NIE aus dem
  // Request-Body, genau wie in manage-family-account. Bewusst KEINE
  // Abfrage von family_students/families hier — Preview-Berechtigung hängt
  // nicht von deren Status ab. ──────────────────────────────────────────
  const { data: studentRow, error: studentLookupError } = await supabaseAdmin
    .from('students')
    .select('id, club_id')
    .eq('id', studentId)
    .maybeSingle();

  if (studentLookupError) {
    return jsonResponse({ error: 'student_lookup_failed', details: studentLookupError.message }, 500);
  }
  if (!studentRow) {
    return jsonResponse({ error: 'student_not_found' }, 404);
  }

  // ── 3) Token erzeugen, NUR den Hash speichern ────────────────────────
  const token = generateOpaqueToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + PREVIEW_TOKEN_TTL_MS).toISOString();

  const { error: insertError } = await supabaseAdmin
    .from('student_preview_tokens')
    .insert({
      token_hash: tokenHash,
      student_id: studentRow.id,
      club_id: studentRow.club_id,
      created_by_super_admin_id: callerSuperAdminId,
      expires_at: expiresAt
    });

  if (insertError) {
    return jsonResponse({ error: 'token_create_failed', details: insertError.message }, 500);
  }

  return jsonResponse({ token, expiresAt, studentId: studentRow.id }, 201);
});
