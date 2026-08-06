import { useCallback, useEffect, useRef, useState } from 'react';
import { getTechniqueProgress } from '../services/techniqueProgressService.js';

export function useTechniqueProgress(studentId) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    if (!studentId) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    // Сразу очищаем данные предыдущего ребёнка — не показываем их поверх
    // загрузки нового, пока не пришёл ответ (иначе на миг видны чужие техники).
    setData(null);
    setIsLoading(true);
    setError(null);

    getTechniqueProgress(studentId)
      .then((result) => {
        if (requestIdRef.current === requestId) {
          setData(result);
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

  return { data, isLoading, error, refetch: load };
}
