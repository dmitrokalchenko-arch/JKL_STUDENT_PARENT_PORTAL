-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION.
--
-- КОРРЕКТИРУЮЩАЯ миграция к 20260913120053 (та тоже ещё не применена, но
-- уже закоммичена в git как часть этого PR — по устоявшейся в проекте
-- конвенции уже закоммиченные миграции не редактируются задним числом,
-- поправки идут новым файлом с новой меткой времени, тот же принцип, что
-- 20260806100032_rename_family_nickname.sql поверх 20260806100028 и т.д.).
--
-- ПРОДУКТОВОЕ УТОЧНЕНИЕ: "completed" и "bonus" — одна и та же сущность.
-- student_technique_records означает не "ученик знает технику", а "ученик
-- подтвердил на соревнованиях бонусную технику, тренер отметил видео".
-- Бонусный пул ученика по умолчанию = техники, которые требовались для
-- ПРЕДЫДУЩЕГО (уже полученного) Kyu — те же club_required_techniques,
-- просто belt_key указывает не на "текущую цель", а на "уже сданный
-- экзамен". Второй таблицы для бонуса не создаётся — это одна и та же
-- club_required_techniques, разница только в том, какой belt_key
-- запрашивается (см. get-student-preview).
--
-- ⚠️ BLOCKING ARCHITECTURE ISSUE (зафиксировано, не решается в этой
-- миграции): в production нет стабильного machine-readable Kyu-идентификатора
-- ученика. students.kyu_grad — свободный текст (см. EXISTING_DATABASE_AUDIT.md,
-- раздел 5.1), нет истории смены поясов, нет записи "когда именно ученик
-- получил текущий Kyu". get-student-preview использует best-effort
-- сопоставление belt_key = trim(lower(students.kyu_grad)) — ТОТ ЖЕ приём
-- (case-insensitive сравнение текста), что уже был документирован и принят
-- как best-effort в НИКОГДА не применённой resolve_student_current_belt()
-- (миграция 20260720120006) — известное ограничение, не новый риск. Полное
-- решение (нормализованная история Kyu с датой получения) — отдельный
-- будущий этап, не блокирует этот foundation-шаг.

-- Club-scoped переключатель всей бонусной системы — если false, блок
-- бонусных техник не показывается НИКОМУ (Family/Trainer/Super Admin) и не
-- рассчитывается вообще, см. get-student-preview. Default false — ни один
-- клуб не получает бонусный блок автоматически.
alter table public.club_technique_program_settings
  add column if not exists bonus_program_enabled boolean not null default false;

comment on column public.club_technique_program_settings.bonus_program_enabled is
  'Club-scoped переключатель бонусной системы (НЕ student-level, НЕ global). false = блок "Бонусные техники" не рендерится вообще ни для одной роли — не "0/0", не "не настроено", полностью отсутствует. Default false.';

comment on column public.club_technique_program_settings.bonus_requirement is
  'Сколько техник ИЗ БОНУСНОГО ПУЛА (club_required_techniques для belt_key ПРЕДЫДУЩЕГО полученного Kyu ученика) нужно подтвердить для получения бонуса. NULL = бонус-программа включена, но требование ещё не задано клубом — честно показывается как "не настроено", не придумывается число.';

comment on column public.club_required_techniques.belt_key is
  'Свободный club-scoped идентификатор Kyu/программы (см. основной комментарий в 20260913120053). Одна и та же таблица обслуживает ДВЕ роли в зависимости от того, какой belt_key запрашивается: "required" (программа ТЕКУЩЕЙ цели ученика — ещё не читается ни одним read-путём, будущий этап) и "bonus" (программа УЖЕ ПОЛУЧЕННОГО Kyu — читается get-student-preview через best-effort сопоставление с students.kyu_grad, см. blocking issue выше).';

-- Точечные (per-student) корректировки бонусного пула — ТОЛЬКО добавление/
-- исключение конкретной техники для КОНКРЕТНОГО ученика, без копирования
-- всего каталога в student-строки. 'include' — техника входит в бонусный
-- пул этого ученика, даже если её нет в club_required_techniques для его
-- belt_key. 'exclude' — техника исключается из пула этого ученика, даже
-- если она есть в club-программе. club program остаётся default,
-- переопределяется точечно.
create table if not exists public.student_bonus_technique_overrides (
  id uuid primary key default gen_random_uuid(),
  club_id text not null,
  student_id bigint not null references public.students(id) on delete restrict,
  technique_id uuid not null references public.judo_techniques(id) on delete restrict,
  action text not null check (action in ('include', 'exclude')),
  created_by bigint references public.trainers(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (student_id, technique_id)
);

comment on table public.student_bonus_technique_overrides is
  'Точечные per-student корректировки бонусного пула поверх club_required_techniques — тренер сможет добавить (''include'') или убрать (''exclude'') конкретную технику конкретному ученику (Trainer UI для этого — отдельный будущий этап, здесь только схема). НЕ дублирует каталог — ссылается на technique_id, как и club_required_techniques/student_technique_records.';
comment on column public.student_bonus_technique_overrides.created_by is
  'trainers.id (bigint) тренера, сделавшего корректировку — тот же паттерн, что student_technique_records.completed_by. NULL при удалении тренера (on delete set null) — история корректировки не пропадает.';

create index if not exists idx_student_bonus_overrides_club_id
  on public.student_bonus_technique_overrides(club_id);
create index if not exists idx_student_bonus_overrides_student_id
  on public.student_bonus_technique_overrides(student_id);

-- club_id строки должен совпадать с club_id ученика — тот же приём, что
-- enforce_student_technique_records_club_match (миграция 20260908130043).
create or replace function public.enforce_student_bonus_overrides_club_match()
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
    raise exception 'student_bonus_technique_overrides.club_id must match students.club_id for student_id %', new.student_id;
  end if;

  return new;
end;
$$;

create trigger trg_student_bonus_overrides_club_match
  before insert or update on public.student_bonus_technique_overrides
  for each row execute function public.enforce_student_bonus_overrides_club_match();

-- RLS: включён, НИ ОДНОЙ policy для anon/authenticated — Trainer-редактирование
-- (создание override-строк) не реализуется в этом шаге (см. задание,
-- "не строй editor сейчас"); когда появится, это будет отдельная миграция с
-- policy вида "can_trainer_access_student(student_id) AND created_by =
-- private.current_trainer_row_id()", тот же принцип, что уже применён в
-- student_technique_records.
alter table public.student_bonus_technique_overrides enable row level security;

revoke all privileges on table public.student_bonus_technique_overrides from anon;
revoke all privileges on table public.student_bonus_technique_overrides from authenticated;
revoke all privileges on table public.student_bonus_technique_overrides from public;

grant select on table public.student_bonus_technique_overrides to service_role;
