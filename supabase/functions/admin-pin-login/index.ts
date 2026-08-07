// Edge Function: server-seitige PIN-Verifizierung für Club-Administrator
// (public.trainers.rolle = 'Admin', FREMDE Tabelle — hier weder erstellt
// noch verändert) — analog zu super-admin-pin-login, aber club-gebunden.
//
// MODELL:
//   1) Client sendet { loginText, pin, clubId } — clubId ist bereits heute
//      vor jedem Login bekannt (Gruppen-/Club-Auswahl im Frontend), keine
//      neue Preisgabe.
//   2) Diese Funktion sucht Admin-Kandidaten in genau diesem club_id
//      (trainers.rolle='Admin', aktiv='JA') und wendet DIESELBE
//      Matching-Logik wie matchTrainerByLogin() im Frontend an (Vorname exakt,
//      Nachname exakt ODER Abkürzung) — server-seitige Kopie, kein Aufruf
//      des Frontend-Codes.
//   3) PIN wird NUR server-seitig (service_role) gegen trainers.pin_hash/
//      pin_salt (PBKDF2-SHA256, 100000 Iterationen, 256 Bit — identisch zu
//      hashPin()/verifyPinHash() in JCL_Gruppen/app.js) oder den
//      Klartext-Fallback trainers.pin geprüft. Der PIN verlässt diese
//      Funktion nie, weder in der Response noch im Log. KEINE
//      Klartext->Hash-Migration hier (die übernimmt weiterhin ausschließlich
//      der bestehende Client-Legacy-Pfad, keine Duplizierung des Schreibpfads).
//   4) Bei Erfolg: zufälliges opakes Token (32 Byte), NUR der SHA-256-Hash
//      wird in admin_pin_sessions gespeichert. expires_at = jetzt + 30 Minuten,
//      fest (keine Verlängerung bei Nutzung — siehe manage-trainer-account).
//
// Anti-Enumeration: bei falschem loginText, falschem PIN, nicht existierendem
// Club ODER Trainer mit Rolle != 'Admin' exakt dieselbe generische
// Fehlermeldung.

import { createClient } from 'npm:@supabase/supabase-js@2';

interface RequestBody {
  loginText?: string;
  pin?: string;
  clubId?: string;
}

interface TrainerCandidate {
  id: number;
  trainer_id: string;
  name: string;
  rolle: string;
  aktiv: string;
  club_id: string;
  pin: string | null;
  pin_hash: string | null;
  pin_salt: string | null;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 Minuten, fest.
const GENERIC_ERROR = { error: 'invalid_credentials' };

// CORS — Kong/Cloudflare-Gateway fügt für Edge Functions dieses Projekts
// keine CORS-Header automatisch hinzu (im Unterschied zum lokalen
// Docker-Edge-Runtime, siehe Diagnose dieser Session): ohne explizite
// OPTIONS-Behandlung und Header auf JEDER Antwort blockiert der Browser
// jeden Cross-Origin-Aufruf von JCL_Gruppen (jcl-gruppen.netlify.app) schon
// beim Preflight, bevor der eigentliche POST je den Server erreicht.
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

function generateOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Portierung von matchTrainerByLogin() (JCL_Gruppen/app.js) — server-seitig,
// keine Logik-Änderung: Vorname exakt, Nachname exakt ODER Anfangsbuchstabe.
function matchTrainerByLogin(loginText: string, candidates: TrainerCandidate[]): TrainerCandidate | null {
  const parts = loginText.trim().split(/\s+/);
  if (parts.length < 2) return null;

  const inputVorname = parts[0].toLowerCase();
  const inputNachPart = parts.slice(1).join(' ').toLowerCase();

  return (
    candidates.find((t) => {
      const np = String(t.name || '').trim().split(/\s+/);
      if (np.length < 2) return false;
      const dbNach = np[0].toLowerCase();
      const dbVor = np.slice(1).join(' ').toLowerCase();
      if (dbVor !== inputVorname) return false;
      if (inputNachPart.length === 1) return dbNach.startsWith(inputNachPart);
      return dbNach === inputNachPart;
    }) ?? null
  );
}

// Portierung von hashPin()/verifyPinHash() (JCL_Gruppen/app.js) — identischer
// Algorithmus (PBKDF2-SHA256, 100000 Iterationen, 256 Bit, Hex-Salt).
async function verifyPinHash(inputPin: string, storedHash: string, storedSalt: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(inputPin), 'PBKDF2', false, ['deriveBits']);
    const saltHexPairs = storedSalt.match(/.{2}/g);
    if (!saltHexPairs) return false;
    const saltBytes = new Uint8Array(saltHexPairs.map((h) => parseInt(h, 16)));
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const computedHash = Array.from(new Uint8Array(bits))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return computedHash === storedHash;
  } catch {
    return false;
  }
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

  const loginText = (body.loginText ?? '').trim();
  const pin = body.pin ?? '';
  const clubId = (body.clubId ?? '').trim();
  if (!loginText || !pin || !clubId) {
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

  // ── Admin-Kandidaten NUR in diesem club_id, NUR rolle='Admin' ───────────
  const { data: candidates, error: candidatesError } = await supabaseAdmin
    .from('trainers')
    .select('id, trainer_id, name, rolle, aktiv, club_id, pin, pin_hash, pin_salt')
    .eq('club_id', clubId)
    .eq('aktiv', 'JA')
    .eq('rolle', 'Admin');

  if (candidatesError) {
    return jsonResponse({ error: 'lookup_failed', details: candidatesError.message }, 500);
  }

  const trainer = matchTrainerByLogin(loginText, (candidates ?? []) as TrainerCandidate[]);
  if (!trainer) {
    return jsonResponse(GENERIC_ERROR, 401);
  }

  // ── PIN serverseitig prüfen — verlässt diese Funktion nie ──────────────
  let pinOk = false;
  if (trainer.pin_hash && trainer.pin_salt) {
    pinOk = await verifyPinHash(pin, trainer.pin_hash, trainer.pin_salt);
  } else if (trainer.pin) {
    pinOk = String(trainer.pin) === pin;
  }
  if (!pinOk) {
    return jsonResponse(GENERIC_ERROR, 401);
  }

  const token = generateOpaqueToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const { error: insertError } = await supabaseAdmin
    .from('admin_pin_sessions')
    .insert({
      trainer_row_id: trainer.id,
      club_id: clubId,
      token_hash: tokenHash,
      expires_at: expiresAt
    });

  if (insertError) {
    return jsonResponse({ error: 'session_create_failed', details: insertError.message }, 500);
  }

  return jsonResponse({
    success: true,
    admin: {
      trainerId: trainer.trainer_id,
      displayName: trainer.name
    },
    token,
    expiresAt
  }, 200);
});
