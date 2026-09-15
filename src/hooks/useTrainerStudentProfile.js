import { useCallback, useEffect, useRef, useState } from 'react';
import { getTrainerStudentById } from '../services/trainerStudentsService.js';

// Мирроит useTrainerWriteContext.js/useJudoTechniques.js — request-id
// отмена устаревших ответов, загружается один раз на смену studentId.
// Изначально нужен был ТОЛЬКО для "Ученик: Фамилия Имя" в модалке
// подтверждения выполнения техники — с переводом TrainerStudentPage на
// shared StudentPageContent (accessMode="trainer") это ЕДИНСТВЕННЫЙ
// источник student-пропа страницы, и одновременно единственный реальный
// access-check gate верхнего уровня: get_trainer_student_by_id сам
// вызывает can_trainer_access_student и возвращает 0 строк для чужого/
// недоступного ученика — student===null (без error) здесь и означает
// "доступа нет", а не "данных ещё нет". С миграции 20260915130056
// (TRAINER UNIVERSAL STUDENT PAGE) объект student содержит тот же набор
// полей, что и у Family (sportName/groupName/trainingSchedule/beltLabel/
// contractStatus/age/birthYear) — см. trainerStudentsService.js.
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

  return { student, isLoading, error, reload: load };
}
