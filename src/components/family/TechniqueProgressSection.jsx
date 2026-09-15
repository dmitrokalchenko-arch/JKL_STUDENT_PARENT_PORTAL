import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TechniqueCard from './TechniqueCard.jsx';
import EmptyTechniqueSlot from './EmptyTechniqueSlot.jsx';
import TechniqueVideoModal from './TechniqueVideoModal.jsx';
import { featureFlags } from '../../config/featureFlags.js';
import { selectTechniqueGroups, getEmptySlotCount } from '../../utils/techniqueProgress.js';
import styles from './TechniqueProgressSection.module.css';

export default function TechniqueProgressSection({ progressData, isLoading, error, onRetry }) {
  const { t } = useTranslation();
  const [selectedTechnique, setSelectedTechnique] = useState(null);

  // Глобальный технический флаг — если выключен, блок не рендерится вовсе,
  // независимо от состояния загрузки данных (сборка полностью отключает модуль).
  if (!featureFlags.techniqueProgress) {
    return null;
  }

  if (error) {
    return (
      <div className={styles.section}>
        <div className={styles.stateText}>{t('techniqueProgress.loadError')}</div>
        {onRetry && (
          <button type="button" className={styles.retryButton} onClick={onRetry}>
            {t('techniqueProgress.retry')}
          </button>
        )}
      </div>
    );
  }

  if (isLoading || !progressData) {
    return (
      <div className={styles.section}>
        <div className={styles.stateText}>{t('techniqueProgress.loading')}</div>
      </div>
    );
  }

  // Клубный уровень двойного feature flag (задел под настройку клуба) —
  // после загрузки данных полностью скрывает блок, если выключен.
  if (!progressData.featureEnabled) {
    return null;
  }

  const { completed, requiredNageWaza, requiredKatameWaza } = selectTechniqueGroups(progressData.techniques);
  // bonusRequirement может отсутствовать (club-scoped настройка ещё не
  // задана этим клубом, см. club_technique_program_settings) — валидное
  // состояние, не ошибка. getEmptySlotCount(x, null) уже безопасно даёт 0
  // (null арифметически ведёт себя как 0), но строку "N из null" в
  // заголовке показывать нельзя — сама bonus-строка скрывается ниже,
  // completed-карточки и required-группы отображаются как обычно.
  const hasBonusRequirement = progressData.bonusRequirement != null;
  const emptySlotCount = hasBonusRequirement ? getEmptySlotCount(completed.length, progressData.bonusRequirement) : 0;
  const hasNoProgram =
    completed.length === 0 && requiredNageWaza.length === 0 && requiredKatameWaza.length === 0;

  if (hasNoProgram) {
    return (
      <div className={styles.section}>
        <div className={styles.headerRow}>
          <h2 className={styles.title}>{t('techniqueProgress.title')}</h2>
        </div>
        <div className={styles.stateText}>{t('techniqueProgress.noProgram')}</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.headerRow}>
        <h2 className={styles.title}>{t('techniqueProgress.title')}</h2>
        {hasBonusRequirement && (
          <div className={styles.bonusProgress}>
            {t('techniqueProgress.bonusProgress', {
              completed: completed.length,
              required: progressData.bonusRequirement
            })}
          </div>
        )}
      </div>

      <div className={styles.cardRow}>
        {completed.map((technique) => (
          <TechniqueCard
            key={technique.id}
            technique={technique}
            variant="completed"
            onClick={setSelectedTechnique}
          />
        ))}
        {Array.from({ length: emptySlotCount }).map((_, index) => (
          <EmptyTechniqueSlot key={`empty-slot-${index}`} />
        ))}
      </div>

      <div className={styles.requiredGroup}>
        <div className={styles.rowTitle}>{t('techniqueProgress.nageWaza')}</div>
        <div className={styles.cardRowSmall}>
          {requiredNageWaza.length === 0 ? (
            <div className={styles.emptyText}>{t('techniqueProgress.noRequiredTechniques')}</div>
          ) : (
            requiredNageWaza.map((technique) => (
              <TechniqueCard key={technique.id} technique={technique} variant="required" />
            ))
          )}
        </div>
      </div>

      <div className={styles.requiredGroup}>
        <div className={styles.rowTitle}>{t('techniqueProgress.katameWaza')}</div>
        <div className={styles.cardRowSmall}>
          {requiredKatameWaza.length === 0 ? (
            <div className={styles.emptyText}>{t('techniqueProgress.noRequiredTechniques')}</div>
          ) : (
            requiredKatameWaza.map((technique) => (
              <TechniqueCard key={technique.id} technique={technique} variant="required" />
            ))
          )}
        </div>
      </div>

      <TechniqueVideoModal technique={selectedTechnique} onClose={() => setSelectedTechnique(null)} />
    </div>
  );
}
