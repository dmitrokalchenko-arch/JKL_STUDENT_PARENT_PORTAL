-- STUDENT PAGE SUBSCRIPTION — Phase 4 backend foundation ("Familienkonto
-- kann mehrere Kinder haben"). Read-only Aufzählung der Kinder eines
-- Familienkontos für Super Admin + Erweiterung des bestehenden Audit-Logs
-- um eine neue erlaubte operation ('add_child', siehe Migration unten und
-- manage-family-account/index.ts).
--
-- KONTEXT (Audit vor dieser Migration, read-only, siehe Sitzungsverlauf):
--   - families/family_guardians/family_students existieren bereits
--     (Migration 20260720120001) und erlauben STRUKTURELL schon mehrere
--     family_students-Zeilen mit demselben family_id — unique(family_id,
--     student_id) ist ein Paar-Constraint, KEIN unique(family_id).
--   - student_page_access.student_id ist bereits alleiniger PRIMARY KEY
--     (Migration 20260919100064) — komplett unabhängig von Familien.
--     KEINE Änderung an dieser Tabelle/ihrem Resolver in dieser Migration.
--   - Die einzige fehlende Fähigkeit: Super Admin kann bisher NICHT alle
--     Kinder EINES bereits geöffneten Familienkontos auflisten.
--     get_current_family_children() existiert bereits, ist aber an
--     auth.uid() der Familie selbst gebunden (Family Portal Self-Service)
--     und für service_role weder gegrantet noch (auth.uid() wäre NULL)
--     funktional nutzbar — hier bewusst NICHT verändert.
--
-- BEKANNTE, VORBESTEHENDE EINSCHRÄNKUNG (dokumentiert, nicht durch diese
-- Migration verursacht, siehe FAMILY_ACCOUNT_DATA_MODEL_DRAFT.md Abschnitt
-- family_students: bis zu 2 AKTIVE Familien pro Schüler sind ABSICHTLICH
-- erlaubt, z.B. getrennt lebende Eltern mit je eigenem Account. Die
-- BESTEHENDE studentId->family-Auflösung in manage-family-account
-- (.eq('student_id', studentId).eq('status','active').maybeSingle())
-- schlägt bei 2 aktiven Treffern mit einem Fehler fehl (PostgREST liefert
-- bei >1 Zeile einen Fehler statt einer Zeile) — dieselbe Auflösung wird
-- unverändert für die neuen Aktionen unten wiederverwendet (keine neue
-- Auswahlregel erfunden). Aktuell (read-only geprüft) hat KEIN Schüler in
-- Production 2 aktive Familien — betrifft daher heute niemanden, bleibt
-- aber ein offener Punkt für eine spätere, separate Entscheidung, BEVOR
-- diese Funktion für einen real betroffenen Schüler benutzt wird.

-- ══════════════════════════════════════════════════════════════════════
-- get_family_students(p_family_id uuid) — analog zu get_student_page_access:
-- reine, "dumme" SECURITY DEFINER Funktion, vertraut vollständig dem
-- Aufrufer (service_role) bzgl. p_family_id — keine eigene Zugriffsprüfung
-- hier, die erfolgt VOR dem Aufruf in manage-family-account (dieselbe
-- bereits etablierte studentId->family_id-Auflösung, niemals ein vom
-- Client gelieferter family_id-Wert).
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.get_family_students(p_family_id uuid)
returns table (
  student_id bigint,
  student_first_name text,
  student_last_name text
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    s.id as student_id,
    s.vorname as student_first_name,
    s.nachname as student_last_name
  from public.family_students fs
  join public.students s on s.id = fs.student_id
  where fs.family_id = p_family_id
    and fs.status = 'active'
  order by fs.linked_at asc, s.id asc;
$$;

comment on function public.get_family_students(uuid) is
  'Liste der aktiven Kinder EINES Familienkontos — NUR minimale Identifikationsdaten (student_id/Vorname/Nachname), KEINE Kontaktdaten, KEIN Student-Page-Subscription-Status (der kommt weiterhin unabhängig pro Kind aus get_student_page_access(studentId)). Vertraut p_family_id vollständig (wie get_student_page_access p_student_id vertraut) — Zugriffsprüfung/Auflösung "welche family_id" erfolgt ausschließlich im Aufrufer (manage-family-account), niemals ein vom Client gelieferter family_id-Wert. EXECUTE ausschließlich service_role.';

revoke all on function public.get_family_students(uuid) from public;
revoke all on function public.get_family_students(uuid) from anon;
revoke all on function public.get_family_students(uuid) from authenticated;
grant execute on function public.get_family_students(uuid) to service_role;

-- ══════════════════════════════════════════════════════════════════════
-- family_account_audit_log.operation — 'add_child' als neuen erlaubten
-- Wert hinzufügen (gleiches Muster wie Migration
-- 20260807090035_family_account_audit_log_add_set_contact_email.sql, die
-- 'set_contact_email' auf dieselbe Weise ergänzt hat — Constraint-Name war
-- nie explizit gesetzt, Standard-Postgres-Name <table>_<column>_check).
-- ══════════════════════════════════════════════════════════════════════
alter table public.family_account_audit_log
  drop constraint family_account_audit_log_operation_check;

alter table public.family_account_audit_log
  add constraint family_account_audit_log_operation_check
  check (operation in (
    'create', 'link_existing', 'set_login', 'set_contact_email', 'set_password',
    'activate', 'deactivate', 'send_recovery', 'add_child'
  ));
