import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../common/Modal.jsx';
import Icon from '../common/Icon.jsx';
import { getTechniqueVideoUrl } from '../../services/techniqueProgressService.js';
import styles from './TechniqueVideoModal.module.css';

export default function TechniqueVideoModal({ technique, onClose }) {
  const { t } = useTranslation();
  const isOpen = Boolean(technique);
  const [videoUrl, setVideoUrl] = useState(null);
  const [isResolvingVideo, setIsResolvingVideo] = useState(false);

  // Signed URL запрашивается только при реальном открытии модалки с
  // выполненной техникой, у которой есть видео — не заранее для всех карточек.
  useEffect(() => {
    if (!isOpen || !technique?.hasVideo) {
      setVideoUrl(null);
      return undefined;
    }

    let isCancelled = false;
    setIsResolvingVideo(true);

    getTechniqueVideoUrl(technique.videoPath)
      .then((url) => {
        if (!isCancelled) setVideoUrl(url);
      })
      .catch(() => {
        if (!isCancelled) setVideoUrl(null);
      })
      .finally(() => {
        if (!isCancelled) setIsResolvingVideo(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, technique]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="technique-video-title">
      {isOpen && (
        <div className={styles.content}>
          <div className={styles.header}>
            <h2 id="technique-video-title" className={styles.title}>{technique.name}</h2>
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label={t('techniqueProgress.videoModal.close')}
            >
              <Icon name="close" size={18} />
            </button>
          </div>

          {!technique.hasVideo ? (
            <div className={styles.videoPlaceholder}>
              <Icon name="play" size={28} className={styles.placeholderIcon} />
              <div>{t('techniqueProgress.videoModal.notAvailable')}</div>
            </div>
          ) : isResolvingVideo || !videoUrl ? (
            <div className={styles.videoPlaceholder}>
              <div>{t('common.loading')}</div>
            </div>
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video className={styles.video} src={videoUrl} controls controlsList="nodownload" />
          )}
        </div>
      )}
    </Modal>
  );
}
