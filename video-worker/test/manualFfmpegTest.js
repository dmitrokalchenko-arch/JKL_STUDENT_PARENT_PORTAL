// Задание, раздел 19/20: локальная проверка ffmpegPipeline.js БЕЗ HTTP и
// БЕЗ Supabase — просто прогон реального файла через пайплайн, руками.
// НЕ debug-эндпоинт, НЕ bypass внутри server.js — отдельный, автономный
// Node-скрипт для разработчика, никак не встроенный в production-код
// worker'а (раздел 19: "лучше unit/integration helper, чем небезопасный
// debug endpoint").
//
// Запуск:
//   node test/manualFfmpegTest.js "C:\path\to\IMG_7163.mov" 2 5
// (аргументы: путь к исходнику, startSeconds, durationSeconds — оба
// опциональны, по умолчанию 2 и 5)
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFfmpegPipeline, probeOutputFile } from '../ffmpegPipeline.js';

const [, , inputPathArg, startArg, durationArg] = process.argv;

if (!inputPathArg) {
  console.error('Usage: node test/manualFfmpegTest.js <input.mov> [startSeconds] [durationSeconds]');
  process.exit(1);
}

const startSeconds = startArg ? Number(startArg) : 2;
const durationSeconds = durationArg ? Number(durationArg) : 5;

const workDir = await mkdtemp(path.join(tmpdir(), 'jkl-video-worker-manual-test-'));
const outputPath = path.join(workDir, 'output.mp4');

console.log(`[manual-test] input=${inputPathArg} start=${startSeconds}s duration=${durationSeconds}s`);
console.log(`[manual-test] output=${outputPath}`);

const t0 = Date.now();
try {
  await runFfmpegPipeline({ inputPath: inputPathArg, startSeconds, durationSeconds, outputPath });
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

  const outputStat = await stat(outputPath);
  const probed = await probeOutputFile(outputPath);

  const expectedDurationSeconds = durationSeconds * 3;
  const durationOk = probed.durationSeconds !== null && Math.abs(probed.durationSeconds - expectedDurationSeconds) <= 1.5;

  console.log('--- RESULT ---');
  console.log('fileSizeBytes:', outputStat.size);
  console.log('durationSeconds:', probed.durationSeconds, durationOk ? '(OK, expected ~' + expectedDurationSeconds + ')' : '(MISMATCH, expected ~' + expectedDurationSeconds + ')');
  console.log('resolution:', `${probed.width}x${probed.height}`);
  console.log('isH264:', probed.isH264);
  console.log('hasAudio:', probed.hasAudio, probed.hasAudio ? '(FAIL — audio must be absent)' : '(OK)');
  console.log('processingTimeSec:', elapsedSec);
  console.log('outputPath (delete manually after inspection):', outputPath);
} catch (err) {
  console.error('[manual-test] FAILED:', err?.code ?? err?.name, err?.message);
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
}
