import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import { formatDate } from '../../utils/formatters.js';
import styles from './CompletedTechniquesList.module.css';

// Читает student_technique_records уже с JOIN на judo_techniques (см.
// useStudentTechniqueRecords/studentTechniqueRecordsService) — сам
// компонент не делает никаких дополнительных запросов и не хранит копию
// name/category/main_group/youtube_url/youtube_video_id, только отображает
// то, что пришло через JOIN (задание, этап 5).
//
// Имя тренера, отметившего технику, сознательно НЕ показывается —
// authenticated не имеет grant на прямое чтение public.trainers, а JOIN
// туда потребовал бы либо ослабления текущей RLS-модели, либо доверия
// открытым (не наши, JCL_Gruppen) policy этой чужой таблицы. Задание прямо
// разрешает эту часть временно опустить, а не подрывать безопасность ради
// одного отображаемого поля (этап 5).
export default function CompletedTechniquesList({ records, isLoading, error, onRetry, onPlay }) {
  const { t, i18n } = useTranslation();

  if (isLoading) {
    return <div className={styles.stateText}>{t('common.loading')}</div>;
  }

  if (error) {
    return (
      <div className={styles.stateText}>
        {t('trainerTechniques.completedListLoadError')}
        <button type="button" className={styles.retryButton} onClick={onRetry}>
          {t('trainerGroups.retry')}
        </button>
      </div>
    );
  }

  if (!records || records.length === 0) {
    return <div className={styles.stateText}>{t('trainerTechniques.completedListEmpty')}</div>;
  }

  return (
    <ul className={styles.list}>
      {records.map((record) => {
        // technique === null: строка есть, но JOIN ничего не вернул
        // (задание, этап 8 — "technique_id, который больше не найден") —
        // не должно случаться на практике (on delete restrict), но UI не
        // должен упасть, если всё же случится.
        if (!record.technique) {
          return (
            <li key={record.id} className={styles.card}>
              <div className={styles.unknown}>{t('trainerTechniques.unknownTechnique')}</div>
            </li>
          );
        }

        const hasVideo = Boolean(record.technique.youtube_video_id);

        return (
          <li key={record.id} className={styles.card}>
            <div className={styles.iconBox}>
              <Icon name="check" size={18} />
            </div>
            <div className={styles.info}>
              <div className={`${styles.name} ltr-isolate`}>{record.technique.name}</div>
              <div className={styles.meta}>
                {record.technique.main_group} · {record.technique.category}
              </div>
              <div className={styles.date}>
                {formatDate(record.completedAt, i18n.language, {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric'
                })}
              </div>
            </div>
            <button
              type="button"
              className={styles.playButton}
              onClick={() => onPlay?.(record.technique)}
              disabled={!hasVideo}
              aria-label={t('trainerTechniques.watchVideo')}
              title={t('trainerTechniques.watchVideo')}
            >
              <Icon name="play" size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
