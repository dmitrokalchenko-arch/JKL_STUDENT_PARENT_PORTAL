// Типизированные server error codes (задание, раздел 17) — единая точка,
// откуда endpoint строит JSON-ответ клиенту. message в WorkerError — то,
// что реально уходит клиенту (короткое, без internals); подробности для
// логов передаются отдельно вызывающим кодом через console.error(cause),
// не через это поле — stack trace никогда не попадает в HTTP-ответ.
const ERROR_HTTP_STATUS = {
  UNAUTHORIZED: 401,
  INVALID_INPUT: 400,
  STUDENT_ACCESS_DENIED: 403,
  TEMP_OBJECT_NOT_FOUND: 404,
  TEMP_OBJECT_FORBIDDEN: 403,
  DOWNLOAD_FAILED: 502,
  FFMPEG_FAILED: 500,
  OUTPUT_VALIDATION_FAILED: 500,
  FINAL_UPLOAD_FAILED: 502,
  INTERNAL_ERROR: 500
};

export class WorkerError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'WorkerError';
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code] ?? 500;
  }
}

// CLEANUP_WARNING сознательно НЕ входит в ERROR_HTTP_STATUS/не бросается как
// WorkerError (задание, раздел 15: "если delete temp object fail —
// логировать cleanup warning, но не скрывать основную processing error") —
// это side-channel диагностика, не причина отказа запроса. См.
// logCleanupWarning() в server.js.
