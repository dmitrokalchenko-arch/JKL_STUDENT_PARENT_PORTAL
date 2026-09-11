import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import TechniqueThumbnail from './TechniqueThumbnail.jsx';
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
//
// Video button здесь — ПЕРСОНАЛЬНОЕ видео выполнения (record.studentVideoPath,
// private Storage + signed URL, см. StudentVideoPlayerModal), НЕ
// record.technique.youtube_url/youtube_video_id — задание, этап 3/10/11:
// "никогда не использовать YouTube как fallback для completed technique".
// onPlay здесь принимает record целиком (не record.technique, как раньше) —
// StudentVideoPlayerModal нужен именно studentVideoPath записи, а не
// что-либо из каталога. Для старых записей без видео (studentVideoPath
// null) кнопка disabled с tooltip через i18n (задание, этап 10) — YouTube
// НЕ подставляется.
export default function CompletedTechniquesList({
  records,
  isLoading,
  error,
  onRetry,
  onPlay,
  onUnmark,
  unmarkingId,
  unmarkError
}) {
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

        const hasStudentVideo = Boolean(record.studentVideoPath);
        const isUnmarking = unmarkingId === record.id;
        const rowError = unmarkError?.recordId === record.id ? unmarkError : null;

        return (
          <li key={record.id} className={styles.card}>
            <div className={styles.iconBox}>
              <Icon name="check" size={18} />
            </div>
            <TechniqueThumbnail imageUrl={record.technique.image_url} />
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
              {rowError && <div className={styles.rowError}>{t('trainerTechniques.unmarkError')}</div>}
            </div>
            <button
              type="button"
              className={styles.playButton}
              onClick={() => onPlay?.(record)}
              disabled={!hasStudentVideo}
              aria-label={t(hasStudentVideo ? 'trainerTechniques.performanceVideo' : 'trainerTechniques.noPerformanceVideo')}
              title={t(hasStudentVideo ? 'trainerTechniques.performanceVideo' : 'trainerTechniques.noPerformanceVideo')}
            >
              <Icon name="play" size={14} />
            </button>
            <button
              type="button"
              className={styles.unmarkButton}
              onClick={() => onUnmark?.(record)}
              disabled={isUnmarking}
              aria-label={t('trainerTechniques.unmarkCompleted')}
              title={t('trainerTechniques.unmarkCompleted')}
            >
              <Icon name="close" size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
