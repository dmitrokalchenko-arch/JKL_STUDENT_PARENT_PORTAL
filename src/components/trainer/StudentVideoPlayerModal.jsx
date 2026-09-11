import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../common/Modal.jsx';
import Icon from '../common/Icon.jsx';
import { getStudentVideoSignedUrl } from '../../services/studentVideoService.js';
import styles from './StudentVideoPlayerModal.module.css';

// Отдельный viewer для ПЕРСОНАЛЬНОГО видео выполнения ученика — НЕ
// YouTube iframe (задание, этап 3/11: в "Выполненные техники" никогда не
// подставляется YouTube). private bucket -> signed URL строится здесь, по
// требованию, при каждом открытии (НЕ кешируется/не сохраняется в БД, см.
// src/services/studentVideoService.js) — <video controls>, без autoplay,
// без download-параметра (не запускать автоматическое скачивание,
// задание этап 11).
export default function StudentVideoPlayerModal({ record, student, onClose }) {
  const { t } = useTranslation();
  const isOpen = Boolean(record);
  const path = record?.studentVideoPath ?? null;

  // "Nachname Vorname — Technique" (задание) — НЕ "Technique" одна, как у
  // каталожной YouTube-модалки (JudoTechniqueVideoModal.jsx, сознательно не
  // трогаем). student приходит от родителя (TrainerStudentPage), уже
  // загружен один раз через useTrainerStudentProfile — здесь НЕТ нового
  // запроса. Порядок "Фамилия Имя" — тот же, что уже везде в проекте
  // (MarkTechniqueCompletedModal/TrainerStudentSearch), не новое решение.
  const studentName = student ? `${student.lastName ?? ''} ${student.firstName ?? ''}`.trim() : '';
  const title = record?.technique?.name
    ? [studentName, record.technique.name].filter(Boolean).join(' — ')
    : '';

  const [signedUrl, setSignedUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!path) {
      setSignedUrl(null);
      setLoadError(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setLoadError(false);
    setSignedUrl(null);

    getStudentVideoSignedUrl(path)
      .then((url) => {
        if (!cancelled) setSignedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="student-video-title">
      {isOpen && (
        <div className={styles.content}>
          <div className={styles.header}>
            <h2 id="student-video-title" className={`${styles.title} ltr-isolate`}>
              {title}
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

          {isLoading && <div className={styles.statePlaceholder}>{t('common.loading')}</div>}

          {!isLoading && loadError && (
            <div className={styles.statePlaceholder}>
              <Icon name="play" size={28} className={styles.placeholderIcon} />
              <div>{t('trainerTechniques.couldNotOpenPerformanceVideo')}</div>
            </div>
          )}

          {!isLoading && !loadError && signedUrl && (
            <div className={styles.videoWrap}>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- персональный клип выполнения без субтитров */}
              <video className={styles.video} src={signedUrl} controls />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
