-- Схема модуля «Прогресс техник»: club_belts, club_technique_progress_settings,
-- club_techniques, club_belt_techniques, club_belt_technique_settings,
-- student_technique_progress.
--
-- ТИПЫ (аудит этапа 2.2, подтверждено диагностикой реальной базы 20.07.2026):
--   clubs.club_id     text (slug, напр. 'jcl'), НЕ UNIQUE подтверждено -> без hard FK
--   students.id       bigint (реальный PK), НЕ uuid
--   trainers.id       bigint (реальный PK); trainers.trainer_id — отдельная
--                     text-колонка, NOT NULL, но НЕ PK — использовалась по
--                     ошибке в более ранней версии этой миграции
-- Все club_id/student_id/completed_by ниже исправлены под эти типы.
--
-- РЕШЕНИЕ (belt_id): в JCL_Gruppen пояс — это свободный текст
-- (students.guertelfarbe/kyu_grad, оба text), нормализованной таблицы
-- поясов со стабильным id нет (docs/database/EXISTING_DATABASE_AUDIT.md,
-- раздел 5.1). Технику/бонус нужно привязывать к стабильному belt_id,
-- который переживает смену пояса ученика (раздел 7 задания — история по
-- поясам). Поэтому здесь создаётся НОВАЯ club-scoped таблица club_belts —
-- она НЕ трогает и не переопределяет students.guertelfarbe/kyu_grad.
-- Сопоставление "текущий пояс ученика -> club_belts.id" делается по имени в
-- resolve_student_current_belt (следующая миграция) — это best-effort
-- сопоставление по тексту, явный и задокументированный известный риск
-- (опечатка/регистр в guertelfarbe не совпадёт с club_belts.name), а не
-- полноценная нормализация students — это отдельная задача, требующая
-- согласования с владельцем JCL_Gruppen (см. аудит, раздел 11, категория B).
--
-- РЕШЕНИЕ (student_technique_progress): хранится только 'completed'.
-- Отсутствие строки = required. Это предпочтительный вариант из задания:
-- меньше записей, не нужно массово создавать прогресс каждому ученику при
-- создании программы пояса, изменение набора техник пояса не расходится с
-- уже проставленными результатами.

create table if not exists public.club_belts (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  name text not null,
  color_hex text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, name)
);

comment on table public.club_belts is
  'Club-scoped справочник поясов для модуля техник. club_id — text slug (clubs.club_id), без hard FK — см. family_club_exists(). Не заменяет students.guertelfarbe/kyu_grad, см. комментарий в шапке файла.';

create table if not exists public.club_technique_progress_settings (
  id uuid primary key default gen_random_uuid(),
  club_id text not null unique,
  feature_enabled boolean not null default false,
  default_bonus_requirement integer not null default 5 check (default_bonus_requirement > 0),
  bonus_points integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.club_technique_progress_settings is
  'Одна запись на клуб (club_id — text slug). feature_enabled — клубный уровень двойного feature flag (второй уровень — глобальный technical флаг на фронтенде, src/config/featureFlags.js).';

create table if not exists public.club_techniques (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  name text not null,
  category text not null check (category in ('tachi-waza', 'ne-waza')),
  image_path text,
  description text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.club_techniques is
  'Каталог техник клуба (club_id — text slug). Без UNIQUE(club_id, name, category) по прямому указанию задания ("без блокировки допустимых осознанных дублей") — уникальность по смыслу проверяется на уровне будущего административного интерфейса (этап 4), не в БД.';
comment on column public.club_techniques.image_path is
  'Путь в Supabase Storage (bucket technique-images), НЕ публичный URL.';
comment on column public.club_techniques.created_by is
  'Без FK — таблица администраторов клуба ещё не существует. Заполняется будущим административным интерфейсом.';

create table if not exists public.club_belt_techniques (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  belt_id uuid not null references public.club_belts(id) on delete cascade,
  technique_id uuid not null references public.club_techniques(id) on delete restrict,
  sort_order integer not null default 0,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (belt_id, technique_id)
);

comment on table public.club_belt_techniques is
  'Набор техник конкретного пояса конкретного клуба. category берётся из club_techniques, не дублируется здесь.';

-- Опциональные бонус-настройки конкретного пояса (Вариант A из задания).
-- Отсутствие строки для пояса = используются default_bonus_requirement/bonus_points
-- из club_technique_progress_settings.
create table if not exists public.club_belt_technique_settings (
  club_id text not null,
  belt_id uuid not null references public.club_belts(id) on delete cascade,
  bonus_requirement integer not null check (bonus_requirement > 0),
  bonus_points integer,
  feature_enabled boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (club_id, belt_id)
);

comment on table public.club_belt_technique_settings is
  'Переопределение bonus_requirement/bonus_points/feature_enabled для конкретного пояса. feature_enabled=null означает "наследовать из club_technique_progress_settings".';

-- Хранит ТОЛЬКО подтверждённые (completed) техники. required вычисляется как
-- "есть в club_belt_techniques текущего пояса, но нет строки здесь".
create table if not exists public.student_technique_progress (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  student_id bigint not null references public.students(id) on delete restrict,
  technique_id uuid not null references public.club_techniques(id) on delete restrict,
  belt_id uuid not null references public.club_belts(id) on delete restrict,
  completed_at timestamptz not null default now(),
  completed_by bigint references public.trainers(id) on delete set null,
  competition_name text,
  trainer_comment text,
  video_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, technique_id, belt_id)
);

comment on table public.student_technique_progress is
  'Только подтверждённые выполнения. Отсутствие строки для (student, technique, текущий belt) = required. Привязка к belt_id (не только к student+technique) сохраняет историю при смене пояса — см. раздел 7 задания. student_id — bigint (students.id, реальный PK).';
comment on column public.student_technique_progress.completed_by is
  'Ссылается на trainers.id (bigint, реальный PK — НЕ trainers.trainer_id). Тренеры пока не на Supabase Auth — эта колонка сегодня заполняется только серверным/административным процессом, не публичным клиентом (этап 3 роадмапа).';
comment on column public.student_technique_progress.video_path is
  'Путь в Supabase Storage (bucket technique-videos), НЕ публичная ссылка. Доступ — только через signed URL, см. следующие миграции.';

create index if not exists idx_club_belts_club_id on public.club_belts(club_id);
create index if not exists idx_club_techniques_club_id on public.club_techniques(club_id);
create index if not exists idx_club_techniques_club_category on public.club_techniques(club_id, category);
create index if not exists idx_club_belt_techniques_club_id on public.club_belt_techniques(club_id);
create index if not exists idx_club_belt_techniques_belt_id on public.club_belt_techniques(belt_id);
create index if not exists idx_club_belt_techniques_technique_id on public.club_belt_techniques(technique_id);
create index if not exists idx_student_technique_progress_club_id on public.student_technique_progress(club_id);
create index if not exists idx_student_technique_progress_student_id on public.student_technique_progress(student_id);
create index if not exists idx_student_technique_progress_technique_id on public.student_technique_progress(technique_id);
create index if not exists idx_student_technique_progress_belt_id on public.student_technique_progress(belt_id);

create trigger trg_club_belts_set_updated_at
  before update on public.club_belts
  for each row execute function public.set_updated_at();
create trigger trg_club_technique_progress_settings_set_updated_at
  before update on public.club_technique_progress_settings
  for each row execute function public.set_updated_at();
create trigger trg_club_techniques_set_updated_at
  before update on public.club_techniques
  for each row execute function public.set_updated_at();
create trigger trg_club_belt_techniques_set_updated_at
  before update on public.club_belt_techniques
  for each row execute function public.set_updated_at();
create trigger trg_club_belt_technique_settings_set_updated_at
  before update on public.club_belt_technique_settings
  for each row execute function public.set_updated_at();
create trigger trg_student_technique_progress_set_updated_at
  before update on public.student_technique_progress
  for each row execute function public.set_updated_at();

-- club_id этих таблиц должен реально существовать в clubs.club_id
-- (family_club_exists определена в 20260720120001_create_family_layer.sql).
create or replace function public.enforce_club_belts_club_exists()
returns trigger
language plpgsql
as $$
begin
  if not public.family_club_exists(new.club_id) then
    raise exception 'club_belts.club_id % does not exist in clubs.club_id', new.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_club_belts_club_exists
  before insert or update on public.club_belts
  for each row execute function public.enforce_club_belts_club_exists();

create or replace function public.enforce_club_technique_progress_settings_club_exists()
returns trigger
language plpgsql
as $$
begin
  if not public.family_club_exists(new.club_id) then
    raise exception 'club_technique_progress_settings.club_id % does not exist in clubs.club_id', new.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_club_technique_progress_settings_club_exists
  before insert or update on public.club_technique_progress_settings
  for each row execute function public.enforce_club_technique_progress_settings_club_exists();

create or replace function public.enforce_club_techniques_club_exists()
returns trigger
language plpgsql
as $$
begin
  if not public.family_club_exists(new.club_id) then
    raise exception 'club_techniques.club_id % does not exist in clubs.club_id', new.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_club_techniques_club_exists
  before insert or update on public.club_techniques
  for each row execute function public.enforce_club_techniques_club_exists();

-- Целостность club_id внутри club_belt_techniques: belt и technique должны принадлежать
-- тому же клубу, что и сама строка набора.
create or replace function public.enforce_club_belt_technique_club_match()
returns trigger
language plpgsql
as $$
declare
  v_belt_club text;
  v_technique_club text;
begin
  select club_id into v_belt_club from public.club_belts where id = new.belt_id;
  select club_id into v_technique_club from public.club_techniques where id = new.technique_id;

  if v_belt_club is null or v_technique_club is null
     or v_belt_club <> new.club_id or v_technique_club <> new.club_id then
    raise exception 'club_belt_techniques: belt_id, technique_id and club_id must all belong to the same club';
  end if;

  return new;
end;
$$;

create trigger trg_club_belt_techniques_club_match
  before insert or update on public.club_belt_techniques
  for each row execute function public.enforce_club_belt_technique_club_match();

create or replace function public.enforce_club_belt_technique_settings_club_match()
returns trigger
language plpgsql
as $$
declare
  v_belt_club text;
begin
  select club_id into v_belt_club from public.club_belts where id = new.belt_id;
  if v_belt_club is null or v_belt_club <> new.club_id then
    raise exception 'club_belt_technique_settings.club_id must match club_belts.club_id for belt_id %', new.belt_id;
  end if;
  return new;
end;
$$;

create trigger trg_club_belt_technique_settings_club_match
  before insert or update on public.club_belt_technique_settings
  for each row execute function public.enforce_club_belt_technique_settings_club_match();

-- Целостность club_id для student_technique_progress: student/technique/belt
-- должны принадлежать одному club_id, и он должен совпадать с club_id строки.
-- SECURITY DEFINER — не должна зависеть от текущего состояния RLS-политик
-- students у JCL_Gruppen (см. комментарий в миграции 1).
create or replace function public.enforce_student_technique_progress_club_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_club text;
  v_technique_club text;
  v_belt_club text;
begin
  select club_id into v_student_club from public.students where id = new.student_id;
  select club_id into v_technique_club from public.club_techniques where id = new.technique_id;
  select club_id into v_belt_club from public.club_belts where id = new.belt_id;

  if v_student_club is null or v_technique_club is null or v_belt_club is null
     or v_student_club <> v_technique_club or v_student_club <> v_belt_club
     or new.club_id <> v_student_club then
    raise exception 'student_technique_progress: student, technique, belt and club_id must all match (student_id=%)',
      new.student_id;
  end if;

  return new;
end;
$$;

create trigger trg_student_technique_progress_club_match
  before insert or update on public.student_technique_progress
  for each row execute function public.enforce_student_technique_progress_club_match();
