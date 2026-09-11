import { useCallback, useState } from 'react';
import { deleteStudentTechniqueRecord, UnmarkTechniqueError } from '../services/studentTechniqueRecordsService.js';
import { deleteStudentVideo } from '../services/studentVideoService.js';

// Мирроит useMarkTechniqueCompleted.js — то же per-row состояние (unmarkingId
// вместо markingId), тот же принцип typed-ошибки с reason, привязанной к
// конкретной записи (не показать ошибку одной строки рядом с другой при
// быстрых повторных кликах). Отдельный хук, не расширение
// useMarkTechniqueCompleted — разные операции (INSERT/DELETE), разный набор
// возможных reason, разный вызывающий компонент (CompletedTechniquesList,
// не JudoTechniquePicker).
//
// ПОРЯДОК ОПЕРАЦИЙ (задание, этап 12 — "сначала проанализировать
// безопасный порядок"): DB-запись удаляется ПЕРВОЙ, видео из Storage —
// ПОСЛЕ, best-effort. Почему не наоборот: если сначала удалить видео и
// ТОЛЬКО ПОТОМ запись, а удаление записи по любой причине не пройдёт
// (сеть/RLS), пользователь увидит "выполненную" технику, чья ссылка на
// видео уже ведёт в никуда — сломанное, видимое пользователю состояние.
// В выбранном порядке худший случай — наоборот: DB-запись корректно
// удалена (техника снова "не выполнена", ровно то, что просил пользователь),
// а видео-объект остаётся orphan в Storage — невидимая, безопасная для
// целостности UI утечка, а не видимая порча данных. Ошибка cleanup НЕ
// скрывается (задание: "не скрывать ошибку") — но и не откатывает уже
// корректно выполненную отмену записи, см. videoCleanupWarning ниже.
export function useUnmarkTechniqueCompleted({ onUnmarked }) {
  const [unmarkingId, setUnmarkingId] = useState(null);
  const [error, setError] = useState(null);
  const [videoCleanupWarning, setVideoCleanupWarning] = useState(false);

  const unmarkCompleted = useCallback(
    async (record) => {
      setError(null);
      setVideoCleanupWarning(false);
      setUnmarkingId(record.id);
      try {
        await deleteStudentTechniqueRecord(record.id);
        onUnmarked?.(record.id);

        if (record.studentVideoPath) {
          try {
            await deleteStudentVideo(record.studentVideoPath);
          } catch {
            // Запись уже корректно удалена (см. комментарий выше) — только
            // предупреждение, не блокирует и не откатывает unmark.
            setVideoCleanupWarning(true);
          }
        }
      } catch (err) {
        const reason = err instanceof UnmarkTechniqueError ? err.reason : 'unknown';
        setError({ recordId: record.id, reason });
      } finally {
        setUnmarkingId(null);
      }
    },
    [onUnmarked]
  );

  const clearVideoCleanupWarning = useCallback(() => setVideoCleanupWarning(false), []);

  return { unmarkCompleted, unmarkingId, error, videoCleanupWarning, clearVideoCleanupWarning };
}
