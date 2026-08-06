import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentTrainerGroups } from '../services/trainerGroupsService.js';

// Мирроит useTrainerProfile.js/useTechniqueProgress.js — request-id отмена
// устаревших ответов, loading/error/data состояния.
export function useTrainerGroups() {
  const [groups, setGroups] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    getCurrentTrainerGroups()
      .then((result) => {
        if (requestIdRef.current === requestId) {
          setGroups(result);
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

  return { groups, isLoading, error, refetch: load };
}
