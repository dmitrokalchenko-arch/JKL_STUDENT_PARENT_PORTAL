import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CLIP_DURATION_OPTIONS_SEC,
  DEFAULT_CLIP_DURATION_SEC,
  clampClipRange,
  formatClipTime
} from '../../utils/videoClipRange.js';
import styles from './TechniqueClipEditor.module.css';

const FINE_ADJUST_STEPS_SEC = [-1, -0.5, 0.5, 1];

// UX выбора эпизода: preview исходного видео + timeline + duration-кнопки +
// fine adjustment + "просмотреть фрагмент". НИЧЕГО здесь не режет и не
// кодирует физически — этот компонент отдаёт родителю только два числа
// (clipStart/clipEnd в секундах исходного файла) через onClipRangeChange;
// реальная физическая обрезка+замедление происходит в
// processTechniqueClip (см. services/videoProcessing/), вызываемом из
// MarkTechniqueCompletedModal.jsx по этим же секундам.
//
// Источник (this.file) открывается ТОЛЬКО локально через
// URL.createObjectURL — ни разу не уходит в сеть на этом этапе (архитектурный
// audit, "SOURCE VIDEO: LOCAL ONLY"). Object URL освобождается эффектом при
// смене файла/размонтировании — без этого каждый выбор нового source-видео
// тёк бы памятью (задание, этап 8).
export default function TechniqueClipEditor({ file, disabled, onClipRangeChange }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const clipEndRef = useRef(0);

  const [sourceUrl, setSourceUrl] = useState(null);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [metadataError, setMetadataError] = useState(false);
  const [clipDurationSec, setClipDurationSec] = useState(DEFAULT_CLIP_DURATION_SEC);
  const [desiredStartSec, setDesiredStartSec] = useState(0);

  // Новый source video -> сброс к дефолтам (задание, этап 8: "reset
  // clipStart; default duration = 7 sec; metadata загрузить заново").
  useEffect(() => {
    if (!file) {
      setSourceUrl(null);
      setSourceDuration(0);
      return undefined;
    }

    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    setSourceDuration(0);
    setMetadataError(false);
    setClipDurationSec(DEFAULT_CLIP_DURATION_SEC);
    setDesiredStartSec(0);

    return () => {
      videoRef.current?.pause();
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const { clipStart, clipEnd, effectiveDurationSec } = clampClipRange({
    desiredStartSec,
    durationSec: clipDurationSec,
    sourceDurationSec: sourceDuration
  });

  useEffect(() => {
    clipEndRef.current = clipEnd;
  }, [clipEnd]);

  // Родитель (MarkTechniqueCompletedModal) держит clipStart/clipEnd рядом с
  // будущим TODO Phase 2 — сам этот компонент ничего не аплоадит и не
  // решает, что делать с диапазоном.
  useEffect(() => {
    onClipRangeChange?.({ clipStart, clipEnd });
  }, [clipStart, clipEnd, onClipRangeChange]);

  function seekPreviewTo(seconds) {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = seconds;
    }
  }

  // iOS Safari (подтверждено на реальном iPhone, локальный HEVC/MOV из
  // Object URL): readyState/duration/seeked-события приходят корректно, но
  // сам decode+compositing pipeline у <video> активируется только после
  // первого play() — до этого currentTime-сик молча "принимается", а кадр
  // не рисуется (чёрный прямоугольник), хотя на desktop Chromium тот же
  // Object URL красит любой seek без предварительного play(). Один
  // беззвучный play()→pause() сразу после loadedmetadata активирует
  // pipeline без реального проигрывания; muted обязателен, т.к. к моменту
  // loadedmetadata (декод 4K HEVC занимает время) исходный user gesture
  // выбора файла уже истёк, а WebKit разрешает программный play() без
  // gesture только для muted-видео.
  function primeFramePaint(video) {
    const playAttempt = video.play();
    if (playAttempt && typeof playAttempt.then === 'function') {
      playAttempt
        .then(() => {
          video.pause();
          video.currentTime = 0;
        })
        .catch(() => {
          // Если даже muted play() отклонён (редкий edge case) — до кадра
          // всё равно достанет обычный seek при первом взаимодействии с
          // timeline; сама duration/UI уже рабочие, деградация мягкая.
        });
    }
  }

  function handleVideoPause() {
    // Возвращаем беззвучное состояние после любой паузы (auto-stop на
    // clipEnd, ручная перемотка), чтобы звук слышался только во время
    // явного "просмотреть фрагмент" (handlePreviewClip), как и раньше.
    if (videoRef.current) {
      videoRef.current.muted = true;
    }
  }

  function handleLoadedMetadata(event) {
    const { duration } = event.target;
    if (Number.isFinite(duration) && duration > 0) {
      setSourceDuration(duration);
      setMetadataError(false);
      primeFramePaint(event.target);
    } else {
      // Известная особенность некоторых контейнеров (в т.ч. отдельные
      // webm) — duration может прийти как Infinity до первого seek.
      // Не бесконечный retry-цикл — одна попытка достаточно для реальных
      // видео с телефона/камеры.
      setMetadataError(true);
    }
  }

  function handleDurationSelect(optionSec) {
    videoRef.current?.pause();
    setClipDurationSec(optionSec);
  }

  function handleTimelineChange(event) {
    const value = Number(event.target.value);
    setDesiredStartSec(value);
    // Сикаем на ЗАЖАТОЕ значение (не raw value слайдера) — иначе кадр
    // предпросмотра мог бы на миг показать позицию, которую сам clipStart
    // тут же откатит обратно (edge case: duration заведомо больше source,
    // maxStart=0 — то же исправление, что уже применено в handleFineAdjust).
    seekPreviewTo(clampClipRange({ desiredStartSec: value, durationSec: clipDurationSec, sourceDurationSec: sourceDuration }).clipStart);
  }

  function handleFineAdjust(deltaSec) {
    const next = desiredStartSec + deltaSec;
    setDesiredStartSec(next);
    seekPreviewTo(clampClipRange({ desiredStartSec: next, durationSec: clipDurationSec, sourceDurationSec: sourceDuration }).clipStart);
  }

  function handlePreviewClip() {
    const video = videoRef.current;
    if (!video) return;
    // Реальный клик — настоящий user gesture, поэтому unmute здесь
    // безопасен (WebKit не блокирует) — трейнер слышит фрагмент, как и
    // раньше; handleVideoPause вернёт muted=true, как только просмотр
    // остановится.
    video.muted = false;
    video.currentTime = clipStart;
    video.playbackRate = 1;
    video.play();
  }

  function handleTimeUpdate(event) {
    if (event.target.currentTime >= clipEndRef.current) {
      event.target.pause();
    }
  }

  const hasMetadata = sourceDuration > 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.videoWrap}>
        {sourceUrl && (
          <video
            ref={videoRef}
            className={styles.video}
            src={sourceUrl}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPause={handleVideoPause}
            playsInline
            muted
            preload="auto"
          />
        )}
      </div>

      {!hasMetadata && !metadataError && (
        <div className={styles.stateText}>{t('common.loading')}</div>
      )}
      {metadataError && <div className={styles.stateText}>{t('trainerTechniques.clipSourceUnreadable')}</div>}

      {hasMetadata && (
        <>
          <div className={styles.timelineRow}>
            <label className={styles.timelineLabel} htmlFor="clip-start-timeline">
              {t('trainerTechniques.clipStartLabel')}
            </label>
            <input
              id="clip-start-timeline"
              type="range"
              className={styles.timelineInput}
              min={0}
              max={sourceDuration}
              step={0.1}
              value={clipStart}
              onChange={handleTimelineChange}
              disabled={disabled}
              aria-label={t('trainerTechniques.clipTimelineAriaLabel')}
            />
            <div className={styles.timeRow}>
              <span>
                {t('trainerTechniques.clipStart')}: <span className={styles.timeValue}>{formatClipTime(clipStart)}</span>
              </span>
              <span>
                {t('trainerTechniques.clipEnd')}: <span className={styles.timeValue}>{formatClipTime(clipEnd)}</span>
              </span>
            </div>
          </div>

          <div className={styles.durationRow}>
            <div className={styles.timelineLabel}>{t('trainerTechniques.clipDurationLabel')}</div>
            <div className={styles.durationButtons}>
              {CLIP_DURATION_OPTIONS_SEC.map((optionSec) => {
                const exceedsSource = optionSec > sourceDuration;
                const isActive = optionSec === clipDurationSec;
                return (
                  <button
                    key={optionSec}
                    type="button"
                    className={[
                      styles.durationButton,
                      isActive ? styles.durationButtonActive : '',
                      exceedsSource ? styles.durationButtonExceeds : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => handleDurationSelect(optionSec)}
                    disabled={disabled}
                    aria-pressed={isActive}
                  >
                    {optionSec} {t('trainerTechniques.seconds')}
                  </button>
                );
              })}
            </div>
            {effectiveDurationSec < clipDurationSec && (
              <div className={styles.clipNoteText}>
                {t('trainerTechniques.clipLimitedToSource', { seconds: effectiveDurationSec.toFixed(1) })}
              </div>
            )}
          </div>

          <div className={styles.fineAdjustRow}>
            <div className={styles.timelineLabel}>{t('trainerTechniques.fineAdjustLabel')}</div>
            <div className={styles.fineAdjustButtons}>
              {FINE_ADJUST_STEPS_SEC.map((deltaSec) => (
                <button
                  key={deltaSec}
                  type="button"
                  className={styles.fineAdjustButton}
                  onClick={() => handleFineAdjust(deltaSec)}
                  disabled={disabled}
                  aria-label={t('trainerTechniques.fineAdjustButtonAriaLabel', {
                    sign: deltaSec > 0 ? '+' : '',
                    value: deltaSec
                  })}
                >
                  {deltaSec > 0 ? '+' : ''}
                  {deltaSec}s
                </button>
              ))}
            </div>
          </div>

          <button type="button" className={styles.previewButton} onClick={handlePreviewClip} disabled={disabled}>
            {t('trainerTechniques.previewClip')}
          </button>
        </>
      )}
    </div>
  );
}
