-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя (см. задание "Trainer Kyu-Programm — Go Kyu
-- template", этап 6/15).
--
-- НАЗНАЧЕНИЕ: единое хранение шаблонов-пресетов программы Kyu (DJB,
-- Go Kyu, и любой будущий template source) — источник, который тренер
-- может ПРИМЕНИТЬ как черновик текущей программы, но который сам по
-- себе НЕ является сохранённой программой клуба (public.
-- club_kyu_program_items, миграция 20260917120060/20260927100072).
--
-- ИСТОРИЯ РЕШЕНИЯ (заменяет предыдущий файл этой же даты,
-- 20260928100073_create_club_kyu_djb_template.sql — тот файл ЕЩЁ НЕ был
-- применён к production, поэтому безопасно заменён здесь целиком, а не
-- оставлен как отдельная DJB-специфичная таблица): первая версия
-- создавала club_kyu_djb_template_items только под DJB. Когда
-- потребовался второй, СТРУКТУРНО ИДЕНТИЧНЫЙ источник (Go Kyu),
-- сравнение двух вариантов:
--   A) отдельные таблицы (club_kyu_djb_template_items +
--      club_kyu_go_kyu_template_items) — дублирует таблицу+trigger+
--      RLS+revoke/grant+2 RPC ЦЕЛИКОМ под каждый source, при том что
--      единственное реальное отличие между ними — константа-ярлык
--      источника. Каждый следующий template source (задание прямо
--      упоминает такую возможность) снова удваивал бы весь этот код.
--   B) единая таблица club_kyu_template_items с template_type —
--      одна схема, один trigger, один RLS-блок, одна пара RPC с
--      дополнительным параметром p_template_type. Новый template source
--      в будущем — это ОДНО новое допустимое значение в CHECK, а не
--      новая таблица/RPC-пара.
-- Выбран вариант B: меньше дублирования, тот же уровень multi-club
-- изоляции и security definer-паттерна, не усложняет RLS (по-прежнему
-- вообще без policy — весь доступ только через RPC), а будущая
-- поддержка новых источников становится тривиальной. Единственный
-- реальный "минус" — RPC-параметр p_template_type вместо отдельных
-- имён функций — некритично для этого проекта (тот же паттерн, что
-- block_type уже как параметр, не отдельная колонка/таблица на блок).
--
-- ПОЧЕМУ НЕ public.club_kyu_program_items: если бы шаблоны лежали в той
-- же таблице, что и реальная программа, их увидели бы также
-- get_family_required_techniques/get_trainer_required_techniques
-- (миграция 20260918100061), которые читают club_kyu_program_items без
-- фильтрации по источнику — непреднамеренно "протекший" шаблон стал бы
-- видимым ученику/родителю как настоящие required techniques ДО того,
-- как тренер осознанно нажал «Сохранить». Отдельная таблица делает эту
-- утечку структурно невозможной.
--
-- CLUB-SCOPED vs GLOBAL — тот же открытый архитектурный вопрос, что и в
-- предыдущей версии этого файла (решён в пользу club-scoped: тот же
-- club_id text + family_club_exists() + trainer_accounts-резолюция, что
-- и во ВСЕХ остальных club-scoped таблицах проекта — минимальное
-- расхождение с уже принятой архитектурой). И DJB, и Go Kyu в принципе
-- могли бы быть ОДНОЙ общей строкой на всех клубов — если это будет
-- решено позже, club_id можно убрать отдельной миграцией без изменения
-- остальных колонок.
--
-- ОДНА ТЕХНИКА В НЕСКОЛЬКИХ БЛОКАХ: та же модель, что и
-- club_kyu_program_items (миграция 20260927100072) — одна и та же
-- technique_id может присутствовать одновременно в разных block_type
-- одного (club_id, kyu_lookup_id, template_type) шаблона, но не
-- дублируется дважды внутри одной и той же комбинации
-- (club, Kyu, template source, block) — unique index ниже.
--
-- BONUS TECHNIQUES / PR #19: не создаётся и не трогается здесь.

create table public.club_kyu_template_items (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  kyu_lookup_id bigint not null references public.kyu_lookup(id) on delete restrict,
  template_type text not null check (template_type in ('djb', 'go_kyu')),
  technique_id uuid not null references public.judo_techniques(id) on delete restrict,
  block_type text not null check (block_type in ('required_nage', 'required_katame', 'additional')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.club_kyu_template_items is
  'Шаблоны-пресеты программы Kyu (DJB/Go Kyu/будущие источники) — отдельно от сохранённой программы клуба (public.club_kyu_program_items). Тренер может применить шаблон как черновик текущей программы (frontend), фактическая программа сохраняется отдельным вызовом save_trainer_kyu_program только после явного подтверждения. template_type различает независимые шаблоны одного и того же (club_id, kyu_lookup_id) — изменение одного шаблона не влияет на другой.';
comment on column public.club_kyu_template_items.template_type is
  'djb/go_kyu — источник шаблона. Новый template source в будущем = новое допустимое значение здесь, без новой таблицы/RPC-пары (см. шапку файла).';
comment on column public.club_kyu_template_items.technique_id is
  'FOREIGN KEY на public.judo_techniques(id) — так же, как в club_kyu_program_items: name/category/main_group/image_path/youtube_url НИКОГДА не копируются сюда, только JOIN.';
comment on column public.club_kyu_template_items.block_type is
  'required_nage/required_katame/additional — та же организационная структура, что и club_kyu_program_items.block_type; НЕ validation относительно category/main_group техники.';

create unique index club_kyu_template_items_uidx
  on public.club_kyu_template_items(club_id, kyu_lookup_id, template_type, technique_id, block_type);

create index idx_club_kyu_template_items_club_id
  on public.club_kyu_template_items(club_id);
create index idx_club_kyu_template_items_kyu_lookup_id
  on public.club_kyu_template_items(kyu_lookup_id);
create index idx_club_kyu_template_items_technique_id
  on public.club_kyu_template_items(technique_id);
create index idx_club_kyu_template_items_template_type
  on public.club_kyu_template_items(template_type);

-- club_id должен реально существовать в clubs.club_id — тот же
-- family_club_exists(), что уже используется во всех club-scoped
-- таблицах проекта (см. 20260917120060 и другие).
create or replace function public.enforce_club_kyu_template_items_club_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.family_club_exists(new.club_id) then
    raise exception 'club_kyu_template_items.club_id % does not exist in clubs.club_id', new.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_club_kyu_template_items_club_exists
  before insert or update on public.club_kyu_template_items
  for each row execute function public.enforce_club_kyu_template_items_club_exists();

-- RLS: enabled, БЕЗ policy для anon/authenticated — весь доступ только
-- через SECURITY DEFINER RPC ниже, тот же принцип, что
-- club_kyu_program_items (20260917120060).
alter table public.club_kyu_template_items enable row level security;

revoke all privileges on table public.club_kyu_template_items from anon;
revoke all privileges on table public.club_kyu_template_items from authenticated;
revoke all privileges on table public.club_kyu_template_items from public;

grant select on table public.club_kyu_template_items to service_role;

-- ── RPC 1: READ ──────────────────────────────────────────────────────────
-- Дословно та же auth/club_id-резолюция, что get_trainer_kyu_program
-- (20260927100072) — плюс входной параметр p_template_type (валидация
-- допустимых значений здесь же, а не только через CHECK на таблице, для
-- понятного сообщения об ошибке до любого обращения к данным).
create function public.get_trainer_kyu_template(
  p_kyu_lookup_id bigint,
  p_template_type text
)
returns table (
  technique_id uuid,
  name text,
  category text,
  main_group text,
  image_path text,
  youtube_url text,
  youtube_video_id text,
  sort_order integer,
  block_type text
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
  if p_template_type not in ('djb', 'go_kyu') then
    raise exception 'p_template_type must be one of: djb, go_kyu';
  end if;

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
    ckti.sort_order,
    ckti.block_type
  from public.club_kyu_template_items ckti
  join public.judo_techniques jt on jt.id = ckti.technique_id
  where ckti.club_id = v_club_id
    and ckti.kyu_lookup_id = p_kyu_lookup_id
    and ckti.template_type = p_template_type
  order by ckti.block_type, ckti.sort_order, jt.name;
end;
$$;

revoke all on function public.get_trainer_kyu_template(bigint, text) from public;
revoke all on function public.get_trainer_kyu_template(bigint, text) from anon;
grant execute on function public.get_trainer_kyu_template(bigint, text) to authenticated;

-- ── RPC 2: WRITE ─────────────────────────────────────────────────────────
-- Дословно та же валидация/дедупликация/пересчёт sort_order по блокам,
-- что save_trainer_kyu_program (20260927100072) — плюс p_template_type,
-- и DELETE/INSERT всегда ограничены СВОИМ template_type (изменение DJB
-- никогда не трогает строки Go Kyu того же Kyu, и наоборот).
create function public.save_trainer_kyu_template(
  p_kyu_lookup_id bigint,
  p_template_type text,
  p_items jsonb
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
  v_items jsonb;
  v_invalid_block_count integer;
  v_invalid_technique_count integer;
begin
  if p_template_type not in ('djb', 'go_kyu') then
    raise exception 'p_template_type must be one of: djb, go_kyu';
  end if;

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

  v_items := coalesce(p_items, '[]'::jsonb);

  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  select count(*)
    into v_invalid_block_count
  from jsonb_array_elements(v_items) as elem
  where (elem->>'block_type') is null
     or (elem->>'block_type') not in ('required_nage', 'required_katame', 'additional')
     or (elem->>'technique_id') is null;

  if v_invalid_block_count > 0 then
    raise exception 'One or more items have an invalid or missing block_type/technique_id';
  end if;

  select count(*)
    into v_invalid_technique_count
  from (
    select distinct (elem->>'technique_id')::uuid as technique_id
    from jsonb_array_elements(v_items) as elem
  ) t
  where not exists (
    select 1
    from public.judo_techniques jt
    where jt.id = t.technique_id
      and jt.active = true
  );

  if v_invalid_technique_count > 0 then
    raise exception 'One or more technique_ids do not exist or are not active';
  end if;

  delete from public.club_kyu_template_items
  where club_id = v_club_id
    and kyu_lookup_id = p_kyu_lookup_id
    and template_type = p_template_type;

  with parsed as (
    select
      (elem->>'technique_id')::uuid as technique_id,
      elem->>'block_type' as block_type,
      ord
    from jsonb_array_elements(v_items) with ordinality as arr(elem, ord)
  ),
  deduped as (
    select distinct on (block_type, technique_id) technique_id, block_type, ord
    from parsed
    order by block_type, technique_id, ord
  ),
  ranked as (
    select
      technique_id,
      block_type,
      row_number() over (partition by block_type order by ord) as rn
    from deduped
  )
  insert into public.club_kyu_template_items (club_id, kyu_lookup_id, template_type, technique_id, block_type, sort_order)
  select v_club_id, p_kyu_lookup_id, p_template_type, technique_id, block_type, rn - 1
  from ranked;

  return true;
end;
$$;

revoke all on function public.save_trainer_kyu_template(bigint, text, jsonb) from public;
revoke all on function public.save_trainer_kyu_template(bigint, text, jsonb) from anon;
grant execute on function public.save_trainer_kyu_template(bigint, text, jsonb) to authenticated;
