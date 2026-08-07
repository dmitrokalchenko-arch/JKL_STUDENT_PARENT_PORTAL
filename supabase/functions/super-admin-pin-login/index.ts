// Edge Function: server-seitige PIN-Verifizierung für Super Admin
// (JCL_Gruppen.super_admins, FREMDE Tabelle — hier weder erstellt noch
// verändert) — ersetzt den bisherigen Client-seitigen Vergleich
// (_superAdminLoginCore, "Alter PIN-Pfad": select('id, username, name, pin')
// über den anon-Key, Vergleich in JS im Browser).
//
// MODELL:
//   1) Client sendet { username, pin } — kein Bearer-Token nötig, das ist
//      der Login selbst (wie signInWithPassword für den Auth-Zweig).
//   2) Diese Funktion liest super_admins NUR über service_role — der PIN
//      verlässt den Server nie, weder in der Response noch im Log.
//   3) Bei Erfolg: zufälliges opakes Token (32 Byte), NUR der SHA-256-Hash
//      wird in super_admin_pin_sessions gespeichert. Das Klartext-Token wird
//      genau einmal zurückgegeben.
//   4) expires_at = jetzt + 30 Minuten, fest (keine Verlängerung bei Nutzung
//      — siehe manage-family-account).
//
// Anti-Enumeration: bei falschem Username ODER falschem PIN exakt dieselbe
// generische Fehlermeldung (gleiches Prinzip wie resolve_family_login_email/
// resolve_trainer_login_email).
//
// Sekundäre Nutzung dieser Funktion (bewusste Design-Entscheidung, siehe
// technische Notiz docs/database/SUPER_ADMIN_PIN_SESSION.md): der Aufruf
// erfolgt NACH dem lokalen Vergleich im "Alter PIN-Pfad" von
// _superAdminLoginCore, mit demselben, noch im Formular vorhandenen PIN —
// keine zweite Eingabe für den Nutzer.

import { createClient } from 'npm:@supabase/supabase-js@2';

interface RequestBody {
  username?: string;
  pin?: string;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 Minuten, fest — siehe Kommentar oben.
const GENERIC_ERROR = { error: 'invalid_credentials' };

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url, ohne Padding — unauffällig in Headers/JSON, keine
  // Sonderzeichen, die URL-Encoding bräuchten.
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const username = (body.username ?? '').trim();
  const pin = body.pin ?? '';
  if (!username || !pin) {
    return jsonResponse({ error: 'missing_credentials' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // ── PIN serverseitig prüfen — verlässt diese Funktion nie ──────────────
  const { data: superAdminRow, error: lookupError } = await supabaseAdmin
    .from('super_admins')
    .select('id, username, name, pin')
    .eq('username', username)
    .maybeSingle();

  if (lookupError) {
    return jsonResponse({ error: 'lookup_failed', details: lookupError.message }, 500);
  }
  if (!superAdminRow || superAdminRow.pin !== pin) {
    return jsonResponse(GENERIC_ERROR, 401);
  }

  const token = generateOpaqueToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const { error: insertError } = await supabaseAdmin
    .from('super_admin_pin_sessions')
    .insert({
      super_admin_id: superAdminRow.id,
      token_hash: tokenHash,
      expires_at: expiresAt
    });

  if (insertError) {
    return jsonResponse({ error: 'session_create_failed', details: insertError.message }, 500);
  }

  return jsonResponse({
    success: true,
    superAdmin: {
      id: superAdminRow.id,
      username: superAdminRow.username,
      name: superAdminRow.name
    },
    token,
    expiresAt
  }, 200);
});
