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
  Quality,
  canEncodeVideo
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
  signal
}) {
  let nextAllowedTimestamp = rangeStart;
  let segmentEndSec = timestampOffsetSec;

  for await (const sample of videoSampleSink.samples(rangeStart, rangeEnd)) {
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

    try {
      await videoSampleSource.add(outputSample);
    } finally {
      outputSample.close();
    }

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
export async function processTechniqueClip({ sourceFile, clipStart, clipDuration }, { signal } = {}) {
  throwIfAborted(signal);

  const input = new Input({ source: new BlobSource(sourceFile), formats: ALL_FORMATS });
  let output = null;

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new VideoProcessingUnsupportedError('no_video_track');
    }

    // Задание: "не предполагать декодируемость — использовать
    // VideoDecoder.isConfigSupported() или эквивалент". canDecode() —
    // эквивалент из mediabunny, учитывающий реальный codec string трека
    // (включая случаи типа iPhone HEVC/MOV).
    const canDecode = await videoTrack.canDecode();
    if (!canDecode) {
      throw new VideoProcessingUnsupportedError('cannot_decode');
    }

    const displayWidth = await videoTrack.getDisplayWidth();
    const displayHeight = await videoTrack.getDisplayHeight();
    const { width: targetWidth, height: targetHeight } = computeTargetDimensions(displayWidth, displayHeight);

    const quality = new Quality({ bitrate: TARGET_VIDEO_BITRATE_BPS });

    // Задание: аналогично, проверка на стороне энкодера, а не только
    // декодера — некоторые браузеры/устройства декодируют, но не умеют
    // кодировать H.264 на нужном разрешении.
    const canEncode = await canEncodeVideo(OUTPUT_VIDEO_CODEC, {
      width: targetWidth,
      height: targetHeight,
      quality
    });
    if (!canEncode) {
      throw new VideoProcessingUnsupportedError('cannot_encode');
    }

    throwIfAborted(signal);

    // Кэп 30fps применяется ТОЛЬКО если источник реально быстрее —
    // избегаем бессмысленного upsampling источников с более низким fps.
    const frameRateMetrics = await videoTrack.computeFrameRateMetrics();
    const frameIntervalSec = frameRateMetrics.bestGuessFrameRate > MAX_FRAME_RATE ? 1 / MAX_FRAME_RATE : null;

    const clipEnd = clipStart + clipDuration;

    output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const videoSampleSource = new VideoSampleSource({ codec: OUTPUT_VIDEO_CODEC, quality });
    output.addVideoTrack(videoSampleSource);
    await output.start();

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
      signal
    });

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
      signal
    });

    await output.finalize();

    return new Blob([output.target.buffer], { type: 'video/mp4' });
  } catch (err) {
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
