-- Admin PIN Session — server-seitig verifizierbare Kurzzeit-Sitzung für
-- gewöhnliche Club-Administratoren (public.trainers.rolle = 'Admin'), die
-- sich über den bestehenden Username+PIN-Weg anmelden.
--
-- BEWUSST UNABHÄNGIG vom Family-/Super-Admin-Layer (migrations 001-010,
-- 027-038 existieren in production NICHT — siehe Audit-Bericht dieser
-- Sitzung). Diese Migration hängt AUSSCHLIESSLICH von bereits in production
-- vorhandenen Objekten ab: public.trainers, public.trainer_accounts,
-- public.clubs, public.trainer_account_audit_log, public.family_club_exists()
-- (letztere gehört zwar zur family_layer-Datei migration 001, ist aber eine
-- reine, tabellenlose Utility-Funktion, bereits an service_role vergeben
-- und bereits produktiv genutzt von trainer_accounts, migration 011/021 —
-- keine neue Abhängigkeit, siehe Audit).
--
-- Gleiches Muster wie super_admin_pin_sessions (migration 20260807110036),
-- aber mit einem echten FOREIGN KEY auf trainers(id) — dessen Typ ist durch
-- reale Diagnostik bestätigt (im Unterschied zu super_admins.id).

create table public.admin_pin_sessions (
  id uuid primary key default gen_random_uuid(),
  trainer_row_id bigint not null references public.trainers(id) on delete restrict,
  club_id text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

comment on table public.admin_pin_sessions is
  'Kurzzeit-Sitzungen für Club-Administratoren (trainers.rolle=''Admin''), die über den Legacy-PIN-Weg angemeldet sind. Einziger Zugriffsweg: Edge Functions admin-pin-login/admin-pin-logout und die Bearer-Token-Prüfung in manage-trainer-account (service_role). Nur der SHA-256-Hash des Tokens wird gespeichert, niemals der PIN oder das Klartext-Token.';
comment on column public.admin_pin_sessions.trainer_row_id is
  'FOREIGN KEY auf trainers(id) — Typ bigint durch reale Produktions-Diagnostik bestätigt (Trainer Auth, Etappe 2.2), im Unterschied zu super_admins.id.';
comment on column public.admin_pin_sessions.club_id is
  'Denormalisiert (wie trainer_accounts.club_id) für schnelle Prüfung ohne Join — muss mit trainers.club_id übereinstimmen, siehe Trigger unten.';
comment on column public.admin_pin_sessions.token_hash is
  'SHA-256-Hex-Digest des opaken Session-Tokens. Das Klartext-Token existiert nur einmalig in der Response von admin-pin-login und im sessionStorage des Browsers.';

create index idx_admin_pin_sessions_trainer_row_id on public.admin_pin_sessions(trainer_row_id);
create index idx_admin_pin_sessions_expires_at on public.admin_pin_sessions(expires_at);

-- Belt-and-suspenders, gleiches Prinzip wie enforce_trainer_accounts_club_match
-- (migration 011): club_id muss zum tatsächlichen trainers.club_id passen.
create or replace function public.enforce_admin_pin_sessions_club_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trainer_club text;
begin
  select club_id into v_trainer_club from public.trainers where id = new.trainer_row_id;

  if v_trainer_club is null or new.club_id <> v_trainer_club then
    raise exception 'admin_pin_sessions.club_id must match trainers.club_id for trainer_row_id %', new.trainer_row_id;
  end if;

  return new;
end;
$$;

create trigger trg_admin_pin_sessions_club_match
  before insert or update on public.admin_pin_sessions
  for each row execute function public.enforce_admin_pin_sessions_club_match();

-- RLS enabled, ohne eine einzige Policy — gleiches Prinzip wie
-- trainer_accounts/super_admin_pin_sessions: einziger Zugriffsweg ist
-- service_role innerhalb der Edge Functions.
alter table public.admin_pin_sessions enable row level security;

grant select, insert, update on public.admin_pin_sessions to service_role;

-- resolve_trainer_login_email_by_trainer — schließt den architektonischen
-- Gap (siehe Audit-Bericht dieser Sitzung, ЭТАП 4): baut den technischen
-- Login-Email NICHT aus dem rohen, vom Nutzer eingegebenen Text, sondern aus
-- dem KANONISCHEN trainer_accounts.login_name des bereits per
-- matchTrainerByLogin identifizierten Trainers. Der Client übergibt nur
-- trainer_id+club_id — dieselben, bereits heute vor jedem Login an
-- trainer_has_active_account übergebenen, nicht-geheimen Business-IDs.
-- Wiederverwendet resolve_trainer_login_email (migration 012) für die
-- eigentliche Email-Formel — keine Duplizierung der hex-Formel.
--
-- Anti-Enumeration: liefert NULL, wenn kein trainer_accounts existiert oder
-- der Club nicht existiert/inaktiv ist — exakt dasselbe Fehlerbild wie heute
-- bei resolve_trainer_login_email (der Aufrufer sieht in beiden Fällen nur
-- "Login oder PIN falsch", kein Unterschied für einen Angreifer).
create or replace function public.resolve_trainer_login_email_by_trainer(
  p_trainer_id text,
  p_club_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_login_name text;
  v_club_short_name text;
begin
  select ta.login_name into v_login_name
  from public.trainer_accounts ta
  join public.trainers t on t.id = ta.trainer_row_id
  where t.trainer_id = p_trainer_id
    and t.club_id = p_club_id
  limit 1;

  if v_login_name is null then
    return null;
  end if;

  select club_short_name into v_club_short_name
  from public.clubs
  where club_id = p_club_id
    and active = true;

  if v_club_short_name is null then
    return null;
  end if;

  return public.resolve_trainer_login_email(v_club_short_name, v_login_name);
end;
$$;

comment on function public.resolve_trainer_login_email_by_trainer(text, text) is
  'Baut den technischen Login-Email eines Trainers aus dem KANONISCHEN trainer_accounts.login_name (nicht aus rohem Client-Text) — löst den architektonischen Gap zwischen der toleranten matchTrainerByLogin()-Identifikation im Frontend und der bisher wörtlichen resolve_trainer_login_email(loginText)-Konstruktion. Ändert trainer_accounts.login_name NICHT. anti-enumeration: NULL bei fehlendem Account oder inaktivem/fehlendem Club.';

revoke all on function public.resolve_trainer_login_email_by_trainer(text, text) from public;
grant execute on function public.resolve_trainer_login_email_by_trainer(text, text) to anon, authenticated;

-- trainer_account_audit_log.performed_by_auth_user_id ist NOT NULL
-- (migration 024) — für den PIN-Session-Pfad gibt es kein auth.users.
--
-- VEREINFACHT (nach Rückmeldung des Projektinhabers, siehe Chat-Bericht):
-- performed_by_trainer_row_id ist NULLABLE, KEIN Backfill, KEIN
-- SET NOT NULL. Grund: die Tabelle hat in production nachweislich 0 Zeilen
-- (read-only geprüft) — ein Backfill wäre heute ein No-op, aber verzichtet
-- bewusst auf jede zusätzliche Komplexität/Risiko, die dafür keinen Nutzen
-- hätte. Beide Spalten sind ab jetzt NULLABLE auf DB-Ebene; die Anwendung
-- (log_trainer_account_operation, siehe unten) garantiert weiterhin für
-- JEDEN neuen Aufruf, dass performed_by_trainer_row_id befüllt ist (beide
-- Auth-Wege in manage-trainer-account lösen ihn vor dem Aufruf auf) —
-- performed_by_auth_user_id ist NULL bei PIN-Session, befüllt bei JWT.
alter table public.trainer_account_audit_log
  alter column performed_by_auth_user_id drop not null;

alter table public.trainer_account_audit_log
  add column performed_by_trainer_row_id bigint references public.trainers(id) on delete restrict;

comment on column public.trainer_account_audit_log.performed_by_trainer_row_id is
  'FOREIGN KEY auf trainers(id) des ausführenden Administrators. NULLABLE auf DB-Ebene (kein Backfill nötig — Tabelle hatte 0 Zeilen zum Zeitpunkt dieser Migration), aber von der Anwendung (log_trainer_account_operation) bei jedem neuen Aufruf befüllt, unabhängig vom Auth-Weg.';
comment on column public.trainer_account_audit_log.performed_by_auth_user_id is
  'NULLABLE seit dieser Migration. Weiterhin befüllt bei Autorisierung über Supabase-Auth-JWT. NULL bei Autorisierung über admin_pin_sessions (dafür existiert kein auth.users).';

drop function if exists public.log_trainer_account_operation(uuid, bigint, text, text, text);

create or replace function public.log_trainer_account_operation(
  p_performed_by_trainer_row_id bigint,
  p_performed_by_auth_user_id uuid,
  p_target_trainer_row_id bigint,
  p_target_trainer_id text,
  p_club_id text,
  p_operation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.trainer_account_audit_log (
    performed_by_trainer_row_id, performed_by_auth_user_id,
    target_trainer_row_id, target_trainer_id, club_id, operation
  ) values (
    p_performed_by_trainer_row_id, p_performed_by_auth_user_id,
    p_target_trainer_row_id, p_target_trainer_id, p_club_id, p_operation
  );
end;
$$;

comment on function public.log_trainer_account_operation(bigint, uuid, bigint, text, text, text) is
  'Einziger Weg, in trainer_account_audit_log zu schreiben. Spalte performed_by_trainer_row_id ist auf DB-Ebene NULLABLE, wird aber von manage-trainer-account bei JEDEM Aufruf befüllt (beide Auth-Wege lösen sie vor dem Aufruf auf) — p_performed_by_auth_user_id ist NULL bei Autorisierung über admin_pin_sessions, befüllt bei JWT.';

revoke all on function public.log_trainer_account_operation(bigint, uuid, bigint, text, text, text) from public;
grant execute on function public.log_trainer_account_operation(bigint, uuid, bigint, text, text, text) to service_role;
