// Edge Function: reine Server-seitige PIN-Verifikation für Super Admin,
// OHNE jede Nebenwirkung — verwendet für Step-up-Bestätigung vor
// destruktiven Aktionen (aktuell: Club-Delete, siehe saExecuteClubDelete in
// JCL_Gruppen/app.js), wo super-admin-pin-login bewusst NICHT verwendet
// wird: dessen Erfolg mintet immer eine neue 30-Minuten-Session in
// super_admin_pin_sessions — für eine reine Re-Verifikation eines bereits
// eingeloggten Super Admins wäre das eine unnötige, nur durch einen
// nachgelagerten Revoke-Aufruf vermeidbare "orphan session", falls dieser
// Revoke aus Netzwerk-/Servergründen fehlschlägt (siehe PHASE-2-Audit,
// 2026-08-30). Diese Funktion vermeidet das Problem strukturell: sie
// erzeugt niemals eine Session, es gibt daher nichts, das orphan werden
// könnte.
//
// MODELL: Client sendet { username, pin } — kein Bearer-Token nötig
// (analog super-admin-pin-login). Liest public.super_admins NUR über
// service_role (FREMDE Tabelle, hier weder erstellt noch verändert),
// vergleicht PIN server-seitig. Erfolg: { success: true }, sonst NICHTS
// weiter — kein Token, kein expiresAt, keine Identität, kein PIN. Keine
// DB-Schreiboperation in dieser Funktion, überhaupt keine.
//
// Anti-Enumeration: bei falschem Username ODER falschem PIN exakt dieselbe
// generische Fehlermeldung (gleiches Prinzip wie super-admin-pin-login/
// resolve_family_login_email/resolve_trainer_login_email).

import { createClient } from 'npm:@supabase/supabase-js@2';

interface RequestBody {
  username?: string;
  pin?: string;
}

const GENERIC_ERROR = { error: 'invalid_credentials' };

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://jcl-gruppen.netlify.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

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

  // ── PIN serverseitig prüfen — verlässt diese Funktion nie. Nur die für
  // den Vergleich nötigen Spalten, keine überflüssigen Daten nach außen. ──
  const { data: superAdminRow, error: lookupError } = await supabaseAdmin
    .from('super_admins')
    .select('pin')
    .eq('username', username)
    .maybeSingle();

  if (lookupError) {
    // Keine internen DB-Fehlerdetails an den Client — anders als
    // super-admin-pin-login (dort bewusst mit `details` für Diagnose),
    // hier bewusst minimal gehalten (siehe Audit, Punkt 2).
    return jsonResponse({ error: 'verification_failed' }, 500);
  }
  if (!superAdminRow || superAdminRow.pin !== pin) {
    return jsonResponse(GENERIC_ERROR, 401);
  }

  return jsonResponse({ success: true }, 200);
});
