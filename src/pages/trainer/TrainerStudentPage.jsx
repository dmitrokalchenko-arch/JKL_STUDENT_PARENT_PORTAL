import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import PlaceholderSection from '../../components/family/PlaceholderSection.jsx';
import JudoTechniquePicker from '../../components/trainer/JudoTechniquePicker.jsx';
import JudoTechniqueVideoModal from '../../components/trainer/JudoTechniqueVideoModal.jsx';
import MarkTechniqueCompletedModal from '../../components/trainer/MarkTechniqueCompletedModal.jsx';
import StudentVideoPlayerModal from '../../components/trainer/StudentVideoPlayerModal.jsx';
import CompletedTechniquesList from '../../components/trainer/CompletedTechniquesList.jsx';
import { useTrainerWriteContext } from '../../hooks/useTrainerWriteContext.js';
import { useTrainerStudentProfile } from '../../hooks/useTrainerStudentProfile.js';
import { useStudentTechniqueRecords } from '../../hooks/useStudentTechniqueRecords.js';
import { useUnmarkTechniqueCompleted } from '../../hooks/useUnmarkTechniqueCompleted.js';
import styles from './TrainerStudentPage.module.css';

// Маршрут /trainer/student/:studentId — существовал только как приёмник
// маршрута (см. App.jsx), чтобы клик по подсказке поиска имел куда вести.
// Family Block в режиме Trainer View (карточка ученика, тренировки и т.д.)
// по-прежнему отдельный, ещё не начатый этап — PlaceholderSection ниже
// отражает именно эту, всё ещё не спроектированную часть.
//
// Каталог техник дзюдо + реальное сохранение выполненных техник ученика —
// самостоятельная, уже полностью рабочая часть этой страницы:
//   1) useStudentTechniqueRecords(studentId) — читает student_technique_records
//      JOIN judo_techniques для ЭТОГО ученика (RLS: can_trainer_access_student).
//   2) useTrainerWriteContext() — узнаёт {trainerRowId, clubId} текущего
//      тренера через RPC get_current_trainer_write_context.
//   3) useTrainerStudentProfile(studentId) — узнаёт {vorname, nachname}
//      ТЕКУЩЕГО ученика (RPC get_trainer_student_by_id, migration 049,
//      ещё НЕ применена к production) — нужно ТОЛЬКО для заголовка
//      MarkTechniqueCompletedModal ("Ученик: Фамилия Имя", задание этап 13).
//   4) pendingTechnique — какая техника прямо сейчас ждёт подтверждения в
//      модалке; клик "Отметить как выполнено" в JudoTechniquePicker
//      больше НЕ делает INSERT сразу, только открывает модалку (задание,
//      этап 1) — сам upload видео + INSERT происходят внутри
//      MarkTechniqueCompletedModal (useCompleteTechniqueWithVideo).
//   5) viewingStudentVideoRecord — какая ИЗ ВЫПОЛНЕННЫХ записей сейчас
//      открыта в StudentVideoPlayerModal (персональное видео ученика,
//      НЕ YouTube — задание, этап 3/11).
// completedTechniqueIds строится из уже загруженных records — Picker не
// делает отдельный запрос, чтобы узнать, что уже выполнено.
export default function TrainerStudentPage({ studentId }) {
  const { t } = useTranslation();
  const [videoTechnique, setVideoTechnique] = useState(null);
  const [pendingTechnique, setPendingTechnique] = useState(null);
  const [viewingStudentVideoRecord, setViewingStudentVideoRecord] = useState(null);

  const {
    context: writeContext,
    isLoading: isWriteContextLoading,
    error: writeContextHookError
  } = useTrainerWriteContext();

  const { student } = useTrainerStudentProfile(studentId);

  const {
    records,
    isLoading: isRecordsLoading,
    error: recordsError,
    refetch: refetchRecords,
    addRecordLocally,
    removeRecordLocally
  } = useStudentTechniqueRecords(studentId);

  // ЭТАП 7 (прежний): без reload/refetch — новая запись (ровно то, что
  // вернул INSERT ... select(...).single() внутри модалки) добавляется в
  // уже загруженный список напрямую, completedTechniqueIds пересчитывается
  // автоматически (useMemo ниже зависит от records); модалка закрывается
  // тем же сеттером, что её открывал.
  const handleModalCompleted = useCallback(
    (record) => {
      addRecordLocally(record);
      setPendingTechnique(null);
    },
    [addRecordLocally]
  );

  // Симметрично — после успешного DELETE запись убирается локально
  // (removeRecordLocally), completedTechniqueIds пересчитывается
  // автоматически тем же useMemo, JudoTechniquePicker сразу видит технику
  // как невыполненную (задание, "не допускать рассинхронизации между
  // CompletedTechniquesList и JudoTechniquePicker" — общий источник, один
  // и тот же records, а не два независимых состояния).
  const handleUnmarked = useCallback(
    (recordId) => {
      removeRecordLocally(recordId);
    },
    [removeRecordLocally]
  );

  const {
    unmarkCompleted,
    unmarkingId,
    error: unmarkError,
    videoCleanupWarning,
    clearVideoCleanupWarning
  } = useUnmarkTechniqueCompleted({
    onUnmarked: handleUnmarked
  });

  const completedTechniqueIds = useMemo(() => new Set((records ?? []).map((r) => r.techniqueId)), [records]);

  // Авто-скрытие предупреждения об неудачном video cleanup — не нужен
  // отдельный "закрыть" контрол/i18n-ключ (не входит в явный список
  // задания), но и оставлять его висеть навсегда до следующей отмены было
  // бы неаккуратно (задание, этап 15: интерфейс компактный, не
  // доминирующий). Само предупреждение уже сказано пользователю один раз —
  // этого достаточно, оно не блокирует и не требует действия.
  useEffect(() => {
    if (!videoCleanupWarning) return undefined;
    const timeoutId = setTimeout(clearVideoCleanupWarning, 8000);
    return () => clearTimeout(timeoutId);
  }, [videoCleanupWarning, clearVideoCleanupWarning]);

  return (
    <div className={styles.page}>
      <TrainerHeader title={t('trainerDashboard.findStudentTitle')} showBack />

      <div className={styles.content}>
        <PlaceholderSection title={t('trainerDashboard.findStudentTitle')} />
        {studentId && <div className={`${styles.debugId} ltr-isolate`}>{studentId}</div>}

        {/* "current trainer cannot be resolved" — баннер на уровне
            страницы, не per-row: если тренер деактивирован, ЛЮБАЯ попытка
            отметить технику заведомо провалится — лучше сказать это один
            раз заранее, чем дать открыть модалку и получить ошибку внутри. */}
        {!isWriteContextLoading && writeContextHookError && (
          <div className={styles.writeContextBanner}>{t('trainerTechniques.writeContextError')}</div>
        )}

        {videoCleanupWarning && (
          <div className={styles.warningBanner}>{t('trainerTechniques.couldNotDeletePerformanceVideo')}</div>
        )}

        <h2 className={styles.sectionTitle}>{t('trainerTechniques.completedListTitle')}</h2>
        <CompletedTechniquesList
          records={records}
          isLoading={isRecordsLoading}
          error={recordsError}
          onRetry={refetchRecords}
          onPlay={setViewingStudentVideoRecord}
          onUnmark={unmarkCompleted}
          unmarkingId={unmarkingId}
          unmarkError={unmarkError}
        />

        <h2 className={styles.sectionTitle}>{t('trainerTechniques.title')}</h2>
        <JudoTechniquePicker
          completedTechniqueIds={completedTechniqueIds}
          onMarkCompleted={setPendingTechnique}
          onPlay={setVideoTechnique}
        />
      </div>

      {/* Каталожная YouTube-модалка — БЕЗ изменений, эталонное видео техники. */}
      <JudoTechniqueVideoModal technique={videoTechnique} onClose={() => setVideoTechnique(null)} />

      <MarkTechniqueCompletedModal
        technique={pendingTechnique}
        student={student}
        writeContext={writeContext}
        onCompleted={handleModalCompleted}
        onClose={() => setPendingTechnique(null)}
      />

      <StudentVideoPlayerModal
        record={viewingStudentVideoRecord}
        student={student}
        onClose={() => setViewingStudentVideoRecord(null)}
      />
    </div>
  );
}
