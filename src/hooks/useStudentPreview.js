import { useEffect, useRef, useState } from 'react';
import { getStudentPreview } from '../services/studentPreviewService.js';

// Токен одноразовый — запрос должен уйти РОВНО ОДИН РАЗ за время жизни
// этой страницы, поэтому здесь намеренно НЕТ refetch/retry: повторный
// вызов с тем же token на сервере уже всегда вернёт invalid_or_expired_token
// (см. get-student-preview). React StrictMode/повторный рендер защищён
// requestIdRef + флагом "уже отправляли" — эффект не должен вызвать fetch
// дважды для одного token.
export function useStudentPreview(token) {
  const [student, setStudent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestedTokenRef = useRef(null);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      setError(new Error('missing_token'));
      return;
    }

    if (requestedTokenRef.current === token) return;
    requestedTokenRef.current = token;

    setIsLoading(true);
    setError(null);

    getStudentPreview(token)
      .then((result) => setStudent(result))
      .catch((err) => setError(err))
      .finally(() => {
        setIsLoading(false);
        // SECURITY PRE-DEPLOY REVIEW: токен одноразовый и уже потреблён
        // сервером к этому моменту (успешно или нет) — не должен оставаться
        // в адресной строке/истории браузера дольше одного запроса.
        // Обновление страницы после этого ожидаемо покажет
        // invalid_or_expired_token — это нормально для одноразового preview.
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          window.history.replaceState(null, '', '/admin-preview/');
        }
      });
  }, [token]);

  return { student, isLoading, error };
}
