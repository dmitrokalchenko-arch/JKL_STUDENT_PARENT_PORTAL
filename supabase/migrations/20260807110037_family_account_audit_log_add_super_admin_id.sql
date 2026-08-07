-- family_account_audit_log muss ab jetzt AUCH Operationen protokollieren
-- können, die über eine Super-Admin-PIN-Session (super_admin_pin_sessions,
-- vorige Migration) autorisiert wurden — dafür gibt es keinen auth.users-
-- Eintrag, also kann performed_by_auth_user_id dort nicht befüllt werden.
--
-- Entscheidung (mit dem Projektinhaber abgestimmt): performed_by_super_admin_id
-- wird die primäre, immer befüllte Actor-Spalte; performed_by_auth_user_id
-- bleibt erhalten, wird aber NULLABLE und beim JWT-Weg (super_admin_accounts)
-- zusätzlich mitgeschrieben — kein Informationsverlust für bereits auf Auth
-- migrierte Super Admins, volle Kompatibilität mit dem PIN-Session-Weg.
--
-- Diese Tabelle wurde in dieser Session neu angelegt (migration
-- 20260806100031) und war zum Zeitpunkt dieser Migration noch nie an
-- Production ausgerollt — ein Backfill-UPDATE wird trotzdem defensiv
-- mitgeliefert, falls in einer lokalen/Test-Umgebung bereits Zeilen über den
-- JWT-Weg entstanden sind.

alter table public.family_account_audit_log
  alter column performed_by_auth_user_id drop not null;

alter table public.family_account_audit_log
  add column performed_by_super_admin_id bigint;

comment on column public.family_account_audit_log.performed_by_super_admin_id is
  'Wert-FK (kein FOREIGN KEY, gleiches Prinzip wie super_admin_accounts.super_admin_id) auf JCL_Gruppen.super_admins.id. Primäre Actor-Spalte, immer befüllt — unabhängig davon, ob die Operation über Supabase-Auth-JWT (super_admin_accounts) oder über eine PIN-Session (super_admin_pin_sessions) autorisiert wurde.';
comment on column public.family_account_audit_log.performed_by_auth_user_id is
  'NULLABLE seit dieser Migration. Weiterhin befüllt, wenn die Operation über einen Supabase-Auth-JWT (super_admin_accounts) autorisiert wurde. NULL bei Autorisierung über eine PIN-Session (super_admin_pin_sessions) — dafür existiert kein auth.users-Eintrag.';

-- Defensiver Backfill für bereits vorhandene Zeilen (z.B. lokaler Testlauf
-- dieser Session) — leitet super_admin_id aus dem bereits bekannten
-- auth_user_id über super_admin_accounts ab.
update public.family_account_audit_log log
set performed_by_super_admin_id = sa.super_admin_id
from public.super_admin_accounts sa
where log.performed_by_auth_user_id = sa.auth_user_id
  and log.performed_by_super_admin_id is null;

alter table public.family_account_audit_log
  alter column performed_by_super_admin_id set not null;

-- log_family_account_operation bekommt einen neuen Parameter
-- (p_performed_by_super_admin_id) — das ist eine andere Signatur, kein
-- CREATE OR REPLACE der alten Funktion (Postgres erlaubt das Hinzufügen
-- eines Pflichtparameters nicht per REPLACE). Alte Signatur wird entfernt,
-- damit nicht zwei Overloads nebeneinander existieren.
drop function if exists public.log_family_account_operation(uuid, uuid, bigint, text, text);

create or replace function public.log_family_account_operation(
  p_performed_by_super_admin_id bigint,
  p_performed_by_auth_user_id uuid,
  p_target_family_id uuid,
  p_target_student_id bigint,
  p_club_id text,
  p_operation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.family_account_audit_log (
    performed_by_super_admin_id, performed_by_auth_user_id,
    target_family_id, target_student_id, club_id, operation
  ) values (
    p_performed_by_super_admin_id, p_performed_by_auth_user_id,
    p_target_family_id, p_target_student_id, p_club_id, p_operation
  );
end;
$$;

comment on function public.log_family_account_operation(bigint, uuid, uuid, bigint, text, text) is
  'Einziger Weg, in family_account_audit_log zu schreiben. p_performed_by_super_admin_id ist immer Pflicht (beide Auth-Wege kennen den Super Admin); p_performed_by_auth_user_id ist NULL bei Autorisierung über eine PIN-Session. Aufgerufen ausschließlich von manage-family-account als service_role.';

revoke all on function public.log_family_account_operation(bigint, uuid, uuid, bigint, text, text) from public;
grant execute on function public.log_family_account_operation(bigint, uuid, uuid, bigint, text, text) to service_role;
