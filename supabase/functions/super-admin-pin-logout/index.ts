// Edge Function: widerruft eine Super Admin PIN Session
// (super_admin_pin_sessions, siehe super-admin-pin-login).
//
// Best effort, idempotent: egal ob das Token existiert, bereits abgelaufen
// oder bereits widerrufen ist — die Antwort ist immer { revoked: true }, um
// keine Information über die Existenz eines Tokens preiszugeben (dieselbe
// Anti-Enumeration-Haltung wie beim Login). Der Client räumt sessionStorage
// unabhängig vom Ergebnis dieses Aufrufs auf (siehe superAdminLogout in
// JCL_Gruppen/app.js) — dieser Aufruf ist reine serverseitige Hygiene.

import { createClient } from 'npm:@supabase/supabase-js@2';

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

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    // Kein Token angegeben — nichts zu widerrufen, trotzdem idempotent "ok".
    return jsonResponse({ revoked: true }, 200);
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return jsonResponse({ revoked: true }, 200);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const tokenHash = await sha256Hex(token);

  await supabaseAdmin
    .from('super_admin_pin_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .is('revoked_at', null);

  return jsonResponse({ revoked: true }, 200);
});
