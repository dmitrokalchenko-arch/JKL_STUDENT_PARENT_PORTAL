-- Super Admin PIN Session — server-seitig verifizierbare Kurzzeit-Sitzung für
-- Super Admins, die sich über den bestehenden Username+PIN-Weg anmelden
-- (JCL_Gruppen.super_admins, FREMDE Tabelle — hier weder erstellt noch
-- verändert).
--
-- WARUM: bisher gab es für den PIN-Weg KEINE serverseitige Sitzung — die
-- Prüfung lief komplett im Browser (_superAdminLoginCore, "Alter PIN-Pfad":
-- select('id, username, name, pin') über den anon-Key, Vergleich in JS).
-- privilegierte Edge Functions (manage-family-account) verlangten deshalb
-- zwingend einen zusätzlichen Supabase-Auth-JWT (super_admin_accounts,
-- migration 20260806100027) — das ist die inzwischen aufgehobene
-- Business-Anforderung ("Legacy PIN-Login ist kein Read-only/Fallback-Modus").
--
-- MODELL: Edge Function super-admin-pin-login prüft PIN serverseitig
-- (service_role, super_admins.pin NIE an den Client), erzeugt bei Erfolg ein
-- zufälliges opakes Token, gibt es EINMALIG im Klartext zurück und speichert
-- hier NUR den SHA-256-Hash. Kein PIN, kein PIN-Hash, kein Klartext-Token
-- wird jemals in dieser Tabelle gespeichert oder geloggt.
--
-- super_admin_id: Wert-FK (kein FOREIGN KEY) auf super_admins.id — gleiches,
-- bereits dokumentiertes Prinzip wie super_admin_accounts.super_admin_id
-- (migration 20260806100027). TYP BESTÄTIGT (sicherer Pre-Deploy-Audit der
-- Family Layer, 2026-08-29): super_admins.id ist uuid, direkt gegen die
-- reale production JCL_Gruppen geprüft — nicht mehr angenommen. Die
-- ursprüngliche Annahme (bigint) war falsch und hätte diese Tabelle
-- strukturell unbenutzbar gemacht (kein uuid-Wert passt in eine
-- bigint-Spalte), obwohl CREATE TABLE selbst anstandslos durchgelaufen wäre.
create table public.super_admin_pin_sessions (
  id uuid primary key default gen_random_uuid(),
  super_admin_id uuid not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

comment on table public.super_admin_pin_sessions is
  'Kurzzeit-Sitzungen für Super Admins, die über den Legacy-PIN-Weg (super_admins.pin, FREMDE Tabelle) angemeldet sind. Einziger Zugriffsweg: Edge Functions super-admin-pin-login/super-admin-pin-logout und die Bearer-Token-Prüfung in manage-family-account (service_role). Nur der SHA-256-Hash des Tokens wird gespeichert, niemals der PIN oder das Klartext-Token. expires_at wird bei Nutzung NICHT verlängert (last_used_at ist rein informativ) — feste Lebensdauer ab Ausstellung, siehe super-admin-pin-login.';

comment on column public.super_admin_pin_sessions.super_admin_id is
  'Wert-FK (kein FOREIGN KEY — nicht weil der Typ unklar wäre, uuid ist bestätigt, sondern weil super_admins eine fremde Tabelle ohne von diesem Projekt garantiertes UNIQUE auf id ist) auf JCL_Gruppen.super_admins.id (uuid).';
comment on column public.super_admin_pin_sessions.token_hash is
  'SHA-256-Hex-Digest des opaken Session-Tokens. Das Klartext-Token existiert nur einmalig in der Response von super-admin-pin-login und im sessionStorage des Browsers — nie in der Datenbank oder in Logs.';
comment on column public.super_admin_pin_sessions.revoked_at is
  'Gesetzt durch super-admin-pin-logout (best effort). Ein revoked Token ist sofort ungültig, unabhängig von expires_at.';

create index idx_super_admin_pin_sessions_super_admin_id on public.super_admin_pin_sessions(super_admin_id);
-- Beschleunigt die periodische Bereinigung abgelaufener Sitzungen (kein Trigger/Cron in diesem MVP — siehe technische Notiz).
create index idx_super_admin_pin_sessions_expires_at on public.super_admin_pin_sessions(expires_at);

-- RLS aktiviert, absichtlich ohne eine einzige Policy — gleiches Prinzip wie
-- super_admin_accounts/family_account_audit_log: der einzige Zugriffsweg ist
-- service_role innerhalb der Edge Functions.
alter table public.super_admin_pin_sessions enable row level security;
