-- Добавляет image_path в центральный справочник техник (judo_techniques),
-- чтобы одна запись была источником name + category + main_group + image +
-- youtube_url/youtube_video_id (см. задание "интеграция изображений техник").
--
-- ПОЧЕМУ text-путь, А НЕ полный URL: image_path хранит путь ВНУТРИ бакета
-- Storage (например 'techniques/IPPON-SEOI-NAGE.png'), без имени бакета и
-- без домена/query-параметров. Signed URL сознательно не хранится — у него
-- есть срок действия, а эта запись должна оставаться валидной без повторной
-- генерации ссылок. Frontend получает публичный URL на клиенте через
-- supabase.storage.from('judo-techniques').getPublicUrl(image_path) (бакет
-- планируется публичным — сами изображения техник не секретны).
--
-- NULLABLE и без default: заполняется отдельным UPDATE ПОСЛЕ того, как все
-- 100 файлов реально загружены в Storage (см.
-- docs/JUDO_TECHNIQUES_IMAGE_PATH_LINK.sql) — эта миграция только готовит
-- колонку, сама не трогает существующие 100 строк (name/category/
-- main_group/youtube_url/youtube_video_id/active остаются как есть).
--
-- Уникальный constraint на image_path сознательно НЕ добавлен на этом шаге:
-- пока колонка пустая у всех 100 строк, "unique" ничего не проверяет; его
-- стоит добавить отдельной миграцией после подтверждения, что все 100 путей
-- заполнены и различны (см. проверочный блок в JUDO_TECHNIQUES_IMAGE_PATH_LINK.sql).

alter table public.judo_techniques
  add column if not exists image_path text;

comment on column public.judo_techniques.image_path is
  'Путь к изображению техники ВНУТРИ Storage bucket judo-techniques (например techniques/IPPON-SEOI-NAGE.png), без имени бакета и без query-параметров. NULL, пока изображение не загружено. Публичный URL строится на клиенте через getPublicUrl(image_path) — bucket публичный, signed URL не используется, чтобы путь не протухал.';
