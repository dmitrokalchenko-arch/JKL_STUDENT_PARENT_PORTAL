-- Club Rating Config + initial Rating Stage bootstrap foundation (Rating B3, Migration 083).
--
-- Только инфраструктура. Миграция НЕ запускает bootstrap, НЕ создаёт этапы и
-- записи рейтинга, НЕ пишет историю Kyu, НЕ меняет students / kyu_grad /
-- attendance / kyu_lookup, НЕ меняет 079–082.
--
-- 1. public.club_rating_config — рейтинговая конфигурация клуба:
--    rating_start_on (технический старт рейтинга клуба, НЕ дата получения
--    ступени) и rating_includes_dan (политика начальных этапов для Dan).
--    Неизменяема (UPDATE/DELETE/TRUNCATE отклоняются; смена — отдельной
--    миграцией владельца). Строка единственная: jcl / 2026-06-22 / false.
-- 2. private.club_rating_start / private.club_rating_includes_dan — fail closed
--    (нет строки -> club_rating_config_not_configured; без запасных значений).
-- 3. private.classify_student_rating_bootstrap(bigint) — детерминированная
--    классификация ученика (только чтение).
-- 4. private.ensure_initial_rating_stage(bigint) — идемпотентное создание
--    начального этапа одного ученика: блокировка jkl.student_rating ->
--    повторная классификация -> INSERT только для AUTO (A1/A2/B1/B2).
-- 5. private.bootstrap_club_rating_stages(text, boolean default true) —
--    ручной пакетный запуск владельцем в SQL Editor; dry_run = только
--    классификация, ноль записей.
--
-- Правило даты старта (Option 2), только для допущенных учеников:
--   A1  действующий факт текущей ступени, obtained_on >= rating_start_on
--       -> starts_on = obtained_on, 'kyu_obtained', kyu_history_id = факт;
--   A2  действующий факт, obtained_on < rating_start_on
--       -> starts_on = rating_start_on, 'club_rating_start', NULL;
--   B1  цепочки текущей ступени нет -> rating_start_on, 'club_rating_start', NULL;
--   B2  цепочка отозвана            -> rating_start_on, 'club_rating_start', NULL.
-- Дата получения ступени никогда не придумывается.
--
-- Безопасность: все функции B3 — в схеме private, owner postgres,
-- search_path = '', EXECUTE отозван у PUBLIC / anon / authenticated /
-- service_role (у authenticated есть USAGE на private, поэтому отзыв EXECUTE
-- обязателен). Вызывает их только владелец (postgres); из браузера и
-- service_role — нельзя.
--
-- Известное ограничение (не решается здесь): если ученик получил этап от
-- технического старта, а позже внесена реальная дата текущей ступени ПОЗЖЕ
-- старта, нужен будущий Rebase; после появления записей журнала за новой
-- границей правило 081 entries_after_end может его запретить.
--
-- Проверка: docs/database/STUDENT_RATING_B3_BOOTSTRAP_SQL_VERIFICATION.md

begin;

-- ══════════════════════════════════════════════════════════════════════
-- 1. public.club_rating_config
-- ══════════════════════════════════════════════════════════════════════
-- club_id — text slug (clubs.club_id). Формального FK нет: clubs.club_id не
-- подтверждён как UNIQUE в production (как в 001/079) — существование клуба
-- проверяет триггер.
create table public.club_rating_config (
  club_id text not null,
  rating_start_on date not null,
  rating_includes_dan boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  note text null,
  constraint club_rating_config_pkey primary key (club_id),
  constraint club_rating_config_club_id_check
    check (club_id = btrim(club_id) and club_id <> ''),
  constraint club_rating_config_note_check
    check (note is null or btrim(note) <> '')
);

alter table public.club_rating_config owner to postgres;

comment on table public.club_rating_config is
  'Рейтинговая конфигурация клуба: rating_start_on (технический старт рейтинга, НЕ дата ступени) и rating_includes_dan (создавать ли начальные этапы ученикам с Dan). Нет строки -> рейтинговые хелперы отказывают (fail closed). Неизменяема: UPDATE/DELETE/TRUNCATE запрещены, смена — миграцией владельца. Клиентских прав нет. Migration 083.';
comment on column public.club_rating_config.rating_start_on is
  'Технический старт рейтинга клуба: начальный этап без известной (или с более ранней) датой текущей ступени начинается с этого дня. Никогда не пишется в student_kyu_history.';
comment on column public.club_rating_config.rating_includes_dan is
  'Политика клуба: true — начальные этапы и для учеников с Dan; false — Dan пропускаются политикой (N_DAN_POLICY_EXCLUDED).';

-- Проверка вставки: клуб существует, у клуба настроен пояс (079); время
-- аудита задаёт сервер.
create function private.enforce_club_rating_config_valid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.clubs c where c.club_id = new.club_id) then
    raise exception 'club_rating_config_unknown_club'
      using detail = format('club_id %L does not exist in public.clubs.club_id', new.club_id);
  end if;
  if not exists (select 1 from public.club_portal_settings s where s.club_id = new.club_id) then
    raise exception 'club_rating_config_timezone_not_configured'
      using detail = format('club_id %L has no club_portal_settings row', new.club_id);
  end if;
  new.created_at := pg_catalog.now();
  new.updated_at := new.created_at;
  return new;
end;
$$;

alter function private.enforce_club_rating_config_valid() owner to postgres;
comment on function private.enforce_club_rating_config_valid() is
  'BEFORE INSERT club_rating_config: клуб существует в public.clubs.club_id, у клуба есть club_portal_settings (пояс); created_at/updated_at = now(). SECURITY DEFINER. Migration 083.';
revoke all on function private.enforce_club_rating_config_valid() from public, anon, authenticated;
revoke all on function private.enforce_club_rating_config_valid() from service_role;

create trigger trg_club_rating_config_validate
  before insert on public.club_rating_config
  for each row execute function private.enforce_club_rating_config_valid();

-- Неизменяемость: общая функция 081 (сообщение club_rating_config_immutable).
create trigger trg_club_rating_config_immutable
  before update or delete on public.club_rating_config
  for each row execute function private.reject_student_rating_mutation();

create trigger trg_club_rating_config_no_truncate
  before truncate on public.club_rating_config
  for each statement execute function private.reject_student_rating_mutation();

alter table public.club_rating_config enable row level security;

revoke all on table public.club_rating_config from public, anon, authenticated;
revoke all on table public.club_rating_config from service_role;
grant select on table public.club_rating_config to service_role;

-- Строка JCL — только если клуб существует (иначе миграция падает).
do $$
begin
  if not exists (select 1 from public.clubs c where c.club_id = 'jcl') then
    raise exception '083: club jcl does not exist in public.clubs.club_id — refusing to create orphan rating config';
  end if;
end;
$$;

insert into public.club_rating_config (club_id, rating_start_on, rating_includes_dan, note)
values ('jcl', date '2026-06-22', false,
        'Migration 083: owner-confirmed JCL technical rating start; initial stages for Kyu only');

-- ══════════════════════════════════════════════════════════════════════
-- 2. Конфигурационные хелперы (fail closed)
-- ══════════════════════════════════════════════════════════════════════
create function private.club_rating_start(p_club_id text)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start date;
begin
  select c.rating_start_on into v_start
  from public.club_rating_config c where c.club_id = p_club_id;
  if not found then
    raise exception 'club_rating_config_not_configured'
      using detail = format('club_id %L has no club_rating_config row', p_club_id),
            hint = 'Rating config is created only by an owner-controlled migration; no fallback.';
  end if;
  return v_start;
end;
$$;

alter function private.club_rating_start(text) owner to postgres;
comment on function private.club_rating_start(text) is
  'Технический старт рейтинга клуба из club_rating_config. Нет строки -> club_rating_config_not_configured. Без fallback. Без клиентского EXECUTE. Migration 083.';
revoke all on function private.club_rating_start(text) from public, anon, authenticated;
revoke all on function private.club_rating_start(text) from service_role;

create function private.club_rating_includes_dan(p_club_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dan boolean;
begin
  select c.rating_includes_dan into v_dan
  from public.club_rating_config c where c.club_id = p_club_id;
  if not found then
    raise exception 'club_rating_config_not_configured'
      using detail = format('club_id %L has no club_rating_config row', p_club_id),
            hint = 'Rating config is created only by an owner-controlled migration; no fallback.';
  end if;
  return v_dan;
end;
$$;

alter function private.club_rating_includes_dan(text) owner to postgres;
comment on function private.club_rating_includes_dan(text) is
  'Политика Dan клуба из club_rating_config. Нет строки -> club_rating_config_not_configured. Без fallback. Без клиентского EXECUTE. Migration 083.';
revoke all on function private.club_rating_includes_dan(text) from public, anon, authenticated;
revoke all on function private.club_rating_includes_dan(text) from service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 3. Классификатор (только чтение)
-- ══════════════════════════════════════════════════════════════════════
-- Порядок категорий: сначала структура и конфликты, затем политика Dan —
-- повреждённое состояние ученика с Dan не маскируется как политика.
-- Ответ содержит только технические поля (без имён и персональных данных).
create function private.classify_student_rating_bootstrap(p_student_id bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_club text;
  v_sport text;
  v_kyu_grad text;
  v_raw text;
  v_start date;
  v_dan boolean;
  v_n_stages integer;
  v_active_stage uuid;
  v_n_match integer;
  v_cur_id bigint;
  v_cur_grade text;
  v_cur_rank integer;
  v_kind text;
  v_chain_anomalies integer;
  v_club_mismatch integer;
  v_eff_unranked integer;
  v_higher_eff integer;
  v_cur_chain_exists boolean;
  v_eff_id uuid;
  v_eff_on date;
  v_base jsonb;
begin
  select s.club_id, s.sport_id, s.kyu_grad
    into v_club, v_sport, v_kyu_grad
  from public.students s where s.id = p_student_id;
  if not found then
    return jsonb_build_object('studentId', p_student_id, 'category', 'F_STUDENT_NOT_FOUND',
                              'action', 'MANUAL', 'reason', 'student does not exist');
  end if;
  if v_sport is distinct from 'judo' then
    return jsonb_build_object('studentId', p_student_id, 'clubId', v_club, 'category', 'N_NOT_JUDO',
                              'action', 'SKIP', 'reason', 'rating V1 is Judo only');
  end if;

  -- Конфигурация клуба: fail closed (исключение club_rating_config_not_configured).
  v_start := private.club_rating_start(v_club);
  v_dan := private.club_rating_includes_dan(v_club);

  v_base := jsonb_build_object('studentId', p_student_id, 'clubId', v_club,
                               'ratingStartOn', v_start, 'ratingIncludesDan', v_dan);

  -- Существующие этапы.
  select pg_catalog.count(*) into v_n_stages
  from public.student_rating_stages st where st.student_id = p_student_id;
  select st.id into v_active_stage
  from public.student_rating_stages st
  where st.student_id = p_student_id and st.status = 'active';
  if v_active_stage is not null then
    return v_base || jsonb_build_object('category', 'E1_ACTIVE_STAGE_EXISTS', 'action', 'SKIP',
                                        'reason', 'active rating stage already exists',
                                        'existingStageId', v_active_stage);
  end if;
  if v_n_stages > 0 then
    return v_base || jsonb_build_object('category', 'F_STAGE_ANOMALY', 'action', 'MANUAL',
                                        'reason', 'rating stages exist but none is active');
  end if;

  -- Текущая ступень (students.kyu_grad -> kyu_lookup).
  v_raw := nullif(pg_catalog.btrim(v_kyu_grad), '');
  if v_raw is null then
    return v_base || jsonb_build_object('category', 'D1_NO_CURRENT_GRADE', 'action', 'MANUAL',
                                        'reason', 'students.kyu_grad is empty');
  end if;
  select pg_catalog.count(*) into v_n_match
  from public.kyu_lookup kl
  where pg_catalog.lower(pg_catalog.btrim(kl.kyu_grad)) = pg_catalog.lower(v_raw);
  if v_n_match = 0 then
    return v_base || jsonb_build_object('category', 'D2_UNRESOLVED_GRADE', 'action', 'MANUAL',
                                        'reason', 'current grade does not match kyu_lookup', 'currentGradeRaw', v_raw);
  end if;
  if v_n_match > 1 then
    return v_base || jsonb_build_object('category', 'F_AMBIGUOUS_GRADE', 'action', 'MANUAL',
                                        'reason', 'current grade matches several kyu_lookup rows', 'currentGradeRaw', v_raw);
  end if;
  v_cur_id := private.resolve_judo_grade_lookup_id(v_raw);
  select kl.kyu_grad into v_cur_grade from public.kyu_lookup kl where kl.id = v_cur_id;
  v_cur_rank := private.judo_grade_rank(v_cur_grade);
  if v_cur_id is null or v_cur_rank is null then
    return v_base || jsonb_build_object('category', 'F_UNRANKABLE_GRADE', 'action', 'MANUAL',
                                        'reason', 'current grade rank cannot be parsed', 'currentGradeRaw', v_raw);
  end if;
  v_kind := case when v_cur_rank > 0 then 'DAN' else 'KYU' end;
  v_base := v_base || jsonb_build_object('kyuLookupId', v_cur_id, 'kyuGrad', v_cur_grade, 'gradeKind', v_kind);

  -- Аномалии истории (любые цепочки ученика).
  select pg_catalog.count(*) into v_chain_anomalies
  from (
    select x.kyu_lookup_id
    from (
      select h.kyu_lookup_id, h.entry_kind,
             not exists (select 1 from public.student_kyu_history s where s.supersedes_id = h.id) as is_terminal
      from public.student_kyu_history h
      where h.student_id = p_student_id
    ) x
    group by x.kyu_lookup_id
    having pg_catalog.count(*) filter (where x.entry_kind = 'recorded') <> 1
        or pg_catalog.count(*) filter (where x.is_terminal) <> 1
  ) a;
  select pg_catalog.count(*) into v_club_mismatch
  from public.student_kyu_history h
  where h.student_id = p_student_id and h.club_id is distinct from v_club;
  select pg_catalog.count(*) into v_eff_unranked
  from public.student_kyu_history h
  join public.kyu_lookup kl on kl.id = h.kyu_lookup_id
  where h.student_id = p_student_id
    and h.entry_kind <> 'retracted'
    and not exists (select 1 from public.student_kyu_history s where s.supersedes_id = h.id)
    and private.judo_grade_rank(kl.kyu_grad) is null;
  if v_chain_anomalies > 0 or v_club_mismatch > 0 or v_eff_unranked > 0 then
    return v_base || jsonb_build_object('category', 'F_HISTORY_ANOMALY', 'action', 'MANUAL',
                                        'reason', 'malformed history chain, history club mismatch or unranked effective grade');
  end if;

  -- Действующий факт текущей ступени (последняя строка цепочки, не retracted).
  select exists (select 1 from public.student_kyu_history h
                 where h.student_id = p_student_id and h.kyu_lookup_id = v_cur_id)
    into v_cur_chain_exists;
  select h.id, h.obtained_on into v_eff_id, v_eff_on
  from public.student_kyu_history h
  where h.student_id = p_student_id
    and h.kyu_lookup_id = v_cur_id
    and h.entry_kind <> 'retracted'
    and not exists (select 1 from public.student_kyu_history s where s.supersedes_id = h.id);

  -- Конфликты: действующий факт выше текущей ступени; хронология факта
  -- текущей ступени относительно остальных действующих фактов (хелпер 082).
  select pg_catalog.count(*) into v_higher_eff
  from public.student_kyu_history h
  join public.kyu_lookup kl on kl.id = h.kyu_lookup_id
  where h.student_id = p_student_id
    and h.entry_kind <> 'retracted'
    and not exists (select 1 from public.student_kyu_history s where s.supersedes_id = h.id)
    and private.judo_grade_rank(kl.kyu_grad) > v_cur_rank;
  if v_higher_eff > 0
     or (v_eff_id is not null
         and not private.student_kyu_history_chronology_ok(p_student_id, v_cur_id, v_cur_rank, v_eff_on)) then
    return v_base || jsonb_build_object('category', 'C_HISTORY_CONFLICT', 'action', 'MANUAL',
                                        'reason', 'effective history above current grade or chronology conflict');
  end if;

  -- Политика клуба для Dan (после структурных проверок).
  if v_kind = 'DAN' and not v_dan then
    return v_base || jsonb_build_object('category', 'N_DAN_POLICY_EXCLUDED', 'action', 'SKIP',
                                        'reason', 'club rating policy excludes Dan (rating_includes_dan = false)');
  end if;

  -- Рейтинг клуба уже стартовал (нет пояса -> исключение 079).
  if v_start > private.club_today(v_club) then
    return v_base || jsonb_build_object('category', 'F_RATING_NOT_STARTED', 'action', 'MANUAL',
                                        'reason', 'club rating_start_on is after the club local date');
  end if;

  if v_eff_id is not null and v_eff_on >= v_start then
    return v_base || jsonb_build_object('category', 'A1_KNOWN_DATE_ON_OR_AFTER_START', 'action', 'AUTO',
      'reason', 'effective current-grade date on or after club rating start',
      'proposed', jsonb_build_object('startsOn', v_eff_on, 'startsOnBasis', 'kyu_obtained', 'kyuHistoryId', v_eff_id));
  end if;
  if v_eff_id is not null then
    return v_base || jsonb_build_object('category', 'A2_KNOWN_DATE_BEFORE_START', 'action', 'AUTO',
      'reason', 'effective current-grade date before club rating start',
      'proposed', jsonb_build_object('startsOn', v_start, 'startsOnBasis', 'club_rating_start', 'kyuHistoryId', null));
  end if;
  if v_cur_chain_exists then
    return v_base || jsonb_build_object('category', 'B2_CURRENT_GRADE_RETRACTED', 'action', 'AUTO',
      'reason', 'current-grade history chain is retracted',
      'proposed', jsonb_build_object('startsOn', v_start, 'startsOnBasis', 'club_rating_start', 'kyuHistoryId', null));
  end if;
  return v_base || jsonb_build_object('category', 'B1_NO_HISTORY', 'action', 'AUTO',
    'reason', 'no history for current grade',
    'proposed', jsonb_build_object('startsOn', v_start, 'startsOnBasis', 'club_rating_start', 'kyuHistoryId', null));
end;
$$;

alter function private.classify_student_rating_bootstrap(bigint) owner to postgres;
comment on function private.classify_student_rating_bootstrap(bigint) is
  'Только чтение: категория начального этапа рейтинга ученика (E1, F_*, D1, D2, C, N_DAN_POLICY_EXCLUDED, N_NOT_JUDO, A1, A2, B1, B2), action AUTO/SKIP/MANUAL, причина и предлагаемые starts_on / basis / kyu_history_id. Конфигурация клуба — fail closed. Без клиентского EXECUTE. Migration 083.';
revoke all on function private.classify_student_rating_bootstrap(bigint) from public, anon, authenticated;
revoke all on function private.classify_student_rating_bootstrap(bigint) from service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 4. Идемпотентное создание начального этапа одного ученика
-- ══════════════════════════════════════════════════════════════════════
create function private.ensure_initial_rating_stage(p_student_id bigint)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_class jsonb;
  v_action text;
  v_stage_id uuid;
begin
  if p_student_id is null then
    raise exception 'ensure_initial_rating_stage_null_student';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('jkl.student_rating'), pg_catalog.hashtext(p_student_id::text));

  -- Решение — только по классификации ПОСЛЕ блокировки.
  v_class := private.classify_student_rating_bootstrap(p_student_id);
  v_action := v_class ->> 'action';

  if v_action is distinct from 'AUTO' then
    return jsonb_build_object(
      'studentId', p_student_id,
      'result', case when v_class ->> 'category' = 'E1_ACTIVE_STAGE_EXISTS' then 'already_exists'
                     when v_action = 'SKIP' then 'skipped'
                     else 'manual' end,
      'classification', v_class);
  end if;

  insert into public.student_rating_stages (
    club_id, student_id, kyu_lookup_id, kyu_grad_snapshot,
    starts_on, starts_on_basis, kyu_history_id, previous_stage_id,
    status, created_by_kind
  ) values (
    v_class ->> 'clubId',
    p_student_id,
    (v_class ->> 'kyuLookupId')::bigint,
    v_class ->> 'kyuGrad',
    (v_class -> 'proposed' ->> 'startsOn')::date,
    v_class -> 'proposed' ->> 'startsOnBasis',
    (v_class -> 'proposed' ->> 'kyuHistoryId')::uuid,
    null,
    'active',
    'system'
  )
  returning id into v_stage_id;

  return jsonb_build_object('studentId', p_student_id, 'result', 'created',
                            'stageId', v_stage_id, 'classification', v_class);
end;
$$;

alter function private.ensure_initial_rating_stage(bigint) owner to postgres;
comment on function private.ensure_initial_rating_stage(bigint) is
  'Идемпотентно: блокировка jkl.student_rating -> повторная классификация -> INSERT начального этапа (created_by_kind=system) только для AUTO (A1/A2/B1/B2). Существующий active -> already_exists; политика/не Judo -> skipped; прочее -> manual. Инварианты 081 не обходятся. Записи журнала не создаются. Без клиентского EXECUTE. Migration 083.';
revoke all on function private.ensure_initial_rating_stage(bigint) from public, anon, authenticated;
revoke all on function private.ensure_initial_rating_stage(bigint) from service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 5. Пакетный запуск (только владелец, SQL Editor)
-- ══════════════════════════════════════════════════════════════════════
-- Выполняется в транзакции вызывающего: реальный запуск либо целиком
-- фиксируется владельцем, либо целиком откатывается (любое исключение).
create function private.bootstrap_club_rating_stages(
  p_club_id text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_today date;
  v_start date;
  v_dan boolean;
  v_student bigint;
  v_item jsonb;
  v_results jsonb := '[]'::jsonb;
begin
  if p_club_id is null or p_dry_run is null then
    raise exception 'bootstrap_club_rating_stages_invalid_arguments';
  end if;

  -- Глобальные предусловия (fail closed).
  v_today := private.club_today(p_club_id);          -- нет пояса -> club_timezone_not_configured
  v_start := private.club_rating_start(p_club_id);   -- нет конфига -> club_rating_config_not_configured
  v_dan := private.club_rating_includes_dan(p_club_id);
  if v_today < v_start then
    raise exception 'club_rating_not_started'
      using detail = format('club %L rating_start_on %s is after club today %s', p_club_id, v_start, v_today);
  end if;

  for v_student in
    select s.id from public.students s
    where s.club_id = p_club_id and s.sport_id = 'judo'
    order by s.id
  loop
    if p_dry_run then
      v_item := private.classify_student_rating_bootstrap(v_student);
      v_item := jsonb_build_object(
        'studentId', v_student,
        'category', v_item ->> 'category',
        'action', v_item ->> 'action',
        'reason', v_item ->> 'reason',
        'gradeKind', v_item ->> 'gradeKind',
        'proposed', v_item -> 'proposed',
        'result', case when v_item ->> 'action' = 'AUTO' then 'would_create'
                       when v_item ->> 'category' = 'E1_ACTIVE_STAGE_EXISTS' then 'already_exists'
                       when v_item ->> 'action' = 'SKIP' then 'skipped'
                       else 'manual' end);
    else
      v_item := private.ensure_initial_rating_stage(v_student);
      v_item := jsonb_build_object(
        'studentId', v_student,
        'category', v_item -> 'classification' ->> 'category',
        'action', v_item -> 'classification' ->> 'action',
        'reason', v_item -> 'classification' ->> 'reason',
        'gradeKind', v_item -> 'classification' ->> 'gradeKind',
        'proposed', v_item -> 'classification' -> 'proposed',
        'result', v_item ->> 'result',
        'stageId', v_item ->> 'stageId');
    end if;
    v_results := v_results || jsonb_build_array(v_item);
  end loop;

  return jsonb_build_object(
    'clubId', p_club_id,
    'dryRun', p_dry_run,
    'clubToday', v_today,
    'ratingStartOn', v_start,
    'ratingIncludesDan', v_dan,
    'considered', jsonb_array_length(v_results),
    'countsByAction', (
      select coalesce(jsonb_object_agg(a.k, a.n), '{}'::jsonb)
      from (select e ->> 'action' as k, pg_catalog.count(*) as n
            from jsonb_array_elements(v_results) e group by 1) a),
    'countsByCategory', (
      select coalesce(jsonb_object_agg(c.k, c.n), '{}'::jsonb)
      from (select e ->> 'category' as k, pg_catalog.count(*) as n
            from jsonb_array_elements(v_results) e group by 1) c),
    'countsByResult', (
      select coalesce(jsonb_object_agg(r.k, r.n), '{}'::jsonb)
      from (select e ->> 'result' as k, pg_catalog.count(*) as n
            from jsonb_array_elements(v_results) e group by 1) r),
    'students', v_results);
end;
$$;

alter function private.bootstrap_club_rating_stages(text, boolean) owner to postgres;
comment on function private.bootstrap_club_rating_stages(text, boolean) is
  'Только владелец (SQL Editor): начальные этапы рейтинга для учеников Judo клуба по возрастанию id. dry_run=true (по умолчанию) — только классификация, ноль записей; false — ensure_initial_rating_stage для каждого ученика. Предусловия fail closed: пояс (079), club_rating_config, club_today >= rating_start_on. Отчёт — только student_id, без имён. Без клиентского EXECUTE. Migration 083.';
revoke all on function private.bootstrap_club_rating_stages(text, boolean) from public, anon, authenticated;
revoke all on function private.bootstrap_club_rating_stages(text, boolean) from service_role;

-- ══════════════════════════════════════════════════════════════════════
-- 6. Самопроверка (только инварианты 083; без записи данных)
-- ══════════════════════════════════════════════════════════════════════
do $$
declare
  v_tbl regclass := to_regclass('public.club_rating_config');
  v_spec text;
  v_fn regprocedure;
  v_role text;
begin
  if v_tbl is null then
    raise exception '083 check: public.club_rating_config missing';
  end if;
  if pg_get_userbyid((select c.relowner from pg_class c where c.oid = v_tbl)) <> 'postgres' then
    raise exception '083 check: club_rating_config owner is not postgres';
  end if;

  -- Колонки
  if (select count(*) from pg_attribute a where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped) <> 6
     or (select count(*) from pg_attribute a
         where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped
           and (a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull) in (
             ('club_id', 'text', true),
             ('rating_start_on', 'date', true),
             ('rating_includes_dan', 'boolean', true),
             ('created_at', 'timestamp with time zone', true),
             ('updated_at', 'timestamp with time zone', true),
             ('note', 'text', false))) <> 6 then
    raise exception '083 check: club_rating_config columns mismatch';
  end if;
  if (select count(*) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid = v_tbl and a.attname in ('created_at', 'updated_at')
        and pg_get_expr(d.adbin, d.adrelid) = 'now()') <> 2 then
    raise exception '083 check: created_at/updated_at defaults are not now()';
  end if;

  -- PK (club_id) и CHECK
  if not exists (
    select 1 from pg_constraint k
    where k.conrelid = v_tbl and k.contype = 'p' and k.conname = 'club_rating_config_pkey'
      and k.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = v_tbl and a.attname = 'club_id')]::smallint[]
  ) then
    raise exception '083 check: primary key is not (club_id)';
  end if;
  if (select count(*) from pg_constraint k where k.conrelid = v_tbl and k.contype = 'c'
      and k.conname in ('club_rating_config_club_id_check', 'club_rating_config_note_check')) <> 2 then
    raise exception '083 check: CHECK constraints missing';
  end if;

  -- RLS, policies, права
  if not (select c.relrowsecurity from pg_class c where c.oid = v_tbl)
     or (select count(*) from pg_policy p where p.polrelid = v_tbl) <> 0 then
    raise exception '083 check: RLS not enabled or policies exist';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception '083 check: % has privileges on club_rating_config', v_role;
    end if;
  end loop;
  if exists (
    select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = v_tbl and a.grantee = 0
  ) then
    raise exception '083 check: PUBLIC has privileges on club_rating_config';
  end if;
  if not has_table_privilege('service_role', v_tbl, 'SELECT')
     or has_table_privilege('service_role', v_tbl, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
    raise exception '083 check: service_role privileges on club_rating_config are not SELECT only';
  end if;

  -- Триггеры: имя|tgtype|функция (ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32)
  foreach v_spec in array array[
    'trg_club_rating_config_validate|7|private.enforce_club_rating_config_valid()',
    'trg_club_rating_config_immutable|27|private.reject_student_rating_mutation()',
    'trg_club_rating_config_no_truncate|34|private.reject_student_rating_mutation()'
  ] loop
    if not exists (
      select 1 from pg_trigger t
      where t.tgrelid = v_tbl and not t.tgisinternal
        and t.tgname = split_part(v_spec, '|', 1)
        and t.tgenabled::text = 'O'
        and t.tgtype = split_part(v_spec, '|', 2)::smallint
        and t.tgfoid = to_regprocedure(split_part(v_spec, '|', 3))
    ) then
      raise exception '083 check: trigger % missing, disabled or wrong', split_part(v_spec, '|', 1);
    end if;
  end loop;
  if (select count(*) from pg_trigger t where t.tgrelid = v_tbl and not t.tgisinternal) <> 3 then
    raise exception '083 check: unexpected number of triggers on club_rating_config';
  end if;

  -- Функции: сигнатура|SECURITY DEFINER; owner postgres, search_path='', EXECUTE ни у кого
  foreach v_spec in array array[
    'private.enforce_club_rating_config_valid()|true',
    'private.club_rating_start(text)|true',
    'private.club_rating_includes_dan(text)|true',
    'private.classify_student_rating_bootstrap(bigint)|false',
    'private.ensure_initial_rating_stage(bigint)|false',
    'private.bootstrap_club_rating_stages(text,boolean)|false'
  ] loop
    v_fn := to_regprocedure(split_part(v_spec, '|', 1));
    if v_fn is null then
      raise exception '083 check: % not found', split_part(v_spec, '|', 1);
    end if;
    if not (select p.prosecdef = split_part(v_spec, '|', 2)::boolean
                   and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
                   and pg_get_userbyid(p.proowner) = 'postgres'
            from pg_proc p where p.oid = v_fn) then
      raise exception '083 check: % has wrong SECURITY DEFINER / search_path / owner', split_part(v_spec, '|', 1);
    end if;
    if exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception '083 check: PUBLIC EXECUTE on %', split_part(v_spec, '|', 1);
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception '083 check: % has EXECUTE on %', v_role, split_part(v_spec, '|', 1);
      end if;
    end loop;
  end loop;

  -- Строка конфигурации: таблица создана этой транзакцией, поэтому ровно одна строка jcl
  if (select count(*) from public.club_rating_config) <> 1
     or not exists (select 1 from public.club_rating_config c
                    where c.club_id = 'jcl' and c.rating_start_on = date '2026-06-22'
                      and c.rating_includes_dan = false) then
    raise exception '083 check: seed is not exactly jcl / 2026-06-22 / false';
  end if;

  -- Миграция не создала этапов и записей рейтинга (created_at = начало транзакции)
  if exists (select 1 from public.student_rating_stages st where st.created_at >= now())
     or exists (select 1 from public.student_rating_entries e where e.created_at >= now()) then
    raise exception '083 check: migration created rating stages or entries';
  end if;
end;
$$;

commit;
