-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION.
--
-- НАЗНАЧЕНИЕ: одна club-wide строка на клуб — JSONB-конфигурация
-- видимости полей/секций/навигации Universal Student Page (см. итоговый
-- отчёт задачи "student-profile-club-wide-config" и
-- src/config/studentPageConfig.js — канонический DEFAULT_STUDENT_PAGE_CONFIG
-- и mergeStudentPageConfig() на фронтенде). Это ЧИСТО display-конфигурация
-- (какие поля/блоки показывать) — НЕ персональные данные ученика, НЕ
-- расширение доступа к students.
--
-- ПОЧЕМУ НОВАЯ ТАБЛИЦА, А НЕ СУЩЕСТВУЮЩАЯ: аудит задачи
-- "student-profile-club-wide-config" проверил promo_settings (club-wide,
-- но про промо-экран, другая форма) и tw_trainer_settings (per-trainer
-- биллинг, Trainer_Workspace) — обе структурно непригодны. Единственный
-- реальный прецедент club-wide-конфигурации с похожей формой —
-- club_technique_program_settings (миграция 20260913120053) — САМА ЕЩЁ НЕ
-- применена к production (подтверждено прямым запросом к живой схеме),
-- так что переиспользовать нечего — это первая реально применяемая
-- club-wide settings-таблица в проекте, шаблон её RLS/grants ниже намеренно
-- копирует тот же безопасный паттерн.
--
-- CLUB ISOLATION: club_id — text, БЕЗ hard FK на clubs.club_id (тот же
-- принцип и та же причина, что в club_technique_program_settings:
-- clubs.club_id не подтверждён UNIQUE) — вместо FK: family_club_exists()
-- в trigger-проверке при insert/update, тот же переиспользуемый helper,
-- что уже используют club_technique_program_settings/club_required_techniques.
-- Ни один RPC ниже НЕ принимает club_id от клиента как доверенный параметр
-- — он всегда резолвится СЕРВЕРНО из auth.uid() (Family — через
-- family_guardians/family_students/families, Trainer — через
-- trainer_accounts), тот же принцип, что get_current_family_children()/
-- get_current_trainer_write_context(). Super Admin Preview
-- (get-student-preview, service_role) читает таблицу НАПРЯМУЮ по уже
-- провалидированному claimed.club_id — тот же паттерн, что уже применяет
-- эта функция для students/sports/groups.
--
-- WRITE ACCESS: только save_trainer_student_page_config(jsonb) — требует
-- РОВНО ОДИН активный trainer_accounts.is_active=true для auth.uid()
-- (fail-closed при v_match_count<>1, тот же принцип, что
-- get_current_trainer_write_context) — Family физически не может вызвать
-- эту функцию с успехом (у неё нет строки в trainer_accounts), тренер
-- другого клуба не может повлиять на club_id, отличный от своего
-- собственного (club_id никогда не берётся из параметра).
--
-- Формат самого config (jsonb) НЕ валидируется на уровне схемы (та же
-- конвенция, что clubs.custom_css jsonb) — потребители на фронтенде
-- (mergeStudentPageConfig) уже устойчивы к отсутствующим/лишним/
-- некорректным ключам, безопасные defaults не теряются.

create table if not exists public.club_student_page_settings (
  club_id text primary key,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.club_student_page_settings is
  'Одна (опциональная) JSONB-конфигурация видимости Universal Student Page на клуб. Отсутствие строки = клуб ещё не сохранял конфигурацию — фронтенд обязан откатиться на DEFAULT_STUDENT_PAGE_CONFIG (src/config/studentPageConfig.js), а не показывать пустую/выключенную страницу.';
comment on column public.club_student_page_settings.config is
  'Форма: {profileFields:{...}, sections:{...}, navigation:{...}} — см. mergeStudentPageConfig() на фронтенде. НЕ валидируется на уровне БД, потребители устойчивы к частичным/лишним ключам.';

create trigger trg_club_student_page_settings_set_updated_at
  before update on public.club_student_page_settings
  for each row execute function public.set_updated_at();

create or replace function public.enforce_club_student_page_settings_club_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.family_club_exists(new.club_id) then
    raise exception 'club_student_page_settings.club_id % does not exist in clubs.club_id', new.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_club_student_page_settings_club_exists
  before insert or update on public.club_student_page_settings
  for each row execute function public.enforce_club_student_page_settings_club_exists();

-- RLS: включён, НИ ОДНОЙ policy для anon/authenticated — единственные
-- потребители: три SECURITY DEFINER функции ниже (обходят RLS штатно, как
-- владелец таблицы) и get-student-preview (service_role). Прямой доступ к
-- таблице с client-ролей закрыт полностью — тот же принцип, что уже
-- задокументирован для club_technique_program_settings/club_required_techniques.
alter table public.club_student_page_settings enable row level security;

revoke all privileges on table public.club_student_page_settings from anon;
revoke all privileges on table public.club_student_page_settings from authenticated;
revoke all privileges on table public.club_student_page_settings from public;

grant select on table public.club_student_page_settings to service_role;

-- ── READ: Family ────────────────────────────────────────────────────────
-- club_id резолвится из auth.uid() ТЕМ ЖЕ путём, что get_current_family_children()
-- (family_guardians -> family_students(status='active') -> families(status='active')),
-- берётся club_id первой (по linked_at) активной привязки — семья в этой
-- схеме всегда обслуживается ровно одним клубом (family_students.club_id
-- одинаков для всех детей одной семьи по построению этой схемы). Нет
-- активной привязки -> null (анти-enumeration: неотличимо от "клуб не
-- сохранил конфигурацию" на фронтенде, оба ведут к safe defaults).
create or replace function public.get_family_student_page_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_club_id text;
  v_config jsonb;
begin
  select fs.club_id
    into v_club_id
  from public.family_guardians fg
  join public.family_students fs
    on fs.family_id = fg.family_id
   and fs.status = 'active'
  join public.families f
    on f.id = fg.family_id
   and f.status = 'active'
  where fg.auth_user_id = (select auth.uid())
  order by fs.linked_at asc
  limit 1;

  if v_club_id is null then
    return null;
  end if;

  select csps.config
    into v_config
  from public.club_student_page_settings csps
  where csps.club_id = v_club_id;

  return v_config;
end;
$$;

-- ── READ: Trainer ────────────────────────────────────────────────────────
-- club_id резолвится ТЕМ ЖЕ fail-closed способом, что get_current_trainer_write_context()
-- (ровно один активный trainer_accounts, иначе exception на дубликат/null
-- на отсутствие). Используется и в /trainer/settings (для загрузки уже
-- сохранённого черновика), и в /trainer/student/:id (для реальной
-- Student Page текущего тренера).
create or replace function public.get_trainer_student_page_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_club_id text;
  v_match_count integer;
begin
  select count(*)
    into v_match_count
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  if v_match_count = 0 then
    return null;
  end if;

  if v_match_count > 1 then
    raise exception 'Ambiguous active trainer account';
  end if;

  select ta.club_id
    into v_club_id
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  return (
    select csps.config
    from public.club_student_page_settings csps
    where csps.club_id = v_club_id
  );
end;
$$;

-- ── WRITE: Trainer only ───────────────────────────────────────────────────
-- Возвращает false (не exception), если у вызывающего нет ровно одного
-- активного trainer_accounts — Family/любой другой authenticated
-- пользователь получает false, а не строку "успешно сохранено" (никогда
-- не может тайно "не сохраниться, но выглядеть успешно"). club_id — ТОЛЬКО
-- из auth.uid(), p_config — единственный клиентский параметр, сам он
-- никогда не может изменить club_id записи.
create or replace function public.save_trainer_student_page_config(p_config jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id text;
  v_match_count integer;
begin
  select count(*)
    into v_match_count
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  if v_match_count = 0 then
    return false;
  end if;

  if v_match_count > 1 then
    raise exception 'Ambiguous active trainer account';
  end if;

  select ta.club_id
    into v_club_id
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  insert into public.club_student_page_settings (club_id, config, updated_at)
  values (v_club_id, p_config, now())
  on conflict (club_id) do update
    set config = excluded.config,
        updated_at = now();

  return true;
end;
$$;

revoke all on function public.get_family_student_page_config() from public;
revoke all on function public.get_trainer_student_page_config() from public;
revoke all on function public.save_trainer_student_page_config(jsonb) from public;

-- EXECUTE только authenticated (не anon) — та же конвенция, что
-- get_current_family_children/get_current_trainer_write_context/
-- get_trainer_student_by_id: и Family, и Trainer обязаны иметь реальную
-- Supabase Auth сессию, чтобы вызвать любую из трёх функций.
grant execute on function public.get_family_student_page_config() to authenticated;
grant execute on function public.get_trainer_student_page_config() to authenticated;
grant execute on function public.save_trainer_student_page_config(jsonb) to authenticated;
