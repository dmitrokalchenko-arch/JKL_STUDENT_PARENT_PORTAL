import { trainerSupabase } from './trainerSupabaseClient.js';
import { buildStudentVideoObjectPath, ALLOWED_VIDEO_MIME_TYPES, MAX_VIDEO_SIZE_BYTES } from '../utils/studentVideoFilename.js';

// Bucket ПРИВАТНЫЙ (в отличие от judo-techniques) — персональное видео
// ученика, см. supabase/migrations/20260911090050_create_student_technique_videos_bucket.sql
// (пока НЕ применена к production). Никакого anon/service_role — только
// authenticated trainerSupabase, тот же клиент, что и остальные тренерские
// запросы; upload/delete здесь проходят RLS INSERT/DELETE-policy на
// storage.objects (public.can_trainer_access_student по student_id из
// первого сегмента пути) — эти два действия остаются ТОЛЬКО тренерскими.
// SELECT-policy на том же bucket'е ШИРЕ (тренер ИЛИ family этого ученика,
// см. миграцию) — этот файл сам по себе family-клиента не использует, но
// RLS уже готов для будущего Family Portal viewer'а без новой миграции.
const STUDENT_VIDEOS_BUCKET = 'student-technique-videos';

// Коротко-живущий signed URL для просмотра — НЕ сохраняется в БД, строится
// заново при каждом открытии viewer'а (задание, этап 11). 5 минут — с
// запасом на загрузку + фактическое воспроизведение короткого клипа
// (Supabase проверяет токен на каждый Range-запрос браузера при стриминге
// <video>, поэтому слишком короткий TTL мог бы прервать воспроизведение
// ПОСЕРЕДИНЕ клипа) — но всё ещё коротко в терминах "постоянная ссылка".
const SIGNED_URL_TTL_SECONDS = 5 * 60;

export class VideoValidationError extends Error {
  constructor(reason) {
    super(`Video validation failed: ${reason}`);
    this.reason = reason; // 'unsupported_format' | 'too_large'
  }
}

export class VideoUploadError extends Error {
  constructor(cause) {
    super('uploadStudentVideo failed');
    this.cause = cause;
  }
}

export class VideoDeleteError extends Error {
  constructor(cause) {
    super('deleteStudentVideo failed');
    this.cause = cause;
  }
}

// Frontend-валидация НЕ считается security boundary (задание, этап 9) —
// это только быстрый, дружелюбный отказ ДО начала загрузки; настоящая
// граница — RLS-policy на storage.objects + (рекомендуемая, отдельным
// шагом) allowed_mime_types/file_size_limit на самом bucket, см. миграцию.
export function validateStudentVideoFile(file) {
  if (!file) {
    throw new VideoValidationError('unsupported_format');
  }
  if (!ALLOWED_VIDEO_MIME_TYPES.includes(file.type)) {
    throw new VideoValidationError('unsupported_format');
  }
  if (file.size > MAX_VIDEO_SIZE_BYTES) {
    throw new VideoValidationError('too_large');
  }
}

// upsert:false (по умолчанию) — сознательно, ПОСЛЕ architecture review.
// buildStudentVideoObjectPath() теперь включает случайный уникальный
// суффикс в КАЖДЫЙ путь (см. utils/studentVideoFilename.js) — значит два
// разных upload'а НИКОГДА не попадают на один и тот же путь физически, ни
// при повторной отметке той же техники, ни если cleanup после отмены не
// успел выполниться. Раньше путь был детерминированным и полагался на
// upsert:true, чтобы превратить потенциальный конфликт в перезапись —
// после review это признано риском (тихая перезапись чужого/старого видео
// при любом непредвиденном совпадении path, а не только в ожидаемом
// сценарии), поэтому убрано полностью: если Storage когда-либо вернёт
// "already exists" на уникальном пути — это признак настоящей ошибки
// (коллизия генератора id/повторный клик с тем же путём), и upload должен
// провалиться явно, а не тихо перезаписать.
export async function uploadStudentVideo({ studentId, lastName, techniqueName, file }) {
  validateStudentVideoFile(file);

  const path = buildStudentVideoObjectPath({
    studentId,
    lastName,
    techniqueName,
    mimeType: file.type
  });

  const { error } = await trainerSupabase.storage.from(STUDENT_VIDEOS_BUCKET).upload(path, file, {
    contentType: file.type
  });

  if (error) {
    throw new VideoUploadError(error);
  }

  return { path };
}

// Best-effort cleanup — вызывается (а) если upload прошёл, но последующий
// INSERT в student_technique_records не удался (orphan video без записи),
// и (б) при отмене выполненной техники, ПОСЛЕ успешного удаления самой
// записи (см. useUnmarkTechniqueCompleted.js — порядок операций объяснён
// там же). path приходит от вызывающего кода из уже известной, загруженной
// записи/только что залитого файла — эта функция НИЧЕГО не угадывает и не
// перебирает объекты сама, удаляет ровно один переданный путь.
export async function deleteStudentVideo(path) {
  if (!path) return;

  const { error } = await trainerSupabase.storage.from(STUDENT_VIDEOS_BUCKET).remove([path]);

  if (error) {
    throw new VideoDeleteError(error);
  }
}

// Signed URL строится по требованию (открытие viewer'а), короткий TTL, НЕ
// кешируется/сохраняется — каждый вызов даёт новую ссылку.
export async function getStudentVideoSignedUrl(path) {
  if (!path) return null;

  const { data, error } = await trainerSupabase.storage
    .from(STUDENT_VIDEOS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) {
    throw error;
  }

  return data?.signedUrl ?? null;
}
