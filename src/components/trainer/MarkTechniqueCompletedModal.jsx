import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../common/Modal.jsx';
import Icon from '../common/Icon.jsx';
import TechniqueThumbnail from './TechniqueThumbnail.jsx';
import TechniqueClipEditor from './TechniqueClipEditor.jsx';
import { useCompleteTechniqueWithVideo } from '../../hooks/useCompleteTechniqueWithVideo.js';
import {
  processTechniqueClip,
  VideoProcessingUnsupportedError,
  VideoProcessingCanceledError
} from '../../services/videoProcessing/processTechniqueClip.js';
import { ALLOWED_VIDEO_MIME_TYPES } from '../../utils/studentVideoFilename.js';
import { isVideoProcessingSupportedDevice } from '../../utils/videoProcessingDeviceSupport.js';
import styles from './MarkTechniqueCompletedModal.module.css';

// Новый workflow "Отметить как выполнено" (задание, этап 1) — раньше
// клик по кнопке в JudoTechniquePicker сразу делал INSERT; теперь кнопка
// только открывает эту модалку (см. TrainerStudentPage.jsx), а реальный
// INSERT происходит здесь, ПОСЛЕ выбора и успешной загрузки видео
// ученика (задание, этап 2: видео ОБЯЗАТЕЛЬНО для новых выполнений —
// кнопка подтверждения ниже disabled, пока файл не выбран).
//
// technique — из каталога (JudoTechniquePicker), НЕ мутируется, только
// читается (name/image_url) — youtube_url/youtube_video_id техники здесь
// вообще не используются, это персональное видео ученика, другой источник
// (задание, этап 3).
export default function MarkTechniqueCompletedModal({ technique, student, writeContext, onCompleted, onClose }) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const processingAbortControllerRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  // clipRange — UX-выбор (см. TechniqueClipEditor.jsx); Phase 2 передаёт
  // именно эти секунды в processTechniqueClip как реальный decode-диапазон.
  const [clipRange, setClipRange] = useState({ clipStart: 0, clipEnd: 0 });
  // Phase 2: локальная обработка видео (WebCodecs/mediabunny) ДО upload'а —
  // отдельное состояние от isSubmitting (сеть/DB), т.к. во время обработки
  // модалку можно закрыть (что отменяет обработку через AbortController),
  // а во время isSubmitting закрытие остаётся заблокированным, как раньше.
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingErrorKey, setProcessingErrorKey] = useState(null);

  const { completeWithVideo, isSubmitting, error, clearError } = useCompleteTechniqueWithVideo({
    studentId: student?.id,
    writeContext,
    onCompleted
  });

  const isOpen = Boolean(technique);
  // Video processing (mediabunny/WebCodecs) работает ТОЛЬКО на desktop —
  // мобильные браузеры (в т.ч. iPhone Safari) не имеют надёжного пути на
  // уровне браузера (см. videoProcessingDeviceSupport.js). На мобильном
  // устройстве не показываем file input/Clip Editor вообще — только
  // сообщение открыть портал на компьютере; кнопка подтверждения остаётся
  // disabled, т.к. selectedFile так и не появится.
  const isSupportedDevice = isVideoProcessingSupportedDevice();

  // Закрытие (Escape/overlay-клик/крестик/Отмена) заблокировано только во
  // время upload+INSERT (isSubmitting, задание этап 15, не изменилось).
  // Во время ЛОКАЛЬНОЙ обработки видео (isProcessing) закрытие теперь
  // РАЗРЕШЕНО и означает отмену — abort() останавливает decode/encode,
  // после чего processTechniqueClip выбрасывает VideoProcessingCanceledError
  // (обрабатывается в handleConfirm ниже, без показа error-состояния).
  function handleClose() {
    if (isSubmitting) return;
    if (isProcessing) {
      processingAbortControllerRef.current?.abort();
    }
    setSelectedFile(null);
    setClipRange({ clipStart: 0, clipEnd: 0 });
    setIsProcessing(false);
    setProcessingErrorKey(null);
    clearError();
    onClose?.();
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setProcessingErrorKey(null);
    clearError();
  }

  async function handleConfirm() {
    if (!selectedFile || isSubmitting || isProcessing) return;

    setProcessingErrorKey(null);
    setIsProcessing(true);

    const controller = new AbortController();
    processingAbortControllerRef.current = controller;

    let processedClipBlob;
    try {
      processedClipBlob = await processTechniqueClip(
        {
          sourceFile: selectedFile,
          clipStart: clipRange.clipStart,
          clipDuration: clipRange.clipEnd - clipRange.clipStart
        },
        { signal: controller.signal }
      );
    } catch (err) {
      processingAbortControllerRef.current = null;
      setIsProcessing(false);

      if (err instanceof VideoProcessingCanceledError) {
        // handleClose уже инициировал закрытие модалки — никакой
        // error-текст здесь показывать не нужно.
        return;
      }

      setProcessingErrorKey(
        err instanceof VideoProcessingUnsupportedError ? 'videoProcessingUnsupported' : 'videoProcessingFailed'
      );
      return;
    }

    processingAbortControllerRef.current = null;
    setIsProcessing(false);

    // Только ОБРАБОТАННЫЙ клип (1.0x + 0.5x, физически один MP4-файл)
    // уходит дальше в upload — оригинальный selectedFile так и не покинул
    // локальную обработку (задание: "original video privacy").
    await completeWithVideo({ technique, student, file: processedClipBlob });
  }

  const isBusy = isProcessing || isSubmitting;

  const confirmButtonLabel = isProcessing
    ? t('trainerTechniques.processingVideo')
    : isSubmitting
      ? t('trainerTechniques.uploadingVideo')
      : t('trainerTechniques.markCompleted');

  const studentName = student ? `${student.lastName ?? ''} ${student.firstName ?? ''}`.trim() : '';

  const errorKey = (() => {
    if (!error) return null;
    switch (error.reason) {
      case 'unsupported_format':
        return 'unsupportedVideoFormat';
      case 'too_large':
        return 'videoTooLarge';
      case 'upload_failed':
        return 'videoUploadFailed';
      case 'no_write_context':
        return 'writeContextError';
      case 'duplicate':
        return 'alreadyCompleted';
      case 'access_denied':
        return 'accessDenied';
      default:
        return 'couldNotSaveCompletedTechnique';
    }
  })();

  return (
    <Modal isOpen={isOpen} onClose={handleClose} labelledBy="mark-technique-completed-title">
      {isOpen && (
        <div className={styles.content}>
          <div className={styles.header}>
            <h2 id="mark-technique-completed-title" className={styles.title}>
              {t('trainerTechniques.markCompleted')}
            </h2>
            <button
              type="button"
              className={styles.closeButton}
              onClick={handleClose}
              disabled={isSubmitting}
              aria-label={t('trainerTechniques.cancel')}
            >
              <Icon name="close" size={18} />
            </button>
          </div>

          <div className={styles.body}>
            <div>
              <div className={styles.studentLabel}>{t('trainerTechniques.student')}</div>
              <div className={`${styles.studentName} ltr-isolate`}>{studentName}</div>
            </div>

            <div className={styles.techniquePreview}>
              <TechniqueThumbnail imageUrl={technique?.image_url} />
              <span className={`${styles.techniqueName} ltr-isolate`}>{technique?.name}</span>
            </div>

            <div className={styles.videoSection}>
              <div className={styles.videoSectionLabel}>{t('trainerTechniques.uploadVideo')}</div>

              {!isSupportedDevice ? (
                <div className={styles.errorText}>{t('trainerTechniques.videoUnsupportedDevice')}</div>
              ) : (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ALLOWED_VIDEO_MIME_TYPES.join(',')}
                    onChange={handleFileChange}
                    disabled={isBusy}
                    hidden
                  />

                  <button
                    type="button"
                    className={styles.addVideoButton}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isBusy}
                  >
                    {t('trainerTechniques.addVideo')}
                  </button>

                  {selectedFile && (
                    <div className={styles.selectedFile}>
                      <span>{t('trainerTechniques.videoSelected')}</span>
                      <span className={`${styles.selectedFileName} ltr-isolate`}>{selectedFile.name}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Clip Editor — только UX выбора эпизода (preview/timeline/
                duration/fine-adjust/просмотр фрагмента); физическая
                обрезка+замедление происходит в handleConfirm через
                processTechniqueClip (Phase 2). Недоступен на мобильных
                устройствах — там file input выше вообще не показывается,
                поэтому selectedFile никогда не появится. */}
            {isSupportedDevice && selectedFile && (
              <TechniqueClipEditor file={selectedFile} disabled={isBusy} onClipRangeChange={setClipRange} />
            )}

            {processingErrorKey && (
              <div className={styles.errorText}>{t(`trainerTechniques.${processingErrorKey}`)}</div>
            )}
            {errorKey && <div className={styles.errorText}>{t(`trainerTechniques.${errorKey}`)}</div>}
            {error?.orphanCleanupFailed && (
              <div className={styles.warningText}>{t('trainerTechniques.couldNotDeletePerformanceVideo')}</div>
            )}
          </div>

          <div className={styles.footer}>
            <button type="button" className={styles.cancelButton} onClick={handleClose} disabled={isSubmitting}>
              {t('trainerTechniques.cancel')}
            </button>
            <button
              type="button"
              className={styles.confirmButton}
              onClick={handleConfirm}
              disabled={!selectedFile || isBusy}
            >
              {confirmButtonLabel}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
