import { useEffect, useRef, useState } from 'react';
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

// TEMP DIAGNOSTICS: физический iPhone Safari retest показал случай, когда
// модалка молча "исчезает" через 1-2 сек после "Отметить как выполнено" —
// без processingErrorKey, без diagnostic-UI, без новой записи. Ни один код-
// путь в handleConfirm/useCompleteTechniqueWithVideo/TrainerStudentPage не
// закрывает модалку иначе, чем через УСПЕШНЫЙ onCompleted (Modal.jsx тоже
// закрывается только через явный onClose) — значит наиболее вероятная
// причина ТАКОГО поведения на реальном устройстве это ПОЛНАЯ перезагрузка/
// креш вкладки Safari (типично при memory pressure от нескольких decode/
// encode попыток подряд для разных AVC candidates на тяжёлом 4K HEVC),
// стирающая весь in-memory React state — обычная console.log/React-
// диагностика такое НЕ переживает. Поэтому здесь флоу-стадии дублируются в
// localStorage (переживает reload) — если тренер снова откроет модалку
// после такого краша, мы увидим "remnant" последней стадии предыдущей
// попытки. УДАЛИТЬ вместе с остальной TEMP-диагностикой.
const FLOW_STAGE_STORAGE_KEY = 'jkl_debug_completion_flow_last_stage';

function logFlowStage(stage, details) {
  const entry = { stage, details: details ?? null, timestamp: new Date().toISOString() };
  // eslint-disable-next-line no-console
  console.log('[completion-flow]', stage, details ?? '');
  try {
    localStorage.setItem(FLOW_STAGE_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage может быть недоступен (приватный режим и т.п.) —
    // остальная диагностика (console.log) при этом всё равно работает.
  }
}

function readFlowStageRemnant() {
  try {
    const raw = localStorage.getItem(FLOW_STAGE_STORAGE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    // FLOW_MODAL_CLOSE_SUCCESS — последняя стадия ПОЛНОСТЬЮ успешного
    // прогона; если last stage что-то другое, предыдущая попытка не
    // завершилась штатно (либо ошибка, которую тоже стоит показать, либо
    // именно тот самый "тихий" обрыв, который мы расследуем).
    if (entry?.stage === 'FLOW_MODAL_CLOSE_SUCCESS') return null;
    return entry;
  } catch {
    return null;
  }
}

const FLOW_STAGE_LABELS = {
  FLOW_CONFIRM_CLICKED: 'Начало',
  FLOW_PROCESSING_START: 'Обработка видео',
  FLOW_PROCESSING_SUCCESS: 'Обработка видео завершена',
  FLOW_OUTPUT_BLOB_READY: 'Клип готов',
  FLOW_UPLOAD_START: 'Загрузка видео',
  FLOW_UPLOAD_SUCCESS: 'Видео загружено',
  FLOW_DB_INSERT_START: 'Сохранение результата',
  FLOW_DB_INSERT_SUCCESS: 'Результат сохранён',
  FLOW_REFRESH_START: 'Обновление списка',
  FLOW_REFRESH_SUCCESS: 'Список обновлён',
  FLOW_MODAL_CLOSE_SUCCESS: 'Готово',
  FLOW_ERROR: 'Ошибка'
};

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
  // TEMP DIAGNOSTICS (физический iPhone Safari retest processing-бага) —
  // на устройстве нет DevTools, поэтому этап+исходная ошибка временно
  // показываются прямо в модалке; УДАЛИТЬ вместе с diagnosticStage в
  // processTechniqueClip.js после подтверждённого фикса.
  const [processingDiagnostic, setProcessingDiagnostic] = useState(null);
  // TEMP DIAGNOSTICS: какой именно AVC profile/level/hardwareAcceleration
  // реально выбрал selectAvcEncoderConfig на ЭТОМ устройстве — нужно видеть
  // и при следующем физическом iPhone-тесте независимо от того, упадёт ли
  // обработка дальше на другом этапе. УДАЛИТЬ вместе с остальной TEMP-
  // диагностикой.
  const [processingEncoderConfig, setProcessingEncoderConfig] = useState(null);
  // TEMP DIAGNOSTICS: список ВСЕХ попыток AVC candidate (preflight +
  // runtime, ACCEPTED/REJECTED) — второй физический iPhone retest показал,
  // что isConfigSupported() (preflight) сам по себе недостаточен: кандидат,
  // прошедший preflight, может быть отклонён реальной инициализацией
  // encoder. Список нужен, чтобы на следующем тесте видеть ВСЕ попытки, а
  // не только финальный выбор. УДАЛИТЬ вместе с остальной TEMP-диагностикой.
  const [processingCandidateAttempts, setProcessingCandidateAttempts] = useState([]);
  // TEMP DIAGNOSTICS: текущая стадия ПОЛНОГО completion flow (confirm →
  // processing → upload → DB insert → refresh) — человекочитаемая, для
  // отображения в UI без DevTools. УДАЛИТЬ вместе с остальной TEMP-
  // диагностикой.
  const [flowStage, setFlowStageState] = useState(null);
  // TEMP DIAGNOSTICS: remnant предыдущего незавершённого прогона,
  // прочитанный из localStorage при открытии модалки для НОВОЙ техники —
  // если предыдущая попытка не дошла до FLOW_MODAL_CLOSE_SUCCESS (в т.ч. из-
  // за возможной перезагрузки/краша страницы), здесь будет видна её
  // последняя известная стадия. УДАЛИТЬ вместе с остальной TEMP-
  // диагностикой.
  const [previousRunRemnant, setPreviousRunRemnant] = useState(null);

  function setFlowStage(stage, details) {
    logFlowStage(stage, details);
    setFlowStageState({ stage, details });
  }

  useEffect(() => {
    if (!technique) return;
    setPreviousRunRemnant(readFlowStageRemnant());
  }, [technique]);

  const { completeWithVideo, isSubmitting, error, clearError } = useCompleteTechniqueWithVideo({
    studentId: student?.id,
    writeContext,
    onCompleted,
    // TEMP DIAGNOSTICS: стадии upload/DB insert логируются изнутри хука —
    // сюда попадают FLOW_UPLOAD_*/FLOW_DB_INSERT_*/FLOW_REFRESH_*/FLOW_ERROR.
    onFlowStage: setFlowStage
  });

  const isOpen = Boolean(technique);

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
    setProcessingDiagnostic(null);
    setProcessingEncoderConfig(null);
    setProcessingCandidateAttempts([]);
    setFlowStageState(null);
    clearError();
    onClose?.();
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setProcessingErrorKey(null);
    setProcessingDiagnostic(null);
    setProcessingEncoderConfig(null);
    setProcessingCandidateAttempts([]);
    setFlowStageState(null);
    clearError();
  }

  async function handleConfirm() {
    if (!selectedFile || isSubmitting || isProcessing) return;

    setProcessingErrorKey(null);
    setProcessingDiagnostic(null);
    setProcessingEncoderConfig(null);
    setProcessingCandidateAttempts([]);
    setPreviousRunRemnant(null);
    setIsProcessing(true);
    setFlowStage('FLOW_CONFIRM_CLICKED');

    const controller = new AbortController();
    processingAbortControllerRef.current = controller;

    let processedClipBlob;
    try {
      setFlowStage('FLOW_PROCESSING_START');
      processedClipBlob = await processTechniqueClip(
        {
          sourceFile: selectedFile,
          clipStart: clipRange.clipStart,
          clipDuration: clipRange.clipEnd - clipRange.clipStart
        },
        {
          signal: controller.signal,
          // TEMP DIAGNOSTICS: вызывается после того, как candidate РЕАЛЬНО
          // пережил инициализацию encoder (не только preflight), независимо
          // от того, упадёт ли обработка дальше.
          onEncoderConfigSelected: setProcessingEncoderConfig,
          // TEMP DIAGNOSTICS: вызывается на каждую попытку candidate
          // (preflight и runtime), чтобы видеть весь fallback-перебор.
          onCandidateAttempt: (attempt) => setProcessingCandidateAttempts((prev) => [...prev, attempt])
        }
      );

      // Защитная проверка (задание, п.7): processTechniqueClip() по коду
      // либо throw, либо возвращает валидный непустой Blob — но раз мы
      // расследуем "тихое исчезновение операции без throw", лучше явно
      // проверить, чем предполагать. Пустой/невалидный blob НЕ должен вести
      // к upload — считаем это ошибкой обработки.
      if (!(processedClipBlob instanceof Blob) || processedClipBlob.size === 0) {
        throw new Error(
          `processTechniqueClip returned invalid blob: instanceof Blob=${processedClipBlob instanceof Blob}, size=${processedClipBlob?.size}`
        );
      }
      setFlowStage('FLOW_PROCESSING_SUCCESS', { blobSize: processedClipBlob.size });
      setFlowStage('FLOW_OUTPUT_BLOB_READY', { size: processedClipBlob.size, type: processedClipBlob.type });
    } catch (err) {
      processingAbortControllerRef.current = null;
      setIsProcessing(false);

      if (err instanceof VideoProcessingCanceledError) {
        // handleClose уже инициировал закрытие модалки — никакой
        // error-текст здесь показывать не нужно.
        return;
      }

      // TEMP DIAGNOSTICS: console.error дублирует то, что уже залогировано
      // внутри processTechniqueClip (на случай, если stack теряется при
      // проходе через границы промисов), plus видимый в UI этап+ошибка —
      // на физическом iPhone нет DevTools, только так можно увидеть причину.
      console.error('[clip-processing] caught in modal', err);
      setFlowStage('FLOW_ERROR', { stage: 'processing', name: err?.name, message: err?.message });
      setProcessingDiagnostic({
        stage: err?.diagnosticStage ?? 'unknown',
        name: err?.name ?? 'Error',
        message: err?.message ?? String(err)
      });

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

            {/* TEMP DIAGNOSTICS — remnant предыдущего незавершённого
                прогона (см. FLOW_STAGE_STORAGE_KEY выше): если модалка на
                физическом устройстве "тихо исчезла" в прошлый раз (в т.ч.
                из-за возможной перезагрузки страницы), здесь будет видна
                последняя известная стадия ДО того обрыва. УДАЛИТЬ вместе с
                остальной TEMP-диагностикой. */}
            {previousRunRemnant && (
              <div className={styles.warningText}>
                ⚠ Обнаружен незавершённый предыдущий запуск ({previousRunRemnant.timestamp}). Последний известный
                этап: {FLOW_STAGE_LABELS[previousRunRemnant.stage] ?? previousRunRemnant.stage}
                {previousRunRemnant.details ? ` (${JSON.stringify(previousRunRemnant.details)})` : ''}
              </div>
            )}

            {/* TEMP DIAGNOSTICS — текущий этап ПОЛНОГО completion flow
                (confirm → processing → upload → DB insert → refresh),
                человекочитаемый, БЕЗ DevTools. УДАЛИТЬ вместе с остальной
                TEMP-диагностикой. */}
            {isBusy && flowStage && (
              <div className={styles.warningText}>
                Текущий этап: {FLOW_STAGE_LABELS[flowStage.stage] ?? flowStage.stage}
              </div>
            )}

            <div className={styles.videoSection}>
              <div className={styles.videoSectionLabel}>{t('trainerTechniques.uploadVideo')}</div>

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
            </div>

            {/* Clip Editor — только UX выбора эпизода (preview/timeline/
                duration/fine-adjust/просмотр фрагмента); физическая
                обрезка+замедление происходит в handleConfirm через
                processTechniqueClip (Phase 2). */}
            {selectedFile && (
              <TechniqueClipEditor file={selectedFile} disabled={isBusy} onClipRangeChange={setClipRange} />
            )}

            {processingErrorKey && (
              <div className={styles.errorText}>{t(`trainerTechniques.${processingErrorKey}`)}</div>
            )}
            {/* TEMP DIAGNOSTICS — расследование processing-бага на реальном
                iPhone Safari (DevTools недоступны на устройстве). Список
                попыток encoder candidate (preflight+runtime, ACCEPTED/
                REJECTED) и итоговый выбранный config показываются ВСЕГДА,
                как только известны (даже при успешной обработке) — чтобы на
                следующем физическом тесте было видно ВЕСЬ fallback-перебор,
                а не только финальный выбор. Этап+имя/сообщение ошибки —
                только при провале, БЕЗ stack trace. УДАЛИТЬ вместе с
                processingDiagnostic/processingEncoderConfig/
                processingCandidateAttempts после подтверждённого фикса. */}
            {processingCandidateAttempts.length > 0 && (
              <div className={styles.warningText}>
                Попытки encoder candidate:
                {processingCandidateAttempts.map((attempt, index) => (
                  <div key={index}>
                    {index + 1}. {attempt.fullCodecString} ({attempt.profileName}, {attempt.hardwareAcceleration}) —{' '}
                    {attempt.stage}: {attempt.result === 'accepted' ? 'ACCEPTED' : 'REJECTED'}
                    {attempt.error ? ` (${attempt.error})` : ''}
                  </div>
                ))}
              </div>
            )}
            {processingEncoderConfig && (
              <div className={styles.warningText}>
                Итоговый выбранный AVC codec: {processingEncoderConfig.fullCodecString} (
                {processingEncoderConfig.profileName})
                <br />
                Resolution: {processingEncoderConfig.width}x{processingEncoderConfig.height}
                <br />
                Bitrate: {processingEncoderConfig.bitrateBps} bps
                <br />
                Hardware acceleration: {processingEncoderConfig.hardwareAcceleration}
              </div>
            )}
            {processingDiagnostic && (
              <div className={styles.warningText}>
                Этап: {processingDiagnostic.stage}
                <br />
                Ошибка: {processingDiagnostic.name}: {processingDiagnostic.message}
              </div>
            )}
            {errorKey && <div className={styles.errorText}>{t(`trainerTechniques.${errorKey}`)}</div>}
            {/* TEMP DIAGNOSTICS — точная стадия upload/DB insert, на
                которой реально произошла ошибка (errorKey выше показывает
                только i18n-текст, без указания upload это было или DB
                insert) + исходное имя/сообщение, БЕЗ stack trace. УДАЛИТЬ
                вместе с остальной TEMP-диагностикой. */}
            {flowStage?.stage === 'FLOW_ERROR' && (
              <div className={styles.warningText}>
                Этап: {flowStage.details?.stage}
                <br />
                Ошибка: {flowStage.details?.name}: {flowStage.details?.message}
              </div>
            )}
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
