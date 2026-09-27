# Rating B5 — Trainer/Admin student Rating read RPC (migration 085)

Migration: `supabase/migrations/20261009100085_create_trainer_student_rating_read_rpc.sql`

| Статус | Значение |
|---|---|
| Production apply | **НЕ ПРИМЕНЕНА** |
| Поведенческий E2E | **НЕ ВЫПОЛНЯЛСЯ** |
| Локальное выполнение SQL | НЕ ВЫПОЛНЯЛОСЬ (локального PostgreSQL нет) |

## Контракт

`public.get_trainer_student_rating(p_student_id bigint) returns jsonb` —
STABLE, SECURITY DEFINER, owner `postgres`, `search_path=''`; EXECUTE только
`authenticated` (PUBLIC / anon / service_role — нет).

| Ситуация | Ответ |
|---|---|
| `p_student_id` NULL; нет активного аккаунта; `can_trainer_access_student` ≠ true; ученика нет | `{"ok":false,"reason":"not_allowed"}` — одинаково, без данных |
| > 1 активного этапа; активный этап другого клуба; итог < 0 | `{"ok":false,"reason":"rating_data_anomaly","studentId":"…"}` (только для ученика, к которому доступ уже подтверждён) |
| не Judo | `ok:true, ratingActive:false, inactiveReason:"not_judo"` |
| нет строки `club_rating_config` | `ratingActive:false, inactiveReason:"club_rating_not_configured"` |
| активный этап есть | `ratingActive:true, stage{…}, currentRatingTotal, entryCount, lastEntryOn, stageGradeMatchesCurrent` |
| активного этапа нет | `ratingActive:false`, `inactiveReason` по порядку: `current_grade_unresolved` → `dan_policy_excluded` (Dan и `rating_includes_dan = false`) → `no_active_stage` (этапы есть, активного нет) → `not_bootstrapped` |

Общие поля при `ok:true`: `studentId` (строка), `clubId`, `currentGrade`
{`raw` = `students.kyu_grad`, `kyuLookupId`, `kyuGrad` = канонический
`kyu_lookup.kyu_grad`, `kind` = `KYU`/`DAN`/null, `resolved`}; при неактивном
рейтинге `stage`, `currentRatingTotal`, `entryCount`, `lastEntryOn`,
`stageGradeMatchesCurrent` = null.

`stage` = {`stageId` (uuid строкой), `kyuLookupId`, `kyuGrad` (снимок этапа),
`startsOn`, `startsOnBasis`, `ratingSince` = `startsOn`}.
`currentRatingTotal` = `coalesce(SUM(points), 0)` **всех** записей активного
этапа (не только `attendance_day`); `entryCount` — все записи; `lastEntryOn` —
`max(effective_on)`. Строки журнала не возвращаются. Trainer и Admin получают
одинаковые поля; различается только охват `can_trainer_access_student`.
Оплаченная Student Page не требуется. Конфиг читается из таблицы напрямую
(хелперы, бросающие исключения, не вызываются).

## A. Структурные проверки после применения (только чтение)

```sql
with fn as (select to_regprocedure('public.get_trainer_student_rating(bigint)') as oid),
tbl(name) as (values ('public.student_rating_stages'), ('public.student_rating_entries'), ('public.club_rating_config'))
select 'rpc exists' as check_name, (select oid is not null from fn)::text as result, 'true' as expected
union all
select 'signature', coalesce((select oid::regprocedure::text from fn), 'missing'), 'get_trainer_student_rating(bigint)'
union all
select 'owner', (select pg_get_userbyid(p.proowner) from pg_proc p, fn where p.oid = fn.oid), 'postgres'
union all
select 'security definer', (select p.prosecdef::text from pg_proc p, fn where p.oid = fn.oid), 'true'
union all
select 'volatility', (select p.provolatile::text from pg_proc p, fn where p.oid = fn.oid), 's'
union all
select 'search_path', (select array_to_string(p.proconfig, ';') from pg_proc p, fn where p.oid = fn.oid), 'search_path=""'
union all
select 'returns', (select format_type(p.prorettype, null) from pg_proc p, fn where p.oid = fn.oid), 'jsonb'
union all
select 'PUBLIC execute', (select exists (select 1 from pg_proc p, fn, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                          where p.oid = fn.oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text, 'false'
union all
select 'anon execute', has_function_privilege('anon', (select oid from fn), 'EXECUTE')::text, 'false'
union all
select 'service_role execute', has_function_privilege('service_role', (select oid from fn), 'EXECUTE')::text, 'false'
union all
select 'authenticated execute', has_function_privilege('authenticated', (select oid from fn), 'EXECUTE')::text, 'true'
union all
select 'RLS ' || t.name, (select c.relrowsecurity::text from pg_class c where c.oid = to_regclass(t.name)), 'true' from tbl t
union all
select 'policies ' || t.name, (select count(*)::text from pg_policy p where p.polrelid = to_regclass(t.name)), '0' from tbl t
union all
select 'authenticated privileges ' || t.name,
       has_table_privilege('authenticated', to_regclass(t.name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')::text, 'false' from tbl t
union all
select 'anon privileges ' || t.name,
       has_table_privilege('anon', to_regclass(t.name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')::text, 'false' from tbl t
union all
select 'no legacy scalar rating in body',
       (select (prosrc !~* '(calculatedrating|trainingsgesamt|rating_total|\mrolle\M)')::text from pg_proc p, fn where p.oid = fn.oid),
       'true';
```

Ожидается: каждая строка `result = expected`.

## B. Read-only прекчек данных (production, как владелец)

```sql
with stage_totals as (
  select st.student_id, st.id as stage_id,
         coalesce(sum(e.points), 0) as total, count(e.id) as n_entries
  from public.student_rating_stages st
  left join public.student_rating_entries e on e.stage_id = st.id
  where st.club_id = 'jcl' and st.status = 'active'
  group by st.student_id, st.id
),
grades as (
  select s.id, private.judo_grade_rank(kl.kyu_grad) as rnk
  from public.students s
  left join public.kyu_lookup kl on kl.id = private.resolve_judo_grade_lookup_id(s.kyu_grad)
  where s.club_id = 'jcl' and s.sport_id = 'judo'
)
select 'active admin accounts (jcl)' as item,
       (select count(*) from public.trainer_accounts where club_id = 'jcl' and is_active and portal_role = 'admin')::text as value
union all
select 'active non-admin trainer accounts linked to trainers (jcl)',
       (select count(*) from public.trainer_accounts where club_id = 'jcl' and is_active and portal_role = 'trainer' and trainer_row_id is not null)::text
union all
select 'active stages with points > 0', (select count(*) from stage_totals where total > 0)::text
union all
select 'active stages with 0 entries', (select count(*) from stage_totals where n_entries = 0)::text
union all
select 'judo Dan students without stages',
       (select count(*) from grades g where g.rnk > 0
          and not exists (select 1 from public.student_rating_stages st where st.student_id = g.id))::text
union all
select 'students of other clubs (cross-club test candidates)',
       (select count(*) from public.students where club_id <> 'jcl')::text
union all
select 'sample positive student_id', (select min(student_id)::text from stage_totals where total > 0)
union all
select 'sample zero student_id', (select min(student_id)::text from stage_totals where n_entries = 0)
union all
select 'sample Dan student_id',
       (select min(g.id)::text from grades g where g.rnk > 0
          and not exists (select 1 from public.student_rating_stages st where st.student_id = g.id));
```

Ожидается по текущему состоянию: 1 Admin, 0 Trainer, 28 этапов с баллами,
7 этапов без записей, 9 Dan без этапов.

## C. Поведенческий E2E (production, rollback-only, как владелец)

Метод — тот же, что в E2E 080–082: внутри транзакции
`SET LOCAL ROLE authenticated` и `request.jwt.claims` с `sub` =
`auth_user_id` реального **активного Admin jcl** (его `auth.uid()` видят
`current_active_trainer_account_id` / `can_trainer_access_student`). ID
тестовых учеников выбираются автоматически до смены роли. Любое невыполненное
ожидание — исключение (вся транзакция откатывается); иначе — `ROLLBACK` и
итоговая строка.

**Ограничения:** путь обычного Trainer не проверяется — в production нет
активного не-Admin Trainer-аккаунта (см. B); кросс-клубный кейс проверяется
только если в других клубах есть ученики, иначе помечается SKIP. PASS не
подделывается.

```sql
begin;

do $$
declare
  v_uid text;
  v_pos bigint; v_pos_total bigint; v_pos_count bigint;
  v_zero bigint;
  v_dan bigint;
  v_other bigint;
  v_missing bigint;
  r_pos jsonb; r_zero jsonb; r_dan jsonb; r_other jsonb; r_missing jsonb; r_null jsonb;
  v_before text; v_after text;
  v_fail text[] := array[]::text[];
  v_denied constant jsonb := '{"ok": false, "reason": "not_allowed"}'::jsonb;
begin
  -- Как владелец: тестовые данные и счётчики «до».
  select ta.auth_user_id::text into v_uid
  from public.trainer_accounts ta
  where ta.club_id = 'jcl' and ta.is_active and ta.portal_role = 'admin'
  order by ta.id limit 1;
  if v_uid is null then raise exception 'B5 E2E: no active jcl admin account'; end if;

  select x.student_id, x.total, x.n into v_pos, v_pos_total, v_pos_count
  from (select st.student_id, sum(e.points) as total, count(*) as n
        from public.student_rating_stages st
        join public.student_rating_entries e on e.stage_id = st.id
        where st.club_id = 'jcl' and st.status = 'active'
        group by st.student_id having sum(e.points) > 0
        order by st.student_id limit 1) x;

  select st.student_id into v_zero
  from public.student_rating_stages st
  where st.club_id = 'jcl' and st.status = 'active'
    and not exists (select 1 from public.student_rating_entries e where e.stage_id = st.id)
  order by st.student_id limit 1;

  select s.id into v_dan
  from public.students s
  join public.kyu_lookup kl on kl.id = private.resolve_judo_grade_lookup_id(s.kyu_grad)
  where s.club_id = 'jcl' and s.sport_id = 'judo'
    and private.judo_grade_rank(kl.kyu_grad) > 0
    and not exists (select 1 from public.student_rating_stages st where st.student_id = s.id)
  order by s.id limit 1;

  select s.id into v_other from public.students s where s.club_id <> 'jcl' order by s.id limit 1;
  select coalesce(max(s.id), 0) + 1000000 into v_missing from public.students s;

  v_before := concat_ws('/',
    (select count(*) from public.student_rating_entries),
    (select count(*) from public.student_rating_stages),
    (select count(*) from public.student_kyu_history),
    (select count(*) from public.club_rating_config));

  -- Как authenticated Admin jcl.
  set local role authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  r_pos := public.get_trainer_student_rating(v_pos);
  r_zero := public.get_trainer_student_rating(v_zero);
  r_dan := public.get_trainer_student_rating(v_dan);
  r_other := case when v_other is not null then public.get_trainer_student_rating(v_other) end;
  r_missing := public.get_trainer_student_rating(v_missing);
  r_null := public.get_trainer_student_rating(null);

  reset role;

  -- Ожидания.
  if v_pos is null then v_fail := v_fail || 'no positive candidate'::text;
  elsif not (r_pos ->> 'ok' = 'true' and r_pos ->> 'ratingActive' = 'true'
             and (r_pos ->> 'currentRatingTotal')::bigint = v_pos_total and v_pos_total > 0
             and (r_pos ->> 'entryCount')::bigint = v_pos_count and v_pos_count > 0
             and r_pos ->> 'studentId' = v_pos::text
             and jsonb_typeof(r_pos -> 'studentId') = 'string'
             and r_pos -> 'stage' ->> 'startsOn' is not null) then
    v_fail := v_fail || ('positive: ' || r_pos::text);
  end if;

  if v_zero is null then v_fail := v_fail || 'no zero candidate'::text;
  elsif not (r_zero ->> 'ok' = 'true' and r_zero ->> 'ratingActive' = 'true'
             and (r_zero ->> 'currentRatingTotal')::bigint = 0
             and (r_zero ->> 'entryCount')::bigint = 0
             and r_zero -> 'lastEntryOn' = 'null'::jsonb) then
    v_fail := v_fail || ('zero: ' || r_zero::text);
  end if;

  if v_dan is null then v_fail := v_fail || 'no Dan candidate'::text;
  elsif not (r_dan ->> 'ok' = 'true' and r_dan ->> 'ratingActive' = 'false'
             and r_dan ->> 'inactiveReason' = 'dan_policy_excluded'
             and r_dan -> 'currentGrade' ->> 'kind' = 'DAN') then
    v_fail := v_fail || ('dan: ' || r_dan::text);
  end if;

  if r_missing is distinct from v_denied then v_fail := v_fail || ('missing: ' || r_missing::text); end if;
  if r_null is distinct from v_denied then v_fail := v_fail || ('null: ' || r_null::text); end if;
  if v_other is not null and r_other is distinct from v_denied then
    v_fail := v_fail || ('other club: ' || r_other::text);
  end if;

  v_after := concat_ws('/',
    (select count(*) from public.student_rating_entries),
    (select count(*) from public.student_rating_stages),
    (select count(*) from public.student_kyu_history),
    (select count(*) from public.club_rating_config));
  if v_after is distinct from v_before then
    v_fail := v_fail || ('counts changed ' || v_before || ' -> ' || v_after);
  end if;

  if array_length(v_fail, 1) > 0 then
    raise exception 'B5_BEHAVIORAL_E2E_FAIL: %', array_to_string(v_fail, ' | ');
  end if;

  raise notice 'B5 E2E: positive=% zero=% dan=% other_club=% (%)',
    v_pos, v_zero, v_dan, coalesce(v_other::text, 'none'),
    case when v_other is null then 'cross-club SKIP' else 'cross-club PASS' end;
end;
$$;

rollback;

select 'B5_BEHAVIORAL_E2E_AFTER_ROLLBACK' as check_name,
       (select count(*) from public.student_rating_entries) as rating_entries,
       (select count(*) from public.student_rating_stages) as rating_stages,
       (select count(*) from public.student_kyu_history) as kyu_history,
       (select count(*) from public.club_rating_config) as club_rating_config,
       'PASS if the DO block above raised no exception' as status;
```

Ожидаемые итоговые счётчики: 182 / 35 / 0 / 1 (как до теста).

## D. Проверка «ноль записей»

- **Миграция 085** не содержит INSERT/UPDATE/DELETE бизнес-данных (только
  `CREATE FUNCTION`, владелец, права и самопроверку). Её самопроверка сравнивает
  **точные счётчики до/после** (снимок в начале транзакции через транзакционный
  `set_config`): журнал, этапы, закрытые этапы, `club_rating_config`.
  Проверок по времени (`created_at`/`closed_at >= now()`) нет: они не доказывают,
  что строку создала миграция, и параллельная легитимная транзакция дала бы
  ложный отказ.
- **RPC** — STABLE PL/pgSQL: PostgreSQL не позволяет ей выполнить
  INSERT/UPDATE/DELETE.
- **Поведенческий E2E (C)** — собственные счётчики до/после внутри транзакции
  (журнал, этапы, история Kyu, конфигурация), `ROLLBACK` и итоговая строка после
  отката.
