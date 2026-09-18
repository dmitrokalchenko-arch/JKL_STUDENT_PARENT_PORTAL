-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- НАЗНАЧЕНИЕ: "Trainer Bonus Techniques" — club-wide бонусная программа
-- техник по Kyu (какие техники дополнительно засчитываются ученику,
-- достигшему конкретного Kyu) + per-student read-only pool resolver для
-- Trainer Student Page. Reuse: public.judo_techniques (каталог),
-- public.student_technique_records (canonical completion — НЕ создаётся
-- заново, не меняется), public.can_trainer_access_student (relationship
-- helper — НЕ меняется).
--
-- ══════════════════════════════════════════════════════════════════════
-- ПОЧЕМУ НОВАЯ ТАБЛИЦА, А НЕ 053/054 (club_required_techniques/
-- student_bonus_technique_overrides)
-- ══════════════════════════════════════════════════════════════════════
-- Read-only аудит production ПЕРЕД этой миграцией подтвердил: ни
-- club_required_techniques, ни student_bonus_technique_overniques, ни
-- club_technique_program_settings (миграции 20260913120053/
-- 20260914100054) НЕ СУЩЕСТВУЮТ в production — обе миграции остались
-- НЕПРИМЕНЁННЫМИ предложениями. У club_required_techniques ВООБЩЕ никогда
-- не было ни одного write-гранта (даже service_role) — заполнить её было
-- бы физически нечем без дополнительной миграции.
--
-- 054 сама фиксирует "BLOCKING ARCHITECTURE ISSUE": club_required_
-- techniques.belt_key — свободный ТЕКСТ (не FK), сопоставление с Kyu
-- ученика идёт через best-effort case-insensitive text-match. Миграция
-- 20260917120060 (Required Techniques) уже решила ТОЧНО ТУ ЖЕ проблему
-- для "следующего Kyu" программы, создав club_kyu_program_items с
-- настоящим kyu_lookup_id FK, ЕЁ ЖЕ собственный комментарий объясняет:
-- "Причина завести новую независимую таблицу вместо применения 053/054:
-- та схема использует belt_key (text, НЕ FK)... Здесь вместо этого
-- kyu_lookup_id — настоящий FK". Эта миграция применяет ТОТ ЖЕ,
-- уже проверенный принцип к Bonus (уже полученный Kyu), а не
-- воскрешает belt_key-based 053/054 — club_required_techniques/
-- student_bonus_technique_overrides этой миграцией НЕ создаются и
-- НЕ трогаются (они прото и не существуют).
--
-- ══════════════════════════════════════════════════════════════════════
-- REQUIRED vs BONUS — не смешиваются
-- ══════════════════════════════════════════════════════════════════════
-- club_kyu_program_items (миграция 060) = что нужно ВЫУЧИТЬ для
-- СЛЕДУЮЩЕГО Kyu (kyu_lookup_id = resolve_next_kyu_lookup_id(текущий)).
-- club_kyu_bonus_program_items (эта миграция) = что уже ЗАСЧИТАНО на
-- ТЕКУЩЕМ/достигнутом Kyu (kyu_lookup_id = kyu ученика "как есть", без
-- resolve_next). Разные таблицы, разные RPC, ни одна существующая
-- Required Techniques функция/таблица этой миграцией не меняется.
--
-- KIHON / OTHER EXAM ELEMENTS: item_type — тот же архитектурный резерв,
-- что в club_kyu_program_items ('kihon'/'other' допустимы схемой, CHECK
-- гарантирует technique_id NOT NULL ТОЛЬКО когда item_type='technique') —
-- ни одной строки с item_type<>'technique' эта миграция не создаёт. Все
-- read-пути ЯВНО фильтруют item_type='technique' — kihon/ukemi/стойки/
-- координационные упражнения и любые другие экзаменационные требования
-- без judo_techniques.id структурно не могут попасть в Bonus pool: у них
-- либо нет строки вообще (никто их сюда не добавляет), либо, если в
-- будущем появится item_type='kihon' строка, она отсеивается фильтром
-- item_type='technique' в каждом read-пути ниже.

create table public.club_kyu_bonus_program_items (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  kyu_lookup_id bigint not null references public.kyu_lookup(id) on delete restrict,
  item_type text not null default 'technique' check (item_type in ('technique', 'kihon', 'other')),
  technique_id uuid null references public.judo_techniques(id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint club_kyu_bonus_program_items_technique_shape check (
    (item_type = 'technique') = (technique_id is not null)
  )
);

comment on table public.club_kyu_bonus_program_items is
  'Club-wide бонусная программа техник ПО ДОСТИГНУТОМУ Kyu (НЕ следующему — см. club_kyu_program_items, миграция 060, для той роли). item_type=''technique'' — единственное реально используемое значение, technique_id -> public.judo_techniques(id), name/category/main_group/image_path/youtube_url НИКОГДА не копируются сюда. ''kihon''/''other'' — зарезервированные значения, ни одной строки с ними эта миграция не создаёт.';
comment on column public.club_kyu_bonus_program_items.kyu_lookup_id is
  'FOREIGN KEY на public.kyu_lookup(id) — настоящая referential integrity, не свободный текст (см. отклонённый belt_key подход 053/054 в шапке файла).';

create unique index if not exists club_kyu_bonus_program_items_technique_uidx
  on public.club_kyu_bonus_program_items(club_id, kyu_lookup_id, technique_id)
  where technique_id is not null;

create index if not exists idx_club_kyu_bonus_program_items_club_id
  on public.club_kyu_bonus_program_items(club_id);
create index if not exists idx_club_kyu_bonus_program_items_kyu_lookup_id
  on public.club_kyu_bonus_program_items(kyu_lookup_id);
create index if not exists idx_club_kyu_bonus_program_items_technique_id
  on public.club_kyu_bonus_program_items(technique_id);

create or replace function public.enforce_club_kyu_bonus_program_items_club_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.family_club_exists(new.club_id) then
    raise exception 'club_kyu_bonus_program_items.club_id % does not exist in clubs.club_id', new.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_club_kyu_bonus_program_items_club_exists
  before insert or update on public.club_kyu_bonus_program_items
  for each row execute function public.enforce_club_kyu_bonus_program_items_club_exists();

alter table public.club_kyu_bonus_program_items enable row level security;

revoke all privileges on table public.club_kyu_bonus_program_items from anon;
revoke all privileges on table public.club_kyu_bonus_program_items from authenticated;
revoke all privileges on table public.club_kyu_bonus_program_items from public;

grant select on table public.club_kyu_bonus_program_items to service_role;

-- ══════════════════════════════════════════════════════════════════════
-- PER-STUDENT OVERRIDES — read-only на этом этапе (по явному решению
-- пользователя перед этой миграцией): только схема + чтение при
-- вычислении пула. Write RPC (Trainer include/exclude конкретной техники
-- конкретному ученику) — НЕ реализуется сейчас, отдельная будущая задача
-- (тот же принцип, что уже был явно отложен для 054's
-- student_bonus_technique_overrides).
-- ══════════════════════════════════════════════════════════════════════
create table public.student_kyu_bonus_technique_overrides (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  student_id bigint not null references public.students(id) on delete restrict,
  technique_id uuid not null references public.judo_techniques(id) on delete restrict,
  action text not null check (action in ('include', 'exclude')),
  created_by bigint references public.trainers(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (student_id, technique_id)
);

comment on table public.student_kyu_bonus_technique_overrides is
  'Точечные per-student корректировки бонусного пула поверх club_kyu_bonus_program_items. ''include'' — техника входит в пул этого ученика, даже если её нет в club-программе его Kyu. ''exclude'' — исключается, даже если есть. READ-ONLY в этой миграции (только public.get_trainer_student_bonus_pool ниже её читает) — write RPC (Trainer добавляет/убирает override) НЕ реализован, отдельная будущая задача.';
comment on column public.student_kyu_bonus_technique_overrides.created_by is
  'trainers.id (bigint) тренера — заполнится, когда появится write RPC. NULL при удалении тренера (on delete set null).';

create index if not exists idx_student_kyu_bonus_overrides_club_id
  on public.student_kyu_bonus_technique_overrides(club_id);
create index if not exists idx_student_kyu_bonus_overrides_student_id
  on public.student_kyu_bonus_technique_overrides(student_id);

create or replace function public.enforce_student_kyu_bonus_overrides_club_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_club text;
begin
  select club_id into v_student_club from public.students where id = new.student_id;

  if v_student_club is null or new.club_id <> v_student_club then
    raise exception 'student_kyu_bonus_technique_overrides.club_id must match students.club_id for student_id %', new.student_id;
  end if;

  return new;
end;
$$;

create trigger trg_student_kyu_bonus_overrides_club_match
  before insert or update on public.student_kyu_bonus_technique_overrides
  for each row execute function public.enforce_student_kyu_bonus_overrides_club_match();

alter table public.student_kyu_bonus_technique_overrides enable row level security;

revoke all privileges on table public.student_kyu_bonus_technique_overrides from anon;
revoke all privileges on table public.student_kyu_bonus_technique_overrides from authenticated;
revoke all privileges on table public.student_kyu_bonus_technique_overrides from public;

grant select on table public.student_kyu_bonus_technique_overrides to service_role;

-- ══════════════════════════════════════════════════════════════════════
-- RESOLVER: студент -> kyu_lookup.id ЕГО ТЕКУЩЕГО (уже достигнутого) Kyu
-- ══════════════════════════════════════════════════════════════════════
-- Точный (не best-effort текстовый) match: case-insensitive сравнение с
-- trim, ТОТ ЖЕ приём, что уже проверен и подтверждён этой же сессией для
-- public.resolve_next_kyu_lookup_id (миграция 20260918100061) —
-- единственное отличие: возвращает id САМОГО текущего Kyu, а не
-- следующего. НЕ путать с resolve_next_kyu_lookup_id — та функция не
-- переиспользуется и не меняется (разные роли: next vs current).
create or replace function public.resolve_current_kyu_lookup_id(p_kyu_grad text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_input text;
  v_result_id bigint;
begin
  v_input := nullif(trim(p_kyu_grad), '');
  if v_input is null then
    return null;
  end if;

  select kl.id
    into v_result_id
  from public.kyu_lookup kl
  where lower(trim(kl.kyu_grad)) = lower(v_input)
    and kl.kyu_grad ilike '%Kyu%'
  limit 1;

  return v_result_id;
end;
$$;

comment on function public.resolve_current_kyu_lookup_id(text) is
  'kyu_lookup.id, ТОЧНО совпадающий (case-insensitive, trim) с переданным kyu_grad, ТОЛЬКО если это Kyu-строка (не Dan, не произвольный текст) — NULL, если совпадения нет. НЕ используется для "следующего" Kyu (см. resolve_next_kyu_lookup_id, миграция 20260918100061, не меняется).';

revoke all on function public.resolve_current_kyu_lookup_id(text) from public;
revoke all on function public.resolve_current_kyu_lookup_id(text) from anon;
revoke all on function public.resolve_current_kyu_lookup_id(text) from authenticated;
grant execute on function public.resolve_current_kyu_lookup_id(text) to service_role;

-- ══════════════════════════════════════════════════════════════════════
-- RPC 1/2: Trainer club-wide bonus program editor (READ/WRITE) — ТОЧНАЯ
-- структурная копия get_trainer_kyu_program/save_trainer_kyu_program
-- (миграция 20260917120060), только читает/пишет
-- club_kyu_bonus_program_items вместо club_kyu_program_items. club_id
-- резолвится ТЕМ ЖЕ fail-closed способом (ровно один активный
-- trainer_accounts для auth.uid()).
-- ══════════════════════════════════════════════════════════════════════
create or replace function public.get_trainer_kyu_bonus_program(p_kyu_lookup_id bigint)
returns table (
  technique_id uuid,
  name text,
  category text,
  main_group text,
  image_path text,
  youtube_url text,
  youtube_video_id text,
  sort_order integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_club_id text;
  v_match_count integer;
  v_kyu_label text;
begin
  select count(*)
    into v_match_count
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  if v_match_count = 0 then
    return;
  end if;

  if v_match_count > 1 then
    raise exception 'Ambiguous active trainer account';
  end if;

  select ta.club_id
    into v_club_id
  from public.trainer_accounts ta
  where ta.auth_user_id = (select auth.uid())
    and ta.is_active = true;

  select kl.kyu_grad
    into v_kyu_label
  from public.kyu_lookup kl
  where kl.id = p_kyu_lookup_id;

  if v_kyu_label is null then
    raise exception 'kyu_lookup_id % does not exist', p_kyu_lookup_id;
  end if;

  if v_kyu_label not ilike '%Kyu%' then
    raise exception 'kyu_lookup_id % is not an editable Kyu grade (Dan is not supported here)', p_kyu_lookup_id;
  end if;

  return query
  select
    jt.id,
    jt.name,
    jt.category,
    jt.main_group,
    jt.image_path,
    jt.youtube_url,
    jt.youtube_video_id,
    ckbpi.sort_order
  from public.club_kyu_bonus_program_items ckbpi
  join public.judo_techniques jt on jt.id = ckbpi.technique_id
  where ckbpi.club_id = v_club_id
    and ckbpi.kyu_lookup_id = p_kyu_lookup_id
    and ckbpi.item_type = 'technique'
  order by ckbpi.sort_order, jt.name;
end;
$$;

create or replace function public.save_trainer_kyu_bonus_program(
  p_kyu_lookup_id bigint,
  p_technique_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id text;
  v_match_count integer;
  v_kyu_label text;
  v_technique_ids uuid[];
  v_invalid_count integer;
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

  select kl.kyu_grad
    into v_kyu_label
  from public.kyu_lookup kl
  where kl.id = p_kyu_lookup_id;

  if v_kyu_label is null then
    raise exception 'kyu_lookup_id % does not exist', p_kyu_lookup_id;
  end if;

  if v_kyu_label not ilike '%Kyu%' then
    raise exception 'kyu_lookup_id % is not an editable Kyu grade (Dan is not supported here)', p_kyu_lookup_id;
  end if;

  select coalesce(array_agg(distinct t), '{}')
    into v_technique_ids
  from unnest(p_technique_ids) as t
  where t is not null;

  select count(*)
    into v_invalid_count
  from unnest(v_technique_ids) as t
  where not exists (
    select 1
    from public.judo_techniques jt
    where jt.id = t
      and jt.active = true
  );

  if v_invalid_count > 0 then
    raise exception 'One or more technique_ids do not exist or are not active';
  end if;

  delete from public.club_kyu_bonus_program_items
  where club_id = v_club_id
    and kyu_lookup_id = p_kyu_lookup_id
    and item_type = 'technique';

  if coalesce(array_length(v_technique_ids, 1), 0) > 0 then
    insert into public.club_kyu_bonus_program_items (club_id, kyu_lookup_id, item_type, technique_id, sort_order)
    select v_club_id, p_kyu_lookup_id, 'technique', u.t, u.ord - 1
    from unnest(v_technique_ids) with ordinality as u(t, ord);
  end if;

  return true;
end;
$$;

revoke all on function public.get_trainer_kyu_bonus_program(bigint) from public;
revoke all on function public.get_trainer_kyu_bonus_program(bigint) from anon;
grant execute on function public.get_trainer_kyu_bonus_program(bigint) to authenticated;

revoke all on function public.save_trainer_kyu_bonus_program(bigint, uuid[]) from public;
revoke all on function public.save_trainer_kyu_bonus_program(bigint, uuid[]) from anon;
grant execute on function public.save_trainer_kyu_bonus_program(bigint, uuid[]) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- RPC 3: Trainer Student Page — ЭТО ГЛАВНАЯ RPC для "Trainer Bonus
-- Techniques" задачи. Возвращает пул техник, доступных к отметке
-- ВЫПОЛНЕНИЯ для КОНКРЕТНОГО ученика, ограниченный бонусной программой
-- ЕГО ДОСТИГНУТОГО Kyu — НЕ весь каталог judo_techniques.
--
-- ДОСТУП: public.can_trainer_access_student(p_student_id) — СУЩЕСТВУЮЩИЙ
-- relationship helper, НЕ МЕНЯЕТСЯ этой миграцией ни на строку (прямое
-- требование задания). Anti-enumeration: 0 строк, если доступа нет — та
-- же семантика, что у get_trainer_student_by_id/get_trainer_kyu_program.
--
-- KYU РЕЗОЛВИТСЯ ИЗ students.kyu_grad ("как есть", ученик УЖЕ на этом
-- Kyu) ЧЕРЕЗ public.resolve_current_kyu_lookup_id — точный kyu_lookup.id
-- match, НЕ текстовое сравнение с club-стороны (задание: "use exact
-- kyu_lookup.id mapping rather than comparing human-readable Kyu
-- strings"). Если students.kyu_grad NULL/не Kyu-строка/нет совпадения в
-- kyu_lookup — 0 строк (пустой пул, не ошибка — тот же принцип, что и у
-- Required Techniques resolver).
--
-- ПУЛ = club_kyu_bonus_program_items(club_id ученика, kyu_lookup_id
-- ученика, item_type='technique') СКОРРЕКТИРОВАНО
-- student_kyu_bonus_technique_overrides (include добавляет технику вне
-- club-программы, exclude убирает технику из club-программы) — те же
-- include/exclude semantics, что уже задокументированы для 054's модели.
-- item_type='technique' фильтр гарантирует: Kihon/ukemi/стойки/
-- координационные упражнения (будущие item_type<>'technique' строки)
-- НИКОГДА не попадут в результат — они физически отфильтрованы здесь,
-- до JOIN на judo_techniques.
create or replace function public.get_trainer_student_bonus_pool(p_student_id bigint)
returns table (
  id uuid,
  name text,
  category text,
  main_group text,
  image_path text,
  youtube_url text,
  youtube_video_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_student_club_id text;
  v_student_kyu_grad text;
  v_kyu_lookup_id bigint;
begin
  if not public.can_trainer_access_student(p_student_id) then
    return;
  end if;

  select s.club_id, s.kyu_grad
    into v_student_club_id, v_student_kyu_grad
  from public.students s
  where s.id = p_student_id;

  if v_student_club_id is null then
    return;
  end if;

  v_kyu_lookup_id := public.resolve_current_kyu_lookup_id(v_student_kyu_grad);

  if v_kyu_lookup_id is null then
    return;
  end if;

  return query
  select pool.id, pool.name, pool.category, pool.main_group, pool.image_path, pool.youtube_url, pool.youtube_video_id
  from (
    select jt.id, jt.name, jt.category, jt.main_group, jt.image_path, jt.youtube_url, jt.youtube_video_id
    from public.club_kyu_bonus_program_items ckbpi
    join public.judo_techniques jt on jt.id = ckbpi.technique_id
    where ckbpi.club_id = v_student_club_id
      and ckbpi.kyu_lookup_id = v_kyu_lookup_id
      and ckbpi.item_type = 'technique'
      and not exists (
        select 1
        from public.student_kyu_bonus_technique_overrides o
        where o.student_id = p_student_id
          and o.technique_id = ckbpi.technique_id
          and o.action = 'exclude'
      )
    union
    select jt.id, jt.name, jt.category, jt.main_group, jt.image_path, jt.youtube_url, jt.youtube_video_id
    from public.student_kyu_bonus_technique_overrides o
    join public.judo_techniques jt on jt.id = o.technique_id
    where o.student_id = p_student_id
      and o.action = 'include'
  ) pool
  order by pool.main_group, pool.category, pool.name;
end;
$$;

comment on function public.get_trainer_student_bonus_pool(bigint) is
  'Пул техник, доступных Trainer для отметки ВЫПОЛНЕНИЯ (student_technique_records) КОНКРЕТНОМУ ученику — ограничен бонусной программой ЕГО ДОСТИГНУТОГО Kyu (club_kyu_bonus_program_items), НЕ весь каталог judo_techniques. Доступ — public.can_trainer_access_student(p_student_id), БЕЗ ИЗМЕНЕНИЙ. Kyu резолвится через resolve_current_kyu_lookup_id (точный kyu_lookup.id match). item_type=''technique'' фильтр исключает Kihon/ukemi/other non-technique exam elements структурно. Скорректировано student_kyu_bonus_technique_overrides (include/exclude), пока read-only (write RPC — будущая задача).';

revoke all on function public.get_trainer_student_bonus_pool(bigint) from public;
revoke all on function public.get_trainer_student_bonus_pool(bigint) from anon;
grant execute on function public.get_trainer_student_bonus_pool(bigint) to authenticated;
