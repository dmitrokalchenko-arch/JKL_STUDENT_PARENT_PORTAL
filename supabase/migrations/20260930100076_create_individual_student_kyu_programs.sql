-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- НАЗНАЧЕНИЕ: этап 2 "Individual Student Kyu Program" — тренер может задать
-- ученику ИНДИВИДУАЛЬНУЮ программу "Необходимых техник" для его СЛЕДУЮЩЕГО
-- Kyu (три блока required_nage / required_katame / additional). Программа
-- клуба (club_kyu_program_items) при этом НЕ меняется.
--
-- МОДЕЛЬ: FULL SNAPSHOT + IMMUTABLE VERSIONING (не delta).
--   student_kyu_programs       — заголовок версии (student + target Kyu + version)
--   student_kyu_program_items  — полный набор техник ЭТОЙ версии
-- Каждый Save создаёт новую версию N+1 (предыдущая active -> superseded),
-- Reset переводит active -> reset. Строки версий/items не редактируются и не
-- удаляются (триггеры ниже), история сохраняется целиком.
--
-- ЗАВИСИМОСТИ (все существуют в production, подтверждено read-only
-- reconciliation 2026-09-25): public.students (id bigint, club_id text,
-- kyu_grad text, gruppe_id text), public.kyu_lookup (id bigint),
-- public.judo_techniques (id uuid, active), public.trainer_accounts (id uuid),
-- public.club_kyu_program_items (072 block_type), public.resolve_next_kyu_lookup_id
-- (061), public.can_trainer_access_student (017), public.can_trainer_access_student_page
-- и public.get_student_page_access (064), private.current_active_trainer_account_id (014).
-- Старый модуль 004-007 НЕ используется и НЕ требуется.
--
-- ДОСТУП:
--   READ  Trainer — прежний get_trainer_required_techniques
--                   (can_trainer_access_student_page: группы + подписка,
--                   включая READ-исключение trainer_access_after_expiry).
--   EDIT  Trainer — НОВЫЙ private.can_trainer_edit_student_page: группы
--                   (can_trainer_access_student) + Student Page ACTIVE по
--                   Family-правилу get_student_page_access
--                   (familySubscriptionAllowsAccess). trainer_access_after_expiry
--                   НЕ даёт права записи.
--   READ  Family  — прежний get_family_required_techniques (без изменений),
--                   автоматически получает effective program.
--   Write для Family/anon невозможен: нет активного trainer_accounts ->
--   not_allowed; anon вообще не имеет EXECUTE.
--
-- based_on_club_program_at СОЗНАТЕЛЬНО НЕ ХРАНИТСЯ: club_kyu_program_items не
-- имеет version/updated_at (save_trainer_kyu_program делает delete+insert),
-- а сервер не знает, какое состояние программы клуба реально было открыто в
-- редакторе в момент загрузки — любое вычисленное значение было бы
-- фиктивной точностью. Вместо него source = club_copy/edited вычисляется
-- честно: совпал ли сохраняемый набор с программой клуба В МОМЕНТ SAVE.
--
-- БУДУЩЕЕ (НЕ реализуется здесь, зафиксировано в
-- docs/architecture/INDIVIDUAL_STUDENT_KYU_PROGRAM.md): "Повысить Kyu" создаст
-- immutable exam snapshot effective program; Bonus Techniques будут строиться
-- из exam snapshot. PR #19 не затрагивается.

-- ══════════════════════════════════════════════════════════════════════
-- 1. ТАБЛИЦЫ
-- ══════════════════════════════════════════════════════════════════════
create table public.student_kyu_programs (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  student_id bigint not null references public.students(id) on delete restrict,
  kyu_lookup_id bigint not null references public.kyu_lookup(id) on delete restrict,
  version integer not null check (version >= 1),
  status text not null check (status in ('active', 'superseded', 'reset')),
  source text not null check (source in ('club_copy', 'edited')),
  created_by_trainer_account_id uuid not null references public.trainer_accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by_trainer_account_id uuid references public.trainer_accounts(id) on delete restrict,
  constraint student_kyu_programs_version_uq unique (student_id, kyu_lookup_id, version),
  constraint student_kyu_programs_ended_shape check (
    (status = 'active') = (ended_at is null)
    and (ended_at is null) = (ended_by_trainer_account_id is null)
  )
);

comment on table public.student_kyu_programs is
  'Индивидуальная программа "Необходимых техник" ученика для target Kyu — FULL SNAPSHOT, immutable versioning: каждая версия неизменяема, Save создаёт version N+1 (prev active -> superseded), Reset -> reset. Не более одной active на (student_id, kyu_lookup_id). club_id = students.club_id (триггер). Доступ только через SECURITY DEFINER RPC (миграция 20260930100076).';

-- Не более одной active-версии на ученика + target Kyu. club_id в ключ не
-- входит: программа принадлежит ученику, а students.club_id однозначно задаёт
-- клуб; resolver дополнительно требует club_id = текущий клуб ученика, так что
-- при переводе ученика в другой клуб старая программа просто не применяется.
create unique index student_kyu_programs_one_active_uidx
  on public.student_kyu_programs(student_id, kyu_lookup_id)
  where status = 'active';

create index idx_student_kyu_programs_kyu_lookup_id on public.student_kyu_programs(kyu_lookup_id);
create index idx_student_kyu_programs_created_by on public.student_kyu_programs(created_by_trainer_account_id);

create table public.student_kyu_program_items (
  id uuid primary key default gen_random_uuid(),
  student_kyu_program_id uuid not null references public.student_kyu_programs(id) on delete restrict,
  technique_id uuid not null references public.judo_techniques(id) on delete restrict,
  block_type text not null check (block_type in ('required_nage', 'required_katame', 'additional')),
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint student_kyu_program_items_uq unique (student_kyu_program_id, technique_id, block_type)
);

comment on table public.student_kyu_program_items is
  'Полный набор техник ОДНОЙ версии student_kyu_programs. Одна technique_id может быть в разных block_type (уникальность — по тройке). Строки immutable (триггер). Миграция 20260930100076.';

create index idx_student_kyu_program_items_technique_id on public.student_kyu_program_items(technique_id);

-- ══════════════════════════════════════════════════════════════════════
-- 2. ЦЕЛОСТНОСТЬ И IMMUTABILITY (триггеры)
-- ══════════════════════════════════════════════════════════════════════
-- club_id заголовка обязан совпадать с текущим клубом ученика.
create function public.enforce_student_kyu_programs_club_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.club_id is distinct from (select s.club_id from public.students s where s.id = new.student_id) then
    raise exception 'student_kyu_programs.club_id must match students.club_id (student_id=%)', new.student_id;
  end if;
  return new;
end;
$$;

create trigger trg_student_kyu_programs_club_match
  before insert on public.student_kyu_programs
  for each row execute function public.enforce_student_kyu_programs_club_match();

-- Заголовок: DELETE запрещён; UPDATE разрешён ТОЛЬКО как единственный переход
-- active -> superseded|reset с заполнением ended_*; все прочие поля неизменны.
create function public.enforce_student_kyu_programs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'student_kyu_programs rows are immutable history and cannot be deleted';
  end if;

  if old.status <> 'active'
     or new.status not in ('superseded', 'reset')
     or new.id <> old.id
     or new.club_id <> old.club_id
     or new.student_id <> old.student_id
     or new.kyu_lookup_id <> old.kyu_lookup_id
     or new.version <> old.version
     or new.source <> old.source
     or new.created_by_trainer_account_id <> old.created_by_trainer_account_id
     or new.created_at <> old.created_at
     or new.ended_at is null
     or new.ended_by_trainer_account_id is null then
    raise exception 'student_kyu_programs: only the transition active -> superseded|reset (with ended_at/ended_by) is allowed';
  end if;

  return new;
end;
$$;

create trigger trg_student_kyu_programs_immutable
  before update or delete on public.student_kyu_programs
  for each row execute function public.enforce_student_kyu_programs_immutable();

-- Items: полностью immutable.
create function public.enforce_student_kyu_program_items_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'student_kyu_program_items rows are immutable history (% not allowed)', tg_op;
end;
$$;

create trigger trg_student_kyu_program_items_immutable
  before update or delete on public.student_kyu_program_items
  for each row execute function public.enforce_student_kyu_program_items_immutable();

-- Trigger-функции не вызываются напрямую никем.
revoke all on function public.enforce_student_kyu_programs_club_match() from public, anon, authenticated;
revoke all on function public.enforce_student_kyu_programs_immutable() from public, anon, authenticated;
revoke all on function public.enforce_student_kyu_program_items_immutable() from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 3. RLS / GRANTS — прямого доступа нет ни у одной клиентской роли
-- ══════════════════════════════════════════════════════════════════════
alter table public.student_kyu_programs enable row level security;
alter table public.student_kyu_program_items enable row level security;

revoke all on table public.student_kyu_programs from public, anon, authenticated;
revoke all on table public.student_kyu_program_items from public, anon, authenticated;

grant select on table public.student_kyu_programs to service_role;
grant select on table public.student_kyu_program_items to service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. EDIT-проверка (отдельно от READ)
-- ══════════════════════════════════════════════════════════════════════
-- true ТОЛЬКО если одновременно:
--   (1) auth.uid() — активный trainer_accounts (внутри can_trainer_access_student);
--   (2) ученик того же клуба и хотя бы в одной группе этого тренера
--       (can_trainer_access_student: trainer_accounts -> trainers.trainer_id ->
--       trainer_groups -> students.gruppe_id);
--   (3) Student Page ACTIVE по обычному Family-правилу существующего
--       public.get_student_page_access: familySubscriptionAllowsAccess =
--       not manual_disabled AND (не управляется: нет строки / access_until NULL
--       OR не истекла). trainer_access_after_expiry здесь СОЗНАТЕЛЬНО не
--       учитывается — это READ-исключение, не право записи.
-- Не публичная функция: EXECUTE ни у кого из клиентских ролей, вызывается
-- только изнутри SECURITY DEFINER RPC ниже.
create function private.can_trainer_edit_student_page(p_student_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_trainer_access_student(p_student_id) then
    return false;
  end if;

  return coalesce(
    (public.get_student_page_access(p_student_id) ->> 'familySubscriptionAllowsAccess')::boolean,
    false
  );
end;
$$;

comment on function private.can_trainer_edit_student_page(bigint) is
  'EDIT-право тренера на Student Page ученика: can_trainer_access_student (активный тренер, тот же клуб, общая группа) AND Student Page active по Family-правилу get_student_page_access (familySubscriptionAllowsAccess). trainer_access_after_expiry НЕ даёт права записи. Только для вызова изнутри SECURITY DEFINER RPC (миграция 20260930100076).';

revoke all on function private.can_trainer_edit_student_page(bigint) from public, anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 5. EFFECTIVE PROGRAM RESOLVER — individual if active, else club
-- ══════════════════════════════════════════════════════════════════════
-- Тело побайтово как в 20260929100074 до вычисления v_next_id; дальше —
-- выбор источника. Контракт только ДОПОЛНЯЕТСЯ: для status='ok' — source
-- ('club'|'individual'), version (integer|null), nextKyuLookupId; прежние поля
-- и статусы (no_current_kyu/unmapped_kyu/max_level/ok) без изменений.
-- Individual применяется только при совпадении club_id с ТЕКУЩИМ клубом
-- ученика и только для ТЕКУЩЕГО target Kyu — после смены Kyu старая
-- программа естественно перестаёт совпадать и остаётся историей.
create or replace function public.get_required_techniques_for_student(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_empty_result jsonb := jsonb_build_object(
    'currentKyu', null, 'nextKyu', null, 'status', 'no_current_kyu', 'techniques', '[]'::jsonb
  );
  v_student record;
  v_current_kyu text;
  v_is_current_valid boolean;
  v_next_id bigint;
  v_next_kyu text;
  v_techniques jsonb;
  v_program_id uuid;
  v_program_version integer;
begin
  select s.id, s.club_id, s.kyu_grad
    into v_student
  from public.students s
  where s.id = p_student_id;

  if v_student.id is null then
    return v_empty_result;
  end if;

  v_current_kyu := nullif(trim(v_student.kyu_grad), '');
  if v_current_kyu is null then
    return v_empty_result;
  end if;

  select true
    into v_is_current_valid
  from public.kyu_lookup kl
  where lower(trim(kl.kyu_grad)) = lower(v_current_kyu)
    and kl.kyu_grad ilike '%Kyu%'
  limit 1;

  if v_is_current_valid is not true then
    return jsonb_build_object('currentKyu', v_current_kyu, 'nextKyu', null, 'status', 'unmapped_kyu', 'techniques', '[]'::jsonb);
  end if;

  v_next_id := public.resolve_next_kyu_lookup_id(v_current_kyu);

  if v_next_id is null then
    return jsonb_build_object('currentKyu', v_current_kyu, 'nextKyu', null, 'status', 'max_level', 'techniques', '[]'::jsonb);
  end if;

  select kl.kyu_grad into v_next_kyu from public.kyu_lookup kl where kl.id = v_next_id;

  select p.id, p.version
    into v_program_id, v_program_version
  from public.student_kyu_programs p
  where p.student_id = v_student.id
    and p.kyu_lookup_id = v_next_id
    and p.club_id = v_student.club_id
    and p.status = 'active';

  if v_program_id is not null then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'technique_id', jt.id,
                 'name', jt.name,
                 'category', jt.category,
                 'main_group', jt.main_group,
                 'image_path', jt.image_path,
                 'youtube_url', jt.youtube_url,
                 'youtube_video_id', jt.youtube_video_id,
                 'sort_order', i.sort_order,
                 'block_type', i.block_type
               )
               order by
                 case i.block_type
                   when 'required_nage' then 1
                   when 'required_katame' then 2
                   when 'additional' then 3
                   else 4
                 end,
                 i.sort_order,
                 jt.name
             ),
             '[]'::jsonb
           )
      into v_techniques
    from public.student_kyu_program_items i
    join public.judo_techniques jt on jt.id = i.technique_id
    where i.student_kyu_program_id = v_program_id;

    return jsonb_build_object(
      'currentKyu', v_current_kyu,
      'nextKyu', v_next_kyu,
      'nextKyuLookupId', v_next_id,
      'status', 'ok',
      'source', 'individual',
      'version', v_program_version,
      'techniques', v_techniques
    );
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'technique_id', jt.id,
               'name', jt.name,
               'category', jt.category,
               'main_group', jt.main_group,
               'image_path', jt.image_path,
               'youtube_url', jt.youtube_url,
               'youtube_video_id', jt.youtube_video_id,
               'sort_order', ckpi.sort_order,
               'block_type', ckpi.block_type
             )
             order by
               case ckpi.block_type
                 when 'required_nage' then 1
                 when 'required_katame' then 2
                 when 'additional' then 3
                 else 4
               end,
               ckpi.sort_order,
               jt.name
           ),
           '[]'::jsonb
         )
    into v_techniques
  from public.club_kyu_program_items ckpi
  join public.judo_techniques jt on jt.id = ckpi.technique_id
  where ckpi.club_id = v_student.club_id
    and ckpi.kyu_lookup_id = v_next_id
    and ckpi.item_type = 'technique';

  return jsonb_build_object(
    'currentKyu', v_current_kyu,
    'nextKyu', v_next_kyu,
    'nextKyuLookupId', v_next_id,
    'status', 'ok',
    'source', 'club',
    'version', null,
    'techniques', v_techniques
  );
end;
$$;

comment on function public.get_required_techniques_for_student(bigint) is
  'ЕДИНСТВЕННАЯ точка вычисления Required Techniques (effective program следующего Kyu): active student_kyu_programs для (student, next Kyu, текущий club) -> source=individual, иначе club_kyu_program_items -> source=club (миграция 20260930100076). НЕ access-check RPC. Вызывается из get_family_required_techniques/get_trainer_required_techniques и get-student-preview (service_role). EXECUTE закрыт для anon/authenticated/public.';

revoke all on function public.get_required_techniques_for_student(bigint) from public;
revoke all on function public.get_required_techniques_for_student(bigint) from anon;
revoke all on function public.get_required_techniques_for_student(bigint) from authenticated;
grant execute on function public.get_required_techniques_for_student(bigint) to service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. TRAINER READ WRAPPER — + canEdit
-- ══════════════════════════════════════════════════════════════════════
-- READ-проверка БЕЗ ИЗМЕНЕНИЙ (can_trainer_access_student_page, та же форма
-- отказа, что в 065). Добавлено только поле canEdit (EDIT-проверка выше).
-- get_family_required_techniques НЕ меняется и canEdit не получает.
create or replace function public.get_trainer_required_techniques(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_empty_result jsonb := jsonb_build_object(
    'currentKyu', null, 'nextKyu', null, 'status', 'no_current_kyu', 'techniques', '[]'::jsonb
  );
begin
  if (select auth.uid()) is null then
    return v_empty_result;
  end if;

  if not public.can_trainer_access_student_page(p_student_id) then
    return v_empty_result;
  end if;

  return public.get_required_techniques_for_student(p_student_id)
    || jsonb_build_object('canEdit', coalesce(private.can_trainer_edit_student_page(p_student_id), false));
end;
$$;

comment on function public.get_trainer_required_techniques(bigint) is
  'Trainer read-path "Необходимые техники" (effective program). Access-gate — can_trainer_access_student_page (группы + подписка, учитывает trainer_access_after_expiry как READ-исключение). canEdit — private.can_trainer_edit_student_page (группы + Student Page active, без исключения). Миграция 20260930100076.';

-- ══════════════════════════════════════════════════════════════════════
-- 7. WRITE RPC: SAVE
-- ══════════════════════════════════════════════════════════════════════
-- Возвращает jsonb {ok, reason?, version?, currentVersion?}.
-- reason: not_allowed (нет тренера/нет связи с учеником — один ответ, без
--         раскрытия существования ученика) | page_inactive | target_kyu_changed |
--         invalid_items | version_conflict.
-- p_expected_version — версия, открытая в редакторе (NULL = индивидуальной
-- программы не было). Любое расхождение с текущей active -> version_conflict,
-- БД не меняется. Advisory-lock на (student, kyu) сериализует одновременные
-- Save/Reset, partial unique index — вторая линия защиты.
create function public.save_trainer_student_kyu_program(
  p_student_id bigint,
  p_kyu_lookup_id bigint,
  p_items jsonb,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_club_id text;
  v_kyu_grad text;
  v_next_id bigint;
  v_items jsonb;
  v_invalid integer;
  v_active_id uuid;
  v_active_version integer;
  v_new_version integer;
  v_new_id uuid;
  v_matches_club boolean;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  v_account_id := private.current_active_trainer_account_id();
  if v_account_id is null or not public.can_trainer_access_student(p_student_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  if not private.can_trainer_edit_student_page(p_student_id) then
    return jsonb_build_object('ok', false, 'reason', 'page_inactive');
  end if;

  select s.club_id, s.kyu_grad into v_club_id, v_kyu_grad
  from public.students s
  where s.id = p_student_id;

  v_next_id := public.resolve_next_kyu_lookup_id(v_kyu_grad);
  if v_next_id is null or v_next_id is distinct from p_kyu_lookup_id then
    return jsonb_build_object('ok', false, 'reason', 'target_kyu_changed');
  end if;

  v_items := coalesce(p_items, '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_items');
  end if;

  select count(*) into v_invalid
  from jsonb_array_elements(v_items) as elem
  where jsonb_typeof(elem) <> 'object'
     or (elem ->> 'block_type') is null
     or (elem ->> 'block_type') not in ('required_nage', 'required_katame', 'additional')
     or (elem ->> 'technique_id') is null
     or (elem ->> 'technique_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  if v_invalid > 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_items');
  end if;

  select count(*) into v_invalid
  from (select distinct (elem ->> 'technique_id')::uuid as technique_id
        from jsonb_array_elements(v_items) as elem) t
  where not exists (select 1 from public.judo_techniques jt where jt.id = t.technique_id and jt.active = true);
  if v_invalid > 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_items');
  end if;

  perform pg_advisory_xact_lock(hashtext('jkl.student_kyu_program'), hashtext(p_student_id::text || ':' || v_next_id::text));

  select p.id, p.version into v_active_id, v_active_version
  from public.student_kyu_programs p
  where p.student_id = p_student_id and p.kyu_lookup_id = v_next_id and p.status = 'active'
  for update;

  if v_active_version is distinct from p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict', 'currentVersion', v_active_version);
  end if;

  select coalesce(max(p.version), 0) + 1 into v_new_version
  from public.student_kyu_programs p
  where p.student_id = p_student_id and p.kyu_lookup_id = v_next_id;

  -- source: совпадает ли сохраняемый набор (block_type, technique_id) с
  -- программой клуба для этого Kyu В МОМЕНТ SAVE.
  select not exists (
           (select distinct elem ->> 'block_type', (elem ->> 'technique_id')::uuid from jsonb_array_elements(v_items) elem)
           except
           (select c.block_type, c.technique_id from public.club_kyu_program_items c
            where c.club_id = v_club_id and c.kyu_lookup_id = v_next_id and c.item_type = 'technique')
         )
     and not exists (
           (select c.block_type, c.technique_id from public.club_kyu_program_items c
            where c.club_id = v_club_id and c.kyu_lookup_id = v_next_id and c.item_type = 'technique')
           except
           (select distinct elem ->> 'block_type', (elem ->> 'technique_id')::uuid from jsonb_array_elements(v_items) elem)
         )
    into v_matches_club;

  if v_active_id is not null then
    update public.student_kyu_programs
       set status = 'superseded', ended_at = now(), ended_by_trainer_account_id = v_account_id
     where id = v_active_id;
  end if;

  insert into public.student_kyu_programs
    (club_id, student_id, kyu_lookup_id, version, status, source, created_by_trainer_account_id)
  values
    (v_club_id, p_student_id, v_next_id, v_new_version, 'active',
     case when v_matches_club then 'club_copy' else 'edited' end, v_account_id)
  returning id into v_new_id;

  with parsed as (
    select (elem ->> 'technique_id')::uuid as technique_id, elem ->> 'block_type' as block_type, ord
    from jsonb_array_elements(v_items) with ordinality as arr(elem, ord)
  ),
  deduped as (
    select distinct on (block_type, technique_id) technique_id, block_type, ord
    from parsed
    order by block_type, technique_id, ord
  ),
  ranked as (
    select technique_id, block_type, row_number() over (partition by block_type order by ord) as rn
    from deduped
  )
  insert into public.student_kyu_program_items (student_kyu_program_id, technique_id, block_type, sort_order)
  select v_new_id, technique_id, block_type, rn - 1
  from ranked;

  return jsonb_build_object('ok', true, 'version', v_new_version);
end;
$$;

comment on function public.save_trainer_student_kyu_program(bigint, bigint, jsonb, integer) is
  'Trainer-only Save индивидуальной программы ученика для ТЕКУЩЕГО target Kyu: создаёт immutable version N+1 (prev active -> superseded). Проверки: активный тренер, общая группа (can_trainer_access_student), Student Page active для записи (private.can_trainer_edit_student_page), target Kyu пересчитывается сервером, items валидируются, optimistic concurrency через p_expected_version, advisory lock. club_id с клиента не принимается. Миграция 20260930100076.';

revoke all on function public.save_trainer_student_kyu_program(bigint, bigint, jsonb, integer) from public;
revoke all on function public.save_trainer_student_kyu_program(bigint, bigint, jsonb, integer) from anon;
grant execute on function public.save_trainer_student_kyu_program(bigint, bigint, jsonb, integer) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 8. WRITE RPC: RESET TO CLUB PROGRAM
-- ══════════════════════════════════════════════════════════════════════
-- Те же проверки, что Save. active -> reset (+ ended_*), items НЕ удаляются.
-- После Reset resolver снова отдаёт ТЕКУЩУЮ программу клуба; следующий Save
-- продолжит нумерацию (N+1). Нет active и p_expected_version NULL -> ok
-- (идемпотентно, нечего сбрасывать); нет active, но версия ожидалась ->
-- version_conflict (кто-то уже сбросил/изменил).
create function public.reset_trainer_student_kyu_program(
  p_student_id bigint,
  p_kyu_lookup_id bigint,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_kyu_grad text;
  v_next_id bigint;
  v_active_id uuid;
  v_active_version integer;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  v_account_id := private.current_active_trainer_account_id();
  if v_account_id is null or not public.can_trainer_access_student(p_student_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  if not private.can_trainer_edit_student_page(p_student_id) then
    return jsonb_build_object('ok', false, 'reason', 'page_inactive');
  end if;

  select s.kyu_grad into v_kyu_grad from public.students s where s.id = p_student_id;
  v_next_id := public.resolve_next_kyu_lookup_id(v_kyu_grad);
  if v_next_id is null or v_next_id is distinct from p_kyu_lookup_id then
    return jsonb_build_object('ok', false, 'reason', 'target_kyu_changed');
  end if;

  perform pg_advisory_xact_lock(hashtext('jkl.student_kyu_program'), hashtext(p_student_id::text || ':' || v_next_id::text));

  select p.id, p.version into v_active_id, v_active_version
  from public.student_kyu_programs p
  where p.student_id = p_student_id and p.kyu_lookup_id = v_next_id and p.status = 'active'
  for update;

  if v_active_version is distinct from p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict', 'currentVersion', v_active_version);
  end if;

  if v_active_id is null then
    return jsonb_build_object('ok', true, 'version', null);
  end if;

  update public.student_kyu_programs
     set status = 'reset', ended_at = now(), ended_by_trainer_account_id = v_account_id
   where id = v_active_id;

  return jsonb_build_object('ok', true, 'version', null);
end;
$$;

comment on function public.reset_trainer_student_kyu_program(bigint, bigint, integer) is
  'Trainer-only "Вернуть программу клуба": active версия индивидуальной программы -> reset (история и items сохраняются), resolver снова отдаёт текущую программу клуба. Те же проверки доступа, что save_trainer_student_kyu_program, включая запрет записи через trainer_access_after_expiry. Миграция 20260930100076.';

revoke all on function public.reset_trainer_student_kyu_program(bigint, bigint, integer) from public;
revoke all on function public.reset_trainer_student_kyu_program(bigint, bigint, integer) from anon;
grant execute on function public.reset_trainer_student_kyu_program(bigint, bigint, integer) to authenticated;
