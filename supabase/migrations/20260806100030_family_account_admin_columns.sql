-- Familienzugänge-Verwaltung (JCL_Gruppen Super Admin): фактический
-- "настоящий контактный email" семьи для восстановления пароля отсутствовал
-- в схеме вообще (только UI-макет/mock, см. аудит) — добавляется здесь.
-- НЕ путать с families.nickname/technical email (@internal.jkl) — тот
-- используется только для входа, никогда для писем реальным людям.
--
-- credentials_updated_at на family_guardians — "дата последней смены
-- учётных данных" из требований (login/пароль), обновляется вручную из
-- manage-family-account Edge Function при set_login/set_password (не
-- триггером — момент смены пароля происходит в auth.users через Admin API,
-- вне зоны видимости обычного UPDATE/триггера public.family_guardians).

alter table public.families
  add column contact_email text,
  add column contact_email_updated_at timestamptz;

comment on column public.families.contact_email is
  'Настоящий контактный email семьи (не технический @internal.jkl) — используется ТОЛЬКО для отправки ссылки восстановления пароля Super Admin-ом через manage-family-account. Никогда не используется для входа. NULL = не указан (send_recovery в этом случае не отправляет письмо).';
comment on column public.families.contact_email_updated_at is
  'Момент последнего изменения contact_email Super Admin-ом.';

alter table public.family_guardians
  add column credentials_updated_at timestamptz;

comment on column public.family_guardians.credentials_updated_at is
  'Момент последней смены логина (nickname семьи) или пароля этого guardian Super Admin-ом через manage-family-account. NULL = не менялось с момента создания аккаунта.';
