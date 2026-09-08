import { useCallback, useEffect, useRef, useState } from 'react';
import { getJudoTechniques } from '../services/judoTechniquesService.js';

// Мирроит useTrainerGroups.js/useTechniqueProgress.js — request-id отмена
// устаревших ответов, loading/error/data состояния.
export function useJudoTechniques() {
  const [techniques, setTechniques] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    getJudoTechniques()
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { techniques, isLoading, error, refetch: load };
}
