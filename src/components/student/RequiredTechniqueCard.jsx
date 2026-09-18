import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import TechniqueThumbnail from '../trainer/TechniqueThumbnail.jsx';
import styles from './RequiredTechniqueCard.module.css';

// READ-ONLY карточка техники для "Необходимых техник" на Universal
// Student Page — НЕ TechniqueSelectCard (там checkbox/toggle для
// конструктора /trainer/kyu-program, другой процесс). Здесь нет ни
// выбора, ни удаления, ни completion/progress — только изображение,
// название, категория и (если у техники есть reference-видео) кнопка,
// открывающая его ВНУТРИ Student Page через модалку
// (RequiredTechniquesSection сам решает, что открыть, — эта карточка
// только сообщает "по какой технике кликнули", никакого iframe/route
// здесь нет).
export default function RequiredTechniqueCard({ technique, onPlay }) {
  const { t } = useTranslation();
  const hasVideo = Boolean(technique.youtube_video_id);

  return (
    <div className={styles.card}>
      <TechniqueThumbnail imageUrl={technique.image_url} />
      <span className={`${styles.name} ltr-isolate`}>{technique.name}</span>
      <span className={styles.category}>{technique.category}</span>
      {hasVideo && (
        <button type="button" className={styles.videoButton} onClick={() => onPlay(technique)}>
          <Icon name="play" size={12} />
          {t('requiredTechniques.watchVideo')}
        </button>
      )}
    </div>
  );
}
