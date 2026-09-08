import { useCallback, useState } from 'react';
import { markStudentTechniqueCompleted, MarkTechniqueError } from '../services/studentTechniqueRecordsService.js';

// Состояние "отметить технику выполненной" для одной страницы ученика.
// markingId — id техники, для которой прямо сейчас идёт INSERT (per-row
// loading state в Picker, не глобальный спиннер на всю страницу — тренер
// может продолжать искать/просматривать видео других техник, пока одна
// сохраняется). error — последняя ошибка ПОСЛЕДНЕЙ попытки, с id техники,
// к которой она относится (чтобы не показать ошибку одной техники рядом с
// другой при быстрых повторных кликах).
export function useMarkTechniqueCompleted({ studentId, writeContext, onCompleted }) {
  const [markingId, setMarkingId] = useState(null);
  const [error, setError] = useState(null);

  const markCompleted = useCallback(
    async (technique) => {
      setError(null);

      // "current trainer cannot be resolved" (задание, этап 8) — не даём
      // даже попытаться, чтобы не отправить заведомо некорректный INSERT
      // (completed_by/club_id не из чего собрать).
      if (!writeContext) {
        setError({ techniqueId: technique.id, reason: 'no_write_context' });
        return;
      }

      setMarkingId(technique.id);
      try {
        const record = await markStudentTechniqueCompleted({
          studentId,
          techniqueId: technique.id,
          clubId: writeContext.clubId,
          trainerRowId: writeContext.trainerRowId
        });
        onCompleted?.(record);
      } catch (err) {
        const reason = err instanceof MarkTechniqueError ? err.reason : 'unknown';
        setError({ techniqueId: technique.id, reason });
      } finally {
        setMarkingId(null);
      }
    },
    [studentId, writeContext, onCompleted]
  );

  const clearError = useCallback(() => setError(null), []);

  return { markCompleted, markingId, error, clearError };
}
