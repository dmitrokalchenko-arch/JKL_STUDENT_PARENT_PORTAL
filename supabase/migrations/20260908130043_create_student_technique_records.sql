-- ✅ ПРИМЕНЕНО К PRODUCTION вручную через Dashboard SQL Editor (не этой
-- сессией — предыдущая сессия только готовила и статически проверяла этот
-- файл, применение и последующая ручная privilege-коррекция выполнены
-- владельцем самостоятельно). Этот файл СИНХРОНИЗИРОВАН постфактум с
-- фактическим проверенным production-состоянием (см. privilege-блок ниже)
-- — он больше не «предложение», а точный слепок того, что реально
-- выполнено. Повторно применять этот файл (`db push` и т.п.) не нужно и не
-- следует — объекты уже существуют.
--
-- НАЗНАЧЕНИЕ: минимальная production-safe схема "тренер отметил у ученика
-- технику из judo_techniques" — единственная часть, которой сегодня не
-- хватает для завершения цепочки
--   student -> [эта таблица] -> technique_id -> public.judo_techniques.
--
-- ПОЧЕМУ НЕ student_technique_progress (как в задании предпочтительно
-- названо) И НЕ миграции 20260720120004-007: та таблица физически НЕ
-- существует в production (см. отчёт сессии, AUDIT — PGRST205 "Could not
-- find the table", не RLS-отказ) и её схема требует belt_id NOT NULL
-- (ссылка на club_belts, которой тоже нет в production) — применить её
-- означало бы либо тянуть весь непримененный club_belts/club_technique_
-- progress_settings/club_belt_techniques каркас ради одной этой задачи
-- (прямо запрещено заданием: "не применяй все старые migrations подряд"),
-- либо изобретать несовместимый вариант под тем же именем — что создало бы
-- КОЛЛИЗИЮ ИМЁН: если migration 004 (create table if not exists
-- public.student_technique_progress ...) будет применена позже отдельно,
-- "if not exists" молча пропустит создание таблицы с ЕЁ ожидаемыми
-- колонками (включая NOT NULL belt_id), и последующие миграции 005/006
-- сломаются о несуществующие колонки. Поэтому здесь — ДРУГОЕ имя,
-- student_technique_records, без зависимости от club_belts/бонусной
-- механики. Обе схемы могут в будущем сосуществовать или одна из них может
-- быть выбрана владельцем как основная — не решается этой миграцией.
--
-- ПОЧЕМУ БЕЗ КОЛОНКИ status (расходится с буквальным списком полей из
-- задания, "предпочтительно"): в этом же проекте для СЕМЕЙНОЙ стороны того
-- же концептуального модуля уже принято архитектурное решение (см.
-- docs/database/FAMILY_AUTH_AND_TECHNIQUE_PROGRESS_SCHEMA.md, раздел
-- "Решение по нормализации") — хранить ТОЛЬКО подтверждённые (completed)
-- записи; "required" технику определяет отсутствие строки, а не отдельное
-- значение статуса. Задание прямо просило "сначала сравни с текущей
-- моделью проекта" — здесь выбрана согласованность с уже принятым решением
-- вместо буквального повторения шаблона из задания. Сама СТРОКА в этой
-- таблице и означает "выполнено"; отдельная колонка status с единственным
-- допустимым значением была бы информационным дублированием.
--
-- club_id — денормализован (тот же принцип, что trainer_accounts.club_id/
-- admin_pin_sessions.club_id) для быстрой проверки/индекса без JOIN,
-- целостность обеспечена триггером ниже (belt-and-suspenders, тот же
-- паттерн, что enforce_trainer_accounts_club_match).

create table public.student_technique_records (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  student_id bigint not null references public.students(id) on delete restrict,
  technique_id uuid not null references public.judo_techniques(id) on delete restrict,
  completed_at timestamptz not null default now(),
  completed_by bigint not null references public.trainers(id) on delete restrict,
  trainer_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, technique_id)
);

comment on table public.student_technique_records is
  'Тренер отметил у ученика конкретную технику из public.judo_techniques как выполненную. Хранит ТОЛЬКО ссылку (technique_id) — name/category/main_group/youtube_url/youtube_video_id НИКОГДА не копируются сюда, только JOIN на judo_techniques (см. критическое правило задания, этап 5). Наличие строки = выполнено; отдельного статуса "required" не существует — техника считается требуемой, если её ожидает клубная программа (вне объёма этой миграции) и для неё нет строки здесь. Применена к production.';
comment on column public.student_technique_records.technique_id is
  'FOREIGN KEY на public.judo_techniques(id) — единственный источник name/category/main_group/youtube_url/youtube_video_id. on delete restrict: техника с историей выполнения физически не может быть удалена из каталога, только деактивирована (judo_techniques.active).';
comment on column public.student_technique_records.completed_by is
  'FOREIGN KEY на trainers(id) (bigint, реальный PK — не trainer_accounts.id) — тот же паттерн, что trainer_account_audit_log.performed_by_trainer_row_id. Кто именно отметил технику, для аудита/отображения.';

create index idx_student_technique_records_club_id on public.student_technique_records(club_id);
create index idx_student_technique_records_student_id on public.student_technique_records(student_id);
create index idx_student_technique_records_technique_id on public.student_technique_records(technique_id);

create trigger trg_student_technique_records_set_updated_at
  before update on public.student_technique_records
  for each row execute function public.set_updated_at();

-- club_id строки должен совпадать с club_id ученика (belt-and-suspenders,
-- тот же принцип, что enforce_student_technique_progress_club_match в
-- НЕприменённой миграции 004 — тот же приём, независимо перепроверен здесь,
-- т.к. эта таблица не зависит от той миграции).
create or replace function public.enforce_student_technique_records_club_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_club text;
begin
  select club_id into v_student_club from public.students where id = new.student_id;

  if v_student_club is null or new.club_id <> v_student_club then
    raise exception 'student_technique_records.club_id must match students.club_id for student_id %', new.student_id;
  end if;

  return new;
end;
$$;

create trigger trg_student_technique_records_club_match
  before insert or update on public.student_technique_records
  for each row execute function public.enforce_student_technique_records_club_match();

-- Резолвит trainers.id (bigint) ТЕКУЩЕГО активного тренера из auth.uid() —
-- тот же принцип, что private.current_active_trainer_account_id()
-- (migration 013/014), но следующий шаг цепочки (trainer_accounts.id ->
-- trainers.id), нужный для WITH CHECK ниже (тренер может отметить технику
-- только от своего собственного trainers.id, не выдавая себя за другого).
-- Переиспользует ту же схему private (уже существует в production — см.
-- аудит сессии, H2_PRIVATE_SCHEMA), не создаёт новую.
--
-- RLS-policy ниже вызывает private.current_trainer_row_id() НАПРЯМУЮ (не
-- изнутри уже-SECURITY DEFINER обёртки) — это прямой вызов ролью
-- authenticated, а Postgres требует ОБА права для вызова функции в
-- нестандартной схеме: EXECUTE на саму функцию (выдан ниже) И USAGE на
-- саму схему private. Тот же класс проблемы, что migration 20260720120009
-- отдельно нашла (не предположила) для private.is_current_user_family_guardian
-- — здесь исправлено сразу, до применения, не постфактум отдельной
-- миграцией. Подтверждено фактическим production-состоянием (владелец
-- выполнил именно эту строку вручную вместе с остальным privilege-блоком
-- ниже).
grant usage on schema private to authenticated;

create or replace function private.current_trainer_row_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.trainer_accounts ta
  join public.trainers t on t.id = ta.trainer_row_id
  where ta.auth_user_id = auth.uid()
    and ta.is_active = true
  limit 1;
$$;

comment on function private.current_trainer_row_id() is
  'SECURITY DEFINER: trainers.id (bigint) текущего активного тренера (auth.uid() -> trainer_accounts, is_active=true), или NULL, если сессия не тренерская/неактивна. Используется WITH CHECK на student_technique_records, чтобы тренер не мог указать completed_by чужого trainers.id.';

revoke all on function private.current_trainer_row_id() from public;
revoke all on function private.current_trainer_row_id() from anon;
grant execute on function private.current_trainer_row_id() to authenticated;

-- RLS: SELECT и INSERT только для тренера, реально имеющего доступ к этому
-- ученику (can_trainer_access_student, уже существует в production — см.
-- migration 20260720120017, живой запрос подтвердил "permission denied for
-- function" для anon, т.е. функция существует и защищена).
-- НИКАКОГО using(true)/with check(true) — ровно то, о чём явно
-- предупреждает задание (этап 6). UPDATE/DELETE НЕ добавлены вообще —
-- минимальный необходимый для этой задачи набор операций ("отметить
-- технику"), не "редактировать"/"удалить отметку" — та функциональность,
-- если понадобится, обсуждается отдельно, не задним числом через
-- расширение уже одобренной policy.
--
-- PRIVILEGE-БЛОК СИНХРОНИЗИРОВАН С ФАКТИЧЕСКИ ПРОВЕРЕННЫМ PRODUCTION
-- (не оригинальная версия этого файла — та выдавала один голый
-- `grant select, insert ... to authenticated` и была исправлена вручную
-- владельцем после диагностики). Причина, задокументированная и дважды
-- независимо подтверждённая фактическим прогоном в этом же проекте
-- (migration 20260720120009 "fix_family_module_privileges", migration
-- 20260829120001 "technique_progress_privileges"): НИ ОДНА новая таблица в
-- public-схеме не получает base table privileges для authenticated/anon
-- автоматически — RLS фильтрует строки, но не заменяет само право на
-- операцию; без явного GRANT запрос падает с "permission denied for table"
-- ДО того, как Postgres успевает применить policy. В этом конкретном
-- проекте PUBLIC/DEFAULT PRIVILEGES на новые таблицы оказались ШИРЕ, чем
-- предполагалось — явный `revoke all ... from anon/authenticated/public`
-- ПЕРЕД точечным `grant select, insert ... to authenticated` — единственный
-- надёжный способ гарантировать ИМЕННО этот набор прав, а не полагаться на
-- то, что могло быть выдано неявно при создании таблицы. Итоговое
-- проверенное состояние (information_schema.role_table_grants):
--   authenticated: SELECT=true, INSERT=true, UPDATE=false, DELETE=false
--   anon:          SELECT=false, INSERT=false, UPDATE=false, DELETE=false
revoke all privileges on table public.student_technique_records from anon;
revoke all privileges on table public.student_technique_records from authenticated;
revoke all privileges on table public.student_technique_records from public;

grant select, insert on table public.student_technique_records to authenticated;

alter table public.student_technique_records enable row level security;

create policy student_technique_records_select_own_students
  on public.student_technique_records
  for select
  to authenticated
  using (public.can_trainer_access_student(student_id));

create policy student_technique_records_insert_own_students
  on public.student_technique_records
  for insert
  to authenticated
  with check (
    public.can_trainer_access_student(student_id)
    and completed_by = private.current_trainer_row_id()
  );

comment on policy student_technique_records_select_own_students on public.student_technique_records is
  'Тренер видит записи только тех учеников, к которым у него есть доступ прямо сейчас (fresh-проверка can_trainer_access_student при каждом запросе — тот же принцип "живой проверки", что и у остальных тренерских RPC, деактивация группы/тренера немедленно скрывает данные).';
comment on policy student_technique_records_insert_own_students on public.student_technique_records is
  'Тренер может создать запись только (а) для ученика, к которому у него есть доступ, И (б) с completed_by = его собственный trainers.id — структурно невозможно отметить технику от имени другого тренера или для чужого ученика, даже подделав тело запроса.';

-- Никакой anon-доступ ни к таблице, ни к private.current_trainer_row_id() —
-- анонимный пользователь получает 0 строк точно так же, как и у
-- trainer_accounts/judo_techniques (RLS включён, для anon нет ни одной
-- policy).
