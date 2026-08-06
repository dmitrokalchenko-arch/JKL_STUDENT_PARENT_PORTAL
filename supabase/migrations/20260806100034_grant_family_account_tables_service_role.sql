-- Grants für service_role auf Basistabellen, die manage-family-account
-- DIREKT über den PostgREST-Client anspricht (`.from(...)`), nicht über
-- SECURITY DEFINER RPC — RLS filtert nur Zeilen, ersetzt aber nicht das
-- Basisrecht für die Operation (derselbe Grundsatz, der migration 009 für
-- authenticated bereits dokumentiert; hier für service_role, analog zu den
-- lokalen Testbestand-Funden in .local-supabase-test/supabase/migrations/
-- 00000000000003/00000000000004).
--
-- Explizit statt "service_role kann in production ohnehin alles" — dieselbe
-- Lehre wie migrations 020-023 (revoke all from public wirkt AUCH auf
-- service_role, nicht nur auf anon/authenticated). Ein bereits vorhandener,
-- äquivalenter impliziter Grant in production macht ein erneutes GRANT
-- folgenlos (kein Fehler, keine Nebenwirkung) — dieses explizite GRANT ist
-- also in jedem Fall sicher, unabhängig davon, was production heute schon
-- hat.
--
-- public.students / public.clubs — fremde Tabellen (JCL_Gruppen), nur
-- gelesen (Zielschüler/Club-Validierung), nie geschrieben.
grant select on public.students to service_role;
grant select on public.clubs to service_role;

-- public.families / family_guardians / family_students — eigene Tabellen
-- dieses Portals, hier erstmals von service_role direkt (nicht nur über
-- create-family-account, die denselben Bedarf hat) beschrieben.
grant select, insert, update on public.families to service_role;
grant select, insert, update on public.family_guardians to service_role;
grant select, insert, update on public.family_students to service_role;

-- public.super_admin_accounts — nur SELECT (Prüfung des Aufrufers). INSERT
-- für den Bootstrap-Schritt (Anlage des ersten Super-Admin-Auth-Kontos) ist
-- bewusst NICHT hier enthalten — dieser Schritt ist kein Teil von
-- manage-family-account und wird separat entschieden (siehe Abschlussbericht).
grant select on public.super_admin_accounts to service_role;
