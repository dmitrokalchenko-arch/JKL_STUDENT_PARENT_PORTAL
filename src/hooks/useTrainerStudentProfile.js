import { useCallback, useEffect, useRef, useState } from 'react';
import { getTrainerStudentById } from '../services/trainerStudentsService.js';

// Мирроит useTrainerWriteContext.js/useJudoTechniques.js — request-id
// отмена устаревших ответов, загружается один раз на смену studentId.
// Нужен ТОЛЬКО для отображения "Ученик: Фамилия Имя" в модалке
// подтверждения выполнения техники (задание, этап 13) — больше нигде на
// TrainerStudentPage имя/фамилия ученика сегодня не загружены.
export function useTrainerStudentProfile(studentId) {
  const [student, setStudent] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    getTrainerStudentById(studentId)
      .then((result) => {
        if (requestIdRef.current === requestId) {
          setStudent(result);
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
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  return { student, isLoading, error };
}
