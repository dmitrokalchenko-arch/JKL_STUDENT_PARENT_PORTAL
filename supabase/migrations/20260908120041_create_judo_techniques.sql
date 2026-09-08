-- Центральный справочник техник дзюдо (judo_techniques) — единый источник
-- истины для названия/категории/видео техники, общий для ВСЕХ клубов.
--
-- ПОЧЕМУ НОВАЯ ТАБЛИЦА, А НЕ РАСШИРЕНИЕ club_techniques: проведён аудит
-- существующей схемы модуля «Прогресс техник» (миграции 20260720120004-007,
-- задокументированы в docs/database/FAMILY_AUTH_AND_TECHNIQUE_PROGRESS_SCHEMA.md)
-- ПЕРЕД созданием этой миграции. Два факта решили вопрос:
--   1) club_techniques устроена club-scoped (club_id text not null) — то
--      есть предполагает СВОЙ набор строк на каждый клуб. Задание требует
--      прямо противоположного: "для каждой техники должна существовать
--      только ОДНА центральная запись" — общий каталог из 100 официальных
--      техник IJF, переиспользуемый всеми клубами, а не дублируемый на
--      каждый клуб.
--   2) club_techniques.category ограничена ДВУМЯ значениями через CHECK
--      ('tachi-waza','ne-waza') — не совпадает с требуемой 8-категорийной
--      IJF-классификацией (Te-waza/Koshi-waza/.../Kansetsu-waza) и не имеет
--      колонки youtube_url вообще.
-- Проверено ЖИВЫМ запросом к production (не предположение): club_techniques,
-- club_belts, student_technique_progress физически НЕ СУЩЕСТВУЮТ в
-- production (PostgREST вернул "Could not find the table ... in the schema
-- cache" — 42P01/PGRST205, не RLS-отказ). Миграции 20260720120004-007 были
-- только написаны, но НИКОГДА не применялись ни к одной базе, включая
-- локальную (задокументировано в SCHEMA.md, раздел 5 "Известные
-- ограничения"). Значит, расширять здесь физически нечего — не только
-- архитектурно неверно, но и нет живой таблицы для ALTER.
-- Поэтому: создаётся отдельный, club-independent справочник judo_techniques,
-- по прямому указанию задания на этот случай. Ничего из уже задеплоенного
-- (families/family_guardians/family_students/trainer_accounts/
-- admin_pin_sessions/super_admin_accounts — все подтверждены живыми
-- запросами как существующие в production) этой миграцией не затрагивается.
--
-- Если/когда модуль «Прогресс техник» (миграции 004-007) будет реально
-- применяться к production, его student_technique_progress.technique_id и
-- club_belt_techniques.technique_id стоит указывать на judo_techniques(id)
-- напрямую, а не заново изобретать club-scoped каталог названий/видео —
-- см. итоговый отчёт сессии, раздел DATABASE RELATION.

create table public.judo_techniques (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in (
    'Te-waza', 'Koshi-waza', 'Ashi-waza', 'Ma-sutemi-waza', 'Yoko-sutemi-waza',
    'Osaekomi-waza', 'Shime-waza', 'Kansetsu-waza'
  )),
  -- main_group — чистая функция от category (CASE по фиксированному
  -- списку литералов), поэтому безопасно как GENERATED STORED: не зависит
  -- ни от каких внешних данных, детерминирована, immutable по построению.
  main_group text generated always as (
    case category
      when 'Te-waza'           then 'Nage-waza'
      when 'Koshi-waza'        then 'Nage-waza'
      when 'Ashi-waza'         then 'Nage-waza'
      when 'Ma-sutemi-waza'    then 'Nage-waza'
      when 'Yoko-sutemi-waza'  then 'Nage-waza'
      when 'Osaekomi-waza'     then 'Katame-waza'
      when 'Shime-waza'        then 'Katame-waza'
      when 'Kansetsu-waza'     then 'Katame-waza'
    end
  ) stored,
  youtube_url text not null,
  -- youtube_video_id: НЕ generated column (regex-функции извлечения id
  -- рискуют не пройти проверку IMMUTABLE для generated-выражения на разных
  -- версиях Postgres) — вместо этого заполняется BEFORE INSERT/UPDATE
  -- триггером ниже. Результат тот же (всегда синхронизирован с
  -- youtube_url, нельзя забыть обновить вручную), но без риска для DDL.
  -- Вычисление на клиенте сознательно отвергнуто: тогда КАЖДЫЙ клиент
  -- (Trainer Area, Family Portal, будущая админка) должен был бы
  -- реализовать тот же парсинг заново и держать его в синхроне — сервер
  -- гарантирует единственный источник истины для всех потребителей сразу.
  youtube_video_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

comment on table public.judo_techniques is
  'Центральный, НЕ club-scoped справочник официальных техник дзюдо (IJF-классификация). Единственный источник истины для name/category/youtube_url — Trainer Area и Family/Student Portal ссылаются на technique_id, не копируют эти поля. Запись/изменение — только через service_role (см. RLS-миграцию), до появления административного интерфейса (этап 4 роадмапа модуля «Прогресс техник», см. SCHEMA.md).';
comment on column public.judo_techniques.category is
  'Официальная IJF-категория техники (8 значений). Определяет main_group автоматически.';
comment on column public.judo_techniques.main_group is
  'GENERATED STORED из category: Te/Koshi/Ashi/Ma-sutemi/Yoko-sutemi-waza -> Nage-waza; Osaekomi/Shime/Kansetsu-waza -> Katame-waza.';
comment on column public.judo_techniques.youtube_url is
  'Ссылка на видео на YouTube-канале IJF Academy/UCJI. Видео физически хранится только на YouTube, Supabase хранит лишь ссылку.';
comment on column public.judo_techniques.youtube_video_id is
  'Извлекается автоматически из youtube_url (см. триггер ниже) для использования как youtube.com/embed/{id}. Не редактируется напрямую.';
comment on column public.judo_techniques.active is
  'Мягкое удаление/скрытие техники из каталога без потери истории (student_technique_progress/club_belt_techniques ссылаются on delete restrict — техника с историей физически не может быть удалена, только деактивирована).';

create index idx_judo_techniques_category on public.judo_techniques(category);
create index idx_judo_techniques_active on public.judo_techniques(active);

create trigger trg_judo_techniques_set_updated_at
  before update on public.judo_techniques
  for each row execute function public.set_updated_at();

-- Извлечение 11-символьного YouTube video id из типовых форматов ссылки:
-- youtu.be/ID, youtube.com/watch?v=ID(&...), youtube.com/embed/ID,
-- youtube.com/shorts/ID. substring(text from POSIX-pattern) — встроенная
-- immutable-функция Postgres, здесь просто обёрнута для переиспользования.
create or replace function public.extract_youtube_video_id(p_url text)
returns text
language sql
immutable
as $$
  select substring(p_url from '(?:youtu\.be/|[?&]v=|/embed/|/shorts/)([A-Za-z0-9_-]{11})');
$$;

comment on function public.extract_youtube_video_id(text) is
  'Извлекает 11-символьный YouTube video id из youtu.be/watch?v=/embed/shorts ссылок. Возвращает NULL, если формат не распознан (не бросает исключение — не блокирует INSERT/UPDATE техники с нестандартной ссылкой, см. вызывающий триггер).';

revoke all on function public.extract_youtube_video_id(text) from public;
grant execute on function public.extract_youtube_video_id(text) to service_role;

create or replace function public.set_judo_technique_youtube_video_id()
returns trigger
language plpgsql
as $$
begin
  new.youtube_video_id := public.extract_youtube_video_id(new.youtube_url);
  return new;
end;
$$;

create trigger trg_judo_techniques_youtube_video_id
  before insert or update of youtube_url on public.judo_techniques
  for each row execute function public.set_judo_technique_youtube_video_id();

-- RLS: чтение — авторизованным пользователям портала (тренеры через
-- trainer_accounts, семьи через family_guardians — обе группы уже проходят
-- через Supabase Auth и попадают в роль authenticated). Запись/добавление/
-- удаление — НЕ разрешены ни anon, ни authenticated ни одной policy: тот же
-- принцип, что уже применён в проекте для trainer_accounts/families/
-- admin_pin_sessions/super_admin_accounts ("RLS включён, policy нет вообще,
-- единственный путь записи — service_role"), а не `using (true)` для
-- anon/authenticated, которого явно просило избежать задание. Обычный
-- Trainer не может менять центральные YouTube-ссылки; Family/Student
-- получает только read-доступ.
alter table public.judo_techniques enable row level security;

create policy judo_techniques_select_authenticated
  on public.judo_techniques
  for select
  to authenticated
  using (true);

comment on policy judo_techniques_select_authenticated on public.judo_techniques is
  'Любой authenticated пользователь (тренер через trainer_accounts ИЛИ семья через family_guardians) может читать каталог целиком — это общая справочная информация без клубной/персональной чувствительности (аналогично публичному списку техник IJF), не требует различать роль/клуб. Запись техник не входит ни в одну policy — только service_role (Dashboard SQL Editor или будущая административная Edge Function, этап 4).';
