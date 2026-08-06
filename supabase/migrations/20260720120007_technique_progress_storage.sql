-- Storage buckets для модуля «Прогресс техник».
--
-- Оба bucket'а приватные (public=false) — доступ только через политики ниже
-- (для изображений) или через createSignedUrl с ограниченным сроком действия
-- (для видео, запрашивается фронтендом только по клику на карточку — см.
-- src/services/techniqueProgressService.js). Загрузка файлов через UI на
-- этом этапе не реализуется (см. задание, п.8 и п.10).
--
-- Пути объектов (ВНУТРИ бакета, БЕЗ имени бакета как префикса — bucket_id
-- уже отдельная колонка storage.objects, и именно так их ожидают
-- storage.foldername(name) и client.storage.from(bucket).createSignedUrl(path)):
--   club_techniques.image_path      = {club_id}/{technique_id}/{filename}
--   student_technique_progress.video_path = {club_id}/{student_id}/{progress_id}/{filename}
--
-- Ограничения по MIME-типу и размеру файла НЕ заданы здесь SQL-ом — версия
-- Supabase (managed/self-hosted) может не поддерживать колонки
-- file_size_limit/allowed_mime_types в storage.buckets на момент применения
-- миграции. Рекомендуемые значения задокументированы в
-- docs/database/FAMILY_AUTH_AND_TECHNIQUE_PROGRESS_SCHEMA.md — их нужно
-- настроить вручную в Supabase Dashboard (Storage -> bucket settings) или
-- отдельной миграцией после подтверждения версии платформы.
--
-- ТИПЫ (аудит этапа 2.2): {club_id} в пути — text slug (clubs.club_id, без
-- каста), {student_id} — bigint (students.id). Более ранняя версия этой
-- миграции ошибочно приводила оба сегмента к ::uuid.

insert into storage.buckets (id, name, public)
values ('technique-images', 'technique-images', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('technique-videos', 'technique-videos', false)
on conflict (id) do nothing;

-- RLS на storage.objects управляется платформой Supabase и уже включён ею
-- (storage.objects — системная таблица, её владелец supabase_storage_admin,
-- не postgres/migration role — see F1: ALTER TABLE storage.objects ENABLE
-- ROW LEVEL SECURITY здесь не выполняется и не требуется). Эта миграция
-- создаёт только необходимые policies поверх уже включённого RLS, саму
-- системную таблицу storage.objects не изменяет.

-- Изображения техник: читает любая семья своего клуба (club_id — первый
-- сегмент пути).
create policy technique_images_select_own_club
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'technique-images'
    and public.is_family_in_club( (storage.foldername(name))[1] )
  );

-- Видео техник: читает только семья, имеющая доступ к конкретному student_id
-- (второй сегмент пути) — та же проверка, что и в RLS student_technique_progress.
create policy technique_videos_select_own_children
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'technique-videos'
    and public.can_family_access_student( ( (storage.foldername(name))[2] )::bigint )
  );

-- Никаких insert/update/delete policies для authenticated на этих двух
-- bucket'ах — загрузка не входит в этот этап, выполняется позже через
-- сервисный/административный процесс (service role), не напрямую с клиента.
