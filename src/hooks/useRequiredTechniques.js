import { useCallback, useEffect, useRef, useState } from 'react';

// LAZY-загрузка "Необходимых техник" — RPC вызывается ТОЛЬКО когда
// isActive становится true (т.е. пользователь реально открыл раздел
// «Необходимые техники»), не при монтировании Student Page. loadFn —
// getFamilyRequiredTechniques/getTrainerRequiredTechniques
// (requiredTechniquesService.js), передаётся вызывающей страницей —
// сам хук не знает про accessMode/RPC-имя.
//
// Простой in-page кэш по studentId: пока открыт один и тот же ученик,
// повторное открытие раздела после перехода на другую карточку не
// повторяет RPC (state.studentId === studentId && уже есть data/error).
// При смене studentId (другой ребёнок в ChildSelector/другой ученик у
// тренера) старые data/error/isLoading для предыдущего ученика НИКОГДА не
// возвращаются — hasStudentChanged ниже гарантирует это независимо от
// того, успел ли useEffect уже среагировать на смену studentId.
export function useRequiredTechniques(loadFn, studentId, isActive) {
  const [state, setState] = useState({ studentId: null, data: null, isLoading: false, error: null });
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    if (!studentId) return;
    const requestId = ++requestIdRef.current;
    setState({ studentId, data: null, isLoading: true, error: null });
    loadFn(studentId)
      .then((result) => {
        if (requestIdRef.current === requestId) {
          setState({ studentId, data: result, isLoading: false, error: null });
        }
      })
      .catch((err) => {
        if (requestIdRef.current === requestId) {
          setState({ studentId, data: null, isLoading: false, error: err });
        }
      });
  }, [loadFn, studentId]);

  useEffect(() => {
    if (!isActive || !studentId) return;
    if (state.studentId === studentId && (state.data !== null || state.error)) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, studentId]);

  const hasStudentChanged = state.studentId !== null && state.studentId !== studentId;

  return {
    data: hasStudentChanged ? null : state.data,
    isLoading: hasStudentChanged ? false : state.isLoading,
    error: hasStudentChanged ? null : state.error,
    refetch: load
  };
}
