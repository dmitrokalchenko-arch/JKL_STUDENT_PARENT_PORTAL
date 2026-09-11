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

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new VideoProcessingCanceledError();
  }
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

// Заменяет старую mediabunny canEncodeVideo(): та молча доверяет ЕДИНСТВЕННОМУ
// жёстко подобранному codec string (см. комментарий выше) — здесь же
// реально перебираем кандидатов и берём первый, который нативный
// VideoEncoder.isConfigSupported() подтверждает на ЭТОМ конкретном
// устройстве/браузере.
async function selectAvcEncoderConfig({ width, height, bitrateBps, framerateHz, signal }) {
  if (typeof VideoEncoder === 'undefined') {
    throw new VideoProcessingUnsupportedError('cannot_encode');
  }

  const candidates = buildAvcEncoderCandidates({ width, height, bitrateBps, framerateHz });

  for (const candidate of candidates) {
    throwIfAborted(signal);
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: candidate.fullCodecString,
        width,
        height,
        bitrate: bitrateBps,
        framerate: framerateHz,
        hardwareAcceleration: candidate.hardwareAcceleration
      });
      if (support.supported) {
        return candidate;
      }
    } catch {
      // Некорректная/неизвестная для этого движка комбинация — пробуем
      // следующего кандидата, как и раньше делала сама mediabunny.
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
  // TEMP DIAGNOSTICS — см. logStage выше; onStage вызывается только для
  // самого первого сегмента/первого кадра всего pipeline (isFirstSegment),
  // чтобы не засорять console на каждый из сотен кадров.
  onStage,
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
      onStage?.('F_DECODER_CREATED');
      onStage?.('G_FIRST_FRAME_DECODED');
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

    const canvas = shouldSkip ? null : drawSampleToCanvas(sample, targetWidth, targetHeight);
    if (isFirstSegment && isFirstFrameOfSegment && canvas) {
      onStage?.('H_CANVAS_CREATED');
      onStage?.('I_FIRST_FRAME_DRAWN');
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
    sample.close();

    throwIfAborted(signal);

    if (shouldSkip) {
      continue;
    }

    const outputSample = new VideoSample(canvas, {
      timestamp: timestampOffsetSec + relativeTimestampSec,
      duration: scaledDurationSec
    });

    if (isFirstSegment && isFirstFrameOfSegment) {
      onStage?.('J_ENCODER_CONFIG_CREATED');
    }

    try {
      await videoSampleSource.add(outputSample);
    } finally {
      outputSample.close();
    }

    if (isFirstSegment && isFirstFrameOfSegment) {
      // videoSampleSource.add() лениво конфигурирует и создаёт реальный
      // WebCodecs VideoEncoder на первый вызов (mediabunny) — успешное
      // разрешение промиса выше означает encoder создан И кадр закодирован.
      onStage?.('L_ENCODER_CREATED');
      onStage?.('M_FIRST_FRAME_ENCODED');
    }
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
    // комбинацию реально выбрал selectAvcEncoderConfig — вызывается сразу
    // после выбора, НЕЗАВИСИМО от того, успешно ли завершится обработка
    // дальше. УДАЛИТЬ вместе с остальной TEMP-диагностикой.
    onEncoderConfigSelected
  } = {}
) {
  throwIfAborted(signal);

  // TEMP DIAGNOSTICS: текущая стадия pipeline на момент возможного throw —
  // используется только для прикрепления к ошибке ниже (err.diagnosticStage),
  // сам алгоритм обработки от этой переменной не зависит. УДАЛИТЬ вместе с
  // logStage() после подтверждённого фикса на физическом iPhone.
  let currentStage = 'A_INPUT_LOAD';
  const onStage = (stage) => {
    currentStage = stage;
    logStage(stage);
  };
  onStage('A_INPUT_LOAD');

  const input = new Input({ source: new BlobSource(sourceFile), formats: ALL_FORMATS });
  let output = null;

  try {
    onStage('B_DEMUX');
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new VideoProcessingUnsupportedError('no_video_track');
    }
    onStage('C_VIDEO_TRACK_FOUND');

    // Задание: "не предполагать декодируемость — использовать
    // VideoDecoder.isConfigSupported() или эквивалент". canDecode() —
    // эквивалент из mediabunny, учитывающий реальный codec string трека
    // (включая случаи типа iPhone HEVC/MOV).
    onStage('D_CODEC_CONFIG');
    const canDecode = await videoTrack.canDecode();
    if (!canDecode) {
      throw new VideoProcessingUnsupportedError('cannot_decode');
    }
    onStage('E_CAN_DECODE');

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

    // Задание: аналогично, проверка на стороне энкодера, а не только
    // декодера — некоторые браузеры/устройства декодируют, но не умеют
    // кодировать H.264 на нужном разрешении. Заменяет старый mediabunny
    // canEncodeVideo() (см. подробный комментарий у selectAvcEncoderConfig
    // выше — единственный жёстко подобранный codec string не прошёл
    // реальную проверку на физическом iPhone).
    const selectedEncoderConfig = await selectAvcEncoderConfig({
      width: targetWidth,
      height: targetHeight,
      bitrateBps: TARGET_VIDEO_BITRATE_BPS,
      framerateHz: outputFramerateHz,
      signal
    });
    onEncoderConfigSelected?.({
      fullCodecString: selectedEncoderConfig.fullCodecString,
      profileName: selectedEncoderConfig.profileName,
      hardwareAcceleration: selectedEncoderConfig.hardwareAcceleration,
      width: targetWidth,
      height: targetHeight,
      bitrateBps: TARGET_VIDEO_BITRATE_BPS,
      framerateHz: outputFramerateHz
    });
    logStage(
      `K_CAN_ENCODE selected=${selectedEncoderConfig.fullCodecString} hwAccel=${selectedEncoderConfig.hardwareAcceleration}`
    );
    onStage('K_CAN_ENCODE');

    throwIfAborted(signal);

    const clipEnd = clipStart + clipDuration;

    output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const videoSampleSource = new VideoSampleSource({
      codec: OUTPUT_VIDEO_CODEC,
      quality,
      fullCodecString: selectedEncoderConfig.fullCodecString,
      hardwareAcceleration: selectedEncoderConfig.hardwareAcceleration
    });
    output.addVideoTrack(videoSampleSource);
    await output.start();
    onStage('N_MUX_START');

    const videoSampleSink = new VideoSampleSink(videoTrack);

    const part1EndSec = await encodeSegment({
      videoSampleSink,
      videoSampleSource,
      rangeStart: clipStart,
      rangeEnd: clipEnd,
      targetWidth,
      targetHeight,
      speedFactor: 1,
      timestampOffsetSec: 0,
      frameIntervalSec,
      signal,
      onStage,
      isFirstSegment: true
    });
    onStage('O_NORMAL_SEGMENT_COMPLETE');

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
      isFirstSegment: false
    });
    onStage('P_SLOW_SEGMENT_COMPLETE');

    onStage('Q_FINALIZE');
    await output.finalize();

    const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
    onStage('R_OUTPUT_BLOB_CREATED');
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
