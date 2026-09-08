import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import PlaceholderSection from '../../components/family/PlaceholderSection.jsx';
import JudoTechniquePicker from '../../components/trainer/JudoTechniquePicker.jsx';
import JudoTechniqueVideoModal from '../../components/trainer/JudoTechniqueVideoModal.jsx';
import CompletedTechniquesList from '../../components/trainer/CompletedTechniquesList.jsx';
import { useTrainerWriteContext } from '../../hooks/useTrainerWriteContext.js';
import { useStudentTechniqueRecords } from '../../hooks/useStudentTechniqueRecords.js';
import { useMarkTechniqueCompleted } from '../../hooks/useMarkTechniqueCompleted.js';
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
//      тренера через НОВЫЙ RPC get_current_trainer_write_context (см.
//      supabase/migrations/20260908140044..., ещё НЕ применена к
//      production — до применения владельцем через Dashboard попытка
//      отметить технику покажет понятную ошибку, не крэш).
//   3) useMarkTechniqueCompleted — сам INSERT, с typed-ошибками
//      (duplicate/access_denied/no_write_context/unknown), без raw
//      Postgres-текста в UI.
// completedTechniqueIds строится из уже загруженных records — Picker не
// делает отдельный запрос, чтобы узнать, что уже выполнено.
export default function TrainerStudentPage({ studentId }) {
  const { t } = useTranslation();
  const [videoTechnique, setVideoTechnique] = useState(null);

  const {
    context: writeContext,
    isLoading: isWriteContextLoading,
    error: writeContextHookError
  } = useTrainerWriteContext();

  const {
    records,
    isLoading: isRecordsLoading,
    error: recordsError,
    refetch: refetchRecords,
    addRecordLocally
  } = useStudentTechniqueRecords(studentId);

  // ЭТАП 7: без reload/refetch — новая запись (ровно то, что вернул
  // INSERT ... select(...).single()) добавляется в уже загруженный список
  // напрямую, completedTechniqueIds пересчитывается автоматически (useMemo
  // ниже зависит от records).
  const handleCompleted = useCallback(
    (record) => {
      addRecordLocally(record);
    },
    [addRecordLocally]
  );

  const { markCompleted, markingId, error: markError } = useMarkTechniqueCompleted({
    studentId,
    writeContext,
    onCompleted: handleCompleted
  });

  const completedTechniqueIds = useMemo(() => new Set((records ?? []).map((r) => r.techniqueId)), [records]);

  return (
    <div className={styles.page}>
      <TrainerHeader title={t('trainerDashboard.findStudentTitle')} showBack />

      <div className={styles.content}>
        <PlaceholderSection title={t('trainerDashboard.findStudentTitle')} />
        {studentId && <div className={`${styles.debugId} ltr-isolate`}>{studentId}</div>}

        {/* "current trainer cannot be resolved" (задание, этап 8) — баннер
            на уровне страницы, не per-row: если RPC 044 ещё не применена
            или тренер деактивирован, ЛЮБАЯ попытка отметить технику
            заведомо провалится — лучше сказать это один раз заранее, чем
            дать нажать кнопку и получить ошибку на каждой строке. */}
        {!isWriteContextLoading && writeContextHookError && (
          <div className={styles.writeContextBanner}>{t('trainerTechniques.writeContextError')}</div>
        )}

        <h2 className={styles.sectionTitle}>{t('trainerTechniques.completedListTitle')}</h2>
        <CompletedTechniquesList
          records={records}
          isLoading={isRecordsLoading}
          error={recordsError}
          onRetry={refetchRecords}
          onPlay={setVideoTechnique}
        />

        <h2 className={styles.sectionTitle}>{t('trainerTechniques.title')}</h2>
        <JudoTechniquePicker
          completedTechniqueIds={completedTechniqueIds}
          markingId={markingId}
          markError={markError}
          onMarkCompleted={markCompleted}
          onPlay={setVideoTechnique}
        />
      </div>

      <JudoTechniqueVideoModal technique={videoTechnique} onClose={() => setVideoTechnique(null)} />
    </div>
  );
}
