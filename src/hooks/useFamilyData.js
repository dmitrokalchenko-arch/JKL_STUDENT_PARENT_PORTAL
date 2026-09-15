import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentFamilyChildren } from '../services/familyDataService.js';
import { useFamilySession } from './useFamilySession.js';
import { isSupabaseConfigured } from '../services/supabaseClient.js';

const EMPTY_FAMILY = { id: null, displayName: '' };

// isAuthenticated возвращается наружу (см. return ниже) СПЕЦИАЛЬНО для
// того, чтобы у вызывающего кода (FamilyDashboard) был РОВНО ОДИН
// источник правды об auth-статусе, синхронизированный с loading/children
// здесь же — НЕ вызывать useFamilySession() ещё раз отдельно в
// FamilyDashboard.
//
// ⚠️ ВТОРОЙ PRODUCTION BUG FIX (2026-09-15, реальный повторный инцидент
// ПОСЛЕ первого фикса race condition): одного общего источника
// isAuthenticated оказалось НЕДОСТАТОЧНО. useFamilySession() — это
// САМОСТОЯТЕЛЬНЫЙ хук: при КАЖДОМ новом монтировании (а FamilyDashboard, и
// значит useFamilyData, монтируется заново уже ПОСЛЕ того, как App.jsx —
// СВОИМ отдельным вызовом этого же хука — уже определил isAuthenticated)
// он снова стартует с session=null/isLoading=true и заново асинхронно
// резолвит уже существующую сессию. Раньше `loading` инициализировался
// ОДИН РАЗ через `useState(shouldLoad)` — а на самом первом рендере
// isAuthenticated из ЭТОГО, ещё не резолвившегося экземпляра хука всегда
// false, поэтому shouldLoad=false и loading стартовал как false. Когда
// чуть позже (следующий рендер) isAuthenticated этого же хука наконец
// становился true, React успевал закоммитить рендер с isAuthenticated=true
// И ещё не обновлённым (старым, false) loading — прежде чем эффект,
// реально запускающий загрузку, вообще успевал отработать (эффекты
// выполняются ПОСЛЕ коммита рендера). На этом промежуточном рендере
// isAuthenticated===true && loading===false && children.length===0 —
// ровно то же ложное "семья деактивирована", что и в первом инциденте,
// просто источник гонки теперь внутри одного хука, а не между двумя.
//
// ИСПРАВЛЕНО: loading теперь НЕ хранит "стартовое" значение, вычисленное
// один раз из ещё не резолвившегося shouldLoad — это ПРОИЗВОДНОЕ значение
// (isSessionPending || isFetchInFlight), которое обязано быть true, пока
// не выяснена даже сама сессия (useFamilySession().isLoading), И пока
// реальный fetch данных семьи не завершился. children.length===0 теперь
// достоверно означает "запрос реально завершился и вернул пусто" — а не
// "запрос ещё не начинался", что и требовалось для корректной работы
// isEmptyAfterRealLoad в FamilyDashboard.
export function useFamilyData() {
  const { isAuthenticated, isLoading: isSessionLoading } = useFamilySession();
  // В mock-режиме (Supabase не настроен) сессии не существует вовсе —
  // загружаем mock-fallback всегда. В реальном режиме — только если есть
  // подтверждённая authenticated-сессия (иначе RPC не вызывается вовсе).
  const shouldLoad = !isSupabaseConfigured || isAuthenticated;
  // Сама сессия (auth.uid()) ещё не выяснена этим конкретным экземпляром
  // useFamilySession() — пока это так, окончательного ответа "грузить или
  // нет" у нас в принципе не может быть, поэтому это ТОЖЕ loading.
  const isSessionPending = isSupabaseConfigured && isSessionLoading;

  const [family, setFamily] = useState(EMPTY_FAMILY);
  const [children, setChildren] = useState([]);
  // Изначально ВСЕГДА true — конкретная причина (сессия не выяснена /
  // fetch в процессе) не важна на старте, важно, что мы ТОЧНО ещё не знаем
  // финальный ответ. Единственные места, где это становится false —
  // явные setIsFetchDone(...) ниже, оба ПОСЛЕ реального завершения работы.
  const [isFetchDone, setIsFetchDone] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    if (isSessionPending) {
      // Сессия ещё не выяснена — рано решать, грузить данные или нет.
      // Ничего не трогаем, loading остаётся true через isSessionPending.
      return undefined;
    }

    if (!shouldLoad) {
      // Сессия выяснена окончательно, и её нет — не вызываем RPC.
      // Сбрасываем данные предыдущей семьи (logout / session disappearance).
      requestIdRef.current += 1;
      setFamily(EMPTY_FAMILY);
      setChildren([]);
      setError(null);
      setIsFetchDone(true);
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    let isCancelled = false;

    setIsFetchDone(false);
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
          setIsFetchDone(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [shouldLoad, isSessionPending]);

  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load]);

  const loading = isSessionPending || !isFetchDone;

  return { family, children, loading, error, reload: load, isAuthenticated };
}
