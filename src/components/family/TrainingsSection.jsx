import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import { formatDate } from '../../utils/formatters.js';
import styles from './TrainingsSection.module.css';

export default function TrainingsSection({ trainings }) {
  const { t, i18n } = useTranslation();

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <h2 className={styles.title}>{t('trainings.upcomingTitle')}</h2>
        <button type="button" className={styles.showAll}>
          {t('common.showAll')} <Icon name="arrowRight" size={14} />
        </button>
      </div>

      {(!trainings || trainings.length === 0) && (
        <div className={styles.empty}>{t('trainings.empty')}</div>
      )}

      <div className={styles.list}>
        {trainings?.map((training) => (
          <div key={training.id} className={styles.row}>
            <div className={styles.dateBlock}>
              <Icon name="calendar" size={16} />
              <div>
                <div className={styles.date}>
                  {formatDate(training.date, i18n.language, { weekday: 'short', day: 'numeric', month: 'long' })}
                </div>
                <div className={`${styles.time} ltr-isolate`}>{training.startTime} – {training.endTime}</div>
              </div>
            </div>

            <div className={styles.groupBlock}>
              <div>{t(training.groupKey)}</div>
              <div className={styles.trainer}>{t('trainings.trainerLabel', { name: training.trainer })}</div>
            </div>

            <div className={styles.roomBlock}>
              <Icon name="pin" size={14} />
              {t('trainings.room', { number: training.roomNumber })}
            </div>

            <button type="button" className={styles.statusButton}>
              {t(training.enrolled ? 'statuses.enrolled' : 'statuses.register')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
