import { useTranslation } from 'react-i18next';
import Modal from '../common/Modal.jsx';
import Icon from '../common/Icon.jsx';
import styles from './JudoTechniqueVideoModal.module.css';

// Переиспользует общий Modal.jsx (открытие/закрытие по Esc/оверлею,
// блокировка прокрутки фона) — та же оболочка, что и у семейного
// TechniqueVideoModal.jsx, не параллельная реализация (см. задание, этап 4).
// Внутреннее содержимое — своё: family-модалка резолвит подписанный
// Storage-URL асинхронно (video_path в приватном bucket), а здесь
// youtube_video_id уже приходит готовым прямо из judo_techniques — никакого
// повторного парсинга youtube_url на клиенте и никакого сетевого запроса
// перед показом, просто <iframe src=".../embed/{id}">.
export default function JudoTechniqueVideoModal({ technique, onClose }) {
  const { t } = useTranslation();
  const isOpen = Boolean(technique);
  const hasVideo = Boolean(technique?.youtube_video_id);

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="judo-technique-video-title">
      {isOpen && (
        <div className={styles.content}>
          <div className={styles.header}>
            <h2 id="judo-technique-video-title" className={`${styles.title} ltr-isolate`}>
              {technique.name}
            </h2>
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label={t('techniqueProgress.videoModal.close')}
            >
              <Icon name="close" size={18} />
            </button>
          </div>

          {!hasVideo ? (
            <div className={styles.videoPlaceholder}>
              <Icon name="play" size={28} className={styles.placeholderIcon} />
              <div>{t('techniqueProgress.videoModal.notAvailable')}</div>
            </div>
          ) : (
            <div className={styles.videoWrap}>
              <iframe
                className={styles.video}
                src={`https://www.youtube-nocookie.com/embed/${technique.youtube_video_id}`}
                title={technique.name}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
