-- Добавляет 'set_contact_email' в допустимые значения
-- family_account_audit_log.operation (migration 031) — новое действие
-- manage-family-account, отдельное от set_login (смена контактного email
-- семьи без обязательной смены nickname).
--
-- Имя constraint не задавалось явно в migration 031 (обычный column-level
-- check в CREATE TABLE) — используется стандартное автоматическое имя
-- Postgres <table>_<column>_check, подтверждённое локальным прогоном
-- (.local-supabase-test) перед применением к production.
alter table public.family_account_audit_log
  drop constraint family_account_audit_log_operation_check;

alter table public.family_account_audit_log
  add constraint family_account_audit_log_operation_check
  check (operation in (
    'create', 'link_existing', 'set_login', 'set_contact_email', 'set_password',
    'activate', 'deactivate', 'send_recovery'
  ));
