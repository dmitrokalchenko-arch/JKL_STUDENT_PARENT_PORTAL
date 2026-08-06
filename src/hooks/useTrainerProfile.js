import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentTrainerProfile } from '../services/trainerProfileService.js';

// shouldLoad управляется вызывающим компонентом (TrainerAuthGuard) —
// профиль запрашивается только когда есть подтверждённая тренерская
// сессия, не раньше.
export function useTrainerProfile(shouldLoad) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(shouldLoad);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    if (!shouldLoad) {
      requestIdRef.current += 1;
      setProfile(null);
      setError(null);
      setLoading(false);
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    let isCancelled = false;

    setLoading(true);
    setError(null);

    getCurrentTrainerProfile()
      .then((result) => {
        if (!isCancelled && requestIdRef.current === requestId) {
          setProfile(result);
        }
      })
      .catch((err) => {
        if (!isCancelled && requestIdRef.current === requestId) {
          setError(err);
        }
      })
      .finally(() => {
        if (!isCancelled && requestIdRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [shouldLoad]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load]);

  return { profile, loading, error, reload: load };
}
