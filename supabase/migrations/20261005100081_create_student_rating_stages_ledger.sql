-- Student Rating Stages + Immutable Rating Ledger (Rating Database Design, Migration B2).
--
-- Только схема и инварианты. НЕ создаёт этапы/записи, не читает attendance,
-- не импортирует students.kyu_grad, не создаёт историю Kyu, не меняет
-- students / attendance / kyu_lookup / student_kyu_history. Bootstrap, RPC,
-- Promote, Rebase, сверка посещаемости — отдельные будущие этапы.
--
-- student_rating_stages — период рейтинга ученика на одной ступени Judo
-- (Kyu или Dan из kyu_lookup):
--   * starts_on_basis = 'kyu_obtained'      -> kyu_history_id указывает на
--     действующий (терминальный, не retracted) факт student_kyu_history,
--     starts_on = его obtained_on;
--   * starts_on_basis = 'club_rating_start' -> kyu_history_id NULL (дата ступени
--     неизвестна; starts_on — технический старт рейтинга клуба, НЕ дата
--     получения ступени). Значение даты задаёт будущий bootstrap; схема его не
--     хардкодит.
--   * не более одного active этапа на ученика; этапы ученика — линейная
--     цепочка через previous_stage_id (один корень, каждый этап продолжается
--     не более одного раза).
--   * ends_on — последний включённый день этапа (NULL у active). Единственное
--     разрешённое изменение — active -> closed (promotion | rebase) будущим
--     definer-workflow. К какому этапу относится день повышения, решает будущий
--     Promote RPC; схема ни один вариант не навязывает.
--
-- student_rating_entries — неизменяемый журнал. Авторитетный итог этапа =
-- SUM(points); хранимого итога нет. V1 source_type: attendance_day,
-- admin_adjustment, reversal.
--   * attendance_day: +1 за местный день клуба; корень дня уникален на
--     (stage_id, effective_on); повторное начисление после отмены — только
--     через reaward_after_entry_id -> отмена награды того же дня.
--   * reversal: точная компенсация одной записи (points = -target.points),
--     не отменяет отмену, одна отмена на запись; effective_on = effective_on
--     цели (то же место в периоде этапа), время отмены — created_at.
--   * admin_adjustment: только Admin, points <> 0, |points| <= 1000, причина и
--     idempotency_key обязательны.
--   * ИТОГ ЭТАПА НИКОГДА НЕ ОТРИЦАТЕЛЕН: триггер вставки блокирует строку этапа
--     (FOR UPDATE), считает SUM и отклоняет запись, если итог станет < 0
--     (включая отмену посещаемости — это конфликт сверки, решается Admin позже).
--   * записи принимаются только в active этап, effective_on в
--     [starts_on, club_today]; неизвестный пояс клуба -> отказ.
--
-- Блокировки: строка этапа (FOR UPDATE) сериализует все записи журнала и
-- закрытие этапа. Будущие RPC, меняющие несколько сущностей ученика
-- (Promote, Rebase, сверка, запись истории Kyu), дополнительно берут
-- pg_advisory_xact_lock(hashtext('jkl.student_rating'), hashtext(student_id::text))
-- — ключ из B1. Проверки итога и закрытия требуют READ COMMITTED (как 078).
--
-- Проверка: docs/database/STUDENT_RATING_B2_SQL_VERIFICATION.md

begin;

-- ══════════════════════════════════════════════════════════════════════
-- 1. student_rating_stages
-- ══════════════════════════════════════════════════════════════════════
create table public.student_rating_stages (
  id uuid not null default gen_random_uuid(),
  club_id text not null,
  student_id bigint not null,
  kyu_lookup_id bigint not null,
  kyu_grad_snapshot text not null,
  starts_on date not null,
  starts_on_basis text not null,
  kyu_history_id uuid null,
  previous_stage_id uuid null,
  status text not null,
  ends_on date null,
  closed_reason text null,
  closed_note text null,
  closed_at timestamptz null,
  closed_by_kind text null,
  closed_by_trainer_account_id uuid null,
  closed_by_portal_role text null,
  created_by_kind text not null,
  created_by_trainer_account_id uuid null,
  created_by_portal_role text null,
  created_at timestamptz not null default now(),
  constraint student_rating_stages_pkey primary key (id),
  constraint student_rating_stages_scope_key unique (id, student_id, club_id),
  constraint student_rating_stages_previous_once unique (previous_stage_id),
  constraint student_rating_stages_student_fk
    foreign key (student_id) references public.students(id) on delete restrict,
  constraint student_rating_stages_kyu_lookup_fk
    foreign key (kyu_lookup_id) references public.kyu_lookup(id) on delete restrict,
  constraint student_rating_stages_kyu_history_fk
    foreign key (kyu_history_id, student_id, club_id, kyu_lookup_id)
    references public.student_kyu_history(id, student_id, club_id, kyu_lookup_id)
    on delete restrict,
  constraint student_rating_stages_created_by_fk
    foreign key (created_by_trainer_account_id) references public.trainer_accounts(id) on delete restrict,
  constraint student_rating_stages_closed_by_fk
    foreign key (closed_by_trainer_account_id) references public.trainer_accounts(id) on delete restrict,
  constraint student_rating_stages_basis_check
    check (starts_on_basis in ('kyu_obtained', 'club_rating_start')),
  constraint student_rating_stages_basis_history_shape
    check ((starts_on_basis = 'kyu_obtained') = (kyu_history_id is not null)),
  constraint student_rating_stages_status_check
    check (status in ('active', 'closed')),
  constraint student_rating_stages_closed_reason_check
    check (closed_reason is null or closed_reason in ('promotion', 'rebase')),
  constraint student_rating_stages_closed_by_kind_check
    check (closed_by_kind is null or closed_by_kind in ('system', 'trainer_account')),
  constraint student_rating_stages_created_by_kind_check
    check (created_by_kind in ('system', 'trainer_account')),
  constraint student_rating_stages_role_check
    check ((created_by_portal_role is null or created_by_portal_role in ('trainer', 'admin'))
           and (closed_by_portal_role is null or closed_by_portal_role in ('trainer', 'admin'))),
  -- active: все поля закрытия пусты; closed: ends_on/reason/closed_at/kind заданы.
  constraint student_rating_stages_close_shape
    check (
      (status = 'active'
        and ends_on is null and closed_reason is null and closed_note is null
        and closed_at is null and closed_by_kind is null
        and closed_by_trainer_account_id is null and closed_by_portal_role is null)
      or
      (status = 'closed'
        and ends_on is not null and closed_reason is not null
        and closed_at is not null and closed_by_kind is not null)
    ),
  constraint student_rating_stages_ends_after_start
    check (ends_on is null or ends_on >= starts_on),
  constraint student_rating_stages_closed_note_check
    check ((closed_note is null or btrim(closed_note) <> '')
           and (closed_reason is distinct from 'rebase' or closed_note is not null)),
  constraint student_rating_stages_created_by_shape
    check ((created_by_trainer_account_id is not null) = (created_by_kind = 'trainer_account')
           and (created_by_trainer_account_id is null) = (created_by_portal_role is null)),
  constraint student_rating_stages_closed_by_shape
    check ((closed_by_trainer_account_id is not null) = (closed_by_kind is not distinct from 'trainer_account')
           and (closed_by_trainer_account_id is null) = (closed_by_portal_role is null)),
  constraint student_rating_stages_not_self
    check (previous_stage_id is null or previous_stage_id <> id),
  constraint student_rating_stages_snapshot_check
    check (btrim(kyu_grad_snapshot) <> ''),
  constraint student_rating_stages_club_id_check
    check (btrim(club_id) <> '')
);

-- Предыдущий этап — того же ученика и клуба.
alter table public.student_rating_stages
  add constraint student_rating_stages_previous_fk
  foreign key (previous_stage_id, student_id, club_id)
  references public.student_rating_stages(id, student_id, club_id)
  on delete restrict;

-- Не более одного active этапа на ученика (ученик принадлежит одному клубу,
-- V1 — только Judo, поэтому student_id — минимальный корректный ключ).
create unique index student_rating_stages_one_active_uidx
  on public.student_rating_stages (student_id)
  where status = 'active';

-- Один корень цепочки этапов на ученика (с UNIQUE(previous_stage_id) —
-- цепочка линейна).
create unique index student_rating_stages_one_root_uidx
  on public.student_rating_stages (student_id)
  where previous_stage_id is null;

create index student_rating_stages_student_idx
  on public.student_rating_stages (student_id, created_at);
create index student_rating_stages_kyu_lookup_idx
  on public.student_rating_stages (kyu_lookup_id);
create index student_rating_stages_kyu_history_idx
  on public.student_rating_stages (kyu_history_id);
create index student_rating_stages_created_by_idx
  on public.student_rating_stages (created_by_trainer_account_id);
create index student_rating_stages_closed_by_idx
  on public.student_rating_stages (closed_by_trainer_account_id);

alter table public.student_rating_stages owner to postgres;

comment on table public.student_rating_stages is
  'Период рейтинга ученика на одной ступени Judo (Kyu/Dan). Не более одного active на ученика; линейная цепочка через previous_stage_id. kyu_obtained -> действующий факт student_kyu_history (starts_on = obtained_on); club_rating_start -> технический старт клуба, без факта истории. Единственное изменение — active -> closed (promotion/rebase) будущим definer-workflow; DELETE/TRUNCATE запрещены. Migration B2 (20261005100081).';
comment on column public.student_rating_stages.starts_on is
  'Первый день этапа (местный день клуба). Для club_rating_start — технический старт рейтинга клуба, НЕ дата получения ступени.';
comment on column public.student_rating_stages.ends_on is
  'Последний включённый день закрытого этапа; NULL у active. Граница дня повышения определяется будущим Promote RPC.';
comment on column public.student_rating_stages.kyu_history_id is
  'Факт student_kyu_history (той же цепочки ученик/клуб/ступень), действующий на момент создания этапа. Позднее исправление факта не меняет этап — для этого будущий аудируемый rebase.';

-- ══════════════════════════════════════════════════════════════════════
-- 2. student_rating_entries
-- ══════════════════════════════════════════════════════════════════════
create table public.student_rating_entries (
  id uuid not null default gen_random_uuid(),
  club_id text not null,
  student_id bigint not null,
  stage_id uuid not null,
  source_type text not null,
  effective_on date not null,
  points integer not null,
  reversal_of_entry_id uuid null,
  reaward_after_entry_id uuid null,
  idempotency_key uuid null,
  reason text null,
  created_by_kind text not null,
  created_by_trainer_account_id uuid null,
  created_by_portal_role text null,
  created_at timestamptz not null default now(),
  constraint student_rating_entries_pkey primary key (id),
  constraint student_rating_entries_chain_key unique (id, stage_id, effective_on),
  constraint student_rating_entries_reversal_once unique (reversal_of_entry_id),
  constraint student_rating_entries_reaward_once unique (reaward_after_entry_id),
  constraint student_rating_entries_idempotency_key unique (stage_id, idempotency_key),
  constraint student_rating_entries_stage_fk
    foreign key (stage_id, student_id, club_id)
    references public.student_rating_stages(id, student_id, club_id)
    on delete restrict,
  constraint student_rating_entries_created_by_fk
    foreign key (created_by_trainer_account_id) references public.trainer_accounts(id) on delete restrict,
  constraint student_rating_entries_source_type_check
    check (source_type in ('attendance_day', 'admin_adjustment', 'reversal')),
  constraint student_rating_entries_created_by_kind_check
    check (created_by_kind in ('system', 'trainer_account')),
  constraint student_rating_entries_created_by_shape
    check ((created_by_trainer_account_id is not null) = (created_by_kind = 'trainer_account')
           and (created_by_trainer_account_id is null) = (created_by_portal_role is null)),
  -- V1: вручную пишет только Admin.
  constraint student_rating_entries_author_role_check
    check (created_by_portal_role is null or created_by_portal_role = 'admin'),
  constraint student_rating_entries_attendance_shape
    check (source_type <> 'attendance_day'
           or (points = 1 and created_by_kind = 'system' and reason is null)),
  constraint student_rating_entries_adjustment_shape
    check (source_type <> 'admin_adjustment'
           or (points <> 0 and abs(points) <= 1000
               and created_by_kind = 'trainer_account' and reason is not null)),
  constraint student_rating_entries_reversal_shape
    check ((source_type = 'reversal') = (reversal_of_entry_id is not null)
           and (source_type <> 'reversal' or (points <> 0 and reason is not null))),
  constraint student_rating_entries_reaward_shape
    check (reaward_after_entry_id is null or source_type = 'attendance_day'),
  constraint student_rating_entries_idempotency_shape
    check ((source_type = 'admin_adjustment') = (idempotency_key is not null)),
  constraint student_rating_entries_reason_check
    check (reason is null or btrim(reason) <> ''),
  constraint student_rating_entries_not_self
    check ((reversal_of_entry_id is null or reversal_of_entry_id <> id)
           and (reaward_after_entry_id is null or reaward_after_entry_id <> id)),
  constraint student_rating_entries_club_id_check
    check (btrim(club_id) <> '')
);

-- Отмена и повторная награда — в том же этапе и в тот же effective_on.
alter table public.student_rating_entries
  add constraint student_rating_entries_reversal_fk
  foreign key (reversal_of_entry_id, stage_id, effective_on)
  references public.student_rating_entries(id, stage_id, effective_on)
  on delete restrict;

alter table public.student_rating_entries
  add constraint student_rating_entries_reaward_fk
  foreign key (reaward_after_entry_id, stage_id, effective_on)
  references public.student_rating_entries(id, stage_id, effective_on)
  on delete restrict;

-- Корень посещаемости: одна первичная награда на этап + местный день.
create unique index student_rating_entries_attendance_root_uidx
  on public.student_rating_entries (stage_id, effective_on)
  where source_type = 'attendance_day' and reaward_after_entry_id is null;

create index student_rating_entries_stage_day_idx
  on public.student_rating_entries (stage_id, effective_on);
create index student_rating_entries_student_idx
  on public.student_rating_entries (student_id, created_at);
create index student_rating_entries_created_by_idx
  on public.student_rating_entries (created_by_trainer_account_id);

alter table public.student_rating_entries owner to postgres;

comment on table public.student_rating_entries is
  'Неизменяемый журнал рейтинга. Итог этапа = SUM(points), никогда < 0 (проверка под блокировкой строки этапа). V1: attendance_day (+1, корень уникален на этап+день, повтор — через reaward_after_entry_id), admin_adjustment (Admin, причина, idempotency_key), reversal (точная компенсация одной записи). UPDATE/DELETE/TRUNCATE запрещены. Migration B2 (20261005100081).';
comment on column public.student_rating_entries.effective_on is
  'Местный день клуба. attendance_day — день посещения; reversal — effective_on отменяемой записи; admin_adjustment — день корректировки.';
comment on column public.student_rating_entries.reaward_after_entry_id is
  'Повторная attendance_day после отмены: ссылка на reversal, отменивший предыдущую награду того же этапа и дня.';

-- ══════════════════════════════════════════════════════════════════════
-- 3. Триггерные функции
-- ══════════════════════════════════════════════════════════════════════

-- Общий запрет изменения (UPDATE/DELETE row, TRUNCATE statement).
-- Не SECURITY DEFINER: ничего не читает.
create function private.reject_student_rating_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%_immutable', tg_table_name
    using detail = format('%s is not allowed on %s', tg_op, tg_table_name);
end;
$$;

alter function private.reject_student_rating_mutation() owner to postgres;
comment on function private.reject_student_rating_mutation() is
  'Отклоняет изменение student_rating_stages (DELETE/TRUNCATE) и student_rating_entries (UPDATE/DELETE/TRUNCATE) для всех ролей. Сообщение: <table>_immutable. Migration B2.';
revoke all on function private.reject_student_rating_mutation() from public, anon, authenticated;
revoke all on function private.reject_student_rating_mutation() from service_role;

-- Вставка этапа.
create function private.enforce_student_rating_stages_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_club text;
  v_student_sport text;
  v_grade text;
  v_hist_kind text;
  v_hist_obtained date;
  v_prev_status text;
  v_author_club text;
  v_author_active boolean;
  v_author_role text;
begin
  new.created_at := pg_catalog.now();

  if new.status <> 'active' then
    raise exception 'student_rating_stages_insert_must_be_active';
  end if;

  select s.club_id, s.sport_id into v_student_club, v_student_sport
  from public.students s where s.id = new.student_id;
  if not found then
    raise exception 'student_rating_stages_unknown_student'
      using detail = format('student_id %s does not exist', new.student_id);
  end if;
  if v_student_club is distinct from new.club_id then
    raise exception 'student_rating_stages_club_mismatch';
  end if;
  if v_student_sport is distinct from 'judo' then
    raise exception 'student_rating_stages_not_judo';
  end if;

  select kl.kyu_grad into v_grade from public.kyu_lookup kl where kl.id = new.kyu_lookup_id;
  if not found then
    raise exception 'student_rating_stages_unknown_grade';
  end if;
  if v_grade is null or btrim(v_grade) = '' then
    raise exception 'student_rating_stages_invalid_grade';
  end if;
  if new.kyu_grad_snapshot is distinct from v_grade then
    raise exception 'student_rating_stages_snapshot_mismatch';
  end if;

  if new.starts_on > private.club_today(new.club_id) then
    raise exception 'student_rating_stages_future_start';
  end if;

  if new.starts_on_basis = 'kyu_obtained' then
    -- Факт той же цепочки (гарантирует составной FK), действующий сейчас:
    -- терминальный и не retracted; starts_on = obtained_on.
    select h.entry_kind, h.obtained_on into v_hist_kind, v_hist_obtained
    from public.student_kyu_history h
    where h.id = new.kyu_history_id
      and h.student_id = new.student_id
      and h.club_id = new.club_id
      and h.kyu_lookup_id = new.kyu_lookup_id;
    if not found then
      raise exception 'student_rating_stages_invalid_kyu_history';
    end if;
    if v_hist_kind = 'retracted'
       or exists (select 1 from public.student_kyu_history h2 where h2.supersedes_id = new.kyu_history_id) then
      raise exception 'student_rating_stages_kyu_history_not_effective';
    end if;
    if new.starts_on is distinct from v_hist_obtained then
      raise exception 'student_rating_stages_start_not_obtained_on';
    end if;
  end if;

  if new.previous_stage_id is not null then
    select p.status into v_prev_status
    from public.student_rating_stages p
    where p.id = new.previous_stage_id
      and p.student_id = new.student_id
      and p.club_id = new.club_id;
    if not found then
      raise exception 'student_rating_stages_invalid_previous';
    end if;
    if v_prev_status <> 'closed' then
      raise exception 'student_rating_stages_previous_not_closed';
    end if;
    if exists (select 1 from public.student_rating_stages n where n.previous_stage_id = new.previous_stage_id) then
      raise exception 'student_rating_stages_previous_already_continued';
    end if;
  elsif exists (select 1 from public.student_rating_stages r
                where r.student_id = new.student_id and r.previous_stage_id is null) then
    raise exception 'student_rating_stages_root_exists';
  end if;

  if exists (select 1 from public.student_rating_stages a
             where a.student_id = new.student_id and a.status = 'active') then
    raise exception 'student_rating_stages_active_exists';
  end if;

  if new.created_by_trainer_account_id is not null then
    select ta.club_id, ta.is_active, ta.portal_role
      into v_author_club, v_author_active, v_author_role
    from public.trainer_accounts ta where ta.id = new.created_by_trainer_account_id;
    if not found or v_author_active is not true or v_author_club is distinct from new.club_id then
      raise exception 'student_rating_stages_invalid_author';
    end if;
    if v_author_role is distinct from new.created_by_portal_role then
      raise exception 'student_rating_stages_author_role_mismatch';
    end if;
  end if;

  return new;
end;
$$;

alter function private.enforce_student_rating_stages_insert() owner to postgres;
comment on function private.enforce_student_rating_stages_insert() is
  'BEFORE INSERT student_rating_stages: только active; ученик (клуб, judo), ступень и снимок; starts_on <= club_today; kyu_obtained -> действующий факт истории и starts_on = obtained_on; previous — закрытый этап того же ученика, не продолженный ранее; один корень и один active; автор — активный аккаунт клуба с текущей ролью. SECURITY DEFINER. Migration B2.';
revoke all on function private.enforce_student_rating_stages_insert() from public, anon, authenticated;
revoke all on function private.enforce_student_rating_stages_insert() from service_role;

-- Изменение этапа: только active -> closed.
create function private.enforce_student_rating_stages_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_club text;
  v_author_active boolean;
  v_author_role text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'student_rating_stages_close_requires_read_committed'
      using errcode = '25001';
  end if;

  if old.status <> 'active' or new.status <> 'closed' then
    raise exception 'student_rating_stages_immutable'
      using detail = 'only the transition active -> closed is allowed';
  end if;

  if (new.id, new.club_id, new.student_id, new.kyu_lookup_id, new.kyu_grad_snapshot,
      new.starts_on, new.starts_on_basis, new.kyu_history_id, new.previous_stage_id,
      new.created_by_kind, new.created_by_trainer_account_id, new.created_by_portal_role,
      new.created_at)
     is distinct from
     (old.id, old.club_id, old.student_id, old.kyu_lookup_id, old.kyu_grad_snapshot,
      old.starts_on, old.starts_on_basis, old.kyu_history_id, old.previous_stage_id,
      old.created_by_kind, old.created_by_trainer_account_id, old.created_by_portal_role,
      old.created_at) then
    raise exception 'student_rating_stages_immutable'
      using detail = 'only closing fields may change on active -> closed';
  end if;

  new.closed_at := pg_catalog.now();

  if new.ends_on is null or new.ends_on > private.club_today(new.club_id) then
    raise exception 'student_rating_stages_invalid_end';
  end if;

  if exists (select 1 from public.student_rating_entries e
             where e.stage_id = new.id and e.effective_on > new.ends_on) then
    raise exception 'student_rating_stages_entries_after_end';
  end if;

  if new.closed_by_trainer_account_id is not null then
    select ta.club_id, ta.is_active, ta.portal_role
      into v_author_club, v_author_active, v_author_role
    from public.trainer_accounts ta where ta.id = new.closed_by_trainer_account_id;
    if not found or v_author_active is not true or v_author_club is distinct from new.club_id then
      raise exception 'student_rating_stages_invalid_closer';
    end if;
    if v_author_role is distinct from new.closed_by_portal_role then
      raise exception 'student_rating_stages_closer_role_mismatch';
    end if;
  end if;

  return new;
end;
$$;

alter function private.enforce_student_rating_stages_update() owner to postgres;
comment on function private.enforce_student_rating_stages_update() is
  'BEFORE UPDATE student_rating_stages: только active -> closed, прочие поля неизменны; closed_at = now(); ends_on <= club_today; нет записей журнала после ends_on; закрывающий — активный аккаунт клуба с текущей ролью. Требует READ COMMITTED. SECURITY DEFINER. Migration B2.';
revoke all on function private.enforce_student_rating_stages_update() from public, anon, authenticated;
revoke all on function private.enforce_student_rating_stages_update() from service_role;

-- Вставка записи журнала.
create function private.enforce_student_rating_entries_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage_student bigint;
  v_stage_club text;
  v_stage_status text;
  v_stage_starts date;
  v_target_type text;
  v_target_points integer;
  v_target_reversal_of uuid;
  v_reversed_type text;
  v_author_club text;
  v_author_active boolean;
  v_author_role text;
  v_total bigint;
begin
  new.created_at := pg_catalog.now();

  if new.points < 0 and current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'student_rating_entries_requires_read_committed'
      using errcode = '25001';
  end if;

  -- Блокировка строки этапа сериализует записи журнала и закрытие этапа.
  select st.student_id, st.club_id, st.status, st.starts_on
    into v_stage_student, v_stage_club, v_stage_status, v_stage_starts
  from public.student_rating_stages st
  where st.id = new.stage_id
  for update;
  if not found then
    raise exception 'student_rating_entries_unknown_stage';
  end if;
  if v_stage_student is distinct from new.student_id or v_stage_club is distinct from new.club_id then
    raise exception 'student_rating_entries_stage_mismatch';
  end if;
  if v_stage_status <> 'active' then
    raise exception 'student_rating_entries_stage_closed';
  end if;
  if new.effective_on < v_stage_starts or new.effective_on > private.club_today(new.club_id) then
    raise exception 'student_rating_entries_outside_stage'
      using detail = format('effective_on %s is outside [%s, club today]', new.effective_on, v_stage_starts);
  end if;

  if new.created_by_trainer_account_id is not null then
    select ta.club_id, ta.is_active, ta.portal_role
      into v_author_club, v_author_active, v_author_role
    from public.trainer_accounts ta where ta.id = new.created_by_trainer_account_id;
    if not found or v_author_active is not true or v_author_club is distinct from new.club_id then
      raise exception 'student_rating_entries_invalid_author';
    end if;
    if v_author_role is distinct from new.created_by_portal_role then
      raise exception 'student_rating_entries_author_role_mismatch';
    end if;
  end if;

  if new.source_type = 'attendance_day' then
    if new.reaward_after_entry_id is null then
      if exists (select 1 from public.student_rating_entries e
                 where e.stage_id = new.stage_id and e.effective_on = new.effective_on
                   and e.source_type = 'attendance_day' and e.reaward_after_entry_id is null) then
        raise exception 'student_rating_entries_attendance_day_exists';
      end if;
    else
      -- reaward: цель — отмена награды посещаемости того же этапа и дня.
      select e.source_type, e.reversal_of_entry_id into v_target_type, v_target_reversal_of
      from public.student_rating_entries e
      where e.id = new.reaward_after_entry_id
        and e.stage_id = new.stage_id and e.effective_on = new.effective_on;
      if not found or v_target_type <> 'reversal' then
        raise exception 'student_rating_entries_invalid_reaward_target';
      end if;
      select e.source_type into v_reversed_type
      from public.student_rating_entries e where e.id = v_target_reversal_of;
      if v_reversed_type is distinct from 'attendance_day' then
        raise exception 'student_rating_entries_invalid_reaward_target';
      end if;
      if exists (select 1 from public.student_rating_entries e
                 where e.reaward_after_entry_id = new.reaward_after_entry_id) then
        raise exception 'student_rating_entries_reaward_already_used';
      end if;
    end if;
  elsif new.source_type = 'reversal' then
    select e.source_type, e.points into v_target_type, v_target_points
    from public.student_rating_entries e
    where e.id = new.reversal_of_entry_id
      and e.stage_id = new.stage_id and e.effective_on = new.effective_on;
    if not found then
      raise exception 'student_rating_entries_invalid_reversal_target';
    end if;
    if v_target_type = 'reversal' then
      raise exception 'student_rating_entries_cannot_reverse_reversal';
    end if;
    if new.points is distinct from -v_target_points then
      raise exception 'student_rating_entries_reversal_points_mismatch';
    end if;
    -- Посещаемость отменяет только система (сверка), корректировку — только Admin.
    if (v_target_type = 'attendance_day' and new.created_by_kind <> 'system')
       or (v_target_type = 'admin_adjustment' and new.created_by_kind <> 'trainer_account') then
      raise exception 'student_rating_entries_reversal_author_mismatch';
    end if;
    if exists (select 1 from public.student_rating_entries e
               where e.reversal_of_entry_id = new.reversal_of_entry_id) then
      raise exception 'student_rating_entries_already_reversed';
    end if;
  end if;

  -- Авторитетный итог этапа не может стать отрицательным.
  select coalesce(sum(e.points), 0) into v_total
  from public.student_rating_entries e
  where e.stage_id = new.stage_id;
  if v_total + new.points < 0 then
    raise exception 'student_rating_entries_negative_total'
      using detail = format('stage total %s + %s would be negative', v_total, new.points);
  end if;

  return new;
end;
$$;

alter function private.enforce_student_rating_entries_insert() owner to postgres;
comment on function private.enforce_student_rating_entries_insert() is
  'BEFORE INSERT student_rating_entries: блокирует строку этапа (FOR UPDATE); этап active и тот же ученик/клуб; effective_on в [starts_on, club_today]; автор — активный Admin клуба; attendance: один корень на день, reaward — через отмену награды того же дня; reversal: точная компенсация, не отмены, автор по типу цели; итог этапа после вставки >= 0. Отрицательные записи требуют READ COMMITTED. SECURITY DEFINER. Migration B2.';
revoke all on function private.enforce_student_rating_entries_insert() from public, anon, authenticated;
revoke all on function private.enforce_student_rating_entries_insert() from service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. Триггеры
-- ══════════════════════════════════════════════════════════════════════
create trigger trg_student_rating_stages_validate
  before insert on public.student_rating_stages
  for each row execute function private.enforce_student_rating_stages_insert();

create trigger trg_student_rating_stages_close
  before update on public.student_rating_stages
  for each row execute function private.enforce_student_rating_stages_update();

create trigger trg_student_rating_stages_no_delete
  before delete on public.student_rating_stages
  for each row execute function private.reject_student_rating_mutation();

create trigger trg_student_rating_stages_no_truncate
  before truncate on public.student_rating_stages
  for each statement execute function private.reject_student_rating_mutation();

create trigger trg_student_rating_entries_validate
  before insert on public.student_rating_entries
  for each row execute function private.enforce_student_rating_entries_insert();

create trigger trg_student_rating_entries_immutable
  before update or delete on public.student_rating_entries
  for each row execute function private.reject_student_rating_mutation();

create trigger trg_student_rating_entries_no_truncate
  before truncate on public.student_rating_entries
  for each statement execute function private.reject_student_rating_mutation();

-- ══════════════════════════════════════════════════════════════════════
-- 5. RLS / права
-- ══════════════════════════════════════════════════════════════════════
-- Production default privileges широкие — явный REVOKE у всех API-ролей.
-- service_role — только SELECT (как 076/079/080). Запись — только будущие
-- definer-RPC (owner postgres). Sequence нет (PK uuid).
alter table public.student_rating_stages enable row level security;
alter table public.student_rating_entries enable row level security;

revoke all on table public.student_rating_stages from public, anon, authenticated;
revoke all on table public.student_rating_stages from service_role;
grant select on table public.student_rating_stages to service_role;

revoke all on table public.student_rating_entries from public, anon, authenticated;
revoke all on table public.student_rating_entries from service_role;
grant select on table public.student_rating_entries to service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. Самопроверка (только структурные инварианты B2)
-- ══════════════════════════════════════════════════════════════════════
-- Поведение проверяется отдельным rollback-only E2E после применения.
-- Любое расхождение — exception -> COMMIT ниже выполняется как ROLLBACK.
do $$
declare
  v_tbl regclass;
  v_fn regprocedure;
  v_spec text;
  v_role text;
  v_priv text;
  v_count integer;
  v_pred text;
begin
  -- Таблицы, владелец, RLS, policies, права
  foreach v_spec in array array['public.student_rating_stages', 'public.student_rating_entries'] loop
    v_tbl := to_regclass(v_spec);
    if v_tbl is null then
      raise exception 'B2 check: % missing', v_spec;
    end if;
    if pg_get_userbyid((select c.relowner from pg_class c where c.oid = v_tbl)) <> 'postgres' then
      raise exception 'B2 check: % owner is not postgres', v_spec;
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = v_tbl) then
      raise exception 'B2 check: RLS not enabled on %', v_spec;
    end if;
    select count(*) into v_count from pg_policy p where p.polrelid = v_tbl;
    if v_count <> 0 then
      raise exception 'B2 check: % policies on %', v_count, v_spec;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
        if has_table_privilege(v_role, v_tbl, v_priv) then
          raise exception 'B2 check: % has % on %', v_role, v_priv, v_spec;
        end if;
      end loop;
    end loop;
    if exists (
      select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.oid = v_tbl and a.grantee = 0
    ) then
      raise exception 'B2 check: PUBLIC has privileges on %', v_spec;
    end if;
    if not has_table_privilege('service_role', v_tbl, 'SELECT') then
      raise exception 'B2 check: service_role lacks SELECT on %', v_spec;
    end if;
    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege('service_role', v_tbl, v_priv) then
        raise exception 'B2 check: service_role has % on %', v_priv, v_spec;
      end if;
    end loop;
  end loop;

  -- Колонки student_rating_stages: ровно 21
  v_tbl := 'public.student_rating_stages'::regclass;
  select count(*) into v_count from pg_attribute a
  where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped;
  if v_count <> 21 then
    raise exception 'B2 check: student_rating_stages expected 21 columns, found %', v_count;
  end if;
  if (
    select count(*) from pg_attribute a
    where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped
      and (a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull) in (
        ('id', 'uuid', true),
        ('club_id', 'text', true),
        ('student_id', 'bigint', true),
        ('kyu_lookup_id', 'bigint', true),
        ('kyu_grad_snapshot', 'text', true),
        ('starts_on', 'date', true),
        ('starts_on_basis', 'text', true),
        ('kyu_history_id', 'uuid', false),
        ('previous_stage_id', 'uuid', false),
        ('status', 'text', true),
        ('ends_on', 'date', false),
        ('closed_reason', 'text', false),
        ('closed_note', 'text', false),
        ('closed_at', 'timestamp with time zone', false),
        ('closed_by_kind', 'text', false),
        ('closed_by_trainer_account_id', 'uuid', false),
        ('closed_by_portal_role', 'text', false),
        ('created_by_kind', 'text', true),
        ('created_by_trainer_account_id', 'uuid', false),
        ('created_by_portal_role', 'text', false),
        ('created_at', 'timestamp with time zone', true)
      )
  ) <> 21 then
    raise exception 'B2 check: student_rating_stages column names/types/nullability mismatch';
  end if;

  -- Колонки student_rating_entries: ровно 15
  v_tbl := 'public.student_rating_entries'::regclass;
  select count(*) into v_count from pg_attribute a
  where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped;
  if v_count <> 15 then
    raise exception 'B2 check: student_rating_entries expected 15 columns, found %', v_count;
  end if;
  if (
    select count(*) from pg_attribute a
    where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped
      and (a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull) in (
        ('id', 'uuid', true),
        ('club_id', 'text', true),
        ('student_id', 'bigint', true),
        ('stage_id', 'uuid', true),
        ('source_type', 'text', true),
        ('effective_on', 'date', true),
        ('points', 'integer', true),
        ('reversal_of_entry_id', 'uuid', false),
        ('reaward_after_entry_id', 'uuid', false),
        ('idempotency_key', 'uuid', false),
        ('reason', 'text', false),
        ('created_by_kind', 'text', true),
        ('created_by_trainer_account_id', 'uuid', false),
        ('created_by_portal_role', 'text', false),
        ('created_at', 'timestamp with time zone', true)
      )
  ) <> 15 then
    raise exception 'B2 check: student_rating_entries column names/types/nullability mismatch';
  end if;

  -- PK / UNIQUE: таблица|имя|тип|колонки
  foreach v_spec in array array[
    'public.student_rating_stages|student_rating_stages_pkey|p|id',
    'public.student_rating_stages|student_rating_stages_scope_key|u|id,student_id,club_id',
    'public.student_rating_stages|student_rating_stages_previous_once|u|previous_stage_id',
    'public.student_rating_entries|student_rating_entries_pkey|p|id',
    'public.student_rating_entries|student_rating_entries_chain_key|u|id,stage_id,effective_on',
    'public.student_rating_entries|student_rating_entries_reversal_once|u|reversal_of_entry_id',
    'public.student_rating_entries|student_rating_entries_reaward_once|u|reaward_after_entry_id',
    'public.student_rating_entries|student_rating_entries_idempotency_key|u|stage_id,idempotency_key'
  ] loop
    if not exists (
      select 1 from pg_constraint k
      where k.conrelid = to_regclass(split_part(v_spec, '|', 1))
        and k.conname = split_part(v_spec, '|', 2)
        and k.contype::text = split_part(v_spec, '|', 3)
        and (select string_agg(a.attname::text, ',' order by u.ord)
             from unnest(k.conkey) with ordinality u(attnum, ord)
             join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum)
            = split_part(v_spec, '|', 4)
    ) then
      raise exception 'B2 check: key constraint % missing or wrong', split_part(v_spec, '|', 2);
    end if;
  end loop;

  -- FK: таблица|имя|цель|колонки|колонки цели — все ON DELETE RESTRICT
  foreach v_spec in array array[
    'public.student_rating_stages|student_rating_stages_student_fk|public.students|student_id|id',
    'public.student_rating_stages|student_rating_stages_kyu_lookup_fk|public.kyu_lookup|kyu_lookup_id|id',
    'public.student_rating_stages|student_rating_stages_kyu_history_fk|public.student_kyu_history|kyu_history_id,student_id,club_id,kyu_lookup_id|id,student_id,club_id,kyu_lookup_id',
    'public.student_rating_stages|student_rating_stages_created_by_fk|public.trainer_accounts|created_by_trainer_account_id|id',
    'public.student_rating_stages|student_rating_stages_closed_by_fk|public.trainer_accounts|closed_by_trainer_account_id|id',
    'public.student_rating_stages|student_rating_stages_previous_fk|public.student_rating_stages|previous_stage_id,student_id,club_id|id,student_id,club_id',
    'public.student_rating_entries|student_rating_entries_stage_fk|public.student_rating_stages|stage_id,student_id,club_id|id,student_id,club_id',
    'public.student_rating_entries|student_rating_entries_created_by_fk|public.trainer_accounts|created_by_trainer_account_id|id',
    'public.student_rating_entries|student_rating_entries_reversal_fk|public.student_rating_entries|reversal_of_entry_id,stage_id,effective_on|id,stage_id,effective_on',
    'public.student_rating_entries|student_rating_entries_reaward_fk|public.student_rating_entries|reaward_after_entry_id,stage_id,effective_on|id,stage_id,effective_on'
  ] loop
    if not exists (
      select 1 from pg_constraint k
      where k.conrelid = to_regclass(split_part(v_spec, '|', 1))
        and k.contype = 'f'
        and k.conname = split_part(v_spec, '|', 2)
        and k.confrelid = to_regclass(split_part(v_spec, '|', 3))
        and k.confdeltype = 'r'
        and (select string_agg(a.attname::text, ',' order by u.ord)
             from unnest(k.conkey) with ordinality u(attnum, ord)
             join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum)
            = split_part(v_spec, '|', 4)
        and (select string_agg(a.attname::text, ',' order by u.ord)
             from unnest(k.confkey) with ordinality u(attnum, ord)
             join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.attnum)
            = split_part(v_spec, '|', 5)
    ) then
      raise exception 'B2 check: foreign key % missing, wrong or not ON DELETE RESTRICT', split_part(v_spec, '|', 2);
    end if;
  end loop;
  if (select count(*) from pg_constraint k where k.conrelid = 'public.student_rating_stages'::regclass and k.contype = 'f') <> 6
     or (select count(*) from pg_constraint k where k.conrelid = 'public.student_rating_entries'::regclass and k.contype = 'f') <> 4 then
    raise exception 'B2 check: unexpected number of foreign keys';
  end if;

  -- CHECK-ограничения по именам
  select count(*) into v_count from pg_constraint k
  where k.conrelid = 'public.student_rating_stages'::regclass and k.contype = 'c'
    and k.conname in (
      'student_rating_stages_basis_check', 'student_rating_stages_basis_history_shape',
      'student_rating_stages_status_check', 'student_rating_stages_closed_reason_check',
      'student_rating_stages_closed_by_kind_check', 'student_rating_stages_created_by_kind_check',
      'student_rating_stages_role_check', 'student_rating_stages_close_shape',
      'student_rating_stages_ends_after_start', 'student_rating_stages_closed_note_check',
      'student_rating_stages_created_by_shape', 'student_rating_stages_closed_by_shape',
      'student_rating_stages_not_self', 'student_rating_stages_snapshot_check',
      'student_rating_stages_club_id_check');
  if v_count <> 15 then
    raise exception 'B2 check: student_rating_stages expected 15 CHECK constraints, found %', v_count;
  end if;

  select count(*) into v_count from pg_constraint k
  where k.conrelid = 'public.student_rating_entries'::regclass and k.contype = 'c'
    and k.conname in (
      'student_rating_entries_source_type_check', 'student_rating_entries_created_by_kind_check',
      'student_rating_entries_created_by_shape', 'student_rating_entries_author_role_check',
      'student_rating_entries_attendance_shape', 'student_rating_entries_adjustment_shape',
      'student_rating_entries_reversal_shape', 'student_rating_entries_reaward_shape',
      'student_rating_entries_idempotency_shape', 'student_rating_entries_reason_check',
      'student_rating_entries_not_self', 'student_rating_entries_club_id_check');
  if v_count <> 12 then
    raise exception 'B2 check: student_rating_entries expected 12 CHECK constraints, found %', v_count;
  end if;

  -- source_type V1: ровно три значения, без будущих типов
  select pg_get_constraintdef(k.oid) into v_pred from pg_constraint k
  where k.conrelid = 'public.student_rating_entries'::regclass
    and k.conname = 'student_rating_entries_source_type_check';
  if position('attendance_day' in v_pred) = 0 or position('admin_adjustment' in v_pred) = 0
     or position('reversal' in v_pred) = 0
     or v_pred ~* '(competition|camp|event|exam|bonus|manual_sport)' then
    raise exception 'B2 check: source_type check is not exactly the V1 set';
  end if;
  select pg_get_constraintdef(k.oid) into v_pred from pg_constraint k
  where k.conrelid = 'public.student_rating_stages'::regclass
    and k.conname = 'student_rating_stages_basis_check';
  if position('kyu_obtained' in v_pred) = 0 or position('club_rating_start' in v_pred) = 0
     or position('promoted' in v_pred) > 0 then
    raise exception 'B2 check: starts_on_basis check is not exactly kyu_obtained/club_rating_start';
  end if;

  -- Частичные UNIQUE-индексы: таблица|имя|колонки|токены предиката (через ;)
  foreach v_spec in array array[
    'public.student_rating_stages|student_rating_stages_one_active_uidx|student_id|status;active',
    'public.student_rating_stages|student_rating_stages_one_root_uidx|student_id|previous_stage_id;IS NULL',
    'public.student_rating_entries|student_rating_entries_attendance_root_uidx|stage_id,effective_on|source_type;attendance_day;reaward_after_entry_id;IS NULL'
  ] loop
    select pg_get_expr(i.indpred, i.indrelid) into v_pred
    from pg_index i join pg_class ic on ic.oid = i.indexrelid
    where i.indrelid = to_regclass(split_part(v_spec, '|', 1))
      and ic.relname = split_part(v_spec, '|', 2)
      and i.indisunique and i.indisvalid
      and (select string_agg(a.attname::text, ',' order by u.ord)
           from unnest(i.indkey::smallint[]) with ordinality u(attnum, ord)
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum)
          = split_part(v_spec, '|', 3);
    if v_pred is null then
      raise exception 'B2 check: partial unique index % missing or wrong', split_part(v_spec, '|', 2);
    end if;
    if exists (
      select 1 from unnest(string_to_array(split_part(v_spec, '|', 4), ';')) t(token)
      where position(t.token in v_pred) = 0
    ) then
      raise exception 'B2 check: partial unique index % predicate is wrong: %', split_part(v_spec, '|', 2), v_pred;
    end if;
  end loop;

  -- Триггеры: таблица|имя|tgtype|функция (все включены).
  -- tgtype: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32
  foreach v_spec in array array[
    'public.student_rating_stages|trg_student_rating_stages_validate|7|private.enforce_student_rating_stages_insert()',
    'public.student_rating_stages|trg_student_rating_stages_close|19|private.enforce_student_rating_stages_update()',
    'public.student_rating_stages|trg_student_rating_stages_no_delete|11|private.reject_student_rating_mutation()',
    'public.student_rating_stages|trg_student_rating_stages_no_truncate|34|private.reject_student_rating_mutation()',
    'public.student_rating_entries|trg_student_rating_entries_validate|7|private.enforce_student_rating_entries_insert()',
    'public.student_rating_entries|trg_student_rating_entries_immutable|27|private.reject_student_rating_mutation()',
    'public.student_rating_entries|trg_student_rating_entries_no_truncate|34|private.reject_student_rating_mutation()'
  ] loop
    if not exists (
      select 1 from pg_trigger t
      where t.tgrelid = to_regclass(split_part(v_spec, '|', 1)) and not t.tgisinternal
        and t.tgname = split_part(v_spec, '|', 2)
        and t.tgenabled::text = 'O'
        and t.tgtype = split_part(v_spec, '|', 3)::smallint
        and t.tgfoid = to_regprocedure(split_part(v_spec, '|', 4))
    ) then
      raise exception 'B2 check: trigger % missing, disabled or wrong', split_part(v_spec, '|', 2);
    end if;
  end loop;
  if (select count(*) from pg_trigger t where t.tgrelid = 'public.student_rating_stages'::regclass and not t.tgisinternal) <> 4
     or (select count(*) from pg_trigger t where t.tgrelid = 'public.student_rating_entries'::regclass and not t.tgisinternal) <> 3 then
    raise exception 'B2 check: unexpected number of triggers';
  end if;

  -- Функции: сигнатура|SECURITY DEFINER; owner postgres, search_path='', EXECUTE ни у кого
  foreach v_spec in array array[
    'private.reject_student_rating_mutation()|false',
    'private.enforce_student_rating_stages_insert()|true',
    'private.enforce_student_rating_stages_update()|true',
    'private.enforce_student_rating_entries_insert()|true'
  ] loop
    v_fn := to_regprocedure(split_part(v_spec, '|', 1));
    if v_fn is null then
      raise exception 'B2 check: % not found', split_part(v_spec, '|', 1);
    end if;
    if not (select p.prosecdef = split_part(v_spec, '|', 2)::boolean
                   and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
                   and pg_get_userbyid(p.proowner) = 'postgres'
            from pg_proc p where p.oid = v_fn) then
      raise exception 'B2 check: % has wrong SECURITY DEFINER / search_path / owner', split_part(v_spec, '|', 1);
    end if;
    if exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'B2 check: PUBLIC EXECUTE on %', split_part(v_spec, '|', 1);
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception 'B2 check: % has EXECUTE on %', v_role, split_part(v_spec, '|', 1);
      end if;
    end loop;
  end loop;
end;
$$;

commit;
