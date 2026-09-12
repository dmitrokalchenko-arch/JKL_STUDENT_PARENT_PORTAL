import { WorkerError } from './errors.js';

// Ровно эти 5 значений разрешены (задание, раздел 7) — те же
// CLIP_DURATION_OPTIONS_SEC, что уже валидирует client-side
// TechniqueClipEditor.jsx (src/utils/videoClipRange.js). Worker — граница
// доверия (это HTTP-эндпоинт, не внутренний вызов), поэтому проверяет
// заново, а не полагается на то, что клиент уже отфильтровал.
const ALLOWED_DURATIONS_SEC = [5, 7, 15, 20, 25];

// <studentId>/<единственный сегмент имени файла>.<ext> — задание, раздел 9:
// "нельзя позволять читать произвольный объект Storage". Единственный
// разрешённый разделитель пути — ровно один '/', сразу после studentId;
// имя файла — без '/', без '..', без обратных слэшей, без ведущего '/'.
const SAFE_FILENAME_SEGMENT_REGEX = /^[A-Za-z0-9._-]+\.(mov|mp4|webm)$/i;

export function validateProcessRequestBody(body) {
  if (!body || typeof body !== 'object') {
    throw new WorkerError('INVALID_INPUT', 'Request body must be a JSON object.');
  }

  const { studentId, techniqueSlug, techniqueName, lastName, startSeconds, durationSeconds, tempObjectPath } = body;

  if (!Number.isInteger(studentId) || studentId <= 0) {
    throw new WorkerError('INVALID_INPUT', 'studentId must be a positive integer.');
  }
  if (typeof techniqueSlug !== 'string' || techniqueSlug.trim() === '') {
    throw new WorkerError('INVALID_INPUT', 'techniqueSlug must be a non-empty string.');
  }
  if (typeof techniqueName !== 'string' || techniqueName.trim() === '') {
    throw new WorkerError('INVALID_INPUT', 'techniqueName must be a non-empty string.');
  }
  // lastName: см. naming.js — нужен для итогового naming convention
  // (<ФАМИЛИЯ>-<ТЕХНИКА>-<id>.mp4), уже известен frontend'у из того же
  // student-объекта, что используется в существующем uploadStudentVideo()
  // (studentVideoService.js) — добавлено к полям из задания намеренно,
  // без него нельзя воспроизвести текущий naming convention (раздел 6/14).
  if (typeof lastName !== 'string' || lastName.trim() === '') {
    throw new WorkerError('INVALID_INPUT', 'lastName must be a non-empty string.');
  }
  if (!Number.isFinite(startSeconds) || startSeconds < 0) {
    throw new WorkerError('INVALID_INPUT', 'startSeconds must be a number >= 0.');
  }
  if (!ALLOWED_DURATIONS_SEC.includes(durationSeconds)) {
    throw new WorkerError(
      'INVALID_INPUT',
      `durationSeconds must be one of: ${ALLOWED_DURATIONS_SEC.join(', ')}.`
    );
  }
  if (typeof tempObjectPath !== 'string' || tempObjectPath.trim() === '') {
    throw new WorkerError('INVALID_INPUT', 'tempObjectPath must be a non-empty string.');
  }

  assertTempObjectPathBelongsToStudent(tempObjectPath, studentId);

  return { studentId, techniqueSlug, techniqueName, lastName, startSeconds, durationSeconds, tempObjectPath };
}

// Задание, раздел 9: путь должен НАЧИНАТЬСЯ именно с "<studentId>/" и не
// содержать directory traversal. Проверяется ДО любого обращения к
// Storage — если студент из тела запроса не совпадает с владельцем
// временного объекта, это TEMP_OBJECT_FORBIDDEN раньше, чем RLS вообще
// успеет сработать (belt-and-suspenders: RLS всё равно блокирует чужой
// путь по can_trainer_access_student, но здесь — быстрый, явный, читаемый
// отказ до сетевого вызова).
export function assertTempObjectPathBelongsToStudent(tempObjectPath, studentId) {
  if (tempObjectPath.includes('..') || tempObjectPath.includes('\\') || tempObjectPath.startsWith('/')) {
    throw new WorkerError('TEMP_OBJECT_FORBIDDEN', 'tempObjectPath contains forbidden path segments.');
  }

  const segments = tempObjectPath.split('/');
  if (segments.length !== 2) {
    throw new WorkerError('TEMP_OBJECT_FORBIDDEN', 'tempObjectPath must have exactly one "/" separator.');
  }

  const [studentSegment, fileSegment] = segments;
  if (studentSegment !== String(studentId)) {
    throw new WorkerError('TEMP_OBJECT_FORBIDDEN', 'tempObjectPath does not belong to the given studentId.');
  }
  if (!SAFE_FILENAME_SEGMENT_REGEX.test(fileSegment)) {
    throw new WorkerError('TEMP_OBJECT_FORBIDDEN', 'tempObjectPath file segment is not a safe video filename.');
  }
}
