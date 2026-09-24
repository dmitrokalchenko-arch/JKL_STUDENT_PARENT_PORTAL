import { useCallback, useEffect, useRef, useState } from 'react';
import { getTrainerStudentBonusPool } from '../services/trainerBonusTechniquesService.js';

// Мирроит useStudentTechniqueRecords.js/useJudoTechniques.js — request-id
// отмена устаревших ответов, loading/error/data состояния. Перезагружается
// при смене studentId (переход между учениками должен сбросить пул, не
// показывать пул прошлого ученика поверх загрузки нового).
export function useTrainerStudentBonusPool(studentId) {
  const [techniques, setTechniques] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    getTrainerStudentBonusPool(studentId)
      .then((result) => {
        if (requestIdRef.current === requestId) {
          setTechniques(result);
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

  return { techniques, isLoading, error, refetch: load };
}
