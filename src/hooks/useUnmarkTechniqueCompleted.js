import { useCallback, useState } from 'react';
import { deleteStudentTechniqueRecord, UnmarkTechniqueError } from '../services/studentTechniqueRecordsService.js';

// Мирроит useMarkTechniqueCompleted.js — то же per-row состояние (unmarkingId
// вместо markingId), тот же принцип typed-ошибки с reason, привязанной к
// конкретной записи (не показать ошибку одной строки рядом с другой при
// быстрых повторных кликах). Отдельный хук, не расширение
// useMarkTechniqueCompleted — разные операции (INSERT/DELETE), разный набор
// возможных reason, разный вызывающий компонент (CompletedTechniquesList,
// не JudoTechniquePicker).
export function useUnmarkTechniqueCompleted({ onUnmarked }) {
  const [unmarkingId, setUnmarkingId] = useState(null);
  const [error, setError] = useState(null);

  const unmarkCompleted = useCallback(
    async (record) => {
      setError(null);
      setUnmarkingId(record.id);
      try {
        await deleteStudentTechniqueRecord(record.id);
        onUnmarked?.(record.id);
      } catch (err) {
        const reason = err instanceof UnmarkTechniqueError ? err.reason : 'unknown';
        setError({ recordId: record.id, reason });
      } finally {
        setUnmarkingId(null);
      }
    },
    [onUnmarked]
  );

  return { unmarkCompleted, unmarkingId, error };
}
