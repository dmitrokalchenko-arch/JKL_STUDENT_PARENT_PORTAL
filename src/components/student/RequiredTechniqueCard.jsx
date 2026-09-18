import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import TechniqueThumbnail from '../trainer/TechniqueThumbnail.jsx';
import styles from './RequiredTechniqueCard.module.css';

// READ-ONLY карточка техники для "Необходимых техник" на Universal
// Student Page — НЕ TechniqueSelectCard (там checkbox/toggle для
// конструктора /trainer/kyu-program, другой процесс). Здесь нет ни
// выбора, ни удаления, ни completion/progress — только изображение,
// название, категория и (если у техники есть referenceVideo) простая
// внешняя ссылка на YouTube, тот же safe-паттерн, что уже используется
// для reference-видео в остальном проекте (открывается в новой вкладке,
// без встроенного плеера/модалки — отдельный video workflow здесь не
// создаётся).
export default function RequiredTechniqueCard({ technique }) {
  const { t } = useTranslation();
  const hasVideo = Boolean(technique.youtube_video_id);

  return (
    <div className={styles.card}>
      <TechniqueThumbnail imageUrl={technique.image_url} />
      <span className={`${styles.name} ltr-isolate`}>{technique.name}</span>
      <span className={styles.category}>{technique.category}</span>
      {hasVideo && (
        <a
          className={styles.videoLink}
          href={technique.youtube_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="play" size={12} />
          {t('requiredTechniques.watchVideo')}
        </a>
      )}
    </div>
  );
}
