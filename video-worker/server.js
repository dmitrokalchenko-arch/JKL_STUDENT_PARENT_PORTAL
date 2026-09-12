import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { existsSync } from 'node:fs';

import { WorkerError } from './errors.js';
import { validateProcessRequestBody } from './validation.js';
import { createTrainerScopedClient, assertTrainerCanAccessStudent } from './supabaseClient.js';
import { buildFinalVideoObjectPath } from './naming.js';
import { runFfmpegPipeline, probeOutputFile } from './ffmpegPipeline.js';

// Задание, раздел 5/6 — bucket-имена. НЕ параметризуемо через .env
// намеренно: это часть security-модели (RLS-политики миграции завязаны на
// конкретные bucket_id), не окружение.
const TEMP_BUCKET = 'student-technique-video-temp';
const FINAL_BUCKET = 'student-technique-videos';

const app = express();
app.use(express.json({ limit: '1mb' })); // тело запроса — только метаданные, само видео идёт через Storage

// Задание, раздел 18 — health endpoint проверяет, что ffmpeg-бинарник
// реально существует на диске (ffmpeg-static иногда не может скачать
// платформенный бинарник при установке — лучше узнать на /health, чем на
// первом реальном запросе тренера).
app.get('/health', (req, res) => {
  const ffmpegExists = typeof ffmpegPath === 'string' && existsSync(ffmpegPath);
  res.status(ffmpegExists ? 200 : 503).json({ ok: ffmpegExists, ffmpeg: ffmpegExists });
});

app.post('/process-technique-video', async (req, res) => {
  let localInputPath = null;
  let localOutputPath = null;
  let workDir = null;
  let trainerClient = null;
  let tempObjectPath = null;

  try {
    const input = validateProcessRequestBody(req.body);
    tempObjectPath = input.tempObjectPath;

    trainerClient = createTrainerScopedClient(req.headers.authorization);

    // Задание, раздел 8: единая, уже существующая точка проверки доступа —
    // не дублируем логику "тренер -> группа -> ученик" вручную.
    await assertTrainerCanAccessStudent(trainerClient, input.studentId);

    // ── Скачивание temp-объекта ────────────────────────────────────────
    workDir = await mkdtemp(path.join(tmpdir(), 'jkl-video-worker-'));
    const inputExt = path.extname(tempObjectPath) || '.mov';
    localInputPath = path.join(workDir, `source${inputExt}`);
    localOutputPath = path.join(workDir, 'output.mp4');

    const { data: downloadData, error: downloadError } = await trainerClient.storage
      .from(TEMP_BUCKET)
      .download(tempObjectPath);

    if (downloadError) {
      // Supabase Storage возвращает generic "not found"-подобную ошибку и
      // для отсутствующего объекта, и для объекта, к которому RLS не даёт
      // доступа (по дизайну — не раскрывать существование чужих объектов).
      // Различить эти два случая с ЭТОЙ стороны API нельзя и не нужно:
      // validation.js уже отверг path, не принадлежащий studentId, ДО
      // этого запроса — если мы всё же дошли сюда и Storage отказал, это
      // либо объект действительно не существует, либо (маловероятно при
      // уже пройденной локальной проверке) какое-то другое несоответствие
      // RLS — в обоих случаях TEMP_OBJECT_NOT_FOUND честно отражает
      // ситуацию клиенту, не намекая на детали чужого доступа.
      throw new WorkerError('TEMP_OBJECT_NOT_FOUND', 'Temporary video object could not be downloaded.');
    }

    const arrayBuffer = await downloadData.arrayBuffer();
    await writeFile(localInputPath, Buffer.from(arrayBuffer));

    // ── ffmpeg pipeline ─────────────────────────────────────────────────
    let pipelineResult;
    try {
      pipelineResult = await runFfmpegPipeline({
        inputPath: localInputPath,
        startSeconds: input.startSeconds,
        durationSeconds: input.durationSeconds,
        outputPath: localOutputPath
      });
    } catch (err) {
      if (err instanceof WorkerError) throw err;
      throw new WorkerError('FFMPEG_FAILED', 'Video processing failed.');
    }

    // ── Output validation (задание, раздел 13) ─────────────────────────
    const outputStat = await stat(localOutputPath).catch(() => null);
    if (!outputStat || outputStat.size <= 0) {
      throw new WorkerError('OUTPUT_VALIDATION_FAILED', 'Output file is missing or empty.');
    }

    const probed = await probeOutputFile(localOutputPath);
    const expectedDurationSeconds = input.durationSeconds * 3; // 1.0x + 0.5x(=2x) сегмент
    const durationTolerance = 1.5; // секунда(ы) допуска на округление GOP/fps
    const durationOk =
      probed.durationSeconds !== null && Math.abs(probed.durationSeconds - expectedDurationSeconds) <= durationTolerance;

    if (!durationOk || !probed.isH264 || probed.hasAudio) {
      throw new WorkerError(
        'OUTPUT_VALIDATION_FAILED',
        'Processed video failed validation (duration/codec/audio mismatch).'
      );
    }

    // ── Final upload ─────────────────────────────────────────────────────
    const finalObjectPath = buildFinalVideoObjectPath({
      studentId: input.studentId,
      lastName: input.lastName,
      techniqueName: input.techniqueName
    });

    const finalFileBuffer = await readFile(localOutputPath);
    const { error: uploadError } = await trainerClient.storage
      .from(FINAL_BUCKET)
      .upload(finalObjectPath, finalFileBuffer, { contentType: 'video/mp4' });

    if (uploadError) {
      throw new WorkerError('FINAL_UPLOAD_FAILED', 'Failed to upload the processed video.');
    }

    // ── Cleanup temp object (задание, раздел 15 — success path) ─────────
    const { error: deleteError } = await trainerClient.storage.from(TEMP_BUCKET).remove([tempObjectPath]);
    if (deleteError) {
      logCleanupWarning(tempObjectPath, deleteError);
    }

    res.status(200).json({
      success: true,
      studentVideoPath: finalObjectPath,
      duration: probed.durationSeconds,
      width: probed.width,
      height: probed.height
    });
  } catch (err) {
    // Задание, раздел 15 — "если processing fail: попытаться удалить temp
    // object тоже". Best-effort, не должен маскировать основную ошибку.
    if (trainerClient && tempObjectPath) {
      try {
        await trainerClient.storage.from(TEMP_BUCKET).remove([tempObjectPath]);
      } catch (cleanupErr) {
        logCleanupWarning(tempObjectPath, cleanupErr);
      }
    }

    const workerError =
      err instanceof WorkerError ? err : new WorkerError('INTERNAL_ERROR', 'Unexpected worker error.');

    // Технические детали — только в server console (задание, раздел 17:
    // "не отдавать stack trace клиенту"). JWT/Authorization header сюда не
    // попадает — err объекты выше (Supabase SDK) не включают заголовки
    // запроса в свой message/toString.
    console.error(`[video-worker] ${workerError.code}:`, err instanceof WorkerError ? err.message : err);

    res.status(workerError.httpStatus).json({ success: false, code: workerError.code, message: workerError.message });
  } finally {
    // Задание, раздел 10 — "локальные temp-файлы обязательно удалить в
    // finally" — весь workDir целиком (input+output), независимо от
    // success/fail.
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {
        console.warn('[video-worker] failed to remove local temp dir', workDir);
      });
    }
  }
});

function logCleanupWarning(objectPath, error) {
  console.warn('[video-worker] CLEANUP_WARNING: failed to delete temp object', objectPath, error?.message ?? error);
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`[video-worker] listening on http://localhost:${port} (local only, not deployed)`);
});
