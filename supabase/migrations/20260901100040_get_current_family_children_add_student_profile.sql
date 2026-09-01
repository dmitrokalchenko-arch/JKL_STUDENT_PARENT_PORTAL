-- Erweitert get_current_family_children() (migration 20260720120010) um
-- Basis-Student-Profile-Felder aus public.students (JCL_Gruppen, FREMDE
-- Tabelle — hier weder erstellt noch verändert), aufgelöst über LEFT JOIN
-- auf public.groups/public.sports für Anzeigenamen. Bewusst NUR Block-1-
-- Basisdaten (siehe architecture memory "Family Portal: два источника
-- данных", 2026-08-31/09-01) — KEINE Trainer-generierten Daten (Techniken,
-- Fortschritt, Prüfungsvorbereitung) hier oder in Zukunft. Dieses RPC bleibt
-- bewusst schmal; Trainer-Daten bekommen einen eigenen RPC/Service-Layer,
-- verknüpft nur über student_id.
--
-- TYPEN BESTÄTIGT (read-only production catalog check, 2026-08-31/09-01,
-- kein Docker-basierter lokaler Testlauf möglich — Docker-Daemon in dieser
-- Session nicht erreichbar, siehe frühere Versuche): students.geburtsdatum
-- date, alter integer, geschlecht text, gruppe_id text, sport_id text,
-- guertelfarbe text, kyu_grad text, vertrag_status text, vertrag_datum
-- date. groups.gruppe_id und sports.sport_id sind GLOBAL UNIQUE (nicht
-- club-skopiert, bestätigt über pg_constraint) — LEFT JOIN daher nur auf
-- die einzelne ID-Spalte, kein zusätzliches club_id-Prädikat nötig.
--
-- LEFT JOIN (nicht JOIN) auf groups/sports: ein Schüler ohne (noch)
-- zugewiesene Gruppe/Sportart (sport_id/gruppe_id NULL, oder verwaister
-- Verweis) darf den gesamten Datensatz nicht zum Verschwinden bringen —
-- die neuen Spalten sind dann einfach NULL, das Frontend blendet sie schon
-- heute korrekt aus (siehe StudentProfileCard: "nur rendern wenn vorhanden").
--
-- RETURNS TABLE ändert sich (neue Output-Spalten) — CREATE OR REPLACE
-- FUNCTION erlaubt das bei RETURNS TABLE nicht (Postgres: "cannot change
-- return type of existing function"), deshalb DROP + CREATE statt REPLACE,
-- exakt das gleiche Prinzip wie migration 20260807110037 für
-- log_family_account_operation.
drop function if exists public.get_current_family_children();

create function public.get_current_family_children()
returns table (
  family_id uuid,
  family_display_name text,
  student_id text,
  student_first_name text,
  student_last_name text,
  club_id text,
  student_birthdate date,
  student_age integer,
  student_gender text,
  sport_id text,
  sport_name text,
  gruppe_id text,
  group_name text,
  training_day text,
  training_time text,
  belt_color text,
  kyu_grade text,
  contract_status text,
  contract_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id as family_id,
    f.display_name as family_display_name,
    s.id::text as student_id,
    s.vorname as student_first_name,
    s.nachname as student_last_name,
    fs.club_id as club_id,
    s.geburtsdatum as student_birthdate,
    s.alter as student_age,
    s.geschlecht as student_gender,
    s.sport_id as sport_id,
    sp.name as sport_name,
    s.gruppe_id as gruppe_id,
    gr.gruppenname as group_name,
    gr.trainingstag as training_day,
    gr.trainingszeit as training_time,
    s.guertelfarbe as belt_color,
    s.kyu_grad as kyu_grade,
    s.vertrag_status as contract_status,
    s.vertrag_datum as contract_date
  from public.family_guardians fg
  join public.family_students fs
    on fs.family_id = fg.family_id
   and fs.status = 'active'
  join public.families f
    on f.id = fg.family_id
  join public.students s
    on s.id = fs.student_id
  left join public.sports sp
    on sp.sport_id = s.sport_id
  left join public.groups gr
    on gr.gruppe_id = s.gruppe_id
  where fg.auth_user_id = (select auth.uid())
  order by fs.linked_at asc, s.id asc;
$$;

comment on function public.get_current_family_children() is
  'SECURITY DEFINER: Familie + aktive Kinder des aktuellen auth.uid() (ohne Parameter — student_id/family_id-Vortäuschung strukturell unmöglich). student_id als text (bigint-Präzisionsschutz, siehe ursprünglicher Kommentar). Enthält NUR Block-1-Basis-Student-Profile (students/groups/sports) — Trainer-generierte Daten (Techniken, Fortschritt, Prüfung) gehören NICHT hierher, siehe architecture memory. leere children = keine Kinder verknüpft, kein Fehler.';

revoke all on function public.get_current_family_children() from public;
revoke all on function public.get_current_family_children() from anon;
grant execute on function public.get_current_family_children() to authenticated;
