-- Student Kyu History (Rating Database Design, Migration B1).
--
-- Неизменяемая история градуировок Judo ученика. Имя таблицы — историческое
-- (student_kyu_history), по смыслу хранит ЛЮБУЮ каноническую ступень Judo из
-- public.kyu_lookup: и Kyu, и Dan (production: у учеников jcl есть оба).
-- Каноническая идентичность ступени — kyu_lookup_id; kyu_grad_snapshot —
-- подпись на момент записи (подписи справочника могут измениться позже).
--
-- Модель — одна линейная цепочка фактов на (student_id, kyu_lookup_id):
--   recorded   — корень цепочки (supersedes_id NULL), ровно один на ученика+ступень;
--   corrected  — новая дата, supersedes_id = текущая терминальная строка;
--   retracted  — факт перестаёт действовать (obtained_on NULL), supersedes_id =
--                текущая терминальная строка.
-- Действующий факт = терминальная строка цепочки (на неё никто не ссылается
-- через supersedes_id), если её entry_kind <> 'retracted'. Терминальная
-- retracted => у ученика+ступени НЕТ действующего факта. corrected после
-- retracted восстанавливает факт. Неизвестная дата = отсутствие строки:
-- дата никогда не придумывается; технический старт рейтинга 2026-06-22 здесь
-- не используется.
--
-- Гарантии на уровне БД:
--   * один корень:          UNIQUE (student_id, kyu_lookup_id) WHERE recorded;
--   * линейность цепочки:   UNIQUE (supersedes_id) — строку можно заменить
--                           только один раз, конкурирующие исправления одной
--                           терминальной строки не могут выиграть обе;
--   * та же цепочка:        составной FK (supersedes_id, student_id, club_id,
--                           kyu_lookup_id) -> (id, student_id, club_id, kyu_lookup_id);
--   * без циклов:           CHECK supersedes_id <> id + BEFORE INSERT требует,
--                           чтобы заменяемая строка УЖЕ существовала;
--   * неизменяемость:       UPDATE / DELETE / TRUNCATE отклоняются триггерами
--                           для всех ролей, включая владельца.
--
-- Авторизация записи (будущие definer-RPC; здесь — защита на уровне строки):
--   recorded            — Trainer или Admin (доступ к ученику проверит RPC через
--                         public.can_trainer_access_student; оплаченная Student
--                         Page НЕ требуется);
--   corrected/retracted — только Admin, причина обязательна.
-- Роль — только trainer_accounts.portal_role (legacy trainers.rolle не
-- используется); recorded_by_portal_role — снимок роли на момент записи,
-- обязан совпадать с ТЕКУЩЕЙ ролью активного аккаунта того же клуба.
--
-- Блокировка: отдельный helper не создаётся — все инварианты B1 защищены
-- ограничениями. Будущие RPC, которым нужна сериализация по ученику
-- (например, проверка хронологии ступеней), берут
-- pg_advisory_xact_lock(hashtext('jkl.student_rating'), hashtext(student_id::text))
-- напрямую — тот же ключ будет использовать B2.
--
-- НЕ делает: нет Rating Stages / Ledger / Settings (B2/C), нет RPC, нет
-- bootstrap и импорта из students.kyu_grad, не читает attendance, не меняет
-- students / kyu_lookup / trainer_accounts / legacy-таблицы JCL.
--
-- Проверка: docs/database/STUDENT_KYU_HISTORY_B1_SQL_VERIFICATION.md

begin;

-- ── 1. Таблица ───────────────────────────────────────────────────────────
create table public.student_kyu_history (
  id uuid not null default gen_random_uuid(),
  club_id text not null,
  student_id bigint not null,
  kyu_lookup_id bigint not null,
  kyu_grad_snapshot text not null,
  entry_kind text not null,
  obtained_on date null,
  supersedes_id uuid null,
  source text not null,
  reason text null,
  recorded_by_trainer_account_id uuid not null,
  recorded_by_portal_role text not null,
  created_at timestamptz not null default now(),
  constraint student_kyu_history_pkey primary key (id),
  constraint student_kyu_history_chain_key unique (id, student_id, club_id, kyu_lookup_id),
  constraint student_kyu_history_supersedes_once unique (supersedes_id),
  constraint student_kyu_history_student_fk
    foreign key (student_id) references public.students(id) on delete restrict,
  constraint student_kyu_history_kyu_lookup_fk
    foreign key (kyu_lookup_id) references public.kyu_lookup(id) on delete restrict,
  constraint student_kyu_history_author_fk
    foreign key (recorded_by_trainer_account_id) references public.trainer_accounts(id) on delete restrict,
  constraint student_kyu_history_entry_kind_check
    check (entry_kind in ('recorded', 'corrected', 'retracted')),
  -- 'promotion' разрешён уже сейчас: будущий Promote Kyu создаёт корневой факт
  -- новой ступени; B1 и ближайшие RPC пишут только 'manual_entry'.
  constraint student_kyu_history_source_check
    check (source in ('manual_entry', 'promotion')),
  constraint student_kyu_history_role_check
    check (recorded_by_portal_role in ('trainer', 'admin')),
  constraint student_kyu_history_obtained_on_shape
    check ((entry_kind = 'retracted') = (obtained_on is null)),
  constraint student_kyu_history_supersedes_shape
    check ((entry_kind = 'recorded') = (supersedes_id is null)),
  constraint student_kyu_history_not_self
    check (supersedes_id is null or supersedes_id <> id),
  constraint student_kyu_history_reason_check
    check ((reason is null or btrim(reason) <> '')
           and (entry_kind = 'recorded' or reason is not null)),
  constraint student_kyu_history_admin_change_check
    check (entry_kind = 'recorded' or recorded_by_portal_role = 'admin'),
  constraint student_kyu_history_promotion_is_root
    check (source = 'manual_entry' or entry_kind = 'recorded'),
  constraint student_kyu_history_snapshot_check
    check (btrim(kyu_grad_snapshot) <> ''),
  constraint student_kyu_history_club_id_check
    check (btrim(club_id) <> '')
);

-- Самоссылка на составной ключ цепочки: исправление/отзыв относится к тому
-- же ученику, клубу и ступени. MATCH SIMPLE: для корня (supersedes_id NULL)
-- не проверяется.
alter table public.student_kyu_history
  add constraint student_kyu_history_supersedes_fk
  foreign key (supersedes_id, student_id, club_id, kyu_lookup_id)
  references public.student_kyu_history(id, student_id, club_id, kyu_lookup_id)
  on delete restrict;

-- Ровно один корень на ученика + ступень: случайный дубль факта невозможен.
create unique index student_kyu_history_one_root_uidx
  on public.student_kyu_history (student_id, kyu_lookup_id)
  where entry_kind = 'recorded';

create index student_kyu_history_student_grade_idx
  on public.student_kyu_history (student_id, kyu_lookup_id, created_at);
create index student_kyu_history_kyu_lookup_idx
  on public.student_kyu_history (kyu_lookup_id);
create index student_kyu_history_author_idx
  on public.student_kyu_history (recorded_by_trainer_account_id);

alter table public.student_kyu_history owner to postgres;

comment on table public.student_kyu_history is
  'Неизменяемая история ступеней Judo (Kyu и Dan из kyu_lookup) ученика. Одна линейная цепочка на (student_id, kyu_lookup_id): recorded -> corrected/retracted через supersedes_id. Действующий факт — терминальная строка, если она не retracted. Неизвестная дата = нет строки. UPDATE/DELETE/TRUNCATE запрещены. Доступ только через будущие SECURITY DEFINER RPC. Migration B1 (20261004100080).';
comment on column public.student_kyu_history.kyu_lookup_id is
  'Каноническая ступень Judo (Kyu или Dan) — public.kyu_lookup(id).';
comment on column public.student_kyu_history.kyu_grad_snapshot is
  'kyu_lookup.kyu_grad на момент записи (точное совпадение проверяет триггер).';
comment on column public.student_kyu_history.obtained_on is
  'Реальная дата получения ступени (DATE, местный день клуба). NULL только для retracted. Никогда не придумывается.';
comment on column public.student_kyu_history.supersedes_id is
  'Терминальная строка той же цепочки, которую заменяет corrected/retracted. UNIQUE: строка заменяется не более одного раза.';
comment on column public.student_kyu_history.recorded_by_portal_role is
  'Снимок trainer_accounts.portal_role автора на момент записи (аудит).';

-- ── 2. Проверка вставки ──────────────────────────────────────────────────
-- SECURITY DEFINER: читает public.students (legacy), public.kyu_lookup,
-- public.trainer_accounts (закрыта от клиентов) и private.club_today —
-- проверка не должна зависеть от прав вызывающего. RETURNS TRIGGER — прямой
-- вызов невозможен; REVOKE всё равно явный (default privileges).
create function private.enforce_student_kyu_history_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_club text;
  v_student_sport text;
  v_grade text;
  v_author_club text;
  v_author_active boolean;
  v_author_role text;
  v_target_kind text;
begin
  -- Время аудита задаёт сервер.
  new.created_at := pg_catalog.now();

  -- Ученик: существует, тот же клуб, Judo.
  select s.club_id, s.sport_id
    into v_student_club, v_student_sport
  from public.students s
  where s.id = new.student_id;
  if not found then
    raise exception 'student_kyu_history_unknown_student'
      using detail = format('student_id %s does not exist', new.student_id);
  end if;
  if v_student_club is distinct from new.club_id then
    raise exception 'student_kyu_history_club_mismatch'
      using detail = format('club_id %L does not match students.club_id of student %s', new.club_id, new.student_id);
  end if;
  if v_student_sport is distinct from 'judo' then
    raise exception 'student_kyu_history_not_judo'
      using detail = format('student %s sport_id is not judo', new.student_id);
  end if;

  -- Ступень: существует, непустая, снимок совпадает точно (Kyu и Dan допустимы).
  select kl.kyu_grad
    into v_grade
  from public.kyu_lookup kl
  where kl.id = new.kyu_lookup_id;
  if not found then
    raise exception 'student_kyu_history_unknown_grade'
      using detail = format('kyu_lookup_id %s does not exist', new.kyu_lookup_id);
  end if;
  if v_grade is null or btrim(v_grade) = '' then
    raise exception 'student_kyu_history_invalid_grade'
      using detail = format('kyu_lookup_id %s has an empty kyu_grad', new.kyu_lookup_id);
  end if;
  if new.kyu_grad_snapshot is distinct from v_grade then
    raise exception 'student_kyu_history_snapshot_mismatch'
      using detail = format('kyu_grad_snapshot must equal kyu_lookup.kyu_grad for id %s', new.kyu_lookup_id);
  end if;

  -- Дата: не в будущем относительно местного дня клуба (нет пояса -> отказ).
  if new.obtained_on is not null and new.obtained_on > private.club_today(new.club_id) then
    raise exception 'student_kyu_history_future_date'
      using detail = format('obtained_on %s is after the club local date', new.obtained_on);
  end if;

  -- Автор: активный аккаунт того же клуба, снимок роли = текущая portal_role.
  select ta.club_id, ta.is_active, ta.portal_role
    into v_author_club, v_author_active, v_author_role
  from public.trainer_accounts ta
  where ta.id = new.recorded_by_trainer_account_id;
  if not found or v_author_active is not true then
    raise exception 'student_kyu_history_invalid_author'
      using detail = 'recorded_by_trainer_account_id must be an existing active trainer account';
  end if;
  if v_author_club is distinct from new.club_id then
    raise exception 'student_kyu_history_author_club_mismatch'
      using detail = 'author trainer account belongs to another club';
  end if;
  if v_author_role is distinct from new.recorded_by_portal_role then
    raise exception 'student_kyu_history_author_role_mismatch'
      using detail = 'recorded_by_portal_role must equal the current trainer_accounts.portal_role';
  end if;
  if new.entry_kind <> 'recorded' and v_author_role <> 'admin' then
    raise exception 'student_kyu_history_admin_required'
      using detail = 'corrections and retractions require portal_role admin';
  end if;

  if new.entry_kind = 'recorded' then
    -- Понятная ошибка; при гонке защищает student_kyu_history_one_root_uidx.
    if exists (
      select 1 from public.student_kyu_history h
      where h.student_id = new.student_id
        and h.kyu_lookup_id = new.kyu_lookup_id
        and h.entry_kind = 'recorded'
    ) then
      raise exception 'student_kyu_history_duplicate_root'
        using detail = format('student %s already has a history chain for kyu_lookup_id %s', new.student_id, new.kyu_lookup_id);
    end if;
  else
    -- Заменяемая строка должна УЖЕ существовать в той же цепочке (это же
    -- исключает циклы внутри одного многострочного INSERT).
    select h.entry_kind
      into v_target_kind
    from public.student_kyu_history h
    where h.id = new.supersedes_id
      and h.student_id = new.student_id
      and h.club_id = new.club_id
      and h.kyu_lookup_id = new.kyu_lookup_id;
    if not found then
      raise exception 'student_kyu_history_invalid_supersedes'
        using detail = 'supersedes_id must reference an existing row of the same student, club and grade';
    end if;
    -- Понятная ошибка; при гонке защищает student_kyu_history_supersedes_once.
    if exists (
      select 1 from public.student_kyu_history h
      where h.supersedes_id = new.supersedes_id
    ) then
      raise exception 'student_kyu_history_not_terminal'
        using detail = 'supersedes_id must reference the current terminal row of the chain';
    end if;
    if new.entry_kind = 'retracted' and v_target_kind = 'retracted' then
      raise exception 'student_kyu_history_already_retracted'
        using detail = 'the terminal row is already retracted';
    end if;
  end if;

  return new;
end;
$$;

alter function private.enforce_student_kyu_history_insert() owner to postgres;

comment on function private.enforce_student_kyu_history_insert() is
  'BEFORE INSERT student_kyu_history: ученик существует, club_id совпадает, sport_id = judo; ступень kyu_lookup существует и непуста (Kyu и Dan), снимок совпадает; obtained_on <= private.club_today; автор — активный trainer_accounts того же клуба, снимок роли = текущая portal_role, corrected/retracted — только admin; один корень; supersedes — существующая терминальная строка той же цепочки. SECURITY DEFINER, search_path=''''. Migration B1.';

revoke all on function private.enforce_student_kyu_history_insert() from public, anon, authenticated;
revoke all on function private.enforce_student_kyu_history_insert() from service_role;

-- ── 3. Неизменяемость ────────────────────────────────────────────────────
-- Не SECURITY DEFINER: ничего не читает, только отклоняет операцию.
create function private.enforce_student_kyu_history_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'student_kyu_history_immutable'
    using detail = format('%s is not allowed: history rows are immutable; corrections and retractions are new rows', tg_op);
end;
$$;

alter function private.enforce_student_kyu_history_immutable() owner to postgres;

comment on function private.enforce_student_kyu_history_immutable() is
  'Отклоняет UPDATE/DELETE (row) и TRUNCATE (statement) на student_kyu_history для всех ролей. Migration B1.';

revoke all on function private.enforce_student_kyu_history_immutable() from public, anon, authenticated;
revoke all on function private.enforce_student_kyu_history_immutable() from service_role;

create trigger trg_student_kyu_history_validate
  before insert on public.student_kyu_history
  for each row execute function private.enforce_student_kyu_history_insert();

create trigger trg_student_kyu_history_immutable
  before update or delete on public.student_kyu_history
  for each row execute function private.enforce_student_kyu_history_immutable();

create trigger trg_student_kyu_history_no_truncate
  before truncate on public.student_kyu_history
  for each statement execute function private.enforce_student_kyu_history_immutable();

-- ── 4. RLS / права ───────────────────────────────────────────────────────
-- Production default privileges широкие — явный REVOKE у всех API-ролей.
-- service_role — только SELECT (как 076/079). Запись — только будущие
-- definer-RPC (owner postgres). Sequence нет (PK uuid).
alter table public.student_kyu_history enable row level security;

revoke all on table public.student_kyu_history from public, anon, authenticated;
revoke all on table public.student_kyu_history from service_role;
grant select on table public.student_kyu_history to service_role;

-- ── 5. Самопроверка (только инварианты B1) ───────────────────────────────
-- Только структурные проверки каталога. Поведение (UPDATE/DELETE/TRUNCATE
-- отклоняются, логика вставки) проверяется отдельным rollback-only E2E после
-- применения. Любое расхождение — exception -> COMMIT ниже выполняется как
-- ROLLBACK.
do $$
declare
  v_tbl regclass := to_regclass('public.student_kyu_history');
  v_fn regprocedure;
  v_sig text;
  v_spec text;
  v_role text;
  v_priv text;
  v_count integer;
begin
  if v_tbl is null then
    raise exception 'B1 check: public.student_kyu_history missing';
  end if;
  if pg_get_userbyid((select c.relowner from pg_class c where c.oid = v_tbl)) <> 'postgres' then
    raise exception 'B1 check: table owner is not postgres';
  end if;

  -- Колонки: ровно 13, имена/типы/NOT NULL
  select count(*) into v_count
  from pg_attribute a
  where a.attrelid = v_tbl and a.attnum > 0 and not a.attisdropped;
  if v_count <> 13 then
    raise exception 'B1 check: expected 13 columns, found %', v_count;
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
        ('entry_kind', 'text', true),
        ('obtained_on', 'date', false),
        ('supersedes_id', 'uuid', false),
        ('source', 'text', true),
        ('reason', 'text', false),
        ('recorded_by_trainer_account_id', 'uuid', true),
        ('recorded_by_portal_role', 'text', true),
        ('created_at', 'timestamp with time zone', true)
      )
  ) <> 13 then
    raise exception 'B1 check: column names/types/nullability mismatch';
  end if;

  -- PK и UNIQUE-ограничения: имя|тип|колонки
  foreach v_spec in array array[
    'student_kyu_history_pkey|p|id',
    'student_kyu_history_chain_key|u|id,student_id,club_id,kyu_lookup_id',
    'student_kyu_history_supersedes_once|u|supersedes_id'
  ] loop
    if not exists (
      select 1 from pg_constraint k
      where k.conrelid = v_tbl
        and k.conname = split_part(v_spec, '|', 1)
        and k.contype::text = split_part(v_spec, '|', 2)
        and (select string_agg(a.attname::text, ',' order by u.ord)
             from unnest(k.conkey) with ordinality u(attnum, ord)
             join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum)
            = split_part(v_spec, '|', 3)
    ) then
      raise exception 'B1 check: key constraint % missing or wrong', v_spec;
    end if;
  end loop;

  -- FK: имя|таблица-цель|локальные колонки|колонки цели, все ON DELETE RESTRICT
  foreach v_spec in array array[
    'student_kyu_history_student_fk|public.students|student_id|id',
    'student_kyu_history_kyu_lookup_fk|public.kyu_lookup|kyu_lookup_id|id',
    'student_kyu_history_author_fk|public.trainer_accounts|recorded_by_trainer_account_id|id',
    'student_kyu_history_supersedes_fk|public.student_kyu_history|supersedes_id,student_id,club_id,kyu_lookup_id|id,student_id,club_id,kyu_lookup_id'
  ] loop
    if not exists (
      select 1 from pg_constraint k
      where k.conrelid = v_tbl
        and k.contype = 'f'
        and k.conname = split_part(v_spec, '|', 1)
        and k.confrelid = to_regclass(split_part(v_spec, '|', 2))
        and k.confdeltype = 'r'
        and (select string_agg(a.attname::text, ',' order by u.ord)
             from unnest(k.conkey) with ordinality u(attnum, ord)
             join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum)
            = split_part(v_spec, '|', 3)
        and (select string_agg(a.attname::text, ',' order by u.ord)
             from unnest(k.confkey) with ordinality u(attnum, ord)
             join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.attnum)
            = split_part(v_spec, '|', 4)
    ) then
      raise exception 'B1 check: foreign key % missing, wrong or not ON DELETE RESTRICT', split_part(v_spec, '|', 1);
    end if;
  end loop;
  select count(*) into v_count from pg_constraint k where k.conrelid = v_tbl and k.contype = 'f';
  if v_count <> 4 then
    raise exception 'B1 check: expected 4 foreign keys, found %', v_count;
  end if;

  -- CHECK-ограничения
  select count(*) into v_count
  from pg_constraint k
  where k.conrelid = v_tbl and k.contype = 'c'
    and k.conname in (
      'student_kyu_history_entry_kind_check',
      'student_kyu_history_source_check',
      'student_kyu_history_role_check',
      'student_kyu_history_obtained_on_shape',
      'student_kyu_history_supersedes_shape',
      'student_kyu_history_not_self',
      'student_kyu_history_reason_check',
      'student_kyu_history_admin_change_check',
      'student_kyu_history_promotion_is_root',
      'student_kyu_history_snapshot_check',
      'student_kyu_history_club_id_check'
    );
  if v_count <> 11 then
    raise exception 'B1 check: expected 11 CHECK constraints, found %', v_count;
  end if;

  -- Один корень: частичный UNIQUE (student_id, kyu_lookup_id) WHERE recorded
  if not exists (
    select 1 from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    where i.indrelid = v_tbl
      and ic.relname = 'student_kyu_history_one_root_uidx'
      and i.indisunique and i.indisvalid
      and (select string_agg(a.attname::text, ',' order by u.ord)
           from unnest(i.indkey::smallint[]) with ordinality u(attnum, ord)
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum)
          = 'student_id,kyu_lookup_id'
      and pg_get_expr(i.indpred, i.indrelid) = '(entry_kind = ''recorded''::text)'
  ) then
    raise exception 'B1 check: root partial unique index missing or wrong';
  end if;

  -- RLS включён, policies нет
  if not (select c.relrowsecurity from pg_class c where c.oid = v_tbl) then
    raise exception 'B1 check: RLS is not enabled';
  end if;
  select count(*) into v_count from pg_policy p where p.polrelid = v_tbl;
  if v_count <> 0 then
    raise exception 'B1 check: % policies exist', v_count;
  end if;

  -- Клиентские роли без прав; service_role — только SELECT
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, v_tbl, v_priv) then
        raise exception 'B1 check: % has % on public.student_kyu_history', v_role, v_priv;
      end if;
    end loop;
  end loop;
  if exists (
    select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = v_tbl and a.grantee = 0
  ) then
    raise exception 'B1 check: PUBLIC has privileges on public.student_kyu_history';
  end if;
  if not has_table_privilege('service_role', v_tbl, 'SELECT') then
    raise exception 'B1 check: service_role lacks SELECT';
  end if;
  foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('service_role', v_tbl, v_priv) then
      raise exception 'B1 check: service_role unexpectedly has %', v_priv;
    end if;
  end loop;

  -- Триггеры: имя|tgtype|функция, все включены.
  -- tgtype: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32
  --   7  = BEFORE INSERT FOR EACH ROW
  --   27 = BEFORE UPDATE OR DELETE FOR EACH ROW
  --   34 = BEFORE TRUNCATE FOR EACH STATEMENT
  foreach v_spec in array array[
    'trg_student_kyu_history_validate|7|private.enforce_student_kyu_history_insert()',
    'trg_student_kyu_history_immutable|27|private.enforce_student_kyu_history_immutable()',
    'trg_student_kyu_history_no_truncate|34|private.enforce_student_kyu_history_immutable()'
  ] loop
    if not exists (
      select 1 from pg_trigger t
      where t.tgrelid = v_tbl and not t.tgisinternal
        and t.tgname = split_part(v_spec, '|', 1)
        and t.tgenabled::text = 'O'
        and t.tgtype = split_part(v_spec, '|', 2)::smallint
        and t.tgfoid = to_regprocedure(split_part(v_spec, '|', 3))
    ) then
      raise exception 'B1 check: trigger % missing, disabled or wrong', split_part(v_spec, '|', 1);
    end if;
  end loop;
  select count(*) into v_count from pg_trigger t where t.tgrelid = v_tbl and not t.tgisinternal;
  if v_count <> 3 then
    raise exception 'B1 check: expected 3 triggers, found %', v_count;
  end if;

  -- Функции: owner postgres, search_path = '', SECURITY DEFINER только у
  -- проверки вставки, EXECUTE нет ни у PUBLIC/anon/authenticated/service_role
  foreach v_spec in array array[
    'private.enforce_student_kyu_history_insert()|true',
    'private.enforce_student_kyu_history_immutable()|false'
  ] loop
    v_sig := split_part(v_spec, '|', 1);
    v_fn := to_regprocedure(v_sig);
    if v_fn is null then
      raise exception 'B1 check: % not found', v_sig;
    end if;
    if not (select p.prosecdef = split_part(v_spec, '|', 2)::boolean
                   and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
                   and pg_get_userbyid(p.proowner) = 'postgres'
            from pg_proc p where p.oid = v_fn) then
      raise exception 'B1 check: % has wrong SECURITY DEFINER / search_path / owner', v_sig;
    end if;
    if exists (
      select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'B1 check: PUBLIC EXECUTE on %', v_sig;
    end if;
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception 'B1 check: % has EXECUTE on %', v_role, v_sig;
      end if;
    end loop;
  end loop;

end;
$$;

commit;
