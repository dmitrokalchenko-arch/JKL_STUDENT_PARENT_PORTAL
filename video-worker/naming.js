import { randomUUID } from 'node:crypto';

// Портировано из src/utils/studentVideoFilename.js (frontend) — ТОЧНО та же
// нормализация и структура пути, что клиент уже использует для
// student-technique-videos, чтобы worker создавал объекты, неотличимые от
// client-side upload'а (STAGE 1 задание, раздел 14: "текущий naming
// convention проекта"). Не импортируется напрямую из src/ (worker — не
// часть Vite/frontend build'а, отдельный Node-процесс), поэтому — копия, не
// require одного и того же файла из двух рантаймов.
const COMBINING_DIACRITICS_REGEX = /[̀-ͯ]/g;

export function normalizeForStoragePath(value) {
  const normalized = (value ?? '')
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS_REGEX, '')
    .replace(/ß/gi, 'ss')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'UNKNOWN';
}

function generateShortId() {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

// <studentId>/<ФАМИЛИЯ>-<ТЕХНИКА>-<unique-id>.mp4 — идентично
// buildStudentVideoObjectPath() на клиенте. Расширение всегда 'mp4' (worker
// сам решает финальный формат — H.264/MP4, независимо от того, что было на
// входе), в отличие от клиентской версии, где ext зависел от исходного
// mimeType.
export function buildFinalVideoObjectPath({ studentId, lastName, techniqueName }) {
  const safeSurname = normalizeForStoragePath(lastName);
  const safeTechnique = normalizeForStoragePath(techniqueName);
  const uniqueId = generateShortId();
  return `${studentId}/${safeSurname}-${safeTechnique}-${uniqueId}.mp4`;
}
