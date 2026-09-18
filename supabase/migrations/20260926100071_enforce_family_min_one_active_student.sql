-- PRODUKTENTSCHEIDUNG VERFEINERT (2026-09-26): eine bereits existierende
-- Familienkonto darf durch remove_family_student NICHT auf 0 aktive Kinder
-- fallen — Super Admin würde sonst eine "verwaiste" Familie mit gültigem
-- Login, aber ohne erreichbaren Einstiegspunkt (Navigation ist bisher
-- ausschließlich schülerzentriert) zurücklassen.
--
-- ZWEI GETRENNTE INVARIANTEN ab jetzt:
--   A) EIN Schüler -> MAXIMAL EIN aktives Familienkonto (Migration
--      20260924100069, partial unique index — unverändert, hier NICHT
--      angerührt).
--   B) EIN EXISTIERENDES Familienkonto -> MINDESTENS EIN aktiver Schüler
--      (NEU, diese Migration).
--
-- WARUM EIN PARTIAL UNIQUE INDEX HIER NICHT FUNKTIONIERT (anders als bei
-- Invariante A): ein UNIQUE INDEX kann nur "höchstens N" ausdrücken, nie
-- "mindestens N" — es gibt keinen Index-Trick für eine Minimum-Kardinalität.
-- Ein reiner "SELECT COUNT(*) dann UPDATE"-Trigger (egal ob in der Edge
-- Function oder im Trigger selbst) ist NICHT race-frei: zwei GLEICHZEITIGE
-- Transaktionen für ZWEI VERSCHIEDENE Kinder derselben Familie können beide
-- denselben Snapshot (z.B. count=2) sehen, bevor eine von beiden committet —
-- beide bestehen ihre eigene Prüfung, beide suspendieren, die Familie
-- landet bei 0 aktiven Kindern, obwohl jede einzelne Prüfung für sich
-- "korrekt" war (klassisches TOCTOU).
--
-- LÖSUNG: EINE einzige SECURITY DEFINER Funktion, die Prüfung UND Schreiben
-- in EINER Transaktion (= ein einziger Funktionsaufruf) bündelt und VOR der
-- Prüfung per `SELECT ... FOR UPDATE` die Zeile der betroffenen Familie
-- sperrt. Eine zweite, gleichzeitige Transaktion für DIESELBE Familie
-- blockiert an genau dieser Stelle, bis die erste committet oder
-- zurückrollt — und sieht danach garantiert den bereits aktualisierten
-- Stand, bevor sie selbst zählt. Das ist die tatsächliche, vom
-- Datenbankserver erzwungene Serialisierung, keine Anwendungs-Vermutung.
-- Defensiver, NICHT blockierender Hinweis (kein RAISE EXCEPTION): diese
-- Migration erzwingt Invariante B nur PROZEDURAL, für ZUKÜNFTIGE
-- remove_family_student_link-Aufrufe — sie prüft/verändert KEINE
-- bestehende Zeile und braucht deshalb (anders als Migration
-- 20260924100069, die eine bestehende CHECK-Schwelle verschärfte) keinen
-- blockierenden Pre-Flight. Trotzdem: falls bereits jetzt eine Familie mit
-- 0 aktiven Kindern existiert, wird das hier protokolliert (NOTICE), damit
-- es nicht unbemerkt bleibt — read-only vor dieser Migration bestätigt:
-- 0 solcher Familien in Production (siehe Sitzungsverlauf).
do $$
declare
  v_empty_family_count integer;
begin
  select count(*) into v_empty_family_count
  from public.families f
  where not exists (
    select 1 from public.family_students fs
    where fs.family_id = f.id and fs.status = 'active'
  );

  if v_empty_family_count > 0 then
    raise notice 'Hinweis: % bereits existierende Familie(n) haben aktuell 0 aktive Kinder. remove_family_student_link() verhindert das nur für KÜNFTIGE Entfernungen — bestehende leere Familien bleiben unverändert und werden NICHT automatisch bereinigt.', v_empty_family_count;
  end if;
end $$;

create or replace function public.remove_family_student_link(
  p_family_id uuid,
  p_student_id bigint
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_link_id uuid;
  v_active_count integer;
begin
  -- Sperrt genau eine Zeile (die Familie selbst) — serialisiert ALLE
  -- gleichzeitigen remove_family_student_link-Aufrufe für DIESELBE Familie,
  -- unabhängig davon, welches Kind jeweils entfernt werden soll.
  perform 1 from public.families where id = p_family_id for update;

  select id into v_link_id
  from public.family_students
  where family_id = p_family_id
    and student_id = p_student_id
    and status = 'active';

  if v_link_id is null then
    raise exception 'not_active_in_this_family';
  end if;

  select count(*) into v_active_count
  from public.family_students
  where family_id = p_family_id
    and status = 'active';

  if v_active_count <= 1 then
    raise exception 'cannot_remove_last_student';
  end if;

  update public.family_students
  set status = 'suspended'
  where id = v_link_id;
end;
$$;

comment on function public.remove_family_student_link(uuid, bigint) is
  'Einziger sicherer Weg, eine aktive family_students-Verknüpfung zu suspendieren ("Kind entfernen"). Sperrt vorab die families-Zeile (SELECT ... FOR UPDATE) — race-frei gegenüber gleichzeitigen remove-Aufrufen für dieselbe Familie, siehe Migration 20260926100071. Lehnt ab (raise exception, keine Zeilenänderung), wenn p_student_id in dieser Familie nicht aktiv ist ("not_active_in_this_family") oder wenn dies das letzte aktive Kind wäre ("cannot_remove_last_student", Invariante B). Wird ausschließlich von manage-family-account (action=remove_family_student) als service_role aufgerufen; niemals student_page_access berührt.';

revoke all on function public.remove_family_student_link(uuid, bigint) from public;
revoke all on function public.remove_family_student_link(uuid, bigint) from anon;
revoke all on function public.remove_family_student_link(uuid, bigint) from authenticated;
grant execute on function public.remove_family_student_link(uuid, bigint) to service_role;
