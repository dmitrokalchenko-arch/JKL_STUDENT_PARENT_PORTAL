import { useCallback, useEffect, useRef, useState } from 'react';
import { searchTrainerStudents } from '../services/trainerStudentsService.js';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

// Общая логика автодополнения для полей Nachname/Vorname. Debounce +
// request-id отмена устаревших ответов — тот же паттерн, что
// useTechniqueProgress.js/useTrainerGroups.js. Один запрос "в полёте" на
// весь экран (не по полю) — набор в одном поле отменяет ещё не пришедший
// ответ по другому, что и нужно, т.к. подсказки общие для обоих полей.
export function useTrainerStudentSearch() {
  const [nachname, setNachname] = useState('');
  const [vorname, setVorname] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [activeField, setActiveField] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  const closeSuggestions = useCallback(() => {
    clearTimeout(debounceRef.current);
    requestIdRef.current += 1;
    setSuggestions([]);
    setIsLoading(false);
    setError(null);
  }, []);

  const scheduleSearch = useCallback((query, field) => {
    clearTimeout(debounceRef.current);
    setActiveField(field);

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestIdRef.current += 1;
      setSuggestions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);

      searchTrainerStudents(trimmed)
        .then((results) => {
          if (requestIdRef.current === requestId) {
            setSuggestions(results);
          }
        })
        .catch((err) => {
          if (requestIdRef.current === requestId) {
            setError(err);
            setSuggestions([]);
          }
        })
        .finally(() => {
          if (requestIdRef.current === requestId) {
            setIsLoading(false);
          }
        });
    }, DEBOUNCE_MS);
  }, []);

  const handleNachnameChange = useCallback(
    (value) => {
      setNachname(value);
      scheduleSearch(value, 'nachname');
    },
    [scheduleSearch]
  );

  const handleVornameChange = useCallback(
    (value) => {
      setVorname(value);
      scheduleSearch(value, 'vorname');
    },
    [scheduleSearch]
  );

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  return {
    nachname,
    vorname,
    suggestions,
    activeField,
    isLoading,
    error,
    handleNachnameChange,
    handleVornameChange,
    closeSuggestions
  };
}
