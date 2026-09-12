-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION (тот же статус, что и
-- 20260911090050_create_student_technique_videos_bucket.sql на момент
-- написания этого файла — проверить перед применением).
--
-- STAGE 1 (server-side iPhone video processing fallback, см. отчёты
-- сессии) — private bucket для ВРЕМЕННОГО хранения оригинала видео,
-- который тренер загружает СО СВОЕГО iPhone ПЕРЕД тем, как отдельный
-- video-worker (см. video-worker/) его обработает (trim + 1.0x/0.5x +
-- H.264/MP4 + resize) и запишет результат в уже существующий
-- student-technique-videos. Объект в этом bucket'е живёт СТРОГО от upload
-- до успешной/неуспешной обработки — worker удаляет его сам (см.
-- server.js: успех -> cleanup сразу; ошибка -> best-effort cleanup в
-- catch), это НЕ архивное хранилище.
--
-- Структура пути — НАМЕРЕННО проще, чем в student-technique-videos
-- (там <studentId>/<ФАМИЛИЯ>-<ТЕХНИКА>-<id>.<ext>, здесь это не нужно —
-- объект недолговечен, человекочитаемость в списке bucket'а не имеет
-- значения):
--   <student_id>/<uuid>.<ext>
-- studentId ПЕРВЫМ сегментом — та же причина, что и в финальном bucket'е:
-- RLS-предикат читает его прямо из пути, без отдельной таблицы
-- соответствий (см. private.storage_object_student_id ниже — уже создана
-- миграцией 20260911090050, здесь ПЕРЕИСПОЛЬЗУЕТСЯ, не дублируется).
--
-- Модель доступа (задание STAGE 1, раздел 5): ТОЛЬКО тренер —
-- INSERT (сам upload оригинала со своего устройства), SELECT (worker
-- скачивает объект authenticated-клиентом С JWT ЭТОГО ЖЕ тренера — см.
-- video-worker/supabaseClient.js, никакого service_role), DELETE (worker
-- удаляет после обработки). Anon и Family — 0 policy, значит 0 доступа
-- (RLS уже включён платформой на storage.objects, здесь только
-- добавляются policy поверх). Никакого UPDATE — нет ни одного сценария,
-- где нужно перезаписывать существующий temp-объект.
insert into storage.buckets (id, name, public)
values ('student-technique-video-temp', 'student-technique-video-temp', false)
on conflict (id) do nothing;

drop policy if exists student_technique_video_temp_insert_trainer on storage.objects;
create policy student_technique_video_temp_insert_trainer
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'student-technique-video-temp'
    and public.can_trainer_access_student(private.storage_object_student_id(name))
  );

drop policy if exists student_technique_video_temp_select_trainer on storage.objects;
create policy student_technique_video_temp_select_trainer
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'student-technique-video-temp'
    and public.can_trainer_access_student(private.storage_object_student_id(name))
  );

drop policy if exists student_technique_video_temp_delete_trainer on storage.objects;
create policy student_technique_video_temp_delete_trainer
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'student-technique-video-temp'
    and public.can_trainer_access_student(private.storage_object_student_id(name))
  );

comment on policy student_technique_video_temp_select_trainer on storage.objects is
  'video-worker скачивает временный оригинал ТОЛЬКО authenticated-клиентом с JWT тренера (никакого service_role, см. video-worker/supabaseClient.js) — тот же can_trainer_access_student, что и на всех остальных student-scoped bucket''ах этого проекта. Family/Student Portal сюда доступа не имеет вообще (никакой SELECT-policy для family) — это временное, не-архивное хранилище, не предмет для family-просмотра.';

comment on policy student_technique_video_temp_delete_trainer on storage.objects is
  'DELETE используется video-worker''ом для cleanup ПОСЛЕ обработки (успешной или нет) — см. server.js. Тот же trainer-access предикат, что и INSERT/SELECT на этом bucket''е.';

-- ── ОПЦИОНАЛЬНО (тот же паттерн, что в 20260911090050) — defense-in-depth
-- по размеру/MIME на уровне самого bucket'а, если Dashboard/версия
-- Supabase это поддерживает:
--
-- update storage.buckets
-- set file_size_limit = 262144000,  -- 250 MiB — исходники с iPhone крупнее, чем уже сжатые клипы
--     allowed_mime_types = array['video/mp4', 'video/quicktime']
-- where id = 'student-technique-video-temp';
