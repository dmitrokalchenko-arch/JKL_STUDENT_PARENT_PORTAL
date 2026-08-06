-- Семейный слой JKL Family Portal: families / family_guardians / family_students.
-- Первое использование Supabase Auth в этой системе — только для семейных
-- аккаунтов. Тренеры остаются на существующей PIN-авторизации
-- (JCL_Gruppen.trainers.pin) — она этой миграцией не затрагивается и не
-- изменяется (см. docs/database/EXISTING_DATABASE_AUDIT.md).
--
-- Ничего не удаляет и не изменяет в существующих таблицах clubs/students.
-- family_students только ссылается на students.id, не копирует его поля.
--
-- ТИПЫ (аудит этапа 2.2, подтверждено диагностикой реальной базы 20.07.2026):
--   clubs.id            uuid  (реальный PK, НЕ используется здесь)
--   clubs.club_id        text  NOT NULL — human-readable slug клуба (напр. 'jcl'),
--                                НЕ подтверждён как UNIQUE -> без hard FK,
--                                принадлежность клубу проверяется триггером (EXISTS)
--   students.id          bigint (реальный PK, БЕЗ автогенерации — id назначает
--                                приложение, значения не начинаются с 1)
--   students.club_id     text  NOT NULL default 'jcl' — тот же slug, что clubs.club_id
-- Более ранняя версия миграции ошибочно предполагала uuid для всех трёх.

create extension if not exists pgcrypto;

-- Семья как сущность (не путать с family_guardians — авторизованными людьми внутри неё).
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  nickname text not null,
  normalized_nickname text not null,
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, normalized_nickname)
);

comment on table public.families is
  'Семейный аккаунт клуба. nickname уникален в пределах club_id, не глобально по всей системе. club_id — text slug (clubs.club_id), без формального FK — см. trg_families_club_exists.';
comment on column public.families.club_id is
  'Соответствует clubs.club_id (text, напр. ''jcl''), НЕ clubs.id (uuid). Формального FOREIGN KEY нет — clubs.club_id не подтверждён как UNIQUE в реальной базе; принадлежность существующему клубу проверяется триггером.';
comment on column public.families.normalized_nickname is
  'nickname в нижнем регистре без разделителей — источник уникальности и для построения технического auth email (см. family_login_email).';

-- Один auth.users = один родитель/опекун, привязанный к одной семье.
-- Семья не имеет собственного пароля — пароль всегда принадлежит guardian через Supabase Auth.
create table if not exists public.family_guardians (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  club_id text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.family_guardians is
  'Связь auth.users с семьёй. club_id денормализован для быстрых RLS-проверок и обязан совпадать с families.club_id (см. trg_family_guardians_club_match).';

-- Связь семьи с существующим учеником students.id (JCL_Gruppen, bigint). Не копирует данные ученика.
create table if not exists public.family_students (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  student_id bigint not null references public.students(id) on delete restrict,
  club_id text not null,
  is_primary boolean not null default true,
  status text not null default 'active' check (status in ('active', 'suspended')),
  linked_at timestamptz not null default now(),
  linked_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, student_id)
);

comment on table public.family_students is
  'Связь семьи с учеником (students.id — bigint, реальный PK). Удаление строки не удаляет students. linked_by — id сотрудника клуба, подтвердившего связь (без FK — таблица администраторов ещё не создана). Максимум 2 активные записи на student_id — см. trg_family_students_max_active (BUSINESS_RULES.md, правило 24).';

create index if not exists idx_families_club_id on public.families(club_id);
create index if not exists idx_family_guardians_family_id on public.family_guardians(family_id);
create index if not exists idx_family_guardians_club_id on public.family_guardians(club_id);
create index if not exists idx_family_students_family_id on public.family_students(family_id);
create index if not exists idx_family_students_student_id on public.family_students(student_id);
create index if not exists idx_family_students_club_id on public.family_students(club_id);

-- updated_at триггер (переиспользуется всеми новыми таблицами этого и следующих модулей).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_families_set_updated_at
  before update on public.families
  for each row execute function public.set_updated_at();

create trigger trg_family_guardians_set_updated_at
  before update on public.family_guardians
  for each row execute function public.set_updated_at();

create trigger trg_family_students_set_updated_at
  before update on public.family_students
  for each row execute function public.set_updated_at();

-- Проверка, что club_id реально существует в clubs.club_id. Заменяет
-- формальный FOREIGN KEY, который здесь невозможен (clubs.club_id не
-- подтверждён как UNIQUE/PK в реальной базе — см. комментарии в шапке
-- файла). SECURITY DEFINER: не должна зависеть от того, насколько открыты
-- (или в будущем закрыты) RLS-политики самой clubs у JCL_Gruppen.
create or replace function public.family_club_exists(p_club_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.clubs where club_id = p_club_id);
$$;

comment on function public.family_club_exists(text) is
  'true, если p_club_id существует в clubs.club_id. Используется вместо FOREIGN KEY (clubs.club_id не подтверждён UNIQUE).';

-- Как и normalize_family_nickname/family_login_email в миграции 2: без
-- явного revoke Postgres даёт EXECUTE роли PUBLIC по умолчанию. Легитимных
-- прямых вызовов нет — используется только изнутри enforce_*_club_exists
-- триггеров (работает независимо от grant'ов, т.к. выполняется в контексте
-- определившей функцию роли).
revoke all on function public.family_club_exists(text) from public;

create or replace function public.enforce_families_club_exists()
returns trigger
language plpgsql
as $$
begin
  if not public.family_club_exists(new.club_id) then
    raise exception 'families.club_id % does not exist in clubs.club_id', new.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_families_club_exists
  before insert or update on public.families
  for each row execute function public.enforce_families_club_exists();

-- Целостность club_id: family_guardians.club_id должен совпадать с club_id семьи.
create or replace function public.enforce_family_guardian_club_match()
returns trigger
language plpgsql
as $$
begin
  if new.club_id <> (select f.club_id from public.families f where f.id = new.family_id) then
    raise exception 'family_guardians.club_id must match families.club_id for family_id %', new.family_id;
  end if;
  return new;
end;
$$;

create trigger trg_family_guardians_club_match
  before insert or update on public.family_guardians
  for each row execute function public.enforce_family_guardian_club_match();

-- Целостность club_id: family_students.club_id должен совпадать и с club_id семьи, и с club_id ученика
-- (запрет cross-club доступа, BUSINESS_RULES.md правило 18). SECURITY DEFINER —
-- не должна зависеть от текущего состояния RLS-политик students у JCL_Gruppen
-- (сейчас они широко открыты, но это чужая система, могут измениться).
create or replace function public.enforce_family_student_club_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_club text;
  v_student_club text;
begin
  select club_id into v_family_club from public.families where id = new.family_id;
  select club_id into v_student_club from public.students where id = new.student_id;

  if v_family_club is null or v_student_club is null or v_family_club <> v_student_club then
    raise exception 'family_students: family.club_id and student.club_id must match (family_id=%, student_id=%)',
      new.family_id, new.student_id;
  end if;

  if new.club_id <> v_family_club then
    raise exception 'family_students.club_id must match families.club_id for family_id %', new.family_id;
  end if;

  return new;
end;
$$;

create trigger trg_family_students_club_match
  before insert or update on public.family_students
  for each row execute function public.enforce_family_student_club_match();

-- BUSINESS_RULES.md правило 24: один ученик — максимум 2 активные семьи одновременно.
create or replace function public.enforce_max_active_families_per_student()
returns trigger
language plpgsql
as $$
declare
  v_active_count integer;
begin
  if new.status = 'active' then
    select count(*) into v_active_count
    from public.family_students
    where student_id = new.student_id
      and status = 'active'
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if v_active_count >= 2 then
      raise exception 'student_id % already linked to 2 active families (BUSINESS_RULES.md, rule 24)', new.student_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_family_students_max_active
  before insert or update on public.family_students
  for each row execute function public.enforce_max_active_families_per_student();
