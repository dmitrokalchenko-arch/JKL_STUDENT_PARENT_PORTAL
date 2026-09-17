import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import TechniqueSelectCard from './TechniqueSelectCard.jsx';
import { groupTechniquesByCategory, searchTechniques } from '../../utils/judoTechniques.js';
import styles from './TrainerKyuTechniqueGrid.module.css';

// Переиспользует ТОЛЬКО существующую группировку/поиск
// (groupTechniquesByCategory/searchTechniques, src/utils/judoTechniques.js)
// и TechniqueSelectCard — сам каталог (все 100 активных техник) грузится
// ОДИН раз родителем (TrainerKyuProgramPage через useJudoTechniques) и не
// зависит от выбранного Kyu; меняется только selectedIds при переключении
// Kyu. query — состояние поиска, специально поднято в родителя (НЕ
// сбрасывается при смене выбранных техник, см. задание раздел 8).
export default function TrainerKyuTechniqueGrid({
  techniques,
  isLoading,
  error,
  onRetry,
  query,
  onQueryChange,
  selectedIds,
  onToggle
}) {
  const { t } = useTranslation();

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
          placeholder={t('trainerKyuProgram.searchPlaceholder')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck="false"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      {isLoading && <div className={styles.stateText}>{t('trainerTechniques.loading')}</div>}

      {!isLoading && error && (
        <div className={styles.stateText}>
          {t('trainerTechniques.loadError')}
          <button type="button" className={styles.retryButton} onClick={onRetry}>
            {t('trainerKyuProgram.retry')}
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

                <div className={styles.grid}>
                  {categoryTechniques.map((technique) => (
                    <TechniqueSelectCard
                      key={technique.id}
                      technique={technique}
                      isSelected={selectedIds.has(technique.id)}
                      onToggle={onToggle}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
