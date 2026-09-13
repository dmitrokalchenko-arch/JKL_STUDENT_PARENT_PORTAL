-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION.
--
-- НАЗНАЧЕНИЕ: минимальная club-scoped основа программы техник — bonus
-- requirement и required-техники СВОИ для каждого клуба, ничего не
-- разделяется между клубами. Не seed-ит ни одного клуба данными — только
-- схема, ни одна существующая таблица (students/clubs/judo_techniques/
-- student_technique_records) этой миграцией не меняется и не трогается.
--
-- ПОЧЕМУ НЕ club_technique_progress_settings/club_belt_techniques (старые
-- имена из миграций 20260720120004-007): та схема НИКОГДА не была применена
-- к production (подтверждено живым запросом — PGRST205 "table not found",
-- см. комментарий миграции 20260908120041) и была built вокруг
-- club_techniques/club_belts — club-scoped ДУБЛЯ каталога, который проект
-- позже сознательно заменил единым глобальным judo_techniques. Здесь —
-- новые таблицы, ссылающиеся НАПРЯМУЮ на judo_techniques(id), без
-- дублирования name/category/main_group/image_path/youtube_url — те поля
-- остаются ТОЛЬКО в judo_techniques (единственный источник истины).
--
-- ТЕРМИНОЛОГИЯ: используется public.judo_techniques.main_group напрямую
-- ('Nage-waza'/'Katame-waza') — никакого отдельного сопоставления
-- Tachi-waza/Ne-waza здесь не создаётся (см. отдельную задачу по
-- терминологии в этом же PR).
--
-- MULTI-CLUB: club_id — text (тот же тип и та же конвенция валидности, что
-- students.club_id/trainer_accounts.club_id/student_technique_records.club_id
-- — через public.family_club_exists(), НЕ через hard FK на clubs.club_id,
-- т.к. clubs.club_id не подтверждён UNIQUE, см. миграцию 20260720120001).
-- Настройки клуба A физически не могут быть прочитаны для клуба B — всегда
-- WHERE club_id = <club_id ученика>, определённый СЕРВЕРНО (см.
-- get-student-preview), никогда не передаётся с клиента как доверенный
-- параметр.
--
-- BELT/KYU SCOPE: полноценной нормализованной модели поясов в production
-- нет (students.guertelfarbe/kyu_grad — свободный текст, см.
-- EXISTING_DATABASE_AUDIT.md, раздел 5.1) — строить сейчас отдельную
-- club_belts-таблицу означало бы повторить ту же двусмысленность, что уже
-- была в неприменённой старой схеме. Вместо этого — один nullable
-- belt_key (text, club-scoped свободный идентификатор, НЕ FK) на
-- club_required_techniques: сейчас везде NULL (программа считается единой
-- для клуба, без деления по поясу), но колонка уже существует — будущий
-- Kyu-editor сможет использовать её для программы конкретного пояса без
-- новой миграции/пересоздания таблицы. Read-путь этого шага (см.
-- get-student-preview) читает ТОЛЬКО строки с belt_key IS NULL.

create table if not exists public.club_technique_program_settings (
  club_id text primary key,
  bonus_requirement integer check (bonus_requirement is null or bonus_requirement > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.club_technique_program_settings is
  'Одна (опциональная) запись на клуб. Отсутствие строки ИЛИ bonus_requirement = NULL означает "клуб не настроил программу бонуса" — Super Admin Preview обязан честно показать "не настроено", а НЕ подставлять число. НЕ заполняется этой миграцией ни для одного клуба.';
comment on column public.club_technique_program_settings.bonus_requirement is
  'NULL = бонус не настроен для этого клуба (валидное, ожидаемое состояние, не ошибка). > 0, если задано.';

create table if not exists public.club_required_techniques (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  technique_id uuid not null references public.judo_techniques(id) on delete restrict,
  belt_key text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.club_required_techniques is
  'Требуемые техники конкретного клуба. Ссылается ТОЛЬКО на technique_id (public.judo_techniques) — name/category/main_group/image_path/youtube_url НИКОГДА не копируются сюда, тот же принцип, что уже применён в student_technique_records (миграция 20260908130043). Наличие строки = техника требуется этому клубу; отдельного is_required не существует — тот же принцип "наличие строки = факт", что и в student_technique_records/student_technique_progress. belt_key зарезервирован под будущее деление по поясу — на этом этапе везде NULL, read-путь фильтрует по belt_key IS NULL.';
comment on column public.club_required_techniques.technique_id is
  'FOREIGN KEY на public.judo_techniques(id) — main_group (Nage-waza/Katame-waza) для группировки берётся оттуда через JOIN, не хранится здесь повторно.';
comment on column public.club_required_techniques.belt_key is
  'Свободный club-scoped идентификатор пояса/программы, НЕ FK (нормализованной таблицы поясов в production нет, см. комментарий в шапке файла). NULL = единая программа клуба без деления по поясу — именно это значение читает get-student-preview на этом этапе.';

-- Дубликат (club_id, technique_id, belt_key) не должен быть возможен —
-- отдельные partial-индексы для NULL/NOT NULL belt_key, т.к. обычный
-- UNIQUE(a,b,c) считает каждую строку с NULL в c отдельной (не ловит
-- дубликаты, когда belt_key IS NULL — а это единственный сценарий, который
-- реально используется на этом этапе).
create unique index if not exists club_required_techniques_no_belt_uidx
  on public.club_required_techniques(club_id, technique_id)
  where belt_key is null;
create unique index if not exists club_required_techniques_belt_uidx
  on public.club_required_techniques(club_id, technique_id, belt_key)
  where belt_key is not null;

create index if not exists idx_club_required_techniques_club_id
  on public.club_required_techniques(club_id);
create index if not exists idx_club_required_techniques_technique_id
  on public.club_required_techniques(technique_id);

create trigger trg_club_technique_program_settings_set_updated_at
  before update on public.club_technique_program_settings
  for each row execute function public.set_updated_at();

-- club_id должен реально существовать в clubs.club_id (тот же
-- family_club_exists(), что уже используется для club_belts/
-- club_techniques/... в миграции 20260720120004 — переиспользуем, не
-- дублируем логику).
create or replace function public.enforce_club_technique_program_settings_club_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.family_club_exists(new.club_id) then
    raise exception 'club_technique_program_settings.club_id % does not exist in clubs.club_id', new.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_club_technique_program_settings_club_exists
  before insert or update on public.club_technique_program_settings
  for each row execute function public.enforce_club_technique_program_settings_club_exists();

create or replace function public.enforce_club_required_techniques_club_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.family_club_exists(new.club_id) then
    raise exception 'club_required_techniques.club_id % does not exist in clubs.club_id', new.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_club_required_techniques_club_exists
  before insert or update on public.club_required_techniques
  for each row execute function public.enforce_club_required_techniques_club_exists();

-- RLS: включён, НИ ОДНОЙ policy для anon/authenticated — единственный
-- потребитель на этом этапе — get-student-preview (service_role, обходит
-- RLS). Trainer-редактирование программы клуба НЕ реализуется сейчас (см.
-- задание, "не открывай write policies заранее") — когда появится, это
-- будет отдельная миграция с policy вида
-- "trainer_accounts.club_id = club_required_techniques.club_id".
alter table public.club_technique_program_settings enable row level security;
alter table public.club_required_techniques enable row level security;

-- Явный revoke перед точечным grant — тот же принцип, что уже
-- задокументирован и дважды подтверждён в этом проекте (миграции
-- 20260720120009, 20260829120001, 20260908130043): PUBLIC/DEFAULT
-- PRIVILEGES на новые таблицы в этом проекте оказывались шире, чем
-- предполагалось, полагаться на них нельзя.
revoke all privileges on table public.club_technique_program_settings from anon;
revoke all privileges on table public.club_technique_program_settings from authenticated;
revoke all privileges on table public.club_technique_program_settings from public;
revoke all privileges on table public.club_required_techniques from anon;
revoke all privileges on table public.club_required_techniques from authenticated;
revoke all privileges on table public.club_required_techniques from public;

grant select on table public.club_technique_program_settings to service_role;
grant select on table public.club_required_techniques to service_role;
