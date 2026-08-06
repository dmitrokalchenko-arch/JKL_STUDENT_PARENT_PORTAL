import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../utils/formatters.js';
import { useTrainerStudentSearch } from '../../hooks/useTrainerStudentSearch.js';
import styles from './TrainerStudentSearch.module.css';

// Поиск ученика по Nachname/Vorname с автодополнением, ограниченный
// backend'ом (search_trainer_students, migration 018) группами ТЕКУЩЕГО
// тренера — фронтенд не делает и не может сделать дополнительную фильтрацию
// по группам, вся область видимости уже задана RPC.
//
// Один общий список подсказок под тем полем, где сейчас идёт ввод
// (activeField из useTrainerStudentSearch) — оба поля используют одну и ту
// же функцию поиска (ilike по nachname ИЛИ vorname на бэкенде), так что
// достаточно одного набора результатов, а не двух независимых.
export default function TrainerStudentSearch() {
  const { t, i18n } = useTranslation();
  const containerRef = useRef(null);

  const {
    nachname,
    vorname,
    suggestions,
    activeField,
    isLoading,
    error,
    handleNachnameChange,
    handleVornameChange,
    closeSuggestions
  } = useTrainerStudentSearch();

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        closeSuggestions();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeSuggestions]);

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      closeSuggestions();
    }
  }

  function handleSelect(student) {
    closeSuggestions();
    window.location.href = `/trainer/student/${student.id}`;
  }

  const activeQuery = activeField === 'vorname' ? vorname : nachname;
  const showDropdown = Boolean(activeField) && activeQuery.trim().length >= 2;

  return (
    <div className={styles.wrap} ref={containerRef}>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>{t('trainerStudentSearch.nachnameLabel')}</span>
          <input
            className={styles.input}
            type="search"
            value={nachname}
            placeholder={t('trainerStudentSearch.nachnamePlaceholder')}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck="false"
            onChange={(event) => handleNachnameChange(event.target.value)}
            onFocus={() => handleNachnameChange(nachname)}
            onKeyDown={handleKeyDown}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{t('trainerStudentSearch.vornameLabel')}</span>
          <input
            className={styles.input}
            type="search"
            value={vorname}
            placeholder={t('trainerStudentSearch.vornamePlaceholder')}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck="false"
            onChange={(event) => handleVornameChange(event.target.value)}
            onFocus={() => handleVornameChange(vorname)}
            onKeyDown={handleKeyDown}
          />
        </label>
      </div>

      {showDropdown && (
        <div className={styles.suggestionsBox}>
          {isLoading && <div className={styles.stateText}>{t('common.loading')}</div>}

          {!isLoading && error && <div className={styles.stateText}>{t('trainerStudentSearch.loadError')}</div>}

          {!isLoading && !error && suggestions.length === 0 && (
            <div className={styles.stateText}>{t('trainerStudentSearch.noResults')}</div>
          )}

          {!isLoading &&
            !error &&
            suggestions.map((student) => (
              <button
                type="button"
                key={student.id}
                className={styles.suggestionItem}
                onClick={() => handleSelect(student)}
              >
                <span className={styles.suggestionName}>
                  {student.lastName} {student.firstName}
                </span>
                {student.birthDate && (
                  <span className={styles.suggestionMeta}>
                    {formatDate(student.birthDate, i18n.language, {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    })}
                  </span>
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
