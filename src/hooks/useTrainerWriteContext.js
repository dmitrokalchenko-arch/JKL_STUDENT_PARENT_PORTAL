import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentTrainerWriteContext } from '../services/trainerWriteContextService.js';

// Мирроит useTrainerProfile.js/useTrainerGroups.js — request-id отмена
// устаревших ответов, loading/error/data состояния. Загружается один раз
// при монтировании страницы ученика — тот же trainer_row_id/club_id
// переиспользуется для всех последующих "отметить технику" на этой
// странице, не запрашивается заново на каждый клик.
export function useTrainerWriteContext() {
  const [context, setContext] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    getCurrentTrainerWriteContext()
      .then((result) => {
        if (requestIdRef.current === requestId) {
          setContext(result);
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

  return { context, isLoading, error, refetch: load };
}
