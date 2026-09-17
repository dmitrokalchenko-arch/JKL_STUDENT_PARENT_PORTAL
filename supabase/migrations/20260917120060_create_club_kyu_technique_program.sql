-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя (см. процесс проекта).
--
-- НАЗНАЧЕНИЕ: этап 1 задачи "Club Kyu Technique Program" — club-wide
-- программа необходимых техник для конкретного Kyu. Тренер клуба
-- настраивает, какие техники из существующего каталога public.judo_techniques
-- требуются ученику для конкретного Kyu. Это НЕ настройка конкретного
-- ученика — программа общая для всего клуба.
--
-- ЭТА МИГРАЦИЯ НЕ ЗАМЕНЯЕТ и НЕ ТРОГАЕТ 20260913120053/20260914100054 —
-- те файлы остаются как есть (уже закоммичены, не применены, не
-- редактируются задним числом). club_required_techniques/
-- student_bonus_technique_overrides из тех миграций здесь НЕ создаются.
-- Причина завести новую независимую таблицу вместо применения
-- 053/054: та схема использует belt_key (text, НЕ FK) для связи с Kyu —
-- сама 054 фиксирует это как "BLOCKING ARCHITECTURE ISSUE". Здесь вместо
-- этого club_kyu_program_items.kyu_lookup_id — настоящий FK на
-- public.kyu_lookup(id).
--
-- КАТАЛОГ ТЕХНИК: НЕ дублируется. Ссылка ТОЛЬКО на public.judo_techniques(id)
-- (100 активных техник, уже существующих в production) — тот же принцип,
-- что уже применён в student_technique_records/club_required_techniques.
--
-- KIHON / OTHER EXAM ELEMENTS: item_type — архитектурный резерв на
-- будущее (значения 'kihon'/'other' допустимы схемой), но НИ ОДНОЙ строки
-- с item_type <> 'technique' эта миграция не создаёт и не заполняет.
-- Kihon НЕ добавляется как фиктивные записи в judo_techniques.
--
-- BONUS TECHNIQUES: не реализуется в этой задаче вообще — ни таблиц, ни
-- RPC, ни бизнес-логики. Required Techniques (эта миграция) и Bonus —
-- разные понятия (следующий Kyu vs уже полученный), не смешиваются.
--
-- MULTI-CLUB: club_id — text, та же конвенция валидности через
-- public.family_club_exists(p_club_id text), что уже используется во
-- всех club-scoped таблицах проекта (student_technique_records,
-- club_student_page_settings, club_technique_program_settings из 053).
-- Программа клуба A физически не может быть прочитана/изменена для
-- клуба B — club_id ВСЕГДА резолвится сервером из auth.uid() тренера
-- (trainer_accounts.auth_user_id = auth.uid() -> trainer_accounts.club_id),
-- никогда не передаётся с клиента как доверенный параметр.
--
-- KYU vs DAN: public.kyu_lookup НЕ изменяется этой миграцией (Dan-строки
-- id=10..12 остаются как есть). Редактируемая программа на этом этапе —
-- только Kyu (id=1..9, kyu_grad вида '9. Kyu'..'1. Kyu'). Обе новые RPC
-- проверяют это не по id <= 9 (хрупко к возможному будущему
-- переупорядочиванию), а по реальному значению kyu_lookup.kyu_grad —
-- все 9 строк Kyu содержат подстроку 'Kyu', все 3 строки Dan содержат
-- 'Dan', пересечения нет (проверено прямым запросом к production перед
-- написанием этой миграции).

create table if not exists public.club_kyu_program_items (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  kyu_lookup_id bigint not null references public.kyu_lookup(id) on delete restrict,
  item_type text not null default 'technique' check (item_type in ('technique', 'kihon', 'other')),
  technique_id uuid null references public.judo_techniques(id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint club_kyu_program_items_technique_shape check (
    (item_type = 'technique') = (technique_id is not null)
  )
);

comment on table public.club_kyu_program_items is
  'Club-wide программа необходимых техник по Kyu. item_type=''technique'' — единственное реально используемое значение на этом этапе (technique_id -> public.judo_techniques(id), name/category/main_group/image_path/youtube_url НИКОГДА не копируются сюда). ''kihon''/''other'' — зарезервированные значения под будущие не-technique элементы программы, строк с ними в этой миграции не создаётся. НЕ путать с Bonus Techniques (отдельное, нереализованное на этом этапе понятие — программа УЖЕ полученного Kyu, а не следующего).';
comment on column public.club_kyu_program_items.kyu_lookup_id is
  'FOREIGN KEY на public.kyu_lookup(id) — настоящая referential integrity вместо свободного текстового belt_key (см. blocking-issue в 20260914100054). Редактируемая программа на этом этапе — только Kyu-строки (kyu_grad содержит ''Kyu''), Dan-строки существуют в kyu_lookup, но RPC save_trainer_kyu_program их отклоняет.';
comment on column public.club_kyu_program_items.technique_id is
  'FOREIGN KEY на public.judo_techniques(id) — NOT NULL, когда item_type=''technique'' (единственный сценарий, реально используемый сейчас), NULL для зарезервированных item_type (''kihon''/''other'') — см. CHECK club_kyu_program_items_technique_shape.';

-- Не должно быть возможности дважды добавить одну и ту же технику одному
-- и тому же Kyu одного клуба. Partial-индекс (не обычный UNIQUE), т.к.
-- будущие non-technique item_type будут иметь свой собственный принцип
-- уникальности, ещё не спроектированный здесь.
create unique index if not exists club_kyu_program_items_technique_uidx
  on public.club_kyu_program_items(club_id, kyu_lookup_id, technique_id)
  where technique_id is not null;

create index if not exists idx_club_kyu_program_items_club_id
  on public.club_kyu_program_items(club_id);
create index if not exists idx_club_kyu_program_items_kyu_lookup_id
  on public.club_kyu_program_items(kyu_lookup_id);
create index if not exists idx_club_kyu_program_items_technique_id
  on public.club_kyu_program_items(technique_id);

-- club_id должен реально существовать в clubs.club_id — тот же
-- family_club_exists(), что уже используется для всех club-scoped таблиц
-- проекта (student_technique_records, club_student_page_settings,
-- club_technique_program_settings из 053) — переиспользуем, не дублируем.
create or replace function public.enforce_club_kyu_program_items_club_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.family_club_exists(new.club_id) then
    raise exception 'club_kyu_program_items.club_id % does not exist in clubs.club_id', new.club_id;
  end if;
  return new;
end;
$$;

create trigger trg_club_kyu_program_items_club_exists
  before insert or update on public.club_kyu_program_items
  for each row execute function public.enforce_club_kyu_program_items_club_exists();

-- RLS: включён, НИ ОДНОЙ policy для anon/authenticated — весь доступ
-- только через SECURITY DEFINER RPC ниже (club_id резолвится сервером,
-- никогда не приходит от клиента как доверенный параметр).
alter table public.club_kyu_program_items enable row level security;

-- Явный revoke СРАЗУ в этой же миграции (не отдельной hardening-миграцией
-- постфактум, как пришлось делать для club_student_page_settings в
-- 20260916150058) — тот же принцип, что уже подтверждён трижды в проекте:
-- PUBLIC/DEFAULT PRIVILEGES на новые таблицы в этом Supabase-проекте
-- оказываются шире, чем предполагается, полагаться на дефолт нельзя.
revoke all privileges on table public.club_kyu_program_items from anon;
revoke all privileges on table public.club_kyu_program_items from authenticated;
revoke all privileges on table public.club_kyu_program_items from public;

grant select on table public.club_kyu_program_items to service_role;

-- ── RPC 1: READ — Trainer, только программа своего клуба ───────────────
-- club_id резолвится ТЕМ ЖЕ fail-closed способом, что
-- get_trainer_student_page_config()/get_current_trainer_write_context()
-- (ровно один активный trainer_accounts для auth.uid(), иначе exception
-- на неоднозначность/пустой результат на отсутствие доступа — тренер без
-- активного trainer_accounts получает 0 строк, а не ошибку, тот же
-- принцип, что уже применён в проекте для read-путей).
--
-- Возвращает уже присоединённые данные техники (name/category/main_group/
-- image_path/youtube_url/youtube_video_id) — frontend не должен сам
-- собирать отдельный (потенциально небезопасный) запрос к judo_techniques.
create or replace function public.get_trainer_kyu_program(p_kyu_lookup_id bigint)
returns table (
  technique_id uuid,
  name text,
  category text,
  main_group text,
  image_path text,
  youtube_url text,
  youtube_video_id text,
  sort_order integer
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
    ckpi.sort_order
  from public.club_kyu_program_items ckpi
  join public.judo_techniques jt on jt.id = ckpi.technique_id
  where ckpi.club_id = v_club_id
    and ckpi.kyu_lookup_id = p_kyu_lookup_id
    and ckpi.item_type = 'technique'
  order by ckpi.sort_order, jt.name;
end;
$$;

-- ── RPC 2: WRITE — Trainer only, только программа своего клуба ─────────
-- Возвращает false (не exception), если у вызывающего нет ровно одного
-- активного trainer_accounts — тот же принцип, что
-- save_trainer_student_page_config(): вызывающий без прав никогда не
-- может получить ложный "успех". club_id — ТОЛЬКО из auth.uid(),
-- p_kyu_lookup_id/p_technique_ids — единственные клиентские параметры,
-- ни один из них не может повлиять на club_id записи.
--
-- Полностью заменяет набор item_type='technique' для (club_id,
-- p_kyu_lookup_id) — DELETE+INSERT внутри одного вызова функции
-- атомарны в рамках транзакции вызывающего (PL/pgSQL: любая ошибка в
-- теле функции откатывает всё тело целиком). Другие клубы, другие Kyu и
-- будущие item_type<>'technique' строки никогда не затрагиваются —
-- WHERE всегда club_id = v_club_id AND kyu_lookup_id = p_kyu_lookup_id
-- AND item_type = 'technique'.
create or replace function public.save_trainer_kyu_program(
  p_kyu_lookup_id bigint,
  p_technique_ids uuid[]
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
  v_technique_ids uuid[];
  v_invalid_count integer;
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

  -- Deduplicate + отбросить NULL из входного массива (сервер сам приводит
  -- вход к безопасному виду, а не отклоняет дубликаты ошибкой — как
  -- предпочтено заданием). NULL/пустой p_technique_ids безопасно даёт '{}'.
  select coalesce(array_agg(distinct t), '{}')
    into v_technique_ids
  from unnest(p_technique_ids) as t
  where t is not null;

  select count(*)
    into v_invalid_count
  from unnest(v_technique_ids) as t
  where not exists (
    select 1
    from public.judo_techniques jt
    where jt.id = t
      and jt.active = true
  );

  if v_invalid_count > 0 then
    raise exception 'One or more technique_ids do not exist or are not active';
  end if;

  delete from public.club_kyu_program_items
  where club_id = v_club_id
    and kyu_lookup_id = p_kyu_lookup_id
    and item_type = 'technique';

  -- Пустой массив = для этого Kyu не выбрано ни одной техники (валидное
  -- состояние после DELETE выше, INSERT просто не выполняется).
  if coalesce(array_length(v_technique_ids, 1), 0) > 0 then
    insert into public.club_kyu_program_items (club_id, kyu_lookup_id, item_type, technique_id, sort_order)
    select v_club_id, p_kyu_lookup_id, 'technique', u.t, u.ord - 1
    from unnest(v_technique_ids) with ordinality as u(t, ord);
  end if;

  return true;
end;
$$;

-- Явный revoke + точечный grant — та же дважды подтверждённая в проекте
-- необходимость (см. 20260916150058, 20260916160059).
revoke all on function public.get_trainer_kyu_program(bigint) from public;
revoke all on function public.get_trainer_kyu_program(bigint) from anon;
grant execute on function public.get_trainer_kyu_program(bigint) to authenticated;

revoke all on function public.save_trainer_kyu_program(bigint, uuid[]) from public;
revoke all on function public.save_trainer_kyu_program(bigint, uuid[]) from anon;
grant execute on function public.save_trainer_kyu_program(bigint, uuid[]) to authenticated;
