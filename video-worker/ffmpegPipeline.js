import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { WorkerError } from './errors.js';

// Те же значения, что client-side processTechniqueClip.js (задание, раздел
// 11/12) — НЕ менять без явного согласования, это одна из инвариант,
// которую задание прямо запрещает трогать в этой итерации.
const MAX_LONG_EDGE_PX = 1280;
const MAX_SHORT_EDGE_PX = 720;
const TARGET_FRAME_RATE = 30;
const TARGET_VIDEO_BITRATE_BPS = 2_500_000;

function runFfmpeg(args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    const timeoutId = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new WorkerError('FFMPEG_FAILED', 'ffmpeg process timed out.'));
    }, timeoutMs);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new WorkerError('FFMPEG_FAILED', `Failed to start ffmpeg: ${err.message}`));
    });
    child.on('close', (exitCode) => {
      clearTimeout(timeoutId);
      resolve({ exitCode, stderr });
    });
  });
}

// Парсит СТАНДАРТНЫЙ человекочитаемый баннер ffmpeg (не ffprobe JSON —
// сознательно НЕ добавляем ffprobe-static как ещё одну зависимость, задание
// раздел 3: "не добавлять лишние библиотеки"; ffmpeg-static уже даёт нам
// весь нужный текст в stderr). Формат баннера стабилен для ТОЧНО той версии
// ffmpeg, которую пакует установленный ffmpeg-static (пиннится в
// package.json) — приемлемый компромисс для v1.
function parseVideoStreamLine(stderrText, { requireBareStreamId }) {
  // Строка вида:
  //   input:  "Stream #0:0[0x1](und): Video: hevc ... 3840x2160 ..."
  //   output: "Stream #0:0: Video: wrapped_avframe ... 2160x3840 ..."
  // requireBareStreamId=true ищет ИМЕННО output-формат (без "[0x..]" после
  // "#0:0") — это единственный надёжный маркер, отличающий OUTPUT-баннер
  // (уже после autorotate/фильтров) от INPUT-баннера (сырые coded pixels).
  const pattern = requireBareStreamId
    ? /Stream #\d+:\d+: Video:.*?(\d{2,5})x(\d{2,5})/
    : /Stream #\d+:\d+\[[^\]]*\][^:]*: Video:.*?(\d{2,5})x(\d{2,5})/;
  const match = stderrText.match(pattern);
  if (!match) {
    return null;
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseHasAudioStream(stderrText, { afterOutputMarker }) {
  const outputIndex = stderrText.indexOf('Output #0');
  const relevant = afterOutputMarker && outputIndex !== -1 ? stderrText.slice(outputIndex) : stderrText;
  return /Stream #\d+:\d+.*?: Audio:/.test(relevant);
}

function parseDurationSeconds(stderrText) {
  const match = stderrText.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const [, hh, mm, ss] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

// Задание, раздел 12: "сначала через ffprobe определить реальные display
// dimensions ПОСЛЕ rotation. Но не нужно вручную transpose." — вместо
// отдельного ffprobe-вызова используем тот факт, что ffmpeg САМ уже
// корректно применяет rotation (Apple Display Matrix side data) внутри
// -filter_complex ДО того, как наши фильтры видят кадры (эмпирически
// подтверждено на реальном IMG_7163.mov в предыдущей итерации — 90°
// rotation, 3840x2160 raw -> 2160x3840 display, БЕЗ явного transpose).
// Здесь — тривиальный "нулевой" -filter_complex проход (0.05с, без
// реального вывода), который заставляет ffmpeg напечатать в stderr POST-
// autorotate Output-баннер с уже скорректированными шириной/высотой.
export async function probeDisplayDimensions(inputPath) {
  const { stderr } = await runFfmpeg(
    ['-y', '-i', inputPath, '-filter_complex', '[0:v]trim=start=0:end=0.05[o]', '-map', '[o]', '-f', 'null', '-'],
    { timeoutMs: 30_000 }
  );

  const dims = parseVideoStreamLine(stderr, { requireBareStreamId: true });
  if (!dims) {
    throw new WorkerError('FFMPEG_FAILED', 'Could not determine display dimensions of the source video.');
  }
  return dims;
}

// Идентичная формула computeTargetDimensions() из
// src/services/videoProcessing/processTechniqueClip.js — сохраняет aspect
// ratio, кэпает длинную/короткую сторону, НИКОГДА не увеличивает (scale<=1),
// округляет до чётных пикселей. Задание, раздел 12 — эти константы/формула
// НЕ меняются.
export function computeTargetDimensions(displayWidth, displayHeight) {
  const longEdge = Math.max(displayWidth, displayHeight);
  const shortEdge = Math.min(displayWidth, displayHeight);
  const scale = Math.min(1, MAX_LONG_EDGE_PX / longEdge, MAX_SHORT_EDGE_PX / shortEdge);

  const toEven = (value) => Math.max(2, Math.round(value / 2) * 2);

  return {
    width: toEven(displayWidth * scale),
    height: toEven(displayHeight * scale)
  };
}

// Задание, раздел 11 — уже проверенный на реальном IMG_7163.mov pipeline:
// trim [start, start+duration] дважды из ОДНОГО прочитанного input-потока
// (ffmpeg декодирует источник один раз, раздаёт кадры в обе filter-ветки) —
// seg1 обычная скорость, seg2 setpts=2*(...) (0.5x slow-motion), concat в
// ОДИН видео-трек. -an убирает звук физически (не просто "не мапим" —
// финальный файл вообще не содержит audio-трека). -movflags +faststart —
// moov atom в начале файла (быстрый старт воспроизведения/скачивания).
// КРИТИЧНО (задание, раздел 11): НЕ передавать -noautorotate — дефолтное
// поведение ffmpeg (autorotate=1) должно остаться включённым, оно уже
// подтверждено рабочим для Apple Display Matrix side data.
export async function runFfmpegPipeline({ inputPath, startSeconds, durationSeconds, outputPath }) {
  const displayDims = await probeDisplayDimensions(inputPath);
  const target = computeTargetDimensions(displayDims.width, displayDims.height);

  const trimEnd = startSeconds + durationSeconds;
  const filterComplex =
    `[0:v]trim=start=${startSeconds}:end=${trimEnd},setpts=PTS-STARTPTS,scale=${target.width}:${target.height},fps=${TARGET_FRAME_RATE}[seg1];` +
    `[0:v]trim=start=${startSeconds}:end=${trimEnd},setpts=2*(PTS-STARTPTS),scale=${target.width}:${target.height},fps=${TARGET_FRAME_RATE}[seg2];` +
    `[seg1][seg2]concat=n=2:v=1:a=0[outv]`;

  const args = [
    '-y',
    '-i', inputPath,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-an',
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', '3.2',
    '-b:v', String(TARGET_VIDEO_BITRATE_BPS),
    '-maxrate', String(TARGET_VIDEO_BITRATE_BPS),
    '-bufsize', String(TARGET_VIDEO_BITRATE_BPS * 2),
    '-pix_fmt', 'yuv420p',
    '-r', String(TARGET_FRAME_RATE),
    '-movflags', '+faststart',
    outputPath
  ];

  const { exitCode, stderr } = await runFfmpeg(args, { timeoutMs: 180_000 });
  if (exitCode !== 0) {
    throw new WorkerError('FFMPEG_FAILED', 'ffmpeg exited with a non-zero code while processing the clip.');
  }

  return { expectedWidth: target.width, expectedHeight: target.height };
}

// Задание, раздел 13 — "OUTPUT VALIDATION": файл существует/size>0
// проверяется вызывающим кодом (fs.stat, до вызова этой функции); здесь —
// codec/duration/resolution/audio через тот же "прочитать stderr баннер"
// приём, применённый к УЖЕ ГОТОВОМУ output-файлу (обычный `ffmpeg -i file`
// без output — печатает Input-баннер этого файла и завершается с
// ожидаемой ошибкой "At least one output file must be specified", которую
// мы игнорируем, нас интересует только stderr текст).
export async function probeOutputFile(outputPath) {
  const { stderr } = await runFfmpeg(['-i', outputPath], { timeoutMs: 30_000 });

  const durationSeconds = parseDurationSeconds(stderr);
  const dims = parseVideoStreamLine(stderr, { requireBareStreamId: false });
  const hasAudio = parseHasAudioStream(stderr, { afterOutputMarker: false });
  const isH264 = /Video:\s*h264/.test(stderr);

  return {
    durationSeconds,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    hasAudio,
    isH264
  };
}
