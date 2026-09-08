-- =====================================================================
-- JUDO_TECHNIQUES_POST_DEPLOY_SMOKE_TEST.sql
-- =====================================================================
--
-- НАЗНАЧЕНИЕ: read-only проверка сразу после применения
-- 20260908120041_create_judo_techniques.sql и
-- 20260908120042_seed_judo_techniques_100.sql через Dashboard SQL Editor.
--
-- ⚠️ ТОЛЬКО ДЛЯ РУЧНОГО ЗАПУСКА ВЛАДЕЛЬЦЕМ. Не выполнялся против production
-- в рамках этой сессии — у сессии нет service_role/DDL-доступа, только
-- анонимный (публичный) ключ. RLS-policy judo_techniques_select_authenticated
-- (см. 20260908120041) разрешает SELECT только роли `authenticated` —
-- анонимный ключ структурно не может прочитать содержимое таблицы, только
-- подтвердить факт её существования (что и было сделано этой сессией:
-- на момент подготовки этого файла public.judo_techniques ещё не
-- существовала в production — миграции ещё не применены).
--
-- READ-ONLY: только SELECT. Выполняется от имени `postgres`/владельца
-- проекта в SQL Editor, поэтому RLS не мешает (роль postgres не подчиняется
-- политикам таблицы), и это единственный способ получить агрегаты и
-- содержимое, которые сама сессия получить не может.
--
-- Результат: ОДИН result grid, колонки:
--   section | check_name | status | actual_value | expected_value
-- Финальная строка check_name = POST_IMPORT_SMOKE_TEST.
--
-- Выполнять двумя ОТДЕЛЬНЫМИ запусками (SQL Editor показывает грид только
-- последнего выполненного запроса при запуске всего файла разом):
--   ЧАСТЬ 1 — все проверки ниже, до "ЧАСТЬ 2".
--   ЧАСТЬ 2 — 10 случайных записей (в самом низу файла).
-- =====================================================================

-- ── ЧАСТЬ 1: проверки ──────────────────────────────────────────────────
with

a_rows as (
  select 'A_EXISTENCE'::text as section, 'public.judo_techniques exists'::text as check_name,
         case when to_regclass('public.judo_techniques') is not null then 'GREEN' else 'RED' end as status,
         (to_regclass('public.judo_techniques') is not null)::text as actual_value,
         'true'::text as expected_value
),

b_rows as (
  select 'B_COUNTS'::text as section, 'total_rows'::text as check_name,
         case when (select count(*) from public.judo_techniques) = 100 then 'GREEN' else 'RED' end as status,
         (select count(*)::text from public.judo_techniques) as actual_value,
         '100'::text as expected_value
  where to_regclass('public.judo_techniques') is not null
  union all
  select 'B_COUNTS', 'active_true_count',
         case when (select count(*) from public.judo_techniques where active = true) = 100 then 'GREEN' else 'RED' end,
         (select count(*)::text from public.judo_techniques where active = true),
         '100'
  where to_regclass('public.judo_techniques') is not null
  union all
  select 'B_COUNTS', 'empty_youtube_url_count',
         case when (select count(*) from public.judo_techniques where youtube_url is null or btrim(youtube_url) = '') = 0 then 'GREEN' else 'RED' end,
         (select count(*)::text from public.judo_techniques where youtube_url is null or btrim(youtube_url) = ''),
         '0'
  where to_regclass('public.judo_techniques') is not null
  union all
  select 'B_COUNTS', 'empty_youtube_video_id_count',
         case when (select count(*) from public.judo_techniques where youtube_video_id is null or btrim(youtube_video_id) = '') = 0 then 'GREEN' else 'RED' end,
         (select count(*)::text from public.judo_techniques where youtube_video_id is null or btrim(youtube_video_id) = ''),
         '0'
  where to_regclass('public.judo_techniques') is not null
),

c_rows as (
  select 'C_DUPLICATES'::text as section, 'duplicate_name_groups'::text as check_name,
         case when (select count(*) from (select name from public.judo_techniques group by name having count(*) > 1) x) = 0 then 'GREEN' else 'RED' end as status,
         (select count(*)::text from (select name from public.judo_techniques group by name having count(*) > 1) x) as actual_value,
         '0'::text as expected_value
  where to_regclass('public.judo_techniques') is not null
  union all
  select 'C_DUPLICATES', 'duplicate_youtube_url_groups',
         case when (select count(*) from (select youtube_url from public.judo_techniques group by youtube_url having count(*) > 1) x) = 0 then 'GREEN' else 'RED' end,
         (select count(*)::text from (select youtube_url from public.judo_techniques group by youtube_url having count(*) > 1) x),
         '0'
  where to_regclass('public.judo_techniques') is not null
),

d_expected(cat, expected) as (
  values
    ('Te-waza', 16), ('Koshi-waza', 10), ('Ashi-waza', 21), ('Ma-sutemi-waza', 5),
    ('Yoko-sutemi-waza', 16), ('Osaekomi-waza', 10), ('Shime-waza', 12), ('Kansetsu-waza', 10)
),
d_rows as (
  select 'D_CATEGORY_COUNTS'::text as section, e.cat || ' count' as check_name,
         case when coalesce(a.actual, 0) = e.expected then 'GREEN' else 'RED' end as status,
         coalesce(a.actual, 0)::text as actual_value,
         e.expected::text as expected_value
  from d_expected e
  left join (
    select category, count(*) as actual from public.judo_techniques group by category
  ) a on a.category = e.cat
  where to_regclass('public.judo_techniques') is not null
),

e_rows as (
  select 'E_SPECIFIC_ROWS'::text as section, 'uchi-mata.youtube_url'::text as check_name,
         case when (select youtube_url from public.judo_techniques where name = 'uchi-mata') = 'https://youtu.be/F27ReC9AALM' then 'GREEN' else 'RED' end as status,
         coalesce((select youtube_url from public.judo_techniques where name = 'uchi-mata'), 'ROW MISSING') as actual_value,
         'https://youtu.be/F27ReC9AALM'::text as expected_value
  where to_regclass('public.judo_techniques') is not null
  union all
  select 'E_SPECIFIC_ROWS', 'uchi-mata.youtube_video_id',
         case when (select youtube_video_id from public.judo_techniques where name = 'uchi-mata') = 'F27ReC9AALM' then 'GREEN' else 'RED' end,
         coalesce((select youtube_video_id from public.judo_techniques where name = 'uchi-mata'), 'ROW MISSING'),
         'F27ReC9AALM'
  where to_regclass('public.judo_techniques') is not null
  union all
  select 'E_SPECIFIC_ROWS', 'uchimata-gaeshi.youtube_url',
         case when (select youtube_url from public.judo_techniques where name = 'uchimata-gaeshi') = 'https://youtu.be/6CbcIRSK93k' then 'GREEN' else 'RED' end,
         coalesce((select youtube_url from public.judo_techniques where name = 'uchimata-gaeshi'), 'ROW MISSING'),
         'https://youtu.be/6CbcIRSK93k'
  where to_regclass('public.judo_techniques') is not null
  union all
  select 'E_SPECIFIC_ROWS', 'uchimata-gaeshi.youtube_video_id',
         case when (select youtube_video_id from public.judo_techniques where name = 'uchimata-gaeshi') = '6CbcIRSK93k' then 'GREEN' else 'RED' end,
         coalesce((select youtube_video_id from public.judo_techniques where name = 'uchimata-gaeshi'), 'ROW MISSING'),
         '6CbcIRSK93k'
  where to_regclass('public.judo_techniques') is not null
),

all_rows as (
  select * from a_rows
  union all select * from b_rows
  union all select * from c_rows
  union all select * from d_rows
  union all select * from e_rows
),

final_rows as (
  select * from all_rows
  union all
  select
    'F_SUMMARY' as section,
    'POST_IMPORT_SMOKE_TEST' as check_name,
    case when count(*) filter (where status = 'RED') > 0 then 'RED' else 'GREEN' end as status,
    'red=' || count(*) filter (where status = 'RED') || ', green=' || count(*) filter (where status = 'GREEN') as actual_value,
    'red=0' as expected_value
  from all_rows
)

select section, check_name, status, actual_value, expected_value
from final_rows
order by
  case status when 'RED' then 1 else 2 end,
  section, check_name;

-- ── ЧАСТЬ 2: 10 случайных записей (выполнить ОТДЕЛЬНЫМ запуском) ───────
-- select name, main_group, category, youtube_url, youtube_video_id
-- from public.judo_techniques
-- order by random()
-- limit 10;
