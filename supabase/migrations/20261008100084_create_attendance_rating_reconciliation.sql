-- Attendance -> Rating Ledger reconciliation (Rating B4, Migration 084).
--
-- Только инфраструктура. Миграция НЕ начисляет посещаемость: ни одной записи
-- student_rating_entries при применении не создаётся; историческое
-- начисление — отдельный явный вызов владельцем после dry-run.
--
-- Правило: 1 ученик + 1 местный день клуба + >= 1 строка public.attendance с
-- anwesenheit = 'JA' = ровно +1 (attendance_day), в этап рейтинга, который
-- действует в этот день (starts_on <= день <= coalesce(ends_on, день)).
-- Местный день = (attendance.datum AT TIME ZONE private.club_timezone(club))::date;
-- неизвестный пояс -> отказ (079).
--
-- Объекты (все private, owner postgres, search_path = '', EXECUTE ни у кого):
--   private.attendance_rating_days(text, bigint default null) — ЕДИНСТВЕННАЯ
--     каноническая логика: attendance -> (ученик, местный день) -> этап ->
--     состояние журнала -> статус. Только чтение.
--   private.sync_student_attendance_rating(bigint) — один ученик: блокировка
--     jkl.student_rating -> повторная оценка -> INSERT только ELIGIBLE_MISSING.
--   private.reconcile_club_attendance_rating(text, boolean default true) —
--     пакет владельца; dry_run = только чтение.
--
-- Идемпотентность: уникальность уже гарантирует 081 —
-- student_rating_entries_attendance_root_uidx (stage_id, effective_on) WHERE
-- source_type = 'attendance_day' AND reaward_after_entry_id IS NULL; этап
-- жёстко связан с учеником и клубом составным FK. Новый индекс не нужен.
-- Уже представленный день = чистая сумма attendance_day и их отмен за
-- (этап, день) = 1.
--
-- V1-граница (без автоматических исправлений): отменённая награда
-- (REVERSED_AWARD), награда без подтверждающей посещаемости (STALE_AWARD —
-- например, JCL изменил JA -> NEIN), день в закрытом этапе без награды
-- (CLOSED_STAGE_MISSING), неоднозначный этап, «сиротская» посещаемость и
-- прочие аномалии только ОТЧИТЫВАЮТСЯ; журнал не меняется (UPDATE/DELETE
-- запрещены 081, отмены и повторные награды — будущий workflow).
--
-- Не меняет attendance / students / RLS legacy-таблиц, 079–083, этапы,
-- историю Kyu; нет UI, Promote, Rebase.
--
-- Проверка: docs/database/STUDENT_RATING_B4_ATTENDANCE_SQL_VERIFICATION.md

begin;

-- ══════════════════════════════════════════════════════════════════════
-- 1. Каноническая логика (только чтение)
-- ══════════════════════════════════════════════════════════════════════
-- Строка на каждую пару (ученик, местный день) с посещаемостью JA клуба, плюс
-- строки журнала (STALE_AWARD / LEDGER_ANOMALY) без подтверждающей
-- посещаемости. p_student_id ограничивает результат одним учеником
-- («сиротские» строки при этом не возвращаются).
--
-- status / action:
--   ORPHAN_ATTENDANCE      MANUAL  attendance.student_id не соответствует students.id
--   INVALID_DATE           MANUAL  attendance.datum IS NULL
--   CLUB_MISMATCH          MANUAL  клуб ученика <> клуб строки attendance
--   NOT_JUDO               SKIP    ученик не Judo
--   FUTURE_DAY             MANUAL  местный день позже club_today
--   AMBIGUOUS_STAGE        MANUAL  день попадает в > 1 этапа
--   NO_STAGE_FOR_STUDENT   SKIP    у ученика нет этапов (напр. Dan по политике клуба)
--   DAY_OUTSIDE_STAGES     SKIP    этапы есть, но день вне их границ
--   ALREADY_REPRESENTED    OK      чистая сумма за (этап, день) = 1
--   REVERSED_AWARD         MANUAL  награда была и отменена (повтор — не автоматически)
--   LEDGER_ANOMALY         MANUAL  чистая сумма не 0/1
--   CLOSED_STAGE_MISSING   MANUAL  этап закрыт — 081 не принимает записи
--   ELIGIBLE_MISSING       AUTO    награды нет, этап active -> создать +1
--   STALE_AWARD            MANUAL  награда есть, подтверждающей посещаемости нет
create function private.attendance_rating_days(
  p_club_id text,
  p_student_id bigint default null
)
returns table (
  student_id bigint,
  raw_student_id text,
  attendance_day date,
  attendance_rows integer,
  stage_id uuid,
  stage_status text,
  ledger_net integer,
  ledger_awards integer,
  status text,
  action text
)
language sql
stable
set search_path = ''
as $$
  with
  cfg as (
    select private.club_timezone(p_club_id) as tz,
           private.club_today(p_club_id) as today
  ),
  att_days as (
    select pg_catalog.btrim(a.student_id::text) as raw_id,
           (a.datum at time zone cfg.tz)::date as day,
           pg_catalog.count(*)::integer as n_rows
    from public.attendance a, cfg
    where a.club_id::text = p_club_id
      and a.anwesenheit::text = 'JA'
    group by 1, 2
  ),
  resolved as (
    select d.raw_id, d.day, d.n_rows,
           s.id as sid, s.club_id::text as s_club, s.sport_id::text as s_sport
    from att_days d
    left join public.students s on s.id::text = d.raw_id
    where p_student_id is null or s.id = p_student_id
  ),
  -- Отмены attendance_day того же этапа и дня (081: effective_on отмены = дню цели).
  att_ledger as (
    select e.stage_id, e.effective_on,
           pg_catalog.sum(e.points)::integer as net,
           (pg_catalog.count(*) filter (where e.source_type = 'attendance_day'))::integer as awards
    from public.student_rating_entries e
    left join public.student_rating_entries t on t.id = e.reversal_of_entry_id
    where e.club_id = p_club_id
      and (p_student_id is null or e.student_id = p_student_id)
      and (e.source_type = 'attendance_day'
           or (e.source_type = 'reversal' and t.source_type = 'attendance_day'))
    group by e.stage_id, e.effective_on
  ),
  matched as (
    select r.*,
           m.n_stage, m.stage_id, m.stage_status,
           exists (select 1 from public.student_rating_stages x where x.student_id = r.sid) as has_stages
    from resolved r
    left join lateral (
      select pg_catalog.count(*)::integer as n_stage,
             pg_catalog.min(st.id::text)::uuid as stage_id,
             pg_catalog.min(st.status) as stage_status
      from public.student_rating_stages st
      where st.student_id = r.sid
        and st.club_id = p_club_id
        and r.day is not null
        and st.starts_on <= r.day
        and (st.ends_on is null or r.day <= st.ends_on)
    ) m on true
  ),
  day_rows as (
    select mt.sid as student_id,
           case when mt.sid is null then mt.raw_id end as raw_student_id,
           mt.day as attendance_day,
           mt.n_rows as attendance_rows,
           case when mt.n_stage = 1 then mt.stage_id end as stage_id,
           case when mt.n_stage = 1 then mt.stage_status end as stage_status,
           coalesce(l.net, 0) as ledger_net,
           coalesce(l.awards, 0) as ledger_awards,
           case
             when mt.sid is null then 'ORPHAN_ATTENDANCE'
             when mt.day is null then 'INVALID_DATE'
             when mt.s_club is distinct from p_club_id then 'CLUB_MISMATCH'
             when mt.s_sport is distinct from 'judo' then 'NOT_JUDO'
             when mt.day > (select today from cfg) then 'FUTURE_DAY'
             when mt.n_stage > 1 then 'AMBIGUOUS_STAGE'
             when mt.n_stage = 0 and not mt.has_stages then 'NO_STAGE_FOR_STUDENT'
             when mt.n_stage = 0 then 'DAY_OUTSIDE_STAGES'
             when coalesce(l.net, 0) = 1 then 'ALREADY_REPRESENTED'
             when coalesce(l.net, 0) = 0 and coalesce(l.awards, 0) > 0 then 'REVERSED_AWARD'
             when coalesce(l.net, 0) <> 0 then 'LEDGER_ANOMALY'
             when mt.stage_status <> 'active' then 'CLOSED_STAGE_MISSING'
             else 'ELIGIBLE_MISSING'
           end as status
    from matched mt
    left join att_ledger l
      on mt.n_stage = 1 and l.stage_id = mt.stage_id and l.effective_on = mt.day
  ),
  -- Журнал без подтверждающей посещаемости (JA -> NEIN, удалённая строка и т.п.).
  ledger_rows as (
    select st.student_id,
           null::text as raw_student_id,
           l.effective_on as attendance_day,
           0 as attendance_rows,
           l.stage_id,
           st.status as stage_status,
           l.net as ledger_net,
           l.awards as ledger_awards,
           case when l.net = 1 then 'STALE_AWARD' else 'LEDGER_ANOMALY' end as status
    from att_ledger l
    join public.student_rating_stages st on st.id = l.stage_id
    where l.net <> 0
      and not exists (
        select 1 from day_rows dr
        where dr.stage_id = l.stage_id and dr.attendance_day = l.effective_on
      )
  )
  select u.student_id, u.raw_student_id, u.attendance_day, u.attendance_rows,
         u.stage_id, u.stage_status, u.ledger_net, u.ledger_awards, u.status,
         case
           when u.status = 'ELIGIBLE_MISSING' then 'AUTO'
           when u.status = 'ALREADY_REPRESENTED' then 'OK'
           when u.status in ('NOT_JUDO', 'NO_STAGE_FOR_STUDENT', 'DAY_OUTSIDE_STAGES') then 'SKIP'
           else 'MANUAL'
         end as action
  from (
    select * from day_rows
    union all
    select * from ledger_rows
  ) u;
$$;

alter function private.attendance_rating_days(text, bigint) owner to postgres;
comment on function private.attendance_rating_days(text, bigint) is
  'Каноническая логика B4 (только чтение): attendance JA клуба -> (ученик, местный день через private.club_timezone) -> ровно один этап по датам -> состояние журнала -> status/action (ELIGIBLE_MISSING=AUTO, ALREADY_REPRESENTED=OK, SKIP, MANUAL: REVERSED_AWARD, STALE_AWARD, CLOSED_STAGE_MISSING, AMBIGUOUS_STAGE, ORPHAN_ATTENDANCE, CLUB_MISMATCH, FUTURE_DAY, INVALID_DATE, LEDGER_ANOMALY). Без клиентского EXECUTE. Migration 084.';
revoke all on function private.attendance_rating_days(text, bigint) from public, anon, authenticated;
revoke all on function private.attendance_rating_days(text, bigint) from service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 2. Один ученик: создание недостающих наград
-- ══════════════════════════════════════════════════════════════════════
create function private.sync_student_attendance_rating(p_student_id bigint)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_club text;
  v_row record;
  v_created jsonb := '[]'::jsonb;
  v_entry_id uuid;
begin
  if p_student_id is null then
    raise exception 'sync_student_attendance_rating_null_student';
  end if;

  select s.club_id into v_club from public.students s where s.id = p_student_id;
  if not found then
    return jsonb_build_object('studentId', p_student_id, 'result', 'student_not_found', 'created', 0);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('jkl.student_rating'), pg_catalog.hashtext(p_student_id::text));

  -- Оценка — только после блокировки (новый снимок оператора цикла).
  for v_row in
    select d.stage_id, d.attendance_day
    from private.attendance_rating_days(v_club, p_student_id) d
    where d.status = 'ELIGIBLE_MISSING'
    order by d.attendance_day
  loop
    insert into public.student_rating_entries (
      club_id, student_id, stage_id, source_type, effective_on, points,
      reversal_of_entry_id, reaward_after_entry_id, idempotency_key, reason,
      created_by_kind
    ) values (
      v_club, p_student_id, v_row.stage_id, 'attendance_day', v_row.attendance_day, 1,
      null, null, null, null,
      'system'
    )
    returning id into v_entry_id;
    v_created := v_created || jsonb_build_array(jsonb_build_object(
      'entryId', v_entry_id, 'stageId', v_row.stage_id, 'attendanceDay', v_row.attendance_day));
  end loop;

  return jsonb_build_object('studentId', p_student_id, 'result', 'synced',
                            'created', jsonb_array_length(v_created), 'createdEntries', v_created);
end;
$$;

alter function private.sync_student_attendance_rating(bigint) owner to postgres;
comment on function private.sync_student_attendance_rating(bigint) is
  'Один ученик: блокировка jkl.student_rating -> private.attendance_rating_days -> INSERT attendance_day (+1, system) только для ELIGIBLE_MISSING. Прочие статусы не трогаются (отчёт — через reconcile). Уникальность — индекс 081. Без клиентского EXECUTE. Migration 084.';
revoke all on function private.sync_student_attendance_rating(bigint) from public, anon, authenticated;
revoke all on function private.sync_student_attendance_rating(bigint) from service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. Пакет клуба (только владелец, SQL Editor)
-- ══════════════════════════════════════════════════════════════════════
create function private.reconcile_club_attendance_rating(
  p_club_id text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_before jsonb;
  v_after jsonb;
  v_student bigint;
  v_sync jsonb;
  v_syncs jsonb := '[]'::jsonb;
  v_created integer := 0;
begin
  if p_club_id is null or p_dry_run is null then
    raise exception 'reconcile_club_attendance_rating_invalid_arguments';
  end if;

  v_tz := private.club_timezone(p_club_id);   -- нет пояса -> club_timezone_not_configured
  v_today := private.club_today(p_club_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'studentId', d.student_id, 'rawStudentId', d.raw_student_id,
           'attendanceDay', d.attendance_day, 'attendanceRows', d.attendance_rows,
           'stageId', d.stage_id, 'stageStatus', d.stage_status,
           'ledgerNet', d.ledger_net, 'ledgerAwards', d.ledger_awards,
           'status', d.status, 'action', d.action)
         order by d.student_id nulls first, d.raw_student_id, d.attendance_day, d.status), '[]'::jsonb)
    into v_before
  from private.attendance_rating_days(p_club_id, null) d;

  if not p_dry_run then
    for v_student in
      select distinct d.student_id
      from private.attendance_rating_days(p_club_id, null) d
      where d.status = 'ELIGIBLE_MISSING'
      order by d.student_id
    loop
      v_sync := private.sync_student_attendance_rating(v_student);
      v_created := v_created + (v_sync ->> 'created')::integer;
      v_syncs := v_syncs || jsonb_build_array(jsonb_build_object(
        'studentId', v_student, 'created', (v_sync ->> 'created')::integer));
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object(
             'studentId', d.student_id, 'rawStudentId', d.raw_student_id,
             'attendanceDay', d.attendance_day, 'stageId', d.stage_id,
             'status', d.status, 'action', d.action)
           order by d.student_id nulls first, d.raw_student_id, d.attendance_day, d.status), '[]'::jsonb)
      into v_after
    from private.attendance_rating_days(p_club_id, null) d;
  end if;

  return jsonb_build_object(
    'clubId', p_club_id,
    'dryRun', p_dry_run,
    'timezone', v_tz,
    'clubToday', v_today,
    'eligibleUniqueDays', (select pg_catalog.count(*) from jsonb_array_elements(v_before) e
                           where e ->> 'status' in ('ELIGIBLE_MISSING', 'ALREADY_REPRESENTED')),
    'alreadyRepresented', (select pg_catalog.count(*) from jsonb_array_elements(v_before) e
                           where e ->> 'status' = 'ALREADY_REPRESENTED'),
    'wouldCreate', (select pg_catalog.count(*) from jsonb_array_elements(v_before) e
                    where e ->> 'status' = 'ELIGIBLE_MISSING'),
    'created', v_created,
    'skipped', (select pg_catalog.count(*) from jsonb_array_elements(v_before) e
                where e ->> 'action' = 'SKIP'),
    'anomalies', (select pg_catalog.count(*) from jsonb_array_elements(v_before) e
                  where e ->> 'action' = 'MANUAL'),
    'countsByStatus', (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
                       from (select e ->> 'status' as k, pg_catalog.count(*) as n
                             from jsonb_array_elements(v_before) e group by 1) x),
    'countsByAction', (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
                       from (select e ->> 'action' as k, pg_catalog.count(*) as n
                             from jsonb_array_elements(v_before) e group by 1) x),
    'perStudent', (select coalesce(jsonb_agg(jsonb_build_object(
                             'studentId', x.sid, 'rawStudentId', x.raw,
                             'countsByStatus', x.counts) order by x.sid nulls first, x.raw), '[]'::jsonb)
                   from (select y.sid, y.raw, jsonb_object_agg(y.st, y.n) as counts
                         from (select e ->> 'studentId' as sid, e ->> 'rawStudentId' as raw,
                                      e ->> 'status' as st, pg_catalog.count(*) as n
                               from jsonb_array_elements(v_before) e group by 1, 2, 3) y
                         group by y.sid, y.raw) x),
    'days', v_before,
    'syncs', v_syncs,
    'afterCountsByStatus', case when p_dry_run then null else (
        select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
        from (select e ->> 'status' as k, pg_catalog.count(*) as n
              from jsonb_array_elements(v_after) e group by 1) x) end);
end;
$$;

alter function private.reconcile_club_attendance_rating(text, boolean) owner to postgres;
comment on function private.reconcile_club_attendance_rating(text, boolean) is
  'Только владелец (SQL Editor): сверка посещаемости клуба с журналом рейтинга. dry_run=true (по умолчанию) — только чтение, отчёт (статусы, счётчики, по ученикам и дням). false — sync_student_attendance_rating для учеников с ELIGIBLE_MISSING (по возрастанию id) и отчёт до/после. MANUAL-статусы не исправляются автоматически. Пояс клуба — fail closed. Без клиентского EXECUTE. Migration 084.';
revoke all on function private.reconcile_club_attendance_rating(text, boolean) from public, anon, authenticated;
revoke all on function private.reconcile_club_attendance_rating(text, boolean) from service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. Самопроверка (только инварианты 084 и сохранность 081; без записи)
-- ══════════════════════════════════════════════════════════════════════
do $$
declare
  v_spec text;
  v_fn regprocedure;
  v_role text;
  v_pred text;
  v_def text;
  v_entries regclass := to_regclass('public.student_rating_entries');
  v_stages regclass := to_regclass('public.student_rating_stages');
begin
  -- Функции 084: INVOKER, owner postgres, search_path = '', EXECUTE ни у кого
  foreach v_spec in array array[
    'private.attendance_rating_days(text,bigint)',
    'private.sync_student_attendance_rating(bigint)',
    'private.reconcile_club_attendance_rating(text,boolean)'
  ] loop
    v_fn := to_regprocedure(v_spec);
    if v_fn is null then
      raise exception '084 check: % not found', v_spec;
    end if;
    if not (select not p.prosecdef
                   and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
                   and pg_get_userbyid(p.proowner) = 'postgres'
            from pg_proc p where p.oid = v_fn) then
      raise exception '084 check: % has wrong SECURITY / search_path / owner', v_spec;
    end if;
    if exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception '084 check: PUBLIC EXECUTE on %', v_spec;
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception '084 check: % has EXECUTE on %', v_role, v_spec;
      end if;
    end loop;
  end loop;
  if (select p.provolatile from pg_proc p where p.oid = to_regprocedure('private.attendance_rating_days(text,bigint)')) <> 's' then
    raise exception '084 check: attendance_rating_days must be STABLE (read-only)';
  end if;

  -- Уникальность наград (081): частичный UNIQUE (stage_id, effective_on) для корня attendance_day
  select pg_get_expr(i.indpred, i.indrelid) into v_pred
  from pg_index i join pg_class ic on ic.oid = i.indexrelid
  where i.indrelid = v_entries
    and ic.relname = 'student_rating_entries_attendance_root_uidx'
    and i.indisunique and i.indisvalid
    and (select string_agg(a.attname::text, ',' order by u.ord)
         from unnest(i.indkey::smallint[]) with ordinality u(attnum, ord)
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum) = 'stage_id,effective_on';
  if v_pred is null
     or position('attendance_day' in v_pred) = 0
     or position('reaward_after_entry_id' in v_pred) = 0 then
    raise exception '084 check: attendance root unique index (081) missing or changed';
  end if;

  -- source_type и форма attendance_day (081) совместимы
  select pg_get_constraintdef(k.oid) into v_def from pg_constraint k
  where k.conrelid = v_entries and k.conname = 'student_rating_entries_source_type_check';
  if v_def is null or position('attendance_day' in v_def) = 0 then
    raise exception '084 check: source_type check does not allow attendance_day';
  end if;
  if not exists (select 1 from pg_constraint k
                 where k.conrelid = v_entries and k.conname = 'student_rating_entries_attendance_shape' and k.contype = 'c') then
    raise exception '084 check: attendance_day shape constraint (081) missing';
  end if;

  -- Защиты 081 на месте: RLS без policies, триггеры включены
  if not (select c.relrowsecurity from pg_class c where c.oid = v_entries)
     or not (select c.relrowsecurity from pg_class c where c.oid = v_stages)
     or (select count(*) from pg_policy p where p.polrelid in (v_entries, v_stages)) <> 0 then
    raise exception '084 check: rating tables RLS/policies changed';
  end if;
  if (select count(*) from pg_trigger t where t.tgrelid = v_entries and not t.tgisinternal and t.tgenabled::text = 'O') <> 3
     or (select count(*) from pg_trigger t where t.tgrelid = v_stages and not t.tgisinternal and t.tgenabled::text = 'O') <> 4 then
    raise exception '084 check: rating table triggers (081) missing or disabled';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, v_entries, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       or has_table_privilege(v_role, v_stages, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception '084 check: % has privileges on rating tables', v_role;
    end if;
  end loop;

  -- Структурная зависимость: нужные колонки public.attendance существуют
  if (select count(*) from pg_attribute a
      where a.attrelid = to_regclass('public.attendance') and not a.attisdropped
        and a.attname in ('student_id', 'datum', 'anwesenheit', 'club_id')) <> 4 then
    raise exception '084 check: public.attendance lacks student_id/datum/anwesenheit/club_id';
  end if;

  -- Миграция ничего не записала (now() = начало этой транзакции)
  if exists (select 1 from public.student_rating_entries e where e.created_at >= now()) then
    raise exception '084 check: migration created rating entries';
  end if;
  if exists (select 1 from public.student_rating_stages st
             where st.created_at >= now() or st.closed_at >= now()) then
    raise exception '084 check: migration created or changed rating stages';
  end if;
  if exists (select 1 from public.student_kyu_history h where h.created_at >= now()) then
    raise exception '084 check: migration changed Kyu history';
  end if;
end;
$$;

commit;
