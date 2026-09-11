import { useCallback, useState } from 'react';
import { markStudentTechniqueCompleted, MarkTechniqueError } from '../services/studentTechniqueRecordsService.js';
import {
  uploadStudentVideo,
  deleteStudentVideo,
  VideoValidationError,
  VideoUploadError
} from '../services/studentVideoService.js';

// Оркестрирует ПОЛНЫЙ workflow модалки подтверждения (задание, этап 8):
//   1) upload video в private Storage;
//   2) ТОЛЬКО после успешного upload — INSERT student_technique_records
//      (с student_video_path из шага 1);
//   3) если INSERT не удался — best-effort DELETE только что залитого
//      видео (не оставлять orphan без записи, задание этап 8 п.9) и
//      сообщить об этом отдельно от самой ошибки INSERT (orphanCleanupFailed),
//      не маскируя первичную причину отказа.
// Если upload (шаг 1) не удался — до INSERT дело не доходит вообще,
// completed record НЕ создаётся (задание, этап 8: "Если upload FAILED —
// completed record НЕ создавать").
export function useCompleteTechniqueWithVideo({ studentId, writeContext, onCompleted, onFlowStage }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const completeWithVideo = useCallback(
    async ({ technique, student, file }) => {
      setError(null);

      if (!writeContext) {
        setError({ reason: 'no_write_context' });
        return;
      }
      if (!file) {
        // Защитный дубль проверки, которая уже держит confirm-кнопку
        // disabled в модалке (задание, этап 2: видео обязательно для
        // новых выполнений) — сюда попасть из штатного UI невозможно.
        setError({ reason: 'unsupported_format' });
        return;
      }

      setIsSubmitting(true);

      // TEMP DIAGNOSTICS: физический iPhone Safari retest показал случай,
      // когда после нажатия "Отметить как выполнено" модалка молча
      // закрывается через 1-2 сек БЕЗ видимой ошибки и БЕЗ появления новой
      // записи — ни processingErrorKey, ни error hook'а ничего не
      // показали. Флоу-стадии (onFlowStage) нужны, чтобы точно увидеть, на
      // каком шаге (upload/insert) реально останавливается выполнение —
      // УДАЛИТЬ вместе с остальной TEMP-диагностикой после подтверждённого
      // фикса.
      onFlowStage?.('FLOW_UPLOAD_START');

      let uploadedPath = null;
      try {
        const { path } = await uploadStudentVideo({
          studentId,
          lastName: student?.lastName ?? '',
          techniqueName: technique.name,
          file
        });
        // Защитная проверка: uploadStudentVideo() по коду либо throw, либо
        // возвращает непустой path — но раз мы уже расследуем "тихое
        // исчезновение операции без throw", лучше явно проверить, чем
        // предполагать.
        if (!path) {
          throw new VideoUploadError(new Error('uploadStudentVideo returned empty path without throwing'));
        }
        uploadedPath = path;
      } catch (err) {
        setIsSubmitting(false);
        onFlowStage?.('FLOW_ERROR', { stage: 'upload', name: err?.name, message: err?.message });
        if (err instanceof VideoValidationError) {
          setError({ reason: err.reason }); // 'unsupported_format' | 'too_large'
        } else if (err instanceof VideoUploadError) {
          setError({ reason: 'upload_failed' });
        } else {
          setError({ reason: 'upload_failed' });
        }
        return;
      }
      // НЕ передаём сам uploadedPath дальше в onFlowStage — он содержит
      // studentId и фамилию ученика (см. buildStudentVideoObjectPath:
      // `${studentId}/${фамилия}-${техника}-${id}.ext`), а onFlowStage
      // сохраняется в localStorage (задание: "localStorage не должен
      // хранить student personal data / полный storage path"). Для
      // диагностики достаточно факта "path получен и непустой".
      onFlowStage?.('FLOW_UPLOAD_SUCCESS', { pathReceived: true });

      onFlowStage?.('FLOW_DB_INSERT_START');
      try {
        const record = await markStudentTechniqueCompleted({
          studentId,
          techniqueId: technique.id,
          clubId: writeContext.clubId,
          trainerRowId: writeContext.trainerRowId,
          studentVideoPath: uploadedPath
        });
        // Защитная проверка: markStudentTechniqueCompleted() использует
        // .select(...).single() — Supabase гарантированно возвращает либо
        // error, либо непустую строку; но, как и выше, не предполагаем.
        if (!record || !record.id) {
          throw new MarkTechniqueError('unknown', new Error('markStudentTechniqueCompleted returned no record'));
        }
        onFlowStage?.('FLOW_DB_INSERT_SUCCESS', { recordId: record.id });
        onFlowStage?.('FLOW_REFRESH_START');
        onCompleted?.(record);
        // onCompleted (handleModalCompleted в TrainerStudentPage) синхронно
        // добавляет запись локально И закрывает модалку (setPendingTechnique
        // (null)) — если мы дошли до этой строки без исключения, весь flow
        // успешно завершён.
        onFlowStage?.('FLOW_REFRESH_SUCCESS');
        onFlowStage?.('FLOW_MODAL_CLOSE_SUCCESS');
      } catch (err) {
        const reason = err instanceof MarkTechniqueError ? err.reason : 'unknown';
        onFlowStage?.('FLOW_ERROR', { stage: 'db_insert', name: err?.name, message: err?.message });

        let orphanCleanupFailed = false;
        try {
          await deleteStudentVideo(uploadedPath);
        } catch {
          orphanCleanupFailed = true;
        }

        setError({ reason, orphanCleanupFailed });
      } finally {
        setIsSubmitting(false);
      }
    },
    [studentId, writeContext, onCompleted, onFlowStage]
  );

  const clearError = useCallback(() => setError(null), []);

  return { completeWithVideo, isSubmitting, error, clearError };
}
