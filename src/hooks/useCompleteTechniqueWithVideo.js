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
export function useCompleteTechniqueWithVideo({ studentId, writeContext, onCompleted }) {
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

      let uploadedPath = null;
      try {
        const { path } = await uploadStudentVideo({
          studentId,
          lastName: student?.lastName ?? '',
          techniqueName: technique.name,
          file
        });
        uploadedPath = path;
      } catch (err) {
        setIsSubmitting(false);
        if (err instanceof VideoValidationError) {
          setError({ reason: err.reason }); // 'unsupported_format' | 'too_large'
        } else if (err instanceof VideoUploadError) {
          setError({ reason: 'upload_failed' });
        } else {
          setError({ reason: 'upload_failed' });
        }
        return;
      }

      try {
        const record = await markStudentTechniqueCompleted({
          studentId,
          techniqueId: technique.id,
          clubId: writeContext.clubId,
          trainerRowId: writeContext.trainerRowId,
          studentVideoPath: uploadedPath
        });
        onCompleted?.(record);
      } catch (err) {
        const reason = err instanceof MarkTechniqueError ? err.reason : 'unknown';

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
    [studentId, writeContext, onCompleted]
  );

  const clearError = useCallback(() => setError(null), []);

  return { completeWithVideo, isSubmitting, error, clearError };
}
