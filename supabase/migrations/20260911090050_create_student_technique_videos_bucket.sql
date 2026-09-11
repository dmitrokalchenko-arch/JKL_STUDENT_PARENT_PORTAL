-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION.
-- (Версия после architecture/security review — см. отчёт сессии: изменены
-- структура пути объекта, набор policy и READ-доступ по сравнению с
-- первой версией этого файла.)
--
-- Private Storage bucket для персональных видео ВЫПОЛНЕНИЯ техник
-- учениками — принципиально ОТДЕЛЬНЫЙ от judo-techniques (публичный,
-- эталонные изображения техник, ничьи персональные данные). Здесь —
-- видео конкретного ребёнка, поэтому bucket ОБЯЗАТЕЛЬНО private (задание,
-- этап 5) — то же архитектурное решение, что уже принято в этом проекте
-- для technique-images/technique-videos club-scoped модуля (см.
-- 20260720120007_technique_progress_storage.sql).
--
-- Структура объектов (без имени бакета как префикса):
--   <student_id>/<НОРМАЛИЗОВАННАЯ_ФАМИЛИЯ>-<НОРМАЛИЗОВАННАЯ_ТЕХНИКА>-<unique-id>.<ext>
--   например: 84/MUSTERMANN-KATA-GURUMA-a8f31c2d.mp4
-- studentId — ОБЯЗАТЕЛЬНО первый сегмент пути (собственный namespace) —
-- без этого два разных ученика с одинаковой фамилией создали бы
-- одинаковый путь и либо конфликтовали бы, либо один тихо перезаписал бы
-- видео другого (задание, этап 6). unique-id (8 hex-символов,
-- crypto.randomUUID() на клиенте, см. src/utils/studentVideoFilename.js)
-- ПОСЛЕ review добавлен в КАЖДЫЙ путь — раньше путь был детерминированным
-- (без unique-id) и upload шёл с upsert:true, чтобы повторная отметка той
-- же техники не считалась конфликтом. Признано риском: тихая перезапись
-- существующего видео была возможна не только в ожидаемом сценарии
-- "cleanup после отмены не успел", а при ЛЮБОМ совпадении пути. Теперь
-- каждый upload физически получает свой объект — upsert больше не нужен
-- (upload идёт с upsert:false/по умолчанию, см. studentVideoService.js) и
-- UPDATE-policy на storage.objects для этого bucket'а НЕ создаётся вообще
-- (не было ни одной причины для UPDATE, кроме поддержки upsert).
--
-- ПОЧЕМУ RLS-предикат читает student_id ИЗ САМОГО ПУТИ, а не из отдельной
-- таблицы соответствий: не нужна лишняя сущность — то же решение, что уже
-- принято в technique-images ((storage.foldername(name))[1] = club_id) и
-- technique-videos ((storage.foldername(name))[2] = student_id).
--
-- EDGE CASE, который иначе привёл бы к RAISE EXCEPTION внутри RLS (а не к
-- тихому "доступа нет"): (storage.foldername(name))[1]::bigint упал бы с
-- ошибкой приведения типа на ЛЮБОМ пути, где первый сегмент — не число
-- (мусорный/чужой объект, ошибка клиента и т.п.) — весь запрос к
-- storage.objects (не только к этому объекту) получил бы 500 вместо
-- ожидаемого "просто не вижу эту строку". private.storage_object_student_id()
-- ниже разбирает путь безопасно (regex-проверка ПЕРЕД cast, NULL при
-- несовпадении) — и public.can_trainer_access_student(NULL)/
-- public.can_family_access_student(NULL) уже сегодня корректно возвращают
-- false (не исключение).
create or replace function private.storage_object_student_id(p_name text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9]+$'
    then split_part(p_name, '/', 1)::bigint
    else null
  end;
$$;

comment on function private.storage_object_student_id(text) is
  'Безопасно извлекает bigint student_id из ПЕРВОГО сегмента Storage-пути вида "<student_id>/<файл>" (regex-проверка перед cast, NULL при несовпадении — НЕ бросает исключение на произвольном/мусорном пути, в отличие от прямого ::bigint). Используется ТОЛЬКО в RLS-policy ниже — can_trainer_access_student(NULL)/can_family_access_student(NULL) уже безопасно возвращают false.';

-- ИСПРАВЛЕНО (найдено при ручной проверке production после применения):
-- CREATE FUNCTION по умолчанию даёт EXECUTE роли PUBLIC (следовательно и
-- anon, т.к. anon наследует PUBLIC) — без явного revoke helper был бы
-- вызываем анонимно, хотя сам по себе не раскрывает ничего чувствительного
-- (просто парсит текст), это лишний, ничем не оправданный публичный
-- surface у функции в схеме private. Тот же порядок revoke -> revoke ->
-- grant, что уже применён в проекте для private.current_trainer_row_id()
-- (migration 043): сначала PUBLIC, потом anon (anon отдельно, потому что
-- REVOKE FROM PUBLIC не гарантированно убирает ранее выданные ИМЕННО
-- роли anon права, если они когда-либо были выданы явно), затем узкий
-- GRANT только authenticated. Подтверждено фактической проверкой в
-- production: authenticated_can_execute = true, anon_can_execute = false.
revoke all on function private.storage_object_student_id(text) from public;
revoke all on function private.storage_object_student_id(text) from anon;
grant execute on function private.storage_object_student_id(text) to authenticated;

insert into storage.buckets (id, name, public)
values ('student-technique-videos', 'student-technique-videos', false)
on conflict (id) do nothing;

-- drop policy if exists перед каждой create policy — CREATE POLICY (в
-- отличие от CREATE OR REPLACE FUNCTION/ADD COLUMN IF NOT EXISTS/ON
-- CONFLICT DO NOTHING выше) не идемпотентен сам по себе: повторный запуск
-- этой миграции без этого упал бы на "policy already exists". Имена ТОЧНО
-- те, что создаются этой миграцией, ни одного широкого/чужого DROP.
--
-- INSERT/DELETE — ТОЛЬКО тренер (задание: "upload/delete остаются только
-- Trainer"). НИКАКОГО using(true).
drop policy if exists student_technique_videos_insert_trainer on storage.objects;
create policy student_technique_videos_insert_trainer
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'student-technique-videos'
    and public.can_trainer_access_student(private.storage_object_student_id(name))
  );

drop policy if exists student_technique_videos_delete_trainer on storage.objects;
create policy student_technique_videos_delete_trainer
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'student-technique-videos'
    and public.can_trainer_access_student(private.storage_object_student_id(name))
  );

-- SELECT — ДВЕ отдельные policy (не одна с OR внутри) — каждая со своей
-- единственной ответственностью, тот же принцип "один concern на policy",
-- что и везде в этом проекте; Postgres сам объединяет несколько permissive
-- policy для одной команды через OR, так что итоговый эффект —
-- "тренер С ДОСТУПОМ К УЧЕНИКУ ИЛИ семья ЭТОГО УЧЕНИКА", не шире.
--
-- Family/Student Portal ЕЩЁ НЕ реализован (задание прямо просит не
-- реализовывать UI сейчас) — но READ-policy добавлена уже теперь,
-- СОЗНАТЕЛЬНО, чтобы не редактировать Storage security задним числом,
-- когда появится viewer на семейной стороне: там понадобится ТОЛЬКО
-- фронтенд (свой signed-URL viewer в Family Portal, симметричный
-- StudentVideoPlayerModal тренера) — ни одной новой migration/policy для
-- этого больше не потребуется. public.can_family_access_student(bigint)
-- (migration 20260720120002, уже в production) — тот же принцип, что
-- can_trainer_access_student: проверяет family_guardians.auth_user_id =
-- auth.uid() JOIN family_students(student_id, status='active') — семья A
-- физически не может пройти эту проверку для ученика семьи B (это её
-- собственный auth.uid(), не подделываемый с клиента).
drop policy if exists student_technique_videos_select_trainer on storage.objects;
create policy student_technique_videos_select_trainer
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'student-technique-videos'
    and public.can_trainer_access_student(private.storage_object_student_id(name))
  );

drop policy if exists student_technique_videos_select_family on storage.objects;
create policy student_technique_videos_select_family
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'student-technique-videos'
    and public.can_family_access_student(private.storage_object_student_id(name))
  );

-- Anon: НИ ОДНОЙ policy для anon -> 0 доступа (RLS включён платформой
-- Supabase на storage.objects уже до этой миграции — здесь только
-- добавляются policies поверх, сама системная таблица не трогается).
-- Family/Student: ТОЛЬКО SELECT (student_technique_videos_select_family
-- выше) — ни одной INSERT/UPDATE/DELETE policy для family нет и не
-- планируется этой миграцией; upload/delete остаются исключительно
-- тренерскими операциями (задание, п.2 review).
comment on policy student_technique_videos_select_trainer on storage.objects is
  'Тренер читает (в т.ч. создаёт signed URL для) объект в student-technique-videos ТОЛЬКО если у него есть доступ ПРЯМО СЕЙЧАС к ученику, чей id — первый сегмент пути объекта (public.can_trainer_access_student). Деактивация тренера/группы немедленно закрывает и это чтение.';

comment on policy student_technique_videos_select_family on storage.objects is
  'Family/Student Portal (пока без UI) читает объект ТОЛЬКО для СВОЕГО ученика — public.can_family_access_student проверяет family_guardians.auth_user_id = auth.uid() (сессия ЭТОЙ семьи) JOIN family_students по status=active. Семья A структурно не может подставить student_id семьи B и получить true. Никакого INSERT/UPDATE/DELETE для family — только эта одна SELECT-policy.';

-- ── ОПЦИОНАЛЬНО, отдельным шагом (может требовать поддержки версии
-- Supabase — та же неопределённость уже зафиксирована в этом проекте для
-- technique-images/technique-videos). Defense-in-depth для файлового
-- типа/размера — frontend-валидация НЕ считается security boundary
-- (задание, этап 9). Если Dashboard -> Storage ->
-- student-technique-videos -> Edit bucket поддерживает эти поля,
-- эквивалентно можно выполнить там же вручную.
--
-- update storage.buckets
-- set file_size_limit = 104857600,  -- 100 MiB, см. обоснование в отчёте
--     allowed_mime_types = array['video/mp4', 'video/webm', 'video/quicktime']
-- where id = 'student-technique-videos';
