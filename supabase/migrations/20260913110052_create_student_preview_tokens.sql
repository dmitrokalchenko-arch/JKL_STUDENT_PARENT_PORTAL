-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION.
--
-- НАЗНАЧЕНИЕ: Super Admin Preview — Super Admin (Block 1, JCL_Gruppen)
-- должен иметь возможность открыть read-only превью Student Page (Block 3)
-- конкретного ученика, НЕЗАВИСИМО от того, активирован ли для него
-- Familienzugang (family_students.status/families.status — активация
-- управляет ТОЛЬКО входом самой семьи, не правом Super Admin смотреть
-- карточку). Никакая family-сессия/пароль семьи при этом не создаётся и не
-- используется (см. create-student-preview-token/get-student-preview).
--
-- Таблица хранит ТОЛЬКО одноразовые opaque-токены (аналогия
-- super_admin_pin_sessions/admin_pin_sessions — тот же принцип: хранится
-- SHA-256 хеш токена, не сам токен). Токен выдаётся
-- create-student-preview-token (требует активного Super Admin, дуальная
-- модель — JWT ИЛИ PIN Session, тот же код проверки, что в
-- manage-family-account) и потребляется РОВНО ОДИН РАЗ
-- get-student-preview (вызывается АНОНИМНО из Block 3 — там нет и не
-- должно быть никакой Supabase-сессии; единственный "пропуск" — сам токен).
--
-- RLS включён БЕЗ единой policy — ни anon, ни authenticated не имеют
-- прямого доступа к этой таблице ни на чтение, ни на запись; единственный
-- вход — service_role внутри двух Edge Functions выше (тот же принцип, что
-- у super_admin_pin_sessions/admin_pin_sessions).
create table if not exists public.student_preview_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  student_id bigint not null references public.students(id) on delete cascade,
  club_id text not null,
  created_by_super_admin_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

comment on table public.student_preview_tokens is
  'Одноразовые короткоживущие (TTL ~5 минут) opaque-токены Super Admin Preview. token_hash — SHA-256(token), сырой токен нигде не хранится. used_at заполняется РОВНО ОДИН РАЗ при первом успешном потреблении get-student-preview — повторное использование того же токена отклоняется. created_by_super_admin_id — значение-FK (без FOREIGN KEY, тот же принцип, что super_admin_accounts.super_admin_id/family_account_audit_log.performed_by_super_admin_id) на JCL_Gruppen.super_admins.id. Строка также служит минимальным audit-следом (кто/когда выдал, когда использован) — отдельная audit-система не создаётся.';

comment on column public.student_preview_tokens.club_id is
  'Денормализовано с students.club_id на момент выдачи токена — belt-and-suspenders проверка в get-student-preview (клуб должен существовать и оставаться активным), тот же принцип, что в manage-family-account.';

create index if not exists idx_student_preview_tokens_student_id on public.student_preview_tokens(student_id);
create index if not exists idx_student_preview_tokens_expires_at on public.student_preview_tokens(expires_at);

alter table public.student_preview_tokens enable row level security;

-- Ни одной policy для anon/authenticated намеренно — доступ только через
-- service_role внутри Edge Functions (create-student-preview-token,
-- get-student-preview), тот же принцип, что super_admin_pin_sessions/
-- admin_pin_sessions.
grant select, insert, update on public.student_preview_tokens to service_role;
