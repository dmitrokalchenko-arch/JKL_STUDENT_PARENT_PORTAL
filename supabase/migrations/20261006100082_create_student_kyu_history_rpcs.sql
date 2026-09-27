-- Student Kyu History RPCs (Rating Database Design, Migration 082).
--
-- Серверный слой записи РЕАЛЬНЫХ известных дат ступеней Judo (Kyu и Dan)
-- поверх public.student_kyu_history (080). Триггеры и ограничения 080
-- остаются финальной защитой; RPC добавляют авторизацию по ученику,
-- проверки текущей ступени и хронологии и детерминированные ответы jsonb.
--
-- RPC (SECURITY DEFINER, owner postgres, search_path='', EXECUTE только authenticated):
--   public.record_student_kyu_date(bigint, bigint, date)          — Trainer/Admin: корень recorded
--   public.correct_student_kyu_date(bigint, uuid, date, text)     — только Admin: corrected
--   public.retract_student_kyu_date(bigint, uuid, text)           — только Admin: retracted
--   public.get_trainer_student_kyu_history(bigint)                — Trainer: действующие даты,
--                                                                    Admin: полная цепочка
-- Private-хелперы (без клиентского EXECUTE):
--   private.judo_grade_rank(text)                 — 'N. Kyu' -> -N, 'N. Dan' -> +N, иначе NULL
--   private.resolve_judo_grade_lookup_id(text)    — текст ступени -> kyu_lookup.id (ровно одно совпадение)
--   private.student_kyu_history_chronology_ok(bigint, bigint, integer, date)
--
-- Доступ к ученику: public.can_trainer_access_student (Admin — весь свой клуб,
-- Trainer — ученики своих групп); оплаченная Student Page НЕ требуется
-- (can_trainer_access_student_page / can_trainer_edit_student_page не
-- используются). Admin — private.is_current_trainer_portal_admin(); legacy
-- trainers.rolle не используется. Недоступный или несуществующий ученик —
-- одинаковый ответ not_allowed.
--
-- club_id, автор, роль и снимок ступени клиент НЕ передаёт — сервер берёт их из
-- auth.uid() / students / kyu_lookup.
--
-- Блокировка: pg_advisory_xact_lock(hashtext('jkl.student_rating'),
-- hashtext(student_id::text)) — тот же ключ, что у будущих bootstrap / rebase /
-- создания этапов (они читают историю). Решение о записи принимается по
-- данным, перечитанным ПОСЛЕ блокировки.
--
-- Хронология (record и correct): для ступени ранга G и даты D относительно
-- ДРУГИХ действующих фактов ученика (терминальных, не retracted):
-- младшая ступень (E < G) — дата <= D; старшая (E > G) — дата >= D; равные
-- даты допустимы; отсутствующие ступени не придумываются.
--
-- НЕ делает: не меняет students / kyu_grad / kyu_lookup / trainer_accounts,
-- не создаёт и не меняет Rating Stages / Entries, нет bootstrap, Promote,
-- Rebase, club_rating_config; нет UPDATE/DELETE истории; не меняет 079/080/081
-- и права на student_kyu_history.
--
-- Проверка: docs/database/STUDENT_KYU_HISTORY_RPC_082_SQL_VERIFICATION.md

begin;

-- ══════════════════════════════════════════════════════════════════════
-- 1. Private-хелперы
-- ══════════════════════════════════════════════════════════════════════

-- Ранг ступени из текста; порядок kyu_lookup.id не используется.
create function private.judo_grade_rank(p_grade text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case pg_catalog.lower(x.m[2])
           when 'kyu' then -(x.m[1]::integer)
           when 'dan' then x.m[1]::integer
         end
  from (
    select pg_catalog.regexp_match(pg_catalog.btrim(p_grade), '^([1-9][0-9]{0,2})\s*\.\s*(kyu|dan)$', 'i') as m
  ) x;
$$;

alter function private.judo_grade_rank(text) owner to postgres;
comment on function private.judo_grade_rank(text) is
  'Ранг ступени Judo из текста (trim, без учёта регистра): ''N. Kyu'' -> -N, ''N. Dan'' -> +N, иначе NULL. Не зависит от kyu_lookup.id. Без клиентского EXECUTE. Migration 082.';
revoke all on function private.judo_grade_rank(text) from public, anon, authenticated;
revoke all on function private.judo_grade_rank(text) from service_role;

-- Текст ступени (students.kyu_grad) -> kyu_lookup.id, только при ровно одном
-- совпадении по lower(btrim()); иначе NULL.
create function private.resolve_judo_grade_lookup_id(p_grade text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select case when pg_catalog.count(*) = 1 then pg_catalog.min(kl.id) end
  from public.kyu_lookup kl
  where nullif(pg_catalog.btrim(p_grade), '') is not null
    and pg_catalog.lower(pg_catalog.btrim(kl.kyu_grad)) = pg_catalog.lower(pg_catalog.btrim(p_grade));
$$;

alter function private.resolve_judo_grade_lookup_id(text) owner to postgres;
comment on function private.resolve_judo_grade_lookup_id(text) is
  'Текст ступени -> kyu_lookup.id при ровно одном совпадении lower(btrim()); 0 или >1 -> NULL. Вызывается из SECURITY DEFINER RPC 082. Без клиентского EXECUTE.';
revoke all on function private.resolve_judo_grade_lookup_id(text) from public, anon, authenticated;
revoke all on function private.resolve_judo_grade_lookup_id(text) from service_role;

-- true, если дата p_obtained_on для ступени ранга p_rank согласована со всеми
-- ДРУГИМИ действующими фактами ученика (цепочка p_kyu_lookup_id исключается).
-- Действующий факт с неразбираемым рангом -> false (fail closed).
create function private.student_kyu_history_chronology_ok(
  p_student_id bigint,
  p_kyu_lookup_id bigint,
  p_rank integer,
  p_obtained_on date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1
    from public.student_kyu_history h
    join public.kyu_lookup kl on kl.id = h.kyu_lookup_id
    where h.student_id = p_student_id
      and h.kyu_lookup_id <> p_kyu_lookup_id
      and h.entry_kind <> 'retracted'
      and not exists (
        select 1 from public.student_kyu_history s where s.supersedes_id = h.id
      )
      and (
        private.judo_grade_rank(kl.kyu_grad) is null
        or (private.judo_grade_rank(kl.kyu_grad) < p_rank and h.obtained_on > p_obtained_on)
        or (private.judo_grade_rank(kl.kyu_grad) > p_rank and h.obtained_on < p_obtained_on)
      )
  );
$$;

alter function private.student_kyu_history_chronology_ok(bigint, bigint, integer, date) owner to postgres;
comment on function private.student_kyu_history_chronology_ok(bigint, bigint, integer, date) is
  'Хронология истории ступеней: относительно ДРУГИХ действующих (терминальных, не retracted) фактов ученика — младшая ступень не позже D, старшая не раньше D, равные даты допустимы. Цепочка p_kyu_lookup_id исключается. Вызывается из SECURITY DEFINER RPC 082. Без клиентского EXECUTE.';
revoke all on function private.student_kyu_history_chronology_ok(bigint, bigint, integer, date) from public, anon, authenticated;
revoke all on function private.student_kyu_history_chronology_ok(bigint, bigint, integer, date) from service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 2. record_student_kyu_date — Trainer / Admin
-- ══════════════════════════════════════════════════════════════════════
create function public.record_student_kyu_date(
  p_student_id bigint,
  p_kyu_lookup_id bigint,
  p_obtained_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_role text;
  v_club text;
  v_sport text;
  v_kyu_grad text;
  v_current_id bigint;
  v_current_rank integer;
  v_grade text;
  v_rank integer;
  v_terminal uuid;
  v_id uuid;
begin
  v_account := private.current_active_trainer_account_id();
  if v_account is null or p_student_id is null
     or not public.can_trainer_access_student(p_student_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  if p_obtained_on is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_date');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('jkl.student_rating'), pg_catalog.hashtext(p_student_id::text));

  -- Авторитетное перечитывание после блокировки.
  v_account := private.current_active_trainer_account_id();
  if v_account is null or not public.can_trainer_access_student(p_student_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  select ta.portal_role into v_role
  from public.trainer_accounts ta where ta.id = v_account;

  select s.club_id, s.sport_id, s.kyu_grad
    into v_club, v_sport, v_kyu_grad
  from public.students s where s.id = p_student_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if v_sport is distinct from 'judo' then
    return jsonb_build_object('ok', false, 'reason', 'not_judo');
  end if;

  v_current_id := private.resolve_judo_grade_lookup_id(v_kyu_grad);
  select private.judo_grade_rank(kl.kyu_grad) into v_current_rank
  from public.kyu_lookup kl where kl.id = v_current_id;
  if v_current_id is null or v_current_rank is null then
    return jsonb_build_object('ok', false, 'reason', 'current_grade_unresolved');
  end if;

  select kl.kyu_grad into v_grade
  from public.kyu_lookup kl where kl.id = p_kyu_lookup_id;
  v_rank := private.judo_grade_rank(v_grade);
  if v_grade is null or v_rank is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_grade');
  end if;
  if v_rank > v_current_rank then
    return jsonb_build_object('ok', false, 'reason', 'grade_above_current');
  end if;

  if p_obtained_on > private.club_today(v_club) then
    return jsonb_build_object('ok', false, 'reason', 'future_date');
  end if;

  -- Цепочка уже есть -> только Admin-исправление.
  select h.id into v_terminal
  from public.student_kyu_history h
  where h.student_id = p_student_id
    and h.kyu_lookup_id = p_kyu_lookup_id
    and not exists (select 1 from public.student_kyu_history s where s.supersedes_id = h.id)
  order by h.created_at desc, h.id
  limit 1;
  if found then
    return jsonb_build_object('ok', false, 'reason', 'chain_exists', 'terminalHistoryId', v_terminal);
  end if;
  if exists (select 1 from public.student_kyu_history h
             where h.student_id = p_student_id and h.kyu_lookup_id = p_kyu_lookup_id) then
    -- Цепочка без терминальной строки — нарушение инварианта 080.
    raise exception 'student_kyu_history_chain_without_terminal';
  end if;

  if not private.student_kyu_history_chronology_ok(p_student_id, p_kyu_lookup_id, v_rank, p_obtained_on) then
    return jsonb_build_object('ok', false, 'reason', 'chronology_conflict');
  end if;

  insert into public.student_kyu_history (
    club_id, student_id, kyu_lookup_id, kyu_grad_snapshot, entry_kind, obtained_on,
    supersedes_id, source, reason, recorded_by_trainer_account_id, recorded_by_portal_role
  ) values (
    v_club, p_student_id, p_kyu_lookup_id, v_grade, 'recorded', p_obtained_on,
    null, 'manual_entry', null, v_account, v_role
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'historyId', v_id, 'entryKind', 'recorded', 'obtainedOn', p_obtained_on);
end;
$$;

alter function public.record_student_kyu_date(bigint, bigint, date) owner to postgres;
comment on function public.record_student_kyu_date(bigint, bigint, date) is
  'Trainer/Admin: известная реальная дата ступени Judo (Kyu/Dan) -> корень recorded (manual_entry). Доступ: can_trainer_access_student (без оплаченной Student Page). Ступень не выше текущей (students.kyu_grad), дата <= club_today, хронология с другими действующими фактами. Существующая цепочка -> chain_exists. Автор/роль/клуб/снимок — на сервере. Не меняет students и рейтинг. Migration 082.';
revoke all on function public.record_student_kyu_date(bigint, bigint, date) from public, anon;
revoke all on function public.record_student_kyu_date(bigint, bigint, date) from service_role;
grant execute on function public.record_student_kyu_date(bigint, bigint, date) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 3. correct_student_kyu_date — только Admin
-- ══════════════════════════════════════════════════════════════════════
create function public.correct_student_kyu_date(
  p_student_id bigint,
  p_supersedes_history_id uuid,
  p_new_obtained_on date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_role text;
  v_reason text;
  v_club text;
  v_sport text;
  v_kyu_grad text;
  v_current_id bigint;
  v_current_rank integer;
  v_target_club text;
  v_target_kyu bigint;
  v_target_kind text;
  v_target_on date;
  v_terminal uuid;
  v_grade text;
  v_rank integer;
  v_id uuid;
begin
  v_account := private.current_active_trainer_account_id();
  if v_account is null or p_student_id is null
     or not public.can_trainer_access_student(p_student_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if not private.is_current_trainer_portal_admin() then
    return jsonb_build_object('ok', false, 'reason', 'admin_required');
  end if;

  v_reason := nullif(pg_catalog.btrim(p_reason), '');
  if v_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  if p_new_obtained_on is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_date');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('jkl.student_rating'), pg_catalog.hashtext(p_student_id::text));

  v_account := private.current_active_trainer_account_id();
  if v_account is null or not public.can_trainer_access_student(p_student_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if not private.is_current_trainer_portal_admin() then
    return jsonb_build_object('ok', false, 'reason', 'admin_required');
  end if;

  select ta.portal_role into v_role
  from public.trainer_accounts ta where ta.id = v_account;

  select s.club_id, s.sport_id, s.kyu_grad
    into v_club, v_sport, v_kyu_grad
  from public.students s where s.id = p_student_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if v_sport is distinct from 'judo' then
    return jsonb_build_object('ok', false, 'reason', 'not_judo');
  end if;

  -- Цель: строка этого ученика и клуба.
  select h.club_id, h.kyu_lookup_id, h.entry_kind, h.obtained_on
    into v_target_club, v_target_kyu, v_target_kind, v_target_on
  from public.student_kyu_history h
  where h.id = p_supersedes_history_id and h.student_id = p_student_id;
  if not found or v_target_club is distinct from v_club then
    return jsonb_build_object('ok', false, 'reason', 'stale_target');
  end if;

  -- Цель должна быть текущей терминальной строкой своей цепочки.
  if exists (select 1 from public.student_kyu_history s where s.supersedes_id = p_supersedes_history_id) then
    select h.id into v_terminal
    from public.student_kyu_history h
    where h.student_id = p_student_id
      and h.kyu_lookup_id = v_target_kyu
      and not exists (select 1 from public.student_kyu_history s where s.supersedes_id = h.id)
    order by h.created_at desc, h.id
    limit 1;
    return jsonb_build_object('ok', false, 'reason', 'stale_target', 'currentTerminalId', v_terminal);
  end if;

  v_current_id := private.resolve_judo_grade_lookup_id(v_kyu_grad);
  select private.judo_grade_rank(kl.kyu_grad) into v_current_rank
  from public.kyu_lookup kl where kl.id = v_current_id;
  if v_current_id is null or v_current_rank is null then
    return jsonb_build_object('ok', false, 'reason', 'current_grade_unresolved');
  end if;

  select kl.kyu_grad into v_grade
  from public.kyu_lookup kl where kl.id = v_target_kyu;
  v_rank := private.judo_grade_rank(v_grade);
  if v_grade is null or v_rank is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_grade');
  end if;
  if v_rank > v_current_rank then
    return jsonb_build_object('ok', false, 'reason', 'grade_above_current');
  end if;

  if p_new_obtained_on > private.club_today(v_club) then
    return jsonb_build_object('ok', false, 'reason', 'future_date');
  end if;

  if v_target_kind <> 'retracted' and v_target_on = p_new_obtained_on then
    return jsonb_build_object('ok', false, 'reason', 'no_change');
  end if;

  if not private.student_kyu_history_chronology_ok(p_student_id, v_target_kyu, v_rank, p_new_obtained_on) then
    return jsonb_build_object('ok', false, 'reason', 'chronology_conflict');
  end if;

  insert into public.student_kyu_history (
    club_id, student_id, kyu_lookup_id, kyu_grad_snapshot, entry_kind, obtained_on,
    supersedes_id, source, reason, recorded_by_trainer_account_id, recorded_by_portal_role
  ) values (
    v_club, p_student_id, v_target_kyu, v_grade, 'corrected', p_new_obtained_on,
    p_supersedes_history_id, 'manual_entry', v_reason, v_account, v_role
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'historyId', v_id, 'entryKind', 'corrected', 'obtainedOn', p_new_obtained_on);
end;
$$;

alter function public.correct_student_kyu_date(bigint, uuid, date, text) owner to postgres;
comment on function public.correct_student_kyu_date(bigint, uuid, date, text) is
  'Admin: исправление даты факта истории — добавляет corrected поверх ТЕКУЩЕЙ терминальной строки (в т.ч. поверх retracted — восстановление). Причина обязательна; устаревшая цель -> stale_target; та же дата -> no_change; хронология без исправляемой цепочки. Старые строки не меняются. Не меняет students и рейтинг. Migration 082.';
revoke all on function public.correct_student_kyu_date(bigint, uuid, date, text) from public, anon;
revoke all on function public.correct_student_kyu_date(bigint, uuid, date, text) from service_role;
grant execute on function public.correct_student_kyu_date(bigint, uuid, date, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 4. retract_student_kyu_date — только Admin
-- ══════════════════════════════════════════════════════════════════════
create function public.retract_student_kyu_date(
  p_student_id bigint,
  p_supersedes_history_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_role text;
  v_reason text;
  v_club text;
  v_sport text;
  v_target_club text;
  v_target_kyu bigint;
  v_target_kind text;
  v_terminal uuid;
  v_grade text;
  v_id uuid;
begin
  v_account := private.current_active_trainer_account_id();
  if v_account is null or p_student_id is null
     or not public.can_trainer_access_student(p_student_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if not private.is_current_trainer_portal_admin() then
    return jsonb_build_object('ok', false, 'reason', 'admin_required');
  end if;

  v_reason := nullif(pg_catalog.btrim(p_reason), '');
  if v_reason is null then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('jkl.student_rating'), pg_catalog.hashtext(p_student_id::text));

  v_account := private.current_active_trainer_account_id();
  if v_account is null or not public.can_trainer_access_student(p_student_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if not private.is_current_trainer_portal_admin() then
    return jsonb_build_object('ok', false, 'reason', 'admin_required');
  end if;

  select ta.portal_role into v_role
  from public.trainer_accounts ta where ta.id = v_account;

  select s.club_id, s.sport_id into v_club, v_sport
  from public.students s where s.id = p_student_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if v_sport is distinct from 'judo' then
    return jsonb_build_object('ok', false, 'reason', 'not_judo');
  end if;

  select h.club_id, h.kyu_lookup_id, h.entry_kind
    into v_target_club, v_target_kyu, v_target_kind
  from public.student_kyu_history h
  where h.id = p_supersedes_history_id and h.student_id = p_student_id;
  if not found or v_target_club is distinct from v_club then
    return jsonb_build_object('ok', false, 'reason', 'stale_target');
  end if;

  if exists (select 1 from public.student_kyu_history s where s.supersedes_id = p_supersedes_history_id) then
    select h.id into v_terminal
    from public.student_kyu_history h
    where h.student_id = p_student_id
      and h.kyu_lookup_id = v_target_kyu
      and not exists (select 1 from public.student_kyu_history s where s.supersedes_id = h.id)
    order by h.created_at desc, h.id
    limit 1;
    return jsonb_build_object('ok', false, 'reason', 'stale_target', 'currentTerminalId', v_terminal);
  end if;

  if v_target_kind = 'retracted' then
    return jsonb_build_object('ok', false, 'reason', 'already_retracted');
  end if;

  select kl.kyu_grad into v_grade
  from public.kyu_lookup kl where kl.id = v_target_kyu;
  if v_grade is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_grade');
  end if;

  insert into public.student_kyu_history (
    club_id, student_id, kyu_lookup_id, kyu_grad_snapshot, entry_kind, obtained_on,
    supersedes_id, source, reason, recorded_by_trainer_account_id, recorded_by_portal_role
  ) values (
    v_club, p_student_id, v_target_kyu, v_grade, 'retracted', null,
    p_supersedes_history_id, 'manual_entry', v_reason, v_account, v_role
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'historyId', v_id, 'entryKind', 'retracted');
end;
$$;

alter function public.retract_student_kyu_date(bigint, uuid, text) owner to postgres;
comment on function public.retract_student_kyu_date(bigint, uuid, text) is
  'Admin: отзыв факта истории — добавляет retracted (obtained_on NULL) поверх текущей терминальной неотозванной строки. Причина обязательна; устаревшая цель -> stale_target; уже отозван -> already_retracted. Без DELETE. Не меняет students и рейтинг. Migration 082.';
revoke all on function public.retract_student_kyu_date(bigint, uuid, text) from public, anon;
revoke all on function public.retract_student_kyu_date(bigint, uuid, text) from service_role;
grant execute on function public.retract_student_kyu_date(bigint, uuid, text) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 5. get_trainer_student_kyu_history — чтение
-- ══════════════════════════════════════════════════════════════════════
-- Trainer: по каждой ступени — действующая дата, терминальное состояние,
-- флаг наличия аудиторской истории; без строк аудита, причин и авторов.
-- Admin: дополнительно terminalHistoryId и полная цепочка строк.
create function public.get_trainer_student_kyu_history(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_club text;
  v_sport text;
  v_kyu_grad text;
  v_current_id bigint;
  v_current_grade text;
  v_grades jsonb;
begin
  if p_student_id is null
     or private.current_active_trainer_account_id() is null
     or not public.can_trainer_access_student(p_student_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  v_is_admin := private.is_current_trainer_portal_admin();

  select s.club_id, s.sport_id, s.kyu_grad into v_club, v_sport, v_kyu_grad
  from public.students s where s.id = p_student_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  if v_sport is distinct from 'judo' then
    return jsonb_build_object('ok', false, 'reason', 'not_judo');
  end if;

  v_current_id := private.resolve_judo_grade_lookup_id(v_kyu_grad);
  select kl.kyu_grad into v_current_grade from public.kyu_lookup kl where kl.id = v_current_id;

  with hist as (
    select h.*,
           not exists (select 1 from public.student_kyu_history s where s.supersedes_id = h.id) as is_terminal
    from public.student_kyu_history h
    where h.student_id = p_student_id and h.club_id = v_club
  ),
  terminal as (
    select r.* from hist r where r.is_terminal
  ),
  chains as (
    select r.kyu_lookup_id, pg_catalog.count(*) as n_rows
    from hist r group by r.kyu_lookup_id
  )
  select coalesce(jsonb_agg(g.obj order by g.rnk nulls last, g.kyu_lookup_id), '[]'::jsonb)
    into v_grades
  from (
    select c.kyu_lookup_id,
           private.judo_grade_rank(kl.kyu_grad) as rnk,
           jsonb_build_object(
             'kyuLookupId', c.kyu_lookup_id,
             'kyuGrad', kl.kyu_grad,
             'isCurrentGrade', c.kyu_lookup_id is not distinct from v_current_id,
             'effectiveObtainedOn', case when t.entry_kind <> 'retracted' then t.obtained_on end,
             'terminalKind', t.entry_kind,
             'hasAuditHistory', c.n_rows > 1
           )
           || case when v_is_admin then jsonb_build_object(
                'terminalHistoryId', t.id,
                'rows', (
                  select coalesce(jsonb_agg(jsonb_build_object(
                           'historyId', r.id,
                           'entryKind', r.entry_kind,
                           'obtainedOn', r.obtained_on,
                           'kyuGradSnapshot', r.kyu_grad_snapshot,
                           'supersedesId', r.supersedes_id,
                           'isTerminal', r.is_terminal,
                           'isEffective', r.is_terminal and r.entry_kind <> 'retracted',
                           'createdAt', r.created_at,
                           'reason', r.reason,
                           'author', jsonb_build_object(
                             'displayName', ta.display_name,
                             'portalRole', r.recorded_by_portal_role)
                         ) order by r.created_at, r.id), '[]'::jsonb)
                  from hist r
                  left join public.trainer_accounts ta on ta.id = r.recorded_by_trainer_account_id
                  where r.kyu_lookup_id = c.kyu_lookup_id
                ))
              else '{}'::jsonb end as obj
    from chains c
    join public.kyu_lookup kl on kl.id = c.kyu_lookup_id
    left join lateral (
      select t2.* from terminal t2
      where t2.kyu_lookup_id = c.kyu_lookup_id
      order by t2.created_at desc, t2.id
      limit 1
    ) t on true
  ) g;

  return jsonb_build_object(
    'ok', true,
    'currentGrade', jsonb_build_object(
      'raw', v_kyu_grad,
      'kyuLookupId', v_current_id,
      'kyuGrad', v_current_grade,
      'resolved', v_current_id is not null),
    'grades', v_grades,
    'canCorrect', v_is_admin
  );
end;
$$;

alter function public.get_trainer_student_kyu_history(bigint) owner to postgres;
comment on function public.get_trainer_student_kyu_history(bigint) is
  'Чтение истории ступеней ученика. Доступ: can_trainer_access_student (без оплаченной Student Page). Trainer — действующие даты, терминальное состояние, hasAuditHistory; Admin — плюс terminalHistoryId и полная цепочка (причины, авторы). auth_user_id не раскрывается. Migration 082.';
revoke all on function public.get_trainer_student_kyu_history(bigint) from public, anon;
revoke all on function public.get_trainer_student_kyu_history(bigint) from service_role;
grant execute on function public.get_trainer_student_kyu_history(bigint) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 6. Самопроверка (только структура 082 и неизменность B1; без записи данных)
-- ══════════════════════════════════════════════════════════════════════
do $$
declare
  v_spec text;
  v_fn regprocedure;
  v_role text;
  v_tbl regclass := to_regclass('public.student_kyu_history');
begin
  -- Функции: сигнатура|SECURITY DEFINER|authenticated EXECUTE
  foreach v_spec in array array[
    'private.judo_grade_rank(text)|false|false',
    'private.resolve_judo_grade_lookup_id(text)|false|false',
    'private.student_kyu_history_chronology_ok(bigint,bigint,integer,date)|false|false',
    'public.record_student_kyu_date(bigint,bigint,date)|true|true',
    'public.correct_student_kyu_date(bigint,uuid,date,text)|true|true',
    'public.retract_student_kyu_date(bigint,uuid,text)|true|true',
    'public.get_trainer_student_kyu_history(bigint)|true|true'
  ] loop
    v_fn := to_regprocedure(split_part(v_spec, '|', 1));
    if v_fn is null then
      raise exception '082 check: % not found', split_part(v_spec, '|', 1);
    end if;
    if not (select p.prosecdef = split_part(v_spec, '|', 2)::boolean
                   and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
                   and pg_get_userbyid(p.proowner) = 'postgres'
            from pg_proc p where p.oid = v_fn) then
      raise exception '082 check: % has wrong SECURITY DEFINER / search_path / owner', split_part(v_spec, '|', 1);
    end if;
    if exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception '082 check: PUBLIC EXECUTE on %', split_part(v_spec, '|', 1);
    end if;
    foreach v_role in array array['anon', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception '082 check: % has EXECUTE on %', v_role, split_part(v_spec, '|', 1);
      end if;
    end loop;
    if has_function_privilege('authenticated', v_fn, 'EXECUTE') <> split_part(v_spec, '|', 3)::boolean then
      raise exception '082 check: authenticated EXECUTE on % is not %', split_part(v_spec, '|', 1), split_part(v_spec, '|', 3);
    end if;
  end loop;

  -- Ранг: детерминированное вычисление без данных
  if private.judo_grade_rank('9. Kyu') is distinct from -9
     or private.judo_grade_rank('1. Kyu') is distinct from -1
     or private.judo_grade_rank(' 3. kyu ') is distinct from -3
     or private.judo_grade_rank('1. Dan') is distinct from 1
     or private.judo_grade_rank('3. Dan') is distinct from 3
     or private.judo_grade_rank('Kyu') is not null
     or private.judo_grade_rank('0. Kyu') is not null
     or private.judo_grade_rank(null) is not null then
    raise exception '082 check: judo_grade_rank returns unexpected values';
  end if;

  -- B1: таблица, RLS, права и триггеры не изменены
  if v_tbl is null then
    raise exception '082 check: public.student_kyu_history missing';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = v_tbl)
     or (select count(*) from pg_policy p where p.polrelid = v_tbl) <> 0 then
    raise exception '082 check: student_kyu_history RLS/policies changed';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception '082 check: % has privileges on student_kyu_history', v_role;
    end if;
  end loop;
  if not has_table_privilege('service_role', v_tbl, 'SELECT')
     or has_table_privilege('service_role', v_tbl, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception '082 check: service_role privileges on student_kyu_history changed';
  end if;
  if (select count(*) from pg_trigger t
      where t.tgrelid = v_tbl and not t.tgisinternal and t.tgenabled::text = 'O'
        and (t.tgname, t.tgtype) in (('trg_student_kyu_history_validate', 7::smallint),
                                     ('trg_student_kyu_history_immutable', 27::smallint),
                                     ('trg_student_kyu_history_no_truncate', 34::smallint))) <> 3
     or (select count(*) from pg_trigger t where t.tgrelid = v_tbl and not t.tgisinternal) <> 3 then
    raise exception '082 check: student_kyu_history triggers changed';
  end if;
end;
$$;

commit;
