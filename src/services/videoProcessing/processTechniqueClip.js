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

// Заменяет старую mediabunny canEncodeVideo() (и наш прежний
// selectAvcEncoderConfig(), который останавливался на первом
// isConfigSupported()===true и БЕЗ реальной проверки объявлял его финальным
// выбором — именно это и подвело на физическом iPhone, см. комментарий
// выше). Для каждого candidate: сначала дешёвый статический фильтр
// (isConfigSupported), затем — только если он пройден — РЕАЛЬНАЯ попытка
// инициализировать encoder и закодировать весь PART1 (обычная скорость).
// Первый candidate, который реально прошёл ОБА этапа, используется дальше
// для PART2 (там encoder уже инициализирован, повторный отказ невозможен
// — см. комментарий у createOutputVideoSample/encodeSegment).
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

  for (const candidate of candidates) {
    throwIfAborted(signal);

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

    let firstEncodedChunkSeen = false;
    const attemptOutput = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const attemptSource = new VideoSampleSource({
      codec: OUTPUT_VIDEO_CODEC,
      quality,
      fullCodecString: candidate.fullCodecString,
      hardwareAcceleration: candidate.hardwareAcceleration,
      onEncoderConfig: () => onStage('L_ENCODER_READY', { forceLog: true }),
      onEncodedPacket: () => {
        if (!firstEncodedChunkSeen) {
          firstEncodedChunkSeen = true;
          onStage('M3_FIRST_ENCODED_CHUNK', { forceLog: true });
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
        onStage,
        frameCounter,
        isFirstSegment: true
      });

      onCandidateAttempt?.({ ...candidate, stage: 'runtime', result: 'accepted' });
      onStage(
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
      // Иначе — этот candidate реально не поддержан устройством, пробуем
      // следующего.
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
// Targeted fix: ТОЛЬКО для этого единственного самого первого кадра
// материализуем НЕЗАВИСИМЫЙ ImageBitmap (createImageBitmap гарантированно,
// по спецификации, копирует/владеет собственным bitmap, не завязанным на
// жизненный цикл исходного canvas) и строим VideoSample из него, а не из
// canvas напрямую. Один createImageBitmap() на весь клип (не на каждый
// кадр) — сознательно не платим этой ценой за остальные ~sotни кадров, где
// такого async-разрыва нет и риска нет.
async function createOutputVideoSample(canvas, timestamp, duration, needsIndependentBitmap) {
  if (!needsIndependentBitmap) {
    return new VideoSample(canvas, { timestamp, duration });
  }

  const bitmap = await createImageBitmap(canvas);
  try {
    return new VideoSample(bitmap, { timestamp, duration });
  } finally {
    bitmap.close();
  }
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

    const canvas = shouldSkip ? null : drawSampleToCanvas(sample, targetWidth, targetHeight);
    const frameNumber = shouldSkip ? null : ++frameCounter.value;
    if (canvas) {
      onStage?.(`I_FRAME_DRAWN frame=${frameNumber}`);
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

    // needsIndependentBitmap: ТОЛЬКО самый первый кадр, отправляемый в
    // videoSampleSource.add() за весь pipeline (PART1, 1-й кадр) — см.
    // подробный комментарий у createOutputVideoSample выше. Для PART2
    // isFirstSegment=false всегда, поэтому там ветка не сработает (encoder
    // к этому моменту уже инициализирован из PART1, async-разрыва нет).
    const isVeryFirstPipelineFrame = isFirstSegment && isFirstFrameOfSegment;
    const outputSample = await createOutputVideoSample(
      canvas,
      timestampOffsetSec + relativeTimestampSec,
      scaledDurationSec,
      isVeryFirstPipelineFrame
    );
    onStage?.(`I2_OUTPUT_SAMPLE_CREATED frame=${frameNumber}`);

    onStage?.(`M1_FRAME_SUBMIT_START frame=${frameNumber}`);
    try {
      await videoSampleSource.add(outputSample);
    } finally {
      outputSample.close();
    }
    onStage?.(`M2_FRAME_SUBMIT_DONE frame=${frameNumber}`);
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
    onCandidateAttempt
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
  let detailedFrameLogCount = 0;
  const onStage = (stage, { forceLog = false } = {}) => {
    currentStage = stage;
    if (forceLog || detailedFrameLogCount < MAX_DETAILED_FRAME_LOGS) {
      logStage(stage);
      if (!forceLog) {
        detailedFrameLogCount++;
      }
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
