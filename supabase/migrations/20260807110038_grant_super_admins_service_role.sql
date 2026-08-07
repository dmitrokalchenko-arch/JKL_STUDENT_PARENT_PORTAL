-- Gefunden durch tatsächlichen lokalen Testlauf (nicht vermutet): sowohl
-- super-admin-pin-login als auch manage-family-account (PIN-Session-Zweig)
-- lesen jetzt DIREKT public.super_admins (FREMDE Tabelle, JCL_Gruppen) über
-- service_role — vorher tat das keine Edge Function dieses Projekts direkt
-- (der Auth-Zweig über super_admin_accounts brauchte das nicht).
--
-- Gleiches, bereits dokumentiertes Muster wie migration 20260806100034
-- (families/family_guardians/family_students) und der lokale
-- Test-Stand-Fund zu trainers/clubs (siehe
-- .local-supabase-test/supabase/migrations/20260721000000_local_baseline_service_role_grants.sql,
-- dort als reines Lokal-Artefakt dokumentiert). Dieser Grant hier ist jedoch
-- KEIN reines Lokal-Artefakt — er wird von echtem Produktionscode gebraucht,
-- daher als normale Migration in der Haupt-Migrationskette (nicht nur im
-- Test-Stand).
grant select on public.super_admins to service_role;

-- public.super_admin_pin_sessions — eigene neue Tabelle dieses Portals
-- (migration 20260807110036), direkt per PostgREST-Client angesprochen
-- (INSERT beim Login, SELECT/UPDATE bei jeder privilegierten Anfrage,
-- UPDATE beim Logout) — RLS ist aktiviert, ersetzt aber wie oben erläutert
-- nicht das Basisrecht.
grant select, insert, update on public.super_admin_pin_sessions to service_role;
