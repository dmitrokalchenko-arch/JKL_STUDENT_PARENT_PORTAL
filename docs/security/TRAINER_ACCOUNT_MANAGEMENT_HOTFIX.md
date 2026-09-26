# Security hotfix — Trainer Account management temporarily disabled

## Scope

Only `supabase/functions/manage-trainer-account/index.ts`.

Not changed: database schema, migrations, RLS/policies, grants, data,
`admin-pin-login`, `admin-pin-logout`, other Edge Functions, Trainer Portal
frontend, Family Portal, JCL_Gruppen, legacy `public.trainers` /
`public.students`, `portal_role` (does not exist yet).

## Reason

`manage-trainer-account` authorizes an administrator either by a Portal JWT
combined with legacy `trainers.rolle = 'Admin'` (path A) or by an Admin PIN
session whose trust is derived from legacy `public.trainers` data (path B).
A read-only production precheck showed that legacy `public.trainers` is not a
trustworthy authorization source, so neither path may authorize Trainer
Portal Account management (create, activate/deactivate, rename, password
change).

## Exact behavior after the hotfix

| Request | Response |
|---|---|
| `OPTIONS` (CORS preflight) | `204`, unchanged CORS headers |
| any other method / body / token | `403` `{"error":"trainer_account_management_disabled"}` with CORS headers |

The `403` is returned before the request body is parsed, before the
Authorization header is read, before any Supabase client is created and before
any Auth or database access. The remaining function code is unchanged and
temporarily unreachable.

Controlled by the in-code constant `TRAINER_ACCOUNT_MANAGEMENT_DISABLED = true`
(intentionally not an environment variable: re-enabling requires code review).

## Regression expectations

| Workflow | Expected |
|---|---|
| Trainer Portal login (direct and via JCL_Gruppen "Trainer Portal Zugang") | works |
| Trainer dashboard, student search, student page | works |
| Individual Required Techniques (read / save / reset) | works |
| Family Portal | works |
| Super Admin (Familienzugänge, Student Preview) | unchanged |
| JCL_Gruppen ordinary trainer workflows, saving trainers and groups | unchanged |
| JCL_Gruppen legacy Admin PIN login (`admin-pin-login`) | unchanged |
| JCL_Gruppen "Trainerportal-Zugang" (create / update / password) | intentionally unavailable, generic error message |

## Verification checklist (after deployment)

- [ ] Before deploying, note the current `verify_jwt` setting of
      `manage-trainer-account` (Dashboard → Edge Functions → Details) and
      keep it unchanged.
- [ ] `OPTIONS` → `204` with CORS headers.
- [ ] `POST` without `Authorization` → `403 trainer_account_management_disabled`
      (previously `401 missing_bearer_token` — proves the guard runs first).
- [ ] `POST` with an arbitrary Bearer token → same `403`.
- [ ] JCL_Gruppen → trainer form → "Zugang aktualisieren" → generic error;
      browser console shows `trainer_account_management_disabled`.
- [ ] Trainer Portal: login → dashboard → search → student page → Required
      Techniques work.
- [ ] Family Portal login works.
- [ ] Edge Function logs for `manage-trainer-account` show only `403` / `204`.
- [ ] No new rows in `trainer_account_audit_log`; `trainer_accounts` unchanged
      (read-only count / `max(updated_at)` comparison).

Do not perform exploit tests (no changes to `trainers.rolle`, PINs or other
legacy data).

## Rollback warning

Redeploying the previous version of `manage-trainer-account` re-opens the
insecure legacy authorization paths. Roll back only for an unexpected
breakage unrelated to account management (for example CORS or a failed
deployment), and re-apply the hotfix immediately afterwards.

## Re-enabling account management

Only after the protected `trainer_accounts.portal_role` exists and a trusted
Portal Admin has been bootstrapped: authorization must be active
`trainer_accounts` + `portal_role = 'admin'`. Legacy `trainers.rolle` and
Admin PIN sessions must never again authorize Portal Account management.
