import { useEffect, useState } from 'react';
import { getFamilySession, onFamilyAuthStateChange } from '../services/familyAuthService.js';
import { isSupabaseConfigured } from '../services/supabaseClient.js';

export function useFamilySession() {
  const [session, setSession] = useState(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return undefined;
    }

    let isMounted = true;

    getFamilySession()
      .then((restoredSession) => {
        if (isMounted) setSession(restoredSession);
      })
      .catch(() => {
        if (isMounted) setSession(null);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    const subscription = onFamilyAuthStateChange((nextSession) => {
      if (isMounted) setSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, isLoading, isAuthenticated: Boolean(session) };
}
