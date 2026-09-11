// Разрешённые типы видео (задание, этап 9) — ровно те 3 формата, которые
// реально дают камеры/телефоны/экспорт соревнований: mp4 (Android/большинство
// камер), quicktime=.mov (iPhone), webm (запись с браузера/веб-камеры).
// Расширение объекта в Storage строится ИЗ ЭТОЙ карты (не из имени
// исходного файла) — имя файла может быть любым/без расширения, MIME-тип
// browser определяет сам по содержимому, это надёжнее.
export const ALLOWED_VIDEO_MIME_TO_EXT = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov'
};

export const ALLOWED_VIDEO_MIME_TYPES = Object.keys(ALLOWED_VIDEO_MIME_TO_EXT);

// 100 MiB — обоснование (задание, этап 9 требует не выбирать произвольно):
// клип выполнения одной техники (секунды-десятки секунд, до ~1-2 минут
// фрагмента соревнований) при типичном для телефона битрейте укладывается
// в десятки МБ даже в 1080p; 100 MiB даёт запас для более длинных/качественных
// клипов, но остаётся заливаемым одним обычным (не resumable/TUS) HTTP-запросом
// supabase-js за разумное время даже на посредственном мобильном аплинке
// (100 MiB при 5 Мбит/с аплоада ≈ 160 секунд — приемлемо с progress/loading
// state, не требует chunked-upload архитектуры, которую задание не просит).
export const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024;

// Diacritic combining marks (Unicode U+0300–U+036F) left behind by
// String.prototype.normalize('NFKD') — e.g. ä -> a + U+0308. Stripping this
// range converts ä/ö/ü/é/ñ/etc. to their plain Latin base letter.
const COMBINING_DIACRITICS_REGEX = /[̀-ͯ]/g;

// Нормализует фамилию/название техники для безопасного сегмента имени
// объекта в Storage: trim -> разложение диакритики (ä/ö/ü/é/ñ и т.п. теряют
// диакритический знак) -> ß явно в "ss" (NFKD его не разлагает) -> upper ->
// пробелы/underscore -> "-" -> всё, что не A-Z0-9- вычищается -> схлопнуть
// повторные "-". Пустой результат -> 'UNKNOWN' (защита от пустого сегмента
// пути, а не от реальных фамилий — пустая строка возможна только если на
// вход пришло что-то без единого латинского/цифрового символа).
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

// Короткий случайный суффикс (8 hex-символов = 32 бита) — ЕДИНСТВЕННАЯ
// цель: сделать object path уникальным на КАЖДЫЙ upload, чтобы повторная
// отметка той же техники того же ученика НИКОГДА не могла перезаписать
// предыдущее видео, даже если cleanup после отмены не успел выполниться
// (architecture review — раньше путь был детерминированным
// <student_id>/<ФАМИЛИЯ>-<ТЕХНИКА>.<ext> + upsert:true, что технически
// защищало от ошибки "объект уже существует", но означало, что ЛЮБОЙ
// повторный upload с тем же расширением тихо ЗАМЕНЯЛ старый файл — ровно
// то, чего требовалось избежать). 32 бита случайности достаточно с большим
// запасом для объёма "сколько раз одна техника одного ученика может быть
// отмечена за всё время" (не глобальный счётчик объектов, а per-запись
// событие) — полный UUID здесь избыточен, id никогда не показывается
// пользователю, только внутренний Storage-ключ.
// crypto.randomUUID() — Web Crypto API, доступен в браузере без зависимостей,
// криптографически стойкий источник случайности (не Math.random()).
function generateShortId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

// <student_id>/<ФАМИЛИЯ>-<ТЕХНИКА>-<unique-id>.<ext> — studentId ПЕРВЫМ
// сегментом (собственный namespace, задание этап 6: одинаковые фамилии
// разных учеников не должны конфликтовать); unique-id ПОСЛЕДНИМ сегментом
// имени файла (не первым/не в middle) — фамилия и техника остаются
// читаемыми/грепаемыми в списке объектов bucket'а, что было бы потеряно,
// если бы весь путь состоял из одного UUID. ext — из
// ALLOWED_VIDEO_MIME_TO_EXT по file.type, не из исходного имени файла.
export function buildStudentVideoObjectPath({ studentId, lastName, techniqueName, mimeType }) {
  const ext = ALLOWED_VIDEO_MIME_TO_EXT[mimeType];
  if (!ext) {
    throw new Error(`Unsupported video mime type: ${mimeType}`);
  }
  const safeSurname = normalizeForStoragePath(lastName);
  const safeTechnique = normalizeForStoragePath(techniqueName);
  const uniqueId = generateShortId();
  return `${studentId}/${safeSurname}-${safeTechnique}-${uniqueId}.${ext}`;
}
