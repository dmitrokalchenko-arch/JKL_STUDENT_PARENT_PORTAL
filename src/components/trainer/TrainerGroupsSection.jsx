import { useTranslation } from 'react-i18next';
import TrainerGroupCard from './TrainerGroupCard.jsx';
import styles from './TrainerGroupsSection.module.css';

export default function TrainerGroupsSection({ groups, isLoading, error, onRetry }) {
  const { t } = useTranslation();

  if (error) {
    return (
      <div className={styles.stateBox}>
        <div className={styles.stateText}>{t('trainerGroups.loadError')}</div>
        <button type="button" className={styles.retryButton} onClick={onRetry}>
          {t('trainerGroups.retry')}
        </button>
      </div>
    );
  }

  if (isLoading || groups === null) {
    return (
      <div className={styles.stateBox}>
        <div className={styles.stateText}>{t('trainerGroups.loading')}</div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className={styles.stateBox}>
        <div className={styles.stateText}>{t('trainerGroups.empty')}</div>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {groups.map((group) => (
        <TrainerGroupCard key={group.id} group={group} />
      ))}
    </div>
  );
}
