import { useEffect, useState } from 'react';
import { getTrainerSession, onTrainerAuthStateChange } from '../services/trainerAuthService.js';
import { isSupabaseConfigured } from '../services/supabaseClient.js';

export function useTrainerSession() {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return undefined;
    }

    let isMounted = true;

    getTrainerSession()
      .then((restoredSession) => {
        if (isMounted) setSession(restoredSession);
      })
      .catch(() => {
        if (isMounted) setSession(null);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    const subscription = onTrainerAuthStateChange((nextSession) => {
      if (isMounted) setSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, isLoading, isAuthenticated: Boolean(session) };
}
