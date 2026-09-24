-- ✅ ПРИМЕНЕНО К PRODUCTION (проверено read-only до и после: 0 строк в
-- club_kyu_program_items и до, и после — пользователь вручную очистил
-- таблицу перед этим этапом, поэтому миграция сознательно не содержит
-- backfill/data-migration шага для старых записей; см. отчёт сессии).
--
-- НАЗНАЧЕНИЕ: минимальное расширение уже применённой к production
-- club_kyu_program_items (миграция 20260917120060) под задачу
-- "Trainer Kyu-Programm — три блока" (required_nage / required_katame /
-- additional). Явно РАСШИРЯЕТ существующую модель вместо создания
-- параллельной таблицы/RPC-набора — так и запрошено заданием.
--
-- BLOCK_TYPE — организационная структура программы, НЕ validation
-- category-техники. save_trainer_kyu_program ниже НЕ проверяет
-- judo_techniques.category/main_group техники относительно выбранного
-- block_type — тренер может положить любую технику в любой блок (см.
-- задание, раздел 6). block_type — просто ещё одна колонка на строке
-- club_kyu_program_items, как kyu_lookup_id.
--
-- ОДНА ТЕХНИКА В НЕСКОЛЬКИХ БЛОКАХ: старый уникальный индекс
-- club_kyu_program_items_technique_uidx (club_id, kyu_lookup_id,
-- technique_id) запрещал ЛЮБОЕ повторное появление техники в Kyu вообще.
-- Заменяется индексом, дополнительно учитывающим block_type — теперь
-- одна и та же technique_id может быть одновременно, например, в
-- required_nage И в additional одного Kyu (это две разные строки), но
-- не может дублироваться дважды ВНУТРИ одного и того же блока.
--
-- RPC-КОНТРАКТ МЕНЯЕТСЯ (не просто расширяется телом функции):
--   get_trainer_kyu_program(bigint) — добавлена колонка block_type в
--     RETURNS TABLE, поэтому CREATE OR REPLACE недостаточен (Postgres не
--     позволяет менять набор колонок без DROP) — функция явно
--     пересоздаётся тем же именем и той же сигнатурой параметров.
--   save_trainer_kyu_program(bigint, uuid[]) — старая сигнатура ЗАМЕНЯЕТСЯ
--     на save_trainer_kyu_program(bigint, jsonb): второй параметр теперь
--     jsonb-массив объектов {technique_id, block_type}, а не плоский
--     uuid[] — старая сигнатура явно удаляется (DROP FUNCTION), чтобы не
--     оставлять в production два одновременно вызываемых перегруженных
--     варианта с разным контрактом сохранения одной и той же таблицы.
--
-- ЧТО НЕ ТРОГАЕТСЯ: get_family_required_techniques/
-- get_trainer_required_techniques (миграция 20260918100061) продолжают
-- читать club_kyu_program_items по item_type='technique' независимо от
-- block_type (просто увидят суммарно все три блока как один список
-- "необходимых техник следующего Kyu" — семантически то же самое
-- поведение, что было и раньше, когда единого блока-разделения не
-- существовало вообще). RLS/policies/auth/club_id-резолюция — без
-- изменений, тот же security definer + trainer_accounts-резолюция, что
-- и в исходной миграции 20260917120060.
--
-- BONUS TECHNIQUES / PR #19: не создаётся и не трогается здесь.
-- Архитектурно эта миграция лишь даёт возможность В БУДУЩЕМ определить,
-- какие technique_id входили в required_nage/required_katame/additional
-- сданного Kyu — саму связь с уже сданным экзаменом эта миграция не
-- строит (см. задание, раздел 19 — это заявлено только как
-- architecture-требование на будущее, не реализуется сейчас).

alter table public.club_kyu_program_items
  add column if not exists block_type text not null default 'required_nage'
    check (block_type in ('required_nage', 'required_katame', 'additional'));

comment on column public.club_kyu_program_items.block_type is
  'Организационный блок программы Kyu (required_nage/required_katame/additional) — НЕ validation относительно judo_techniques.category/main_group техники, тренер волен положить любую технику в любой блок. Одна и та же technique_id может присутствовать в разных блоках одного (club_id, kyu_lookup_id) — уникальность ниже учитывает block_type.';

drop index if exists public.club_kyu_program_items_technique_uidx;

create unique index if not exists club_kyu_program_items_technique_block_uidx
  on public.club_kyu_program_items(club_id, kyu_lookup_id, technique_id, block_type)
  where technique_id is not null;

-- ── RPC 1: READ — добавлена колонка block_type ──────────────────────────
drop function if exists public.get_trainer_kyu_program(bigint);

create function public.get_trainer_kyu_program(p_kyu_lookup_id bigint)
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
    ckpi.sort_order,
    ckpi.block_type
  from public.club_kyu_program_items ckpi
  join public.judo_techniques jt on jt.id = ckpi.technique_id
  where ckpi.club_id = v_club_id
    and ckpi.kyu_lookup_id = p_kyu_lookup_id
    and ckpi.item_type = 'technique'
  order by ckpi.block_type, ckpi.sort_order, jt.name;
end;
$$;

revoke all on function public.get_trainer_kyu_program(bigint) from public;
revoke all on function public.get_trainer_kyu_program(bigint) from anon;
grant execute on function public.get_trainer_kyu_program(bigint) to authenticated;

-- ── RPC 2: WRITE — новая сигнатура (bigint, jsonb) ──────────────────────
-- Старая save_trainer_kyu_program(bigint, uuid[]) явно удаляется — новый
-- frontend больше не вызывает её ни при каких условиях, оставлять
-- нерабочий (в терминах реального UI) перегруженный вариант в production
-- было бы просто мёртвым/вводящим в заблуждение кодом.
drop function if exists public.save_trainer_kyu_program(bigint, uuid[]);

-- p_items — jsonb-массив объектов {"technique_id": uuid, "block_type": text}.
-- Дедупликация — ПО ПАРЕ (block_type, technique_id), не только по
-- technique_id (см. шапку файла): одна техника может стоять в двух
-- разных блоках одновременно, это осознанно допустимо.
create function public.save_trainer_kyu_program(
  p_kyu_lookup_id bigint,
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

  delete from public.club_kyu_program_items
  where club_id = v_club_id
    and kyu_lookup_id = p_kyu_lookup_id
    and item_type = 'technique';

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
  insert into public.club_kyu_program_items (club_id, kyu_lookup_id, item_type, technique_id, block_type, sort_order)
  select v_club_id, p_kyu_lookup_id, 'technique', technique_id, block_type, rn - 1
  from ranked;

  return true;
end;
$$;

revoke all on function public.save_trainer_kyu_program(bigint, jsonb) from public;
revoke all on function public.save_trainer_kyu_program(bigint, jsonb) from anon;
grant execute on function public.save_trainer_kyu_program(bigint, jsonb) to authenticated;
