import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import TechniqueThumbnail from './TechniqueThumbnail.jsx';
import { useJudoTechniques } from '../../hooks/useJudoTechniques.js';
import { groupTechniquesByCategory, searchTechniques } from '../../utils/judoTechniques.js';
import styles from './JudoTechniquePicker.module.css';

// Каталог техник дзюдо для Trainer Area — единственный источник данных
// public.judo_techniques (см. этот же файл в отчёте сессии, раздел
// DATA FLOW). Ничего не хардкодится: ни список техник, ни YouTube-ссылки —
// только порядок отображения категорий (CATEGORY_ORDER/MAIN_GROUP_ORDER,
// см. utils/judoTechniques.js), что явно допущено заданием (этап 9).
//
// completedTechniqueIds (Set<string>) — id техник, уже отмеченных ученику
// (student_technique_records), приходит от родителя (TrainerStudentPage),
// который сам их грузит через useStudentTechniqueRecords — Picker ничего
// не знает про студента/прогресс напрямую, только про то, какие id уже
// "выполнены", чтобы показать бейдж вместо кнопки (задание, этап 6).
// onMarkCompleted не вызывается повторно для уже выполненной техники —
// кнопка отметки заменяется бейджем, повторное открытие модалки для уже
// выполненной техники физически недостижимо из UI; видео (каталожное,
// YouTube) при этом остаётся доступным всегда, независимо от
// completed-статуса.
//
// onMarkCompleted теперь ТОЛЬКО открывает модалку подтверждения
// (MarkTechniqueCompletedModal, см. TrainerStudentPage.jsx) — сам INSERT
// больше не происходит по клику здесь (задание: "нажатие больше не должно
// отмечать технику сразу"). Поэтому markingId/markError, которые раньше
// показывали per-row loading/ошибку INSERT прямо в этом списке, больше не
// нужны — вся эта async-логика и её ошибки теперь внутри модалки, не в
// каталоге.
export default function JudoTechniquePicker({ completedTechniqueIds, onMarkCompleted, onPlay }) {
  const { t } = useTranslation();
  const { techniques, isLoading, error, refetch } = useJudoTechniques();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    if (!techniques) return [];
    return groupTechniquesByCategory(searchTechniques(techniques, query));
  }, [techniques, query]);

  const hasAnyTechnique = (techniques?.length ?? 0) > 0;
  const hasVisibleResults = groups.length > 0;

  return (
    <div className={styles.wrap}>
      <label className={styles.searchField}>
        <Icon name="search" size={16} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="search"
          value={query}
          placeholder={t('trainerTechniques.searchPlaceholder')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck="false"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {isLoading && <div className={styles.stateText}>{t('trainerTechniques.loading')}</div>}

      {!isLoading && error && (
        <div className={styles.stateText}>
          {t('trainerTechniques.loadError')}
          <button type="button" className={styles.retryButton} onClick={refetch}>
            {t('trainerGroups.retry')}
          </button>
        </div>
      )}

      {!isLoading && !error && !hasAnyTechnique && (
        <div className={styles.stateText}>{t('trainerTechniques.empty')}</div>
      )}

      {!isLoading && !error && hasAnyTechnique && !hasVisibleResults && (
        <div className={styles.stateText}>{t('trainerTechniques.noResults')}</div>
      )}

      {!isLoading &&
        !error &&
        groups.map(({ mainGroup, categories }) => (
          <div key={mainGroup} className={styles.mainGroup}>
            <h3 className={styles.mainGroupTitle}>{mainGroup}</h3>

            {categories.map(({ category, techniques: categoryTechniques }) => (
              <div key={category} className={styles.category}>
                <div className={styles.categoryTitle}>{category}</div>

                <ul className={styles.list}>
                  {categoryTechniques.map((technique) => {
                    const isCompleted = completedTechniqueIds?.has(technique.id) ?? false;
                    const hasVideo = Boolean(technique.youtube_video_id);

                    return (
                      <li key={technique.id} className={styles.item}>
                        <div className={styles.itemRow}>
                          <TechniqueThumbnail imageUrl={technique.image_url} />

                          <span className={`${styles.techniqueName} ltr-isolate`}>{technique.name}</span>

                          {isCompleted ? (
                            <span className={styles.completedBadge}>
                              <Icon name="check" size={13} />
                              {t('trainerTechniques.completedBadge')}
                            </span>
                          ) : (
                            <button type="button" className={styles.markButton} onClick={() => onMarkCompleted?.(technique)}>
                              {t('trainerTechniques.markCompleted')}
                            </button>
                          )}

                          <button
                            type="button"
                            className={styles.playButton}
                            onClick={() => onPlay?.(technique)}
                            disabled={!hasVideo}
                            aria-label={t('trainerTechniques.watchVideo')}
                            title={t('trainerTechniques.watchVideo')}
                          >
                            <Icon name="play" size={14} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
