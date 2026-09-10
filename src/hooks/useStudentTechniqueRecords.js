import { useCallback, useEffect, useRef, useState } from 'react';
import { getStudentTechniqueRecords } from '../services/studentTechniqueRecordsService.js';

// Мирроит useJudoTechniques.js/useTrainerGroups.js — request-id отмена
// устаревших ответов, loading/error/data состояния. Перезагружается при
// смене studentId (переход между учениками должен сбросить список, не
// показывать прошлого ученика поверх загрузки нового).
export function useStudentTechniqueRecords(studentId) {
  const [records, setRecords] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);
    setRecords(null);

    getStudentTechniqueRecords(studentId)
      .then((result) => {
        if (requestIdRef.current === requestId) {
          setRecords(result);
        }
      })
      .catch((err) => {
        if (requestIdRef.current === requestId) {
          setError(err);
        }
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      });
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  // Локальное обновление после успешного INSERT (ЭТАП 7 — без полного
  // reload/refetch): вызывающий код добавляет новую запись напрямую в уже
  // загрученный список, ровно так, как её вернул INSERT ... select(...).single().
  const addRecordLocally = useCallback((record) => {
    setRecords((prev) => {
      const withoutDuplicate = (prev ?? []).filter((r) => r.techniqueId !== record.techniqueId);
      return [record, ...withoutDuplicate];
    });
  }, []);

  // Симметрично addRecordLocally — после успешного DELETE запись убирается
  // из уже загруженного списка напрямую, без refetch (та же ЭТАП-7 логика,
  // что и у INSERT: completedTechniqueIds в TrainerStudentPage пересчитается
  // автоматически, т.к. зависит от records через useMemo).
  const removeRecordLocally = useCallback((recordId) => {
    setRecords((prev) => (prev ?? []).filter((r) => r.id !== recordId));
  }, []);

  return { records, isLoading, error, refetch: load, addRecordLocally, removeRecordLocally };
}
