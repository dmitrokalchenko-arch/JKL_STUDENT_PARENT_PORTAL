import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentFamilyChildren } from '../services/familyDataService.js';
import { useFamilySession } from './useFamilySession.js';
import { isSupabaseConfigured } from '../services/supabaseClient.js';

const EMPTY_FAMILY = { id: null, displayName: '' };

export function useFamilyData() {
  const { isAuthenticated } = useFamilySession();
  // В mock-режиме (Supabase не настроен) сессии не существует вовсе —
  // загружаем mock-fallback всегда. В реальном режиме — только если есть
  // подтверждённая authenticated-сессия (иначе RPC не вызывается вовсе).
  const shouldLoad = !isSupabaseConfigured || isAuthenticated;

  // isAuthenticated возвращается наружу (см. return ниже) СПЕЦИАЛЬНО для
  // того, чтобы у вызывающего кода (FamilyDashboard) был РОВНО ОДИН
  // источник правды об auth-статусе, синхронизированный с loading/children
  // здесь же — НЕ вызывать useFamilySession() ещё раз отдельно в
  // FamilyDashboard (см. PRODUCTION BUG FIX ниже, найденный при реальном
  // production-инциденте).

  const [family, setFamily] = useState(EMPTY_FAMILY);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(shouldLoad);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    if (!shouldLoad) {
      // Нет активной сессии — не вызываем RPC. Сбрасываем данные
      // предыдущей семьи (logout / session disappearance).
      requestIdRef.current += 1;
      setFamily(EMPTY_FAMILY);
      setChildren([]);
      setError(null);
      setLoading(false);
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    let isCancelled = false;

    setLoading(true);
    setError(null);

    getCurrentFamilyChildren()
      .then((result) => {
        if (!isCancelled && requestIdRef.current === requestId) {
          setFamily(result.family);
          setChildren(result.children);
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

  return { family, children, loading, error, reload: load, isAuthenticated };
}
