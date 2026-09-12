import {
  Input,
  ALL_FORMATS,
  BlobSource,
  Output,
  Mp4OutputFormat,
  BufferTarget,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  Quality
} from 'mediabunny';

// PHASE 2 — реальная физическая генерация Student Performance Clip
// (задание, этап "Переходим к PHASE 2"). Чистый media-layer модуль, без
// React — компонент (MarkTechniqueCompletedModal.jsx) только передаёт сюда
// { sourceFile, clipStart, clipDuration } и получает Promise<Blob>
// (задание: "не помещать media-processing логику в React component").
//
// Архитектура (см. отчёт для полного обоснования выбора библиотеки):
//   mediabunny (MPL-2.0, zero runtime deps, преемник deprecated mp4-muxer)
//   как единственная media-библиотека — WebCodecs используется через её
//   обёртки (VideoSampleSink на чтение, VideoSampleSource на запись), без
//   ffmpeg.wasm (запрещён заданием как основной путь) и без отдельного
//   demux/mux стека (MP4Box.js + сырой muxer), который планировался в
//   исходном audit до того, как выяснилось, что mediabunny покрывает всё
//   нужное сам.
//
// Итоговый файл — ОДИН MP4/H.264 трек: сначала выбранный диапазон
// [clipStart, clipStart+clipDuration] на обычной скорости (1.0x), сразу за
// ним — тот же диапазон в замедлении (0.5x, каждый кадр вдвое дольше).
// Оба сегмента кодируются в один и тот же VideoSampleSource/Output — это
// ОДИН физический файл, а не conceptual playbackRate.
//
// Оригинальный selectedFile НИКОГДА не уходит по сети — Input/BlobSource
// открывает его только локально в памяти браузера (задание: "original
// video privacy").
//
// AUDIO: v1 — БЕЗ звука вообще (см. финальный отчёт, явно раскрыто как
// решение, а не тихое упущение). Явный передаваемый заданием fallback:
// "если audio passthrough слишком сложен — приоритет корректному видео,
// v1 без звука" — здесь это так, поскольку выбранная архитектура читает и
// пишет кадры вручную (canvas redraw на каждый frame для resize/rotation),
// а не через Conversion API, и добавление отдельного синхронизированного
// audio-трека для ДВУХ неравноскоростных видео-сегментов — заметно более
// сложная задача, вынесенная за рамки этого v1.

export class VideoProcessingUnsupportedError extends Error {
  constructor(reason) {
    super(`Video processing unsupported: ${reason}`);
    this.name = 'VideoProcessingUnsupportedError';
    this.reason = reason; // 'no_video_track' | 'cannot_decode' | 'cannot_encode'
  }
}

export class VideoProcessingCanceledError extends Error {
  constructor() {
    super('Video processing canceled');
    this.name = 'VideoProcessingCanceledError';
  }
}

// Кандидатные настройки нормализации (задание: "показать конкретные
// resolution/fps/bitrate перед финальной интеграцией", см. отчёт):
//   - long/short edge вместо фиксированной width/height — иначе portrait-
//     видео (телефон вертикально) либо неправильно ограничивалось бы по
//     ширине, либо не ограничивалось бы вовсе по высоте.
//   - 30fps — потолок, а не принудительное значение: применяется ТОЛЬКО
//     если источник реально быстрее (иначе бессмысленный upsampling более
//     медленного источника, см. computeFrameRateMetrics ниже).
//   - 2.5 Mbps — компромисс для короткого учебного клипа в приватном
//     bucket'е (не публичный YouTube-контент, где обычно рекомендуют выше).
const MAX_LONG_EDGE_PX = 1280;
const MAX_SHORT_EDGE_PX = 720;
const MAX_FRAME_RATE = 30;
const TARGET_VIDEO_BITRATE_BPS = 2_500_000;
const OUTPUT_VIDEO_CODEC = 'avc'; // H.264 — задание: "MP4/H.264(AVC)"

// TEMP DIAGNOSTICS: физический iPhone Safari тест после устранения "Buffer
// has no frame" показал НОВУЮ воспроизводимую проблему — synthetic probe
// ПРИНИМАЕТ candidate (реально создаёт+использует+закрывает H.264 encoder),
// но real processing СРАЗУ ПОСЛЕ этого ОТКЛОНЯЕТ ТОТ ЖЕ candidate с
// идентичной ошибкой "is not supported in this environment". Структурное
// сравнение (перехват VideoEncoder.configure()) доказало: фактический
// VideoEncoderConfig у probe и real БАЙТ-В-БАЙТ идентичен — причина НЕ в
// конфиге. Рабочая гипотеза — device-level resource-release race: WebCodecs
// VideoEncoder.close() синхронен на уровне JS, но освобождение аппаратной
// VideoToolbox-сессии на уровне ОС может быть асинхронным и не даёт JS
// awaitable-сигнала о завершении (та же категория проблемы, что уже была
// найдена и устранена для HEVC source decoder — см. probe/real separation
// у probeAvcEncoderConfig). RESOURCE_SETTLE_DELAY_MS — ЧИСТО ДИАГНОСТИЧЕСКИЙ
// параметр для СЛЕДУЮЩЕГО физического iPhone теста: простое wall-clock
// ожидание (НЕ fake-await несуществующего decoder/encoder teardown hook —
// mediabunny такого hook'а не предоставляет, и лезть в её internals не
// нужно), которое даёт ОС время на освобождение video codec сессии. НЕ
// влияет на алгоритм выбора candidate, на порядок кандидатов, на
// resolution/bitrate/fps/1.0x+0.5x — только добавляет паузу в двух точках
// (см. resourceSettleDelay ниже). Единственное место для изменения значения
// при следующих экспериментах (0/250/500/1000 мс) — без архитектурного
// рефакторинга. УДАЛИТЬ вместе с остальной TEMP-диагностикой после того,
// как гипотеза будет подтверждена/опровергнута и заменена постоянным фиксом.
const RESOURCE_SETTLE_DELAY_MS = 500;

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new VideoProcessingCanceledError();
  }
}

// Прерываемое ожидание: если signal прерывается ПОКА мы ждём, немедленно
// разрешаем промис (не блокируем cancellation на всю длительность delay).
// throwIfAborted() сразу после вызова этой функции (см. resourceSettleDelay)
// гарантирует, что отмена реально останавливает обработку, а не просто
// "тихо" продолжает после укороченного ожидания.
function waitOrAbort(ms, signal) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timeoutId = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

// TEMP DIAGNOSTICS: см. комментарий у RESOURCE_SETTLE_DELAY_MS. Вызывается
// ТОЛЬКО в двух точках findWorkingAvcEncoderConfig (после cleanup успешного
// probe перед стартом real encoder; после cleanup отклонённой real-попытки
// перед следующим candidate) — НЕ на каждый кадр, НЕ внутри encodeSegment.
// onStageForCandidate — уже существующий per-candidate wrapper (несёт
// candidateIndex/codec/hardwareAcceleration) — persistent diagnostics видят
// delayMs/aborted через тот же существующий механизм onInternalStage, без
// дополнительного кода.
async function resourceSettleDelay(onStageForCandidate, signal, startStage, doneStage) {
  if (RESOURCE_SETTLE_DELAY_MS <= 0) {
    return;
  }
  onStageForCandidate(startStage, { forceLog: true, phase: 'settle', delayMs: RESOURCE_SETTLE_DELAY_MS });
  await waitOrAbort(RESOURCE_SETTLE_DELAY_MS, signal);
  onStageForCandidate(doneStage, {
    forceLog: true,
    phase: 'settle',
    delayMs: RESOURCE_SETTLE_DELAY_MS,
    aborted: signal?.aborted === true
  });
  throwIfAborted(signal);
}

// TEMP DIAGNOSTICS (физический iPhone Safari retest, чёрный preview уже
// исправлен — теперь падает processing с generic "Видео не удалось
// обработать"; исходная ошибка нигде не логировалась). Стадии — только для
// расследования, где именно рвётся pipeline на реальном устройстве; УДАЛИТЬ
// после подтверждённого фикса, алгоритм обработки эти логи не меняют.
function logStage(stage) {
  // eslint-disable-next-line no-console
  console.log('[clip-processing]', stage);
}

// TEMP DIAGNOSTICS: физический iPhone retest после AVC-фикса показал новую
// ошибку ("InvalidStateError: Buffer has no frame") на стадии, которую
// старый код обозначал как "M_FIRST_FRAME_ENCODED" — НО этот label
// обновлялся ТОЛЬКО для самого первого кадра всего pipeline (см. старую
// проверку isFirstSegment && isFirstFrameOfSegment ниже) и оставался
// "залипшим" на этом значении для ЛЮБОГО кадра дальше (2-го, 10-го, из
// PART2...), потому что per-frame стадии для остальных кадров вообще не
// логировались. Поэтому диагноз "упало именно на первом кадре" был не
// доказан — реальная точка отказа могла быть где угодно в сегменте.
// Ниже — исправление ЭТОЙ диагностической неточности (не алгоритма):
// per-frame стадии (I_FRAME_DRAWN/I2/M1/M2) теперь обновляются для КАЖДОГО
// кадра (currentStage всегда отражает правду), а подробный console.log
// ограничен MAX_DETAILED_FRAME_LOGS кадрами, чтобы не спамить консоль и не
// тормозить обработку на длинных клипах (до ~750 кадров на 25 сек).
const MAX_DETAILED_FRAME_LOGS = 24;

// TEMP DIAGNOSTICS: физический iPhone retest показал, что после падения
// (вероятно, полная перезагрузка/креш вкладки Safari — модалка "тихо"
// исчезала без ошибки) localStorage remnant в модалке содержал только
// верхнеуровневый FLOW_PROCESSING_START — сама модалка НЕ видела внутренние
// стадии processTechniqueClip() (currentStage — приватное замыкание внутри
// этой функции), поэтому не могла сохранить persistent ТОЧНУЮ внутреннюю
// стадию перед обрывом. onInternalStage (опциональный, ниже) даёт наружу
// throttled поток internal-стадий именно для persistent-записи в
// localStorage — trottling нужен, чтобы не писать в localStorage на каждый
// из ~750 кадров четверть-минутного клипа (лишняя нагрузка на устройство,
// которое и так может быть уже на грани по памяти/ресурсам).
const INTERNAL_STAGE_FRAME_THROTTLE = 30; // ~раз в секунду видео при 30fps

// РЕАЛЬНЫЙ физический iPhone Safari retest (IMG_7163.mov, HEVC/MOV,
// display 2160×3840 portrait → target 720×1280) уронил processing на этапе
// J_ENCODER_CONFIG_CREATED с точной ошибкой:
//   "This specific encoder configuration (avc1.64001f, 2500000 bps,
//   720x1280, hardware acceleration: no-preference) is not supported in
//   this environment."
//
// Root cause (проверено чтением исходников mediabunny 1.56.1,
// node_modules/mediabunny/src/codec.ts buildVideoCodecString + encode.ts
// buildVideoEncoderConfigs): codec string для 'avc' ВСЕГДА жёстко
// High Profile (0x64) — это не варьируемый candidate, а единственный
// детерминированный выбор библиотеки, подобранный только по (см. codec.ts):
//   totalMacroblocks = ceil(width/16) * ceil(height/16) <= level.maxMacroblocks
//   И bitrate <= level.maxBitrate
// Для 720×1280: totalMacroblocks = 45*80 = 3600 → это ТОЧНО порог таблицы
// mediabunny для Level 3.1 (maxMacroblocks: 3600) → codec string
// "avc1.64001f" (High Profile, Level 3.1) — ровно то, что упало на iPhone.
//
// Критично: таблица mediabunny (AVC_LEVEL_TABLE в codec.ts) учитывает ТОЛЬКО
// macroblocks/КАДР (MaxFS) и максимальный bitrate — она ПОЛНОСТЬЮ
// игнорирует реальное ограничение спецификации H.264 (ITU-T Table A-1):
// macroblocks/СЕКУНДУ (MaxMBPS). Наши 3600 MB/кадр при 30fps = 108 000
// MBPS — ТОЧНО равно официальному MaxMBPS для Level 3.1 (108 000), т.е. мы
// на самой границе спецификации без всякого запаса. Chromium (десктоп,
// уже validated) эту границу у себя пропускает, но строгий hardware-валидатор
// Apple VideoToolbox на iPhone её, судя по всему, не пропускает — отсюда и
// "not supported in this environment" именно на реальном устройстве при
// идентичном codec string.
//
// ИСПРАВЛЕНИЕ (capability-based, БЕЗ browser sniffing): вместо того чтобы
// доверять единственному, жёстко зашитому в mediabunny выбору профиля/уровня,
// мы сами строим список кандидатов (профиль × уровень, с учётом РЕАЛЬНОГО
// MaxMBPS, которого нет в таблице mediabunny) и реально проверяем каждый
// через нативный VideoEncoder.isConfigSupported() — точно тот же метод,
// который в итоге проваливает mediabunny внутри VideoSampleSource. Первый
// РЕАЛЬНО поддерживаемый кандидат используется и для preflight-проверки, и
// (через fullCodecString/hardwareAcceleration) для настоящего encoder —
// больше никакого "preflight PASS → другой real config → FAIL".
//
// Официальная таблица уровней H.264 (ITU-T H.264 Annex A, Table A-1).
// MaxBR — в bit/s для Baseline/Main/Extended profile; High profile разрешает
// bitrate в 1.25 раза выше того же уровня (тот же источник).
const REAL_AVC_LEVEL_TABLE = [
  { level: 0x1E, maxMacroblocksPerFrame: 1620, maxMacroblocksPerSecond: 40_500, maxBitrateBps: 10_000_000 }, // 3
  { level: 0x1F, maxMacroblocksPerFrame: 3600, maxMacroblocksPerSecond: 108_000, maxBitrateBps: 14_000_000 }, // 3.1
  { level: 0x20, maxMacroblocksPerFrame: 5120, maxMacroblocksPerSecond: 216_000, maxBitrateBps: 20_000_000 }, // 3.2
  { level: 0x28, maxMacroblocksPerFrame: 8192, maxMacroblocksPerSecond: 245_760, maxBitrateBps: 20_000_000 }, // 4
  { level: 0x29, maxMacroblocksPerFrame: 8192, maxMacroblocksPerSecond: 245_760, maxBitrateBps: 50_000_000 }, // 4.1
  { level: 0x2A, maxMacroblocksPerFrame: 8704, maxMacroblocksPerSecond: 522_240, maxBitrateBps: 50_000_000 }, // 4.2
  { level: 0x32, maxMacroblocksPerFrame: 22_080, maxMacroblocksPerSecond: 589_824, maxBitrateBps: 135_000_000 } // 5
];

// High Profile — то же качество/сжатие, что и раньше (проверенное на
// desktop), поэтому идёт первым кандидатом; Main/Baseline — запасные
// варианты на случай, если конкретное устройство не поддерживает High.
const AVC_PROFILE_CANDIDATES = [
  { profileIdc: 0x64, name: 'High', bitrateFactor: 1.25 },
  { profileIdc: 0x4D, name: 'Main', bitrateFactor: 1 },
  { profileIdc: 0x42, name: 'Baseline', bitrateFactor: 1 }
];

function pickRealAvcLevel(macroblocksPerFrame, macroblocksPerSecond, bitrateBps, bitrateFactor) {
  // Строго МЕНЬШЕ (не <=) для macroblocks/frame и macroblocks/sec —
  // намеренно. Для нашего целевого 720×1280@30fps оба значения (3600
  // MB/кадр, 108 000 MB/сек) попадают ТОЧНО НА границу официального Level
  // 3.1 (см. комментарий выше). Именно "avc1.64001f" (High Profile,
  // Level 3.1 — граница без запаса) реально упал на физическом iPhone.
  // "<=" здесь означало бы, что мы снова выбираем ТОТ ЖЕ пограничный
  // уровень, который уже подтверждённо не поддержан — со строгим "<" в
  // таком edge-case мы сразу берём следующий уровень с реальным запасом
  // (Level 3.2 в нашем случае), вместо того чтобы полагаться на то, что
  // конкретное устройство примет значение ровно на границе спецификации.
  const fit = REAL_AVC_LEVEL_TABLE.find(
    (entry) =>
      macroblocksPerFrame < entry.maxMacroblocksPerFrame &&
      macroblocksPerSecond < entry.maxMacroblocksPerSecond &&
      bitrateBps <= entry.maxBitrateBps * bitrateFactor
  );
  return fit ?? REAL_AVC_LEVEL_TABLE[REAL_AVC_LEVEL_TABLE.length - 1];
}

function buildAvcCodecString(profileIdc, levelIdc) {
  const hex = (value) => value.toString(16).padStart(2, '0');
  return `avc1.${hex(profileIdc)}00${hex(levelIdc)}`;
}

// Порядок кандидатов: сначала hardwareAcceleration оставляем как есть
// (задание: "не фиксируй это без необходимости") и перебираем profile/level;
// только если НИ ОДНА комбинация profile/level не поддержана — пробуем
// другие значения hardwareAcceleration для тех же profile/level (более
// заметное отступление от дефолта, поэтому во вторую очередь).
function buildAvcEncoderCandidates({ width, height, bitrateBps, framerateHz }) {
  const macroblocksPerFrame = Math.ceil(width / 16) * Math.ceil(height / 16);
  const macroblocksPerSecond = macroblocksPerFrame * (framerateHz ?? MAX_FRAME_RATE);

  const profileLevelPairs = AVC_PROFILE_CANDIDATES.map(({ profileIdc, name, bitrateFactor }) => {
    const level = pickRealAvcLevel(macroblocksPerFrame, macroblocksPerSecond, bitrateBps, bitrateFactor);
    return {
      profileName: name,
      fullCodecString: buildAvcCodecString(profileIdc, level.level)
    };
  });

  const candidates = [];
  for (const hardwareAcceleration of ['no-preference', 'prefer-hardware', 'prefer-software']) {
    for (const pair of profileLevelPairs) {
      candidates.push({ ...pair, hardwareAcceleration });
    }
  }
  return candidates;
}

// ВТОРОЙ физический iPhone retest (после AVC profile/level-фикса выше,
// avc1.640020 корректно прошёл СТАТИЧЕСКУЮ проверку и был выбран) показал
// НОВУЮ ошибку РОВНО на попытке реальной инициализации encoder:
//   "This specific encoder configuration (avc1.640020, 2500000 bps,
//   720x1280, hardware acceleration: no-preference) is not supported in
//   this environment."
// — то есть ТОТ ЖЕ кандидат, который наш собственный preflight
// (VideoEncoder.isConfigSupported()) подтвердил как supported:true, на
// РЕАЛЬНОЙ инициализации (mediabunny ensureEncoder(), которая тоже вызывает
// isConfigSupported(), но уже ПОЗЖЕ, после того как HEVC-декодер уже
// активно работает) — отклоняется.
//
// Ключевой вывод (см. также mediabunny/src/encode.ts:1135, собственный
// комментарий авторов библиотеки: "isConfigSupported on Firefox appears to
// unreliably indicate if encoding will actually succeed" — там для Firefox
// уже есть workaround через реальную пробную кодировку кадра). На этом
// iPhone Safari isConfigSupported() оказался НЕНАДЁЖЕН аналогичным
// образом: статическая проверка не гарантирует успех реальной
// VideoEncoder.configure()+encode(), возможно из-за конкуренции за
// hardware video codec block между активным HEVC-декодером и попыткой
// сконфигурировать H.264-энкодер именно в этот момент.
//
// ИСПРАВЛЕНИЕ: RUNTIME CANDIDATE FALLBACK. isConfigSupported() остаётся
// дешёвым первым фильтром (отсекает заведомо нерабочие комбинации), но
// решающим считается ТОЛЬКО реальный результат: создать Output+
// VideoSampleSource с этим candidate, реально задекодировать/отправить
// первый кадр через encodeSegment(). Если mediabunny выбрасывает именно
// "...is not supported in this environment" — это ОТКАЗ ИМЕННО ЭТОГО
// candidate (isEncoderConfigNotSupportedError ниже), не общая ошибка
// pipeline: текущий Output отменяется, и пробуется следующий candidate.
// Любая ДРУГАЯ ошибка (abort/decode/mux/...) пробрасывается как есть, без
// маскировки под "ещё один candidate не подошёл".
function isEncoderConfigNotSupportedError(err) {
  return (
    err instanceof Error &&
    typeof err.message === 'string' &&
    err.message.includes('is not supported in this environment')
  );
}

// ТРЕТИЙ физический iPhone retest (после успешного runtime AVC fallback —
// persistent internal-stage diagnostics) показал: pipeline доходит до
// L_ENCODER_READY на candidate #6 (Baseline, prefer-hardware) — то есть
// ПОСЛЕ ПЯТИ отклонённых runtime-попыток на РЕАЛЬНОМ 4K HEVC source — и
// затем Safari через 2-3 сек перезапускает страницу (без JS-исключения).
//
// Root cause (проверено чтением исходников mediabunny 1.56.1): СТАРАЯ
// архитектура (см. ниже, оставлено для истории) для КАЖДОЙ candidate-
// попытки вызывала encodeSegment(), а та — videoSampleSink.samples() —
// это ВСЕГДА создаёт НОВЫЙ WebCodecs VideoDecoder
// (node_modules/mediabunny/src/media-sink.ts:494, _createDecoder внутри
// mediaSamplesInRange), даже если попытка отклоняется на первом же кадре.
// mediabunny КОРРЕКТНО закрывает decoder при прерывании итерации (custom
// .return() на итераторе, media-sink.ts:631-639 → decoder?.close() в
// finally "pump"-промиса, media-sink.ts:590-591) — НО это закрытие
// АСИНХРОННОЕ (происходит когда внутренний "pump"-цикл добирается до
// следующей проверки условия), а старый код НЕ ЖДАЛ этого закрытия перед
// тем как немедленно запросить НОВЫЙ decoder для следующего candidate. На
// iOS Safari/VideoToolbox, где лимит одновременных HEVC hardware decode
// sessions строгий (нередко ровно 1), это создавало race: предыдущая
// decode-сессия ещё не освобождена, а новая уже запрашивается — после
// нескольких таких попыток подряд WebContent process, судя по всему,
// убивается memory/media-resource pressure (типичное поведение iOS Safari
// при исчерпании media-ресурсов — молчаливый reload, без JS-ошибки).
//
// ИСПРАВЛЕНИЕ: разделяем ENCODER PROBING (выбор рабочего AVC candidate) и
// РЕАЛЬНУЮ ОБРАБОТКУ. Для probe НЕ используем source video/HEVC decoder
// вообще — вместо этого отправляем в encoder ОДИН синтетический RGBA-кадр
// (raw pixel data — тот же безопасный путь, что уже подтверждён рабочим на
// физическом iPhone для первого кадра реальной обработки, см. комментарий
// у createOutputVideoSample). HEVC decoder создаётся РОВНО ОДИН РАЗ — только
// после того, как рабочий candidate уже найден и подтверждён synthetic
// probe'ом. Список/порядок candidates, preflight-фильтр (isConfigSupported)
// и итоговые параметры вывода (720×1280/30fps/2.5Mbps/H.264/1.0x+0.5x) —
// БЕЗ изменений.
async function probeAvcEncoderConfig(
  candidate,
  candidateIndex,
  { width, height, bitrateBps, framerateHz, quality, signal, onStage }
) {
  const candidateMeta = {
    candidateIndex,
    codec: candidate.fullCodecString,
    hardwareAcceleration: candidate.hardwareAcceleration
  };
  const onStageForProbe = (stage, options = {}) =>
    onStage(stage, { ...options, ...candidateMeta, phase: options.phase ?? 'probe' });

  onStageForProbe(`PROBE_CANDIDATE_START candidate=${candidateIndex}`, { forceLog: true });

  let firstEncodedChunkSeen = false;
  const probeOutput = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const probeSource = new VideoSampleSource({
    codec: OUTPUT_VIDEO_CODEC,
    quality,
    fullCodecString: candidate.fullCodecString,
    hardwareAcceleration: candidate.hardwareAcceleration,
    onEncoderConfig: () => onStageForProbe('PROBE_ENCODER_CREATED', { forceLog: true }),
    onEncodedPacket: () => {
      if (!firstEncodedChunkSeen) {
        firstEncodedChunkSeen = true;
        onStageForProbe('PROBE_FIRST_CHUNK', { forceLog: true });
      }
    }
  });
  probeOutput.addVideoTrack(probeSource);

  try {
    await probeOutput.start();
    throwIfAborted(signal);

    // Один синтетический RGBA-кадр — нужного (реального output) размера,
    // валидные timestamp/duration, БЕЗ какого-либо обращения к source video
    // или HEVC-декодеру. Пиксели могут быть полностью чёрными (нулевой
    // Uint8Array) — encoder'у для проверки реальной инициализации не важно
    // содержимое кадра, важен только факт успешного encode.
    const probePixelData = new Uint8Array(width * height * 4);
    onStageForProbe('PROBE_FRAME_CREATED', { forceLog: true });
    const probeSample = new VideoSample(probePixelData, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: 0,
      duration: 1 / (framerateHz ?? MAX_FRAME_RATE)
    });

    onStageForProbe('PROBE_FRAME_SUBMIT_START', { forceLog: true });
    try {
      await probeSource.add(probeSample);
    } finally {
      probeSample.close();
    }
    onStageForProbe('PROBE_FRAME_SUBMIT_DONE', { forceLog: true });

    onStageForProbe('PROBE_FINALIZE_START', { forceLog: true });
    await probeOutput.finalize();
    onStageForProbe('PROBE_FINALIZE_DONE', { forceLog: true });

    if (!firstEncodedChunkSeen) {
      // Не должно случиться (finalize() дожидается вывода всех пакетов),
      // но раз задание требует считать probe успешным ТОЛЬКО при реально
      // полученном encoded chunk — проверяем явно, а не предполагаем.
      throw new Error('Probe finalized without producing an encoded chunk');
    }

    onStageForProbe(`PROBE_CANDIDATE_ACCEPTED candidate=${candidateIndex}`, { forceLog: true });
    return { accepted: true };
  } catch (err) {
    const isCandidateRejection = isEncoderConfigNotSupportedError(err);
    onStageForProbe(`PROBE_CANDIDATE_REJECTED candidate=${candidateIndex}`, { forceLog: true });
    if (!isCandidateRejection) {
      // Настоящая ошибка (abort/mux/...), не связанная с выбором AVC
      // candidate — пробрасываем как есть.
      throw err;
    }
    return { accepted: false, error: err };
  } finally {
    // Output.cancel() безопасен для повторного вызова даже ПОСЛЕ успешного
    // finalize() (mediabunny просто no-op'ает с предупреждением, не бросает
    // — node_modules/mediabunny/src/output.ts:922-930), поэтому единый
    // cleanup без доп. флагов "уже ли finalized". cancel()/finalize() любой
    // ветки гарантированно закрывает реальный WebCodecs VideoEncoder этой
    // попытки (encoder.close() в finally у flushAndClose(),
    // media-source.ts:980-983) — до перехода к следующему candidate.
    try {
      await probeOutput.cancel();
    } catch {
      // best-effort — не маскируем исходную ошибку/результат probe
    }
    onStageForProbe('PROBE_CLEANUP_DONE', { forceLog: true });
  }
}

// Заменяет старую mediabunny canEncodeVideo() (и наш ещё более ранний
// selectAvcEncoderConfig(), который останавливался на первом
// isConfigSupported()===true без реальной проверки). Для каждого candidate:
// дешёвый статический фильтр (isConfigSupported) → synthetic PROBE (см.
// probeAvcEncoderConfig выше, БЕЗ HEVC decoder) → и ТОЛЬКО для первого
// candidate, реально прошедшего probe, — ОДНА настоящая инициализация
// encoder'а + декодирование PART1 реального source video (см. подробный
// комментарий про root cause выше).
async function findWorkingAvcEncoderConfig({
  width,
  height,
  bitrateBps,
  framerateHz,
  signal,
  quality,
  videoSampleSink,
  clipStart,
  clipEnd,
  frameIntervalSec,
  onStage,
  frameCounter,
  onCandidateAttempt
}) {
  if (typeof VideoEncoder === 'undefined') {
    throw new VideoProcessingUnsupportedError('cannot_encode');
  }

  const candidates = buildAvcEncoderCandidates({ width, height, bitrateBps, framerateHz });
  let candidateIndex = 0;

  for (const candidate of candidates) {
    candidateIndex++;
    throwIfAborted(signal);

    const candidateMeta = {
      candidateIndex,
      codec: candidate.fullCodecString,
      hardwareAcceleration: candidate.hardwareAcceleration
    };
    const onStageForThisCandidate = (stage, options = {}) =>
      onStage(stage, { ...options, ...candidateMeta, phase: options.phase ?? 'real' });

    let staticSupport = false;
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: candidate.fullCodecString,
        width,
        height,
        bitrate: bitrateBps,
        framerate: framerateHz,
        hardwareAcceleration: candidate.hardwareAcceleration
      });
      staticSupport = support.supported === true;
    } catch {
      staticSupport = false;
    }

    if (!staticSupport) {
      onCandidateAttempt?.({ ...candidate, stage: 'preflight', result: 'rejected' });
      continue;
    }
    onCandidateAttempt?.({ ...candidate, stage: 'preflight', result: 'accepted' });
    onStageForThisCandidate(`K_PREFLIGHT_ACCEPTED candidate=${candidateIndex}`, { forceLog: true, phase: 'preflight' });

    // ФАЗА A: PROBE — synthetic RGBA-кадр, БЕЗ source video decoder.
    const probeResult = await probeAvcEncoderConfig(candidate, candidateIndex, {
      width,
      height,
      bitrateBps,
      framerateHz,
      quality,
      signal,
      onStage
    });
    onCandidateAttempt?.({
      ...candidate,
      stage: 'probe',
      result: probeResult.accepted ? 'accepted' : 'rejected',
      error: probeResult.error?.message
    });

    if (!probeResult.accepted) {
      // Этот candidate реально не поддержан устройством — пробуем
      // следующего. Настоящий source video decoder ЕЩЁ НИ РАЗУ не
      // запускался.
      continue;
    }

    // TEMP DIAGNOSTICS: см. комментарий у RESOURCE_SETTLE_DELAY_MS — probe
    // уже завершил свой cleanup (probeAvcEncoderConfig's finally, включая
    // PROBE_CLEANUP_DONE) ДО этой точки; здесь только пауза перед стартом
    // real encoder ТОГО ЖЕ candidate, порядок существующего cleanup не
    // меняется.
    await resourceSettleDelay(
      onStageForThisCandidate,
      signal,
      'RESOURCE_SETTLE_AFTER_PROBE_START',
      'RESOURCE_SETTLE_AFTER_PROBE_DONE'
    );

    // ФАЗА B: РЕАЛЬНАЯ обработка — HEVC decoder запускается здесь впервые
    // (и, в штатном случае, единственный раз для всего PART1).
    onStageForThisCandidate(`REAL_PROCESSING_START candidate=${candidateIndex}`, { forceLog: true, phase: 'real' });

    let firstEncodedChunkSeen = false;
    const attemptOutput = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const attemptSource = new VideoSampleSource({
      codec: OUTPUT_VIDEO_CODEC,
      quality,
      fullCodecString: candidate.fullCodecString,
      hardwareAcceleration: candidate.hardwareAcceleration,
      onEncoderConfig: () => onStageForThisCandidate('L_ENCODER_READY', { forceLog: true }),
      onEncodedPacket: () => {
        if (!firstEncodedChunkSeen) {
          firstEncodedChunkSeen = true;
          onStageForThisCandidate('M3_FIRST_ENCODED_CHUNK', { forceLog: true });
        }
      }
    });
    attemptOutput.addVideoTrack(attemptSource);

    // Сброс на каждую попытку — иначе номера кадров в диагностике "прыгали"
    // бы между несколькими неудачными/удачными candidate-попытками.
    frameCounter.value = 0;

    try {
      await attemptOutput.start();
      const part1EndSec = await encodeSegment({
        videoSampleSink,
        videoSampleSource: attemptSource,
        rangeStart: clipStart,
        rangeEnd: clipEnd,
        targetWidth: width,
        targetHeight: height,
        speedFactor: 1,
        timestampOffsetSec: 0,
        frameIntervalSec,
        signal,
        onStage: onStageForThisCandidate,
        frameCounter,
        isFirstSegment: true
      });

      onCandidateAttempt?.({ ...candidate, stage: 'runtime', result: 'accepted' });
      onStageForThisCandidate(
        `RUNTIME_ENCODER_INITIALIZED candidate=${candidate.fullCodecString} hwAccel=${candidate.hardwareAcceleration}`,
        { forceLog: true }
      );

      return { candidate, output: attemptOutput, videoSampleSource: attemptSource, part1EndSec };
    } catch (err) {
      const isCandidateRejection = isEncoderConfigNotSupportedError(err);
      onCandidateAttempt?.({
        ...candidate,
        stage: 'runtime',
        result: 'rejected',
        error: err?.message,
        isCandidateSpecific: isCandidateRejection
      });

      try {
        await attemptOutput.cancel();
      } catch {
        // best-effort — не маскируем исходную ошибку кандидата
      }

      if (!isCandidateRejection) {
        // Настоящая ошибка (отмена/decode/mux/...), не связанная с выбором
        // AVC candidate — пробрасываем как есть, не пытаемся "подобрать
        // другой candidate" для проблемы, которая не в этом.
        throw err;
      }
      // Редкий edge case: candidate прошёл synthetic probe, но реальная
      // инициализация на настоящих данных всё равно отклонена — пробуем
      // следующего candidate (probe заново для него), а не сдаёмся сразу.
      onStageForThisCandidate(`K_CANDIDATE_REJECTED candidate=${candidateIndex}`, { forceLog: true });

      // TEMP DIAGNOSTICS: см. комментарий у RESOURCE_SETTLE_DELAY_MS —
      // cleanup этой (отклонённой) real-попытки уже выполнен выше
      // (attemptOutput.cancel(), что закрывает encoder через
      // flushAndClose(); IteratorClose у encodeSegment's for-await уже
      // вызвал .return() у videoSampleSink.samples()); здесь только пауза
      // перед следующим candidate, порядок cleanup не меняется.
      await resourceSettleDelay(
        onStageForThisCandidate,
        signal,
        'RESOURCE_SETTLE_AFTER_REAL_FAIL_START',
        'RESOURCE_SETTLE_AFTER_REAL_FAIL_DONE'
      );
    }
  }

  throw new VideoProcessingUnsupportedError('cannot_encode');
}

// Сохраняет aspect ratio, ограничивает длинную сторону MAX_LONG_EDGE_PX и
// короткую MAX_SHORT_EDGE_PX одновременно (работает одинаково для landscape
// и portrait источников), никогда не увеличивает (scale <= 1 — маленькие
// исходники не растягиваются). Чётные пиксели — обычное требование
// video-энкодеров (H.264 работает по 2x2 блокам chroma subsampling).
function computeTargetDimensions(displayWidth, displayHeight) {
  const longEdge = Math.max(displayWidth, displayHeight);
  const shortEdge = Math.min(displayWidth, displayHeight);
  const scale = Math.min(1, MAX_LONG_EDGE_PX / longEdge, MAX_SHORT_EDGE_PX / shortEdge);

  const toEven = (value) => Math.max(2, Math.round(value / 2) * 2);

  return {
    width: toEven(displayWidth * scale),
    height: toEven(displayHeight * scale)
  };
}

// sample.draw() у mediabunny сам учитывает rotation (в отличие от
// сырого VideoFrame) — задание явно требовало корректно обрабатывать
// rotated/portrait видео с телефона, а не просто игнорировать метаданные.
// После этого шага кадр уже "прямой" — выходному треку rotation-metadata
// не нужна.
function drawSampleToCanvas(sample, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  sample.draw(ctx, 0, 0, width, height);
  return canvas;
}

// РЕАЛЬНЫЙ физический iPhone retest (после AVC-фикса, avc1.640020 принят)
// уронил processing дальше: "InvalidStateError: Buffer has no frame".
//
// Root cause (проверено чтением исходников mediabunny 1.56.1):
// new VideoSample(canvas, {timestamp, duration}) СРАЗУ, синхронно,
// конструирует внутренний new VideoFrame(canvas, {...})
// (node_modules/mediabunny/src/sample.ts:542-557) — это происходит в
// момент вызова, сразу после sample.draw() на canvas. Но РЕАЛЬНАЯ передача
// этого кадра в WebCodecs VideoEncoder (sampleToEncode.toVideoFrame(),
// media-source.ts:548) происходит только ПОСЛЕ того, как разрешится
// this.ensureEncoderPromise — а ensureEncoder() (media-source.ts:651-741)
// сама асинхронно перебирает кандидатов через VideoEncoder.isConfigSupported()
// и вызывает encoder.configure(). Этот await-разрыв между "VideoFrame
// создан из canvas" и "VideoFrame реально использован" существует ТОЛЬКО
// для САМОГО ПЕРВОГО кадра, отправленного в videoSampleSource.add() за всё
// время pipeline (see media-source.ts:484-497: `if (!this.encoderInitialized)
// {...await this.ensureEncoderPromise...}` — для всех следующих кадров эта
// ветка уже пропускается, encoderInitialized=true).
//
// InvalidStateError "Buffer has no frame" — это ровно ошибка WebCodecs про
// VideoFrame с уже недоступным backing buffer. Наиболее вероятный механизм
// на WebKit: OffscreenCanvas, на который ничего кроме локальной переменной
// в цикле не ссылается, теряет единственную сильную JS-ссылку сразу после
// return из drawSampleToCanvas — и именно для ПЕРВОГО кадра успевает пройти
// реальный await-разрыв (несколько isConfigSupported()+configure()), в
// течение которого GC на мобильном Safari может освободить backing store
// canvas/VideoFrame раньше, чем encoder успевает его прочитать. Все
// остальные кадры идут без такого разрыва (закодированы практически сразу
// после add()), поэтому падать не должны — и по отчёту с iPhone это именно
// так (preview/timeline с этим НЕ связаны, они не используют WebCodecs).
//
// ВТОРОЙ физический iPhone retest (после успешного runtime AVC fallback —
// candidate #5, avc1.4d0020 Main/prefer-hardware, реально прошёл preflight)
// уронил processing НА ЭТОМ САМОМ targeted-фиксе:
//   Этап: I_FRAME_DRAWN frame=1
//   Ошибка: InvalidStateError: Cannot create ImageBitmap from canvas that
//   can't be rendered
// Диагностика подтверждает: OffscreenCanvas создан и sample.draw() уже
// отработал (стадия I_FRAME_DRAWN достигнута) — рисование в OffscreenCanvas
// 2D само по себе на этом iPhone работает. Ломается именно связка
// createImageBitmap(OffscreenCanvas) — судя по всему, эта конкретная
// комбинация (сравнительно новая: OffscreenCanvas в Safari — 16.4+, и не
// каждая API-комбинация с ним одинаково зрело поддержана) на данном
// устройстве не работает, хотя оба API по отдельности существуют.
//
// ИСПРАВЛЕНИЕ: вместо createImageBitmap используем ctx.getImageData() —
// метод Canvas 2D API, существующий и стабильный намного дольше
// OffscreenCanvas, без каких-либо известных проблем именно на этой связке.
// getImageData() возвращает Uint8ClampedArray — чистые байты в обычной
// JS-памяти, НИКАК не привязанные к canvas/GPU backing store (в отличие от
// ImageBitmap, который остаётся canvas/GPU-ресурсом до явного copy).
//
// Критично — почему это ещё и надёжнее самого ImageBitmap-подхода: у
// mediabunny VideoSample для raw pixel data (Uint8Array/ArrayBufferView,
// node_modules/mediabunny/src/sample.ts:478-480) конвертация в настоящий
// WebCodecs VideoFrame СОЗНАТЕЛЬНО ОТКЛАДЫВАЕТСЯ до самого вызова
// toVideoFrame() внутри mediabunny (комментарий авторов библиотеки прямо
// в исходнике, sample.ts:473-477, про известный баг Chromium при
// преждевременной конвертации raw-data в VideoFrame). Для raw ArrayBuffer/
// TypedArray источника WebCodecs КОНСТРУКТОР VideoFrame гарантированно
// (по спецификации) копирует байты синхронно — в отличие от canvas/
// ImageBitmap источника, где spec просит "снимок", но конкретные движки
// могут реализовать это как ленивую ссылку на backing store.
//
// ТРЕТИЙ физический iPhone retest (после разделения AVC probe/real
// processing — сама проблема multiple-decoder-crash решена) показал НОВУЮ
// ошибку: "InvalidStateError: Buffer has no frame" уже НЕ на первом кадре
// (тот защищён getImageData() с самого начала), а на frame=4 — то есть на
// ОБЫЧНОМ кадре, который шёл через СТАРЫЙ путь `new VideoSample(canvas,
// {...})` (canvas-backed, БЕЗ getImageData). Это доказывает: риск "canvas
// backing store истёк до того, как encoder его прочитал" НЕ ограничен
// async-разрывом инициализации энкодера (который существует только для
// самого первого кадра) — это ФУНДАМЕНТАЛЬНАЯ уязвимость ЛЮБОГО canvas-
// backed VideoFrame на этом WebKit (вероятно, WebKit не делает eager copy
// пикселей при `new VideoFrame(offscreenCanvas, ...)`, а держит ленивую
// ссылку на canvas backing store, который GC/WebKit может освободить в
// любой момент под memory pressure на мобильном устройстве — не только
// "на первом кадре", а на ЛЮБОМ, когда GC решит сработать).
//
// ИСПРАВЛЕНИЕ: getImageData() применяется теперь КО ВСЕМ кадрам, не только
// первому — единственный путь материализации output-кадра. Дороже
// ImageBitmap-варианта по CPU (RGBA readback на каждый кадр вместо canvas-
// reference), но КАЖДЫЙ output-кадр становится независимым от canvas/GPU
// backing store сразу после отрисовки — тот же безопасный raw-pixel путь,
// что уже подтверждён рабочим для первого кадра. Память не растёт: цикл в
// encodeSegment строго последовательный (await add() перед следующим
// кадром), поэтому одновременно "жив" РОВНО ОДИН raw RGBA буфер
// (720×1280×4 ≈ 3.5 MB) — не очередь из десятков/сотен кадров.
async function createOutputVideoSample(canvas, timestamp, duration, onStage, frameNumber) {
  // forceLog только для первых 10 кадров (задание, раздел 4) — начиная с
  // 11-го эти стадии проходят через обычный throttled console-лимит
  // (MAX_DETAILED_FRAME_LOGS), чтобы не заспамить консоль на длинных клипах.
  const forceLog = frameNumber !== null && frameNumber !== undefined && frameNumber <= 10;
  onStage?.('PIXEL_COPY_START', { forceLog, frameNumber });
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  onStage?.('PIXEL_COPY_DONE', { forceLog, frameNumber });

  return new VideoSample(imageData.data, {
    format: 'RGBA',
    codedWidth: width,
    codedHeight: height,
    timestamp,
    duration
  });
}

// Кодирует один сегмент (PART1 обычная скорость ИЛИ PART2 замедление) в уже
// открытый videoSampleSource, начиная с timestampOffsetSec. speedFactor=2
// растягивает и timestamp, и duration каждого кадра вдвое — то самое
// "замедление 0.5x", физически прошитое в файл, а не playbackRate.
//
// Решение читать источник ВТОРОЙ раз для PART2 (а не клонировать все кадры
// PART1 в память и retiming их) — сознательное упрощение спайка: на 25-сек
// клипе это сотни decoded VideoFrame одновременно, а повторный decode того
// же короткого диапазона дешевле по памяти и проще по коду.
async function encodeSegment({
  videoSampleSink,
  videoSampleSource,
  rangeStart,
  rangeEnd,
  targetWidth,
  targetHeight,
  speedFactor,
  timestampOffsetSec,
  frameIntervalSec,
  signal,
  // TEMP DIAGNOSTICS — см. logStage/MAX_DETAILED_FRAME_LOGS выше. onStage
  // теперь вызывается для КАЖДОГО кадра (не только первого) — currentStage
  // в processTechniqueClip больше не "залипает" на первом кадре, если
  // реальная ошибка происходит на 2-м/10-м/любом другом. frameCounter —
  // общий на весь pipeline (PART1+PART2), чтобы видеть номер кадра, на
  // котором реально упало, а не только "где-то в сегменте".
  onStage,
  frameCounter,
  isFirstSegment
}) {
  let nextAllowedTimestamp = rangeStart;
  let segmentEndSec = timestampOffsetSec;
  let isFirstFrameOfSegment = true;

  for await (const sample of videoSampleSink.samples(rangeStart, rangeEnd)) {
    if (isFirstSegment && isFirstFrameOfSegment) {
      // Получение первого sample из videoSampleSink уже подразумевает, что
      // внутренний WebCodecs VideoDecoder создан и успешно декодировал хотя
      // бы один кадр (mediabunny создаёт/конфигурирует decoder лениво здесь).
      onStage?.('F_DECODER_CREATED', { forceLog: true });
      onStage?.('G_FIRST_FRAME_DECODED', { forceLog: true });
    }
    // sample.close() ВСЕГДА вызывается до любой возможной точки throw
    // (throwIfAborted) ниже — иначе abort() ровно в момент получения
    // нового кадра оставляет его незакрытым (реально пойманная утечка при
    // тестировании: "A VideoSample was garbage collected without first
    // being closed").
    const shouldSkip = frameIntervalSec !== null && sample.timestamp < nextAllowedTimestamp;
    if (!shouldSkip && frameIntervalSec !== null) {
      nextAllowedTimestamp = sample.timestamp + frameIntervalSec;
    }

    const frameNumber = shouldSkip ? null : ++frameCounter.value;
    // Задание, раздел 4: детальная frame-lifecycle диагностика форсированно
    // логируется для первых 10 кадров каждой попытки; дальше — обычный
    // throttled режим (MAX_DETAILED_FRAME_LOGS), чтобы не спамить консоль на
    // длинных клипах.
    const detailedLifecycle = frameNumber !== null && frameNumber <= 10;
    if (!shouldSkip) {
      onStage?.('FRAME_SOURCE_RECEIVED', { forceLog: detailedLifecycle, frameNumber });
    }
    if (!shouldSkip) {
      onStage?.('FRAME_DRAW_START', { forceLog: detailedLifecycle, frameNumber });
    }
    const canvas = shouldSkip ? null : drawSampleToCanvas(sample, targetWidth, targetHeight);
    if (canvas) {
      onStage?.('FRAME_DRAW_DONE', { forceLog: detailedLifecycle, frameNumber });
      onStage?.(`I_FRAME_DRAWN frame=${frameNumber}`, { forceLog: detailedLifecycle, frameNumber });
    }

    // videoSampleSink.samples(rangeStart, ...) отдаёт кадр, АКТИВНЫЙ в момент
    // rangeStart — его собственный sample.timestamp может быть НЕМНОГО МЕНЬШЕ
    // rangeStart, если rangeStart не совпадает точно с границей кадра
    // (реально пойманный баг: source 29.97fps, rangeStart=30 → первый кадр
    // имел timestamp≈29.9966, что давало ОТРИЦАТЕЛЬНЫЙ relativeTimestampSec
    // на самом первом кадре — encoder/muxer интерпретировал это как испорченный
    // огромный timestamp, "Timestamps cannot be smaller than the largest
    // timestamp of the previous GOP"). Зажимаем в 0, а "заезд" (overhang)
    // вычитаем из duration, чтобы следующий кадр стыковался без разрыва/наплыва.
    const rawRelativeSec = sample.timestamp - rangeStart;
    const clampedRelativeSec = Math.max(0, rawRelativeSec);
    const overhangSec = clampedRelativeSec - rawRelativeSec;
    const adjustedDurationSec = Math.max(0, (sample.duration ?? 0) - overhangSec);

    const relativeTimestampSec = clampedRelativeSec * speedFactor;
    const scaledDurationSec = adjustedDurationSec * speedFactor;

    onStage?.('SOURCE_SAMPLE_CLOSE_START', { forceLog: detailedLifecycle, frameNumber });
    sample.close();
    onStage?.('SOURCE_SAMPLE_CLOSE_DONE', { forceLog: detailedLifecycle, frameNumber });

    throwIfAborted(signal);

    if (shouldSkip) {
      continue;
    }

    // createOutputVideoSample теперь ВСЕГДА материализует независимый raw
    // RGBA pixel buffer через getImageData() — для ВСЕХ output-кадров, не
    // только первого (см. подробный комментарий у createOutputVideoSample
    // выше про третий физический iPhone retest и "Buffer has no frame" на
    // frame=4). isFirstSegment/isFirstFrameOfSegment больше не влияют на
    // выбор пути материализации кадра.
    const outputSample = await createOutputVideoSample(
      canvas,
      timestampOffsetSec + relativeTimestampSec,
      scaledDurationSec,
      onStage,
      frameNumber
    );
    onStage?.('OUTPUT_SAMPLE_CREATED', { forceLog: detailedLifecycle, frameNumber });
    onStage?.(`I5_OUTPUT_SAMPLE_CREATED frame=${frameNumber}`, { forceLog: detailedLifecycle, frameNumber });

    onStage?.(`M1_FRAME_SUBMIT_START frame=${frameNumber}`, { forceLog: detailedLifecycle, frameNumber });
    onStage?.('OUTPUT_ADD_START', { forceLog: detailedLifecycle, frameNumber });
    try {
      await videoSampleSource.add(outputSample);
    } finally {
      outputSample.close();
    }
    onStage?.('OUTPUT_ADD_DONE', { forceLog: detailedLifecycle, frameNumber });
    onStage?.(`M2_FRAME_SUBMIT_DONE frame=${frameNumber}`, { forceLog: detailedLifecycle, frameNumber });
    isFirstFrameOfSegment = false;

    segmentEndSec = timestampOffsetSec + relativeTimestampSec + scaledDurationSec;
    throwIfAborted(signal);
  }

  return segmentEndSec;
}

// sourceFile: File/Blob выбранный тренером локально (никогда не отправляется
// как есть). clipStart/clipDuration — секунды в системе координат
// sourceFile (те же значения, что уже считает videoClipRange.js для Phase 1
// preview). options.signal — AbortSignal для отмены (закрытие модалки
// посередине обработки).
export async function processTechniqueClip(
  { sourceFile, clipStart, clipDuration },
  {
    signal,
    // TEMP DIAGNOSTICS: единственный способ увидеть на физическом iPhone
    // (нет DevTools), какую именно AVC profile/level/hardwareAcceleration
    // комбинацию РЕАЛЬНО (после runtime-проверки, не только preflight)
    // выбрал findWorkingAvcEncoderConfig — вызывается после того, как
    // candidate реально пережил инициализацию encoder и весь PART1.
    // УДАЛИТЬ вместе с остальной TEMP-диагностикой.
    onEncoderConfigSelected,
    // TEMP DIAGNOSTICS: вызывается на КАЖДУЮ попытку candidate (и на
    // preflight-фильтре, и на реальной инициализации) с результатом
    // accepted/rejected — чтобы на физическом iPhone было видно ВСЕ
    // попытки, а не только финальный выбор. УДАЛИТЬ вместе с остальной
    // TEMP-диагностикой.
    onCandidateAttempt,
    // TEMP DIAGNOSTICS: throttled поток ВНУТРЕННИХ стадий (см. комментарий у
    // INTERNAL_STAGE_FRAME_THROTTLE выше) — для persistent-записи в
    // localStorage на стороне модалки (currentStage внутри этой функции —
    // приватное замыкание, снаружи иначе недоступно). Throttling здесь (не
    // просто console.log-лимит выше) — единственный способ пережить
    // возможный crash/reload вкладки и увидеть ТОЧНУЮ последнюю внутреннюю
    // стадию на следующем запуске. УДАЛИТЬ вместе с остальной TEMP-
    // диагностикой.
    onInternalStage
  } = {}
) {
  throwIfAborted(signal);

  // TEMP DIAGNOSTICS: текущая стадия pipeline на момент возможного throw —
  // используется только для прикрепления к ошибке ниже (err.diagnosticStage),
  // сам алгоритм обработки от этой переменной не зависит. forceLog — для
  // редких one-time вех (всегда логируем); per-frame стадии (без forceLog)
  // логируются только первые MAX_DETAILED_FRAME_LOGS раз — currentStage
  // при этом обновляется ВСЕГДА, даже когда console.log уже пропускается,
  // поэтому диагноз ошибки остаётся точным на любом кадре. УДАЛИТЬ вместе с
  // logStage()/frameCounter после подтверждённого фикса на физическом
  // iPhone.
  let currentStage = 'A_INPUT_LOAD';
  // TEMP DIAGNOSTICS: третий физический iPhone retest вскрыл диагностическую
  // (не алгоритмическую) неточность — err.diagnosticStage всегда точен
  // (см. комментарий ниже, currentStage обновляется синхронно на КАЖДЫЙ
  // onStage вызов), а throttled onInternalStage-поток, из которого модалка
  // берёт frameNumber/candidateIndex/codec/hardwareAcceleration/phase для
  // UI, обновляется только на frame=1 и далее раз в
  // INTERNAL_STAGE_FRAME_THROTTLE кадров — на реальном тесте ошибка
  // произошла на frame=4 (currentStage="I_FRAME_DRAWN frame=4"), но UI
  // показал "Frame: 1", т.к. throttled-поток с frame=1 просто не успел ещё
  // обновиться. currentStageMeta — тот же приём, что currentStage, но для
  // МЕТАДАННЫХ (frameNumber+candidateMeta): обновляется синхронно на КАЖДЫЙ
  // onStage вызов, без throttling, и прикрепляется к ошибке как
  // err.diagnosticMeta — модалка теперь может показать однозначный,
  // синхронный с diagnosticStage, номер кадра/candidate вместо устаревшего
  // throttled snapshot.
  let currentStageMeta = {};
  let detailedFrameLogCount = 0;
  const onStage = (stage, { forceLog = false, frameNumber, ...candidateMeta } = {}) => {
    currentStage = stage;
    currentStageMeta = { frameNumber: frameNumber ?? null, ...candidateMeta };
    if (forceLog || detailedFrameLogCount < MAX_DETAILED_FRAME_LOGS) {
      logStage(stage);
      if (!forceLog) {
        detailedFrameLogCount++;
      }
    }

    // Persist только редкие one-time вехи (forceLog/без frameNumber — таких
    // немного) ВСЕГДА, а per-frame стадии — только для frame=1 (самый
    // критичный, там же async-разрыв encoder init) и далее раз в
    // INTERNAL_STAGE_FRAME_THROTTLE кадров — не спамим localStorage.setItem
    // на каждый из сотен кадров длинного клипа. Это throttled-поток ТОЛЬКО
    // для live-отображения "на лету" во время обработки — на случай реальной
    // ошибки точный контекст берётся из err.diagnosticMeta (currentStageMeta
    // выше), а не отсюда.
    const shouldPersist =
      frameNumber === undefined ||
      frameNumber === null ||
      frameNumber === 1 ||
      frameNumber % INTERNAL_STAGE_FRAME_THROTTLE === 0;
    if (shouldPersist) {
      onInternalStage?.(stage, { frameNumber, ...candidateMeta });
    }
  };
  const frameCounter = { value: 0 };
  onStage('A_INPUT_LOAD', { forceLog: true });

  const input = new Input({ source: new BlobSource(sourceFile), formats: ALL_FORMATS });
  let output = null;

  try {
    onStage('B_DEMUX', { forceLog: true });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new VideoProcessingUnsupportedError('no_video_track');
    }
    onStage('C_VIDEO_TRACK_FOUND', { forceLog: true });

    // Задание: "не предполагать декодируемость — использовать
    // VideoDecoder.isConfigSupported() или эквивалент". canDecode() —
    // эквивалент из mediabunny, учитывающий реальный codec string трека
    // (включая случаи типа iPhone HEVC/MOV).
    onStage('D_CODEC_CONFIG', { forceLog: true });
    const canDecode = await videoTrack.canDecode();
    if (!canDecode) {
      throw new VideoProcessingUnsupportedError('cannot_decode');
    }
    onStage('E_CAN_DECODE', { forceLog: true });

    const displayWidth = await videoTrack.getDisplayWidth();
    const displayHeight = await videoTrack.getDisplayHeight();
    const { width: targetWidth, height: targetHeight } = computeTargetDimensions(displayWidth, displayHeight);

    const quality = new Quality({ bitrate: TARGET_VIDEO_BITRATE_BPS });

    // Кэп 30fps применяется ТОЛЬКО если источник реально быстрее —
    // избегаем бессмысленного upsampling источников с более низким fps.
    // Посчитано ДО выбора encoder config, т.к. реальный
    // macroblocks/секунду лимит H.264-уровня зависит от итогового fps
    // (см. комментарий у REAL_AVC_LEVEL_TABLE выше).
    const frameRateMetrics = await videoTrack.computeFrameRateMetrics();
    const frameIntervalSec = frameRateMetrics.bestGuessFrameRate > MAX_FRAME_RATE ? 1 / MAX_FRAME_RATE : null;
    const outputFramerateHz = Math.min(frameRateMetrics.bestGuessFrameRate, MAX_FRAME_RATE);

    const clipEnd = clipStart + clipDuration;
    const videoSampleSink = new VideoSampleSink(videoTrack);

    // Задание: аналогично, проверка на стороне энкодера, а не только
    // декодера — некоторые браузеры/устройства декодируют, но не умеют
    // кодировать H.264 на нужном разрешении. RUNTIME CANDIDATE FALLBACK
    // (см. подробный комментарий у findWorkingAvcEncoderConfig выше) —
    // isConfigSupported() сам по себе оказался недостаточен на физическом
    // iPhone (preflight PASS, реальная инициализация FAIL): здесь для
    // каждого candidate реально инициализируется encoder и кодируется весь
    // PART1, прежде чем считать candidate финальным выбором. Первый
    // candidate, реально переживший PART1, используется дальше и для PART2.
    const {
      candidate: selectedEncoderConfig,
      output: workingOutput,
      videoSampleSource,
      part1EndSec
    } = await findWorkingAvcEncoderConfig({
      width: targetWidth,
      height: targetHeight,
      bitrateBps: TARGET_VIDEO_BITRATE_BPS,
      framerateHz: outputFramerateHz,
      signal,
      quality,
      videoSampleSink,
      clipStart,
      clipEnd,
      frameIntervalSec,
      onStage,
      frameCounter,
      onCandidateAttempt
    });
    output = workingOutput;

    onEncoderConfigSelected?.({
      fullCodecString: selectedEncoderConfig.fullCodecString,
      profileName: selectedEncoderConfig.profileName,
      hardwareAcceleration: selectedEncoderConfig.hardwareAcceleration,
      width: targetWidth,
      height: targetHeight,
      bitrateBps: TARGET_VIDEO_BITRATE_BPS,
      framerateHz: outputFramerateHz
    });
    onStage('O_NORMAL_SEGMENT_COMPLETE', { forceLog: true });

    throwIfAborted(signal);

    await encodeSegment({
      videoSampleSink,
      videoSampleSource,
      rangeStart: clipStart,
      rangeEnd: clipEnd,
      targetWidth,
      targetHeight,
      speedFactor: 2,
      timestampOffsetSec: part1EndSec,
      frameIntervalSec,
      signal,
      onStage,
      frameCounter,
      isFirstSegment: false
    });
    onStage('P_SLOW_SEGMENT_COMPLETE', { forceLog: true });

    onStage('Q_FINALIZE', { forceLog: true });
    await output.finalize();

    const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
    onStage('R_OUTPUT_BLOB_CREATED', { forceLog: true });
    return blob;
  } catch (err) {
    // TEMP DIAGNOSTICS: раньше исходная ошибка (name/message/stack) нигде не
    // логировалась — в MarkTechniqueCompletedModal она всегда превращалась в
    // generic 'videoProcessingFailed', и на физическом устройстве без
    // DevTools узнать точную причину было невозможно. err.diagnosticStage
    // прокидывается наверх для временного отображения в UI (см. модалку).
    console.error('[clip-processing] FAILED at stage', currentStage, {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
      cause: err?.cause
    });
    try {
      err.diagnosticStage = currentStage;
      err.diagnosticMeta = currentStageMeta;
    } catch {
      // некоторые значения (напр. строки/примитивы, брошенные не через Error)
      // нельзя аннотировать доп. свойством — не критично для диагностики
    }

    if (output) {
      try {
        await output.cancel();
      } catch {
        // best-effort — исходная ошибка/отмена важнее, не маскируем её
      }
    }
    throw err;
  } finally {
    input.dispose();
  }
}
