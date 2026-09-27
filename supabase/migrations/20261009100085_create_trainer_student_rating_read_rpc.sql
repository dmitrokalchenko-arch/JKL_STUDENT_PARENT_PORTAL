-- Trainer/Admin student Rating read RPC (Rating B5, Migration 085).
--
-- Только чтение. Одна публичная RPC:
--   public.get_trainer_student_rating(p_student_id bigint) returns jsonb
--   STABLE, SECURITY DEFINER, owner postgres, search_path = '',
--   EXECUTE только authenticated.
--
-- Текущий рейтинг = SUM(points) ВСЕХ записей журнала активного этапа
-- (attendance_day, будущие admin_adjustment и reversal учитываются
-- автоматически). Закрытые этапы в текущий итог не входят. Строки журнала
-- не возвращаются. Хранимого итога нет.
--
-- Доступ: private.current_active_trainer_account_id() +
-- public.can_trainer_access_student(p_student_id) — Admin видит свой клуб,
-- Trainer — свои группы; оплаченная Student Page НЕ требуется; legacy
-- trainers.rolle не используется. NULL / нет активного аккаунта / нет
-- доступа / несуществующий ученик -> одинаковый {ok:false, reason:'not_allowed'}
-- без каких-либо данных ученика.
--
-- Конфигурация клуба читается напрямую из public.club_rating_config
-- (private.club_rating_start / club_today бросают исключения — здесь нет).
--
-- Не меняет таблицы, RLS, права на таблицы, 079–084; нет UI, Promote,
-- корректировок, отмен, настроек рейтинга, семейной RPC.
--
-- Проверка: docs/database/STUDENT_RATING_B5_READ_RPC_SQL_VERIFICATION.md

begin;

-- ══════════════════════════════════════════════════════════════════════
-- 0. Снимок счётчиков до миграции (для самопроверки «ноль записей»)
-- ══════════════════════════════════════════════════════════════════════
-- set_config(..., true) — локально для этой транзакции, ничего не сохраняется.
do $$
begin
  perform set_config('jkl_m085.entries_before',
                      (select count(*) from public.student_rating_entries)::text, true);
  perform set_config('jkl_m085.stages_before',
                      (select count(*) from public.student_rating_stages)::text, true);
  perform set_config('jkl_m085.stages_closed_before',
                      (select count(*) from public.student_rating_stages where status = 'closed')::text, true);
  perform set_config('jkl_m085.config_before',
                      (select count(*) from public.club_rating_config)::text, true);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════
-- 1. public.get_trainer_student_rating
-- ══════════════════════════════════════════════════════════════════════
-- Ответы:
--   {ok:false, reason:'not_allowed'}                        — отказ (любая причина)
--   {ok:false, reason:'rating_data_anomaly', studentId}     — структурная аномалия
--       (>1 active этапа; active этап другого клуба; отрицательный итог)
--   {ok:true, studentId, clubId, ratingActive:false, inactiveReason, currentGrade, stage:null, ...}
--       inactiveReason: not_judo | club_rating_not_configured |
--                       current_grade_unresolved | dan_policy_excluded |
--                       no_active_stage | not_bootstrapped
--   {ok:true, studentId, clubId, ratingActive:true, inactiveReason:null,
--    currentGrade, stage:{...}, currentRatingTotal, entryCount, lastEntryOn,
--    stageGradeMatchesCurrent}
create function public.get_trainer_student_rating(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_denied constant jsonb := jsonb_build_object('ok', false, 'reason', 'not_allowed');
  v_club text;
  v_sport text;
  v_kyu_grad text;
  v_cfg_found boolean;
  v_includes_dan boolean;
  v_grade_id bigint;
  v_grade_text text;
  v_grade_rank integer;
  v_grade_kind text;
  v_current_grade jsonb;
  v_active_count integer;
  v_wrong_club_active integer;
  v_any_stage boolean;
  v_stage_id uuid;
  v_stage_kyu bigint;
  v_stage_grade text;
  v_stage_starts date;
  v_stage_basis text;
  v_total bigint;
  v_entry_count bigint;
  v_last_on date;
  v_base jsonb;
begin
  -- 1. Авторизация (до любого чтения данных ученика).
  if p_student_id is null
     or private.current_active_trainer_account_id() is null
     or public.can_trainer_access_student(p_student_id) is not true then
    return v_denied;
  end if;

  -- 2. Ученик (доступ уже подтверждён; «не найден» даёт тот же отказ).
  select s.club_id, s.sport_id, s.kyu_grad
    into v_club, v_sport, v_kyu_grad
  from public.students s
  where s.id = p_student_id;
  if not found then
    return v_denied;
  end if;

  -- 3. Текущая ступень (канонические хелперы 082).
  v_grade_id := private.resolve_judo_grade_lookup_id(v_kyu_grad);
  if v_grade_id is not null then
    select kl.kyu_grad into v_grade_text
    from public.kyu_lookup kl where kl.id = v_grade_id;
    v_grade_rank := private.judo_grade_rank(v_grade_text);
  end if;
  v_grade_kind := case when v_grade_rank > 0 then 'DAN'
                       when v_grade_rank < 0 then 'KYU' end;
  v_current_grade := jsonb_build_object(
    'raw', v_kyu_grad,
    'kyuLookupId', v_grade_id,
    'kyuGrad', v_grade_text,
    'kind', v_grade_kind,
    'resolved', v_grade_id is not null and v_grade_rank is not null);

  v_base := jsonb_build_object(
    'ok', true,
    'studentId', p_student_id::text,
    'clubId', v_club,
    'currentGrade', v_current_grade);

  -- 4. Не Judo.
  if v_sport is distinct from 'judo' then
    return v_base || jsonb_build_object(
      'ratingActive', false, 'inactiveReason', 'not_judo',
      'stage', null, 'currentRatingTotal', null, 'entryCount', null,
      'lastEntryOn', null, 'stageGradeMatchesCurrent', null);
  end if;

  -- 5. Конфигурация клуба — напрямую, без исключений.
  select true, c.rating_includes_dan
    into v_cfg_found, v_includes_dan
  from public.club_rating_config c
  where c.club_id = v_club;
  if v_cfg_found is not true then
    return v_base || jsonb_build_object(
      'ratingActive', false, 'inactiveReason', 'club_rating_not_configured',
      'stage', null, 'currentRatingTotal', null, 'entryCount', null,
      'lastEntryOn', null, 'stageGradeMatchesCurrent', null);
  end if;

  -- 6. Активный этап: ровно один и того же клуба, иначе аномалия.
  select count(*) filter (where st.status = 'active'),
         count(*) filter (where st.status = 'active' and st.club_id is distinct from v_club),
         count(*) > 0
    into v_active_count, v_wrong_club_active, v_any_stage
  from public.student_rating_stages st
  where st.student_id = p_student_id;

  if v_active_count > 1 or v_wrong_club_active > 0 then
    return jsonb_build_object('ok', false, 'reason', 'rating_data_anomaly',
                              'studentId', p_student_id::text);
  end if;

  if v_active_count = 1 then
    select st.id, st.kyu_lookup_id, st.kyu_grad_snapshot, st.starts_on, st.starts_on_basis
      into v_stage_id, v_stage_kyu, v_stage_grade, v_stage_starts, v_stage_basis
    from public.student_rating_stages st
    where st.student_id = p_student_id
      and st.status = 'active'
      and st.club_id = v_club;

    select coalesce(sum(e.points), 0), count(*), max(e.effective_on)
      into v_total, v_entry_count, v_last_on
    from public.student_rating_entries e
    where e.stage_id = v_stage_id;

    -- 081 гарантирует SUM >= 0; нарушение — аномалия, а не «нормализация».
    if v_total < 0 then
      return jsonb_build_object('ok', false, 'reason', 'rating_data_anomaly',
                                'studentId', p_student_id::text);
    end if;

    return v_base || jsonb_build_object(
      'ratingActive', true,
      'inactiveReason', null,
      'stage', jsonb_build_object(
        'stageId', v_stage_id::text,
        'kyuLookupId', v_stage_kyu,
        'kyuGrad', v_stage_grade,
        'startsOn', v_stage_starts,
        'startsOnBasis', v_stage_basis,
        'ratingSince', v_stage_starts),
      'currentRatingTotal', v_total,
      'entryCount', v_entry_count,
      'lastEntryOn', v_last_on,
      'stageGradeMatchesCurrent', v_grade_id is not null and v_stage_kyu = v_grade_id);
  end if;

  -- 7. Активного этапа нет — самая конкретная причина.
  return v_base || jsonb_build_object(
    'ratingActive', false,
    'inactiveReason', case
      when v_grade_id is null or v_grade_rank is null then 'current_grade_unresolved'
      when v_grade_kind = 'DAN' and v_includes_dan is not true then 'dan_policy_excluded'
      when v_any_stage then 'no_active_stage'
      else 'not_bootstrapped'
    end,
    'stage', null, 'currentRatingTotal', null, 'entryCount', null,
    'lastEntryOn', null, 'stageGradeMatchesCurrent', null);
end;
$$;

alter function public.get_trainer_student_rating(bigint) owner to postgres;
comment on function public.get_trainer_student_rating(bigint) is
  'Trainer/Admin: текущий рейтинг ученика. Доступ: current_active_trainer_account_id + can_trainer_access_student (без оплаченной Student Page); отказ и несуществующий ученик — одинаковый {ok:false, reason:not_allowed}. Итог = SUM(points) всех записей активного этапа (0 без записей); строки журнала не возвращаются. Нет активного этапа -> ratingActive=false и inactiveReason (not_judo, club_rating_not_configured, current_grade_unresolved, dan_policy_excluded, no_active_stage, not_bootstrapped). >1 active / этап другого клуба / отрицательный итог -> rating_data_anomaly. Только чтение. Migration 085.';

revoke all on function public.get_trainer_student_rating(bigint) from public, anon;
revoke all on function public.get_trainer_student_rating(bigint) from service_role;
grant execute on function public.get_trainer_student_rating(bigint) to authenticated;

-- ══════════════════════════════════════════════════════════════════════
-- 2. Самопроверка (структура + ноль записей; без вызовов RPC)
-- ══════════════════════════════════════════════════════════════════════
do $$
declare
  v_fn regprocedure := to_regprocedure('public.get_trainer_student_rating(bigint)');
  v_tbl regclass;
  v_spec text;
  v_role text;
begin
  if v_fn is null then
    raise exception '085 check: public.get_trainer_student_rating(bigint) not found';
  end if;
  if not (select p.prosecdef
                 and p.provolatile = 's'
                 and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
                 and pg_get_userbyid(p.proowner) = 'postgres'
                 and p.prorettype = 'jsonb'::regtype
          from pg_proc p where p.oid = v_fn) then
    raise exception '085 check: RPC must be SECURITY DEFINER, STABLE, search_path="", owner postgres, returns jsonb';
  end if;
  if exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) then
    raise exception '085 check: PUBLIC has EXECUTE';
  end if;
  foreach v_role in array array['anon', 'service_role'] loop
    if has_function_privilege(v_role, v_fn, 'EXECUTE') then
      raise exception '085 check: % has EXECUTE', v_role;
    end if;
  end loop;
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception '085 check: authenticated lacks EXECUTE';
  end if;

  -- Таблицы рейтинга и конфиг: RLS, 0 policies, у клиентов прав нет.
  foreach v_spec in array array[
    'public.student_rating_stages', 'public.student_rating_entries', 'public.club_rating_config'
  ] loop
    v_tbl := to_regclass(v_spec);
    if v_tbl is null then
      raise exception '085 check: % missing', v_spec;
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = v_tbl)
       or (select count(*) from pg_policy p where p.polrelid = v_tbl) <> 0 then
      raise exception '085 check: % RLS disabled or policies exist', v_spec;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_table_privilege(v_role, v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception '085 check: % has privileges on %', v_role, v_spec;
      end if;
    end loop;
  end loop;

  -- Зависимости: хелперы, которые вызывает RPC.
  foreach v_spec in array array[
    'private.current_active_trainer_account_id()',
    'public.can_trainer_access_student(bigint)',
    'private.resolve_judo_grade_lookup_id(text)',
    'private.judo_grade_rank(text)'
  ] loop
    if to_regprocedure(v_spec) is null then
      raise exception '085 check: dependency % missing', v_spec;
    end if;
  end loop;

  -- Ноль записей: точные счётчики до/после.
  if (select count(*) from public.student_rating_entries) <> current_setting('jkl_m085.entries_before')::bigint
     or (select count(*) from public.student_rating_stages) <> current_setting('jkl_m085.stages_before')::bigint
     or (select count(*) from public.student_rating_stages where status = 'closed')
        <> current_setting('jkl_m085.stages_closed_before')::bigint
     or (select count(*) from public.club_rating_config) <> current_setting('jkl_m085.config_before')::bigint then
    raise exception '085 check: rating data changed during migration';
  end if;
  -- ... и по времени (now() = начало этой транзакции). История Kyu — только
  -- так: её может одновременно писать RPC 082.
  if exists (select 1 from public.student_rating_entries e where e.created_at >= now())
     or exists (select 1 from public.student_rating_stages st where st.created_at >= now() or st.closed_at >= now())
     or exists (select 1 from public.student_kyu_history h where h.created_at >= now())
     or exists (select 1 from public.club_rating_config c where c.created_at >= now()) then
    raise exception '085 check: migration wrote rating/history/config rows';
  end if;
end;
$$;

commit;
