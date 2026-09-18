-- Fügt 'remove_child' zu den erlaubten Werten von
-- family_account_audit_log.operation hinzu — gleiches Muster wie
-- Migration 20260807090035 ('set_contact_email') und die 068-Migration
-- dieses PRs ('add_child'): Constraint-Name war nie explizit gesetzt,
-- Standard-Postgres-Name <table>_<column>_check.
--
-- "Kind entfernen" (manage-family-account, action='remove_family_student')
-- setzt NIE ein Hard-Delete, nur family_students.status
-- 'active' -> 'suspended' — dieser Audit-Eintrag protokolliert genau das,
-- mit dem entfernten Kind als target_student_id (logOperation()-Aufruf
-- mit explizitem targetStudentId-Override, siehe Migration 20260924100069
-- für die Begründung desselben Musters bei 'add_child').
alter table public.family_account_audit_log
  drop constraint family_account_audit_log_operation_check;

alter table public.family_account_audit_log
  add constraint family_account_audit_log_operation_check
  check (operation in (
    'create', 'link_existing', 'set_login', 'set_contact_email', 'set_password',
    'activate', 'deactivate', 'send_recovery', 'add_child', 'remove_child'
  ));
