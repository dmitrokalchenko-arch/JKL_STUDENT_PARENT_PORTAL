import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import StudentPageContent from '../../components/student/StudentPageContent.jsx';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
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

// Маршрут /trainer/student/:studentId — рендерится ВНУТРИ TrainerAuthGuard
// (см. App.jsx), значит authenticated trainer с активным profile.is_active
// уже гарантирован выше по дереву — здесь остаётся только per-student
// access check (см. useTrainerStudentProfile ниже).
//
// REAL TRAINER STUDENT PAGE: страница переведена на общий presentation-
// каркас StudentPageContent (accessMode="trainer") — тот же, что уже
// использует Super Admin Preview (accessMode="superadmin") и FamilyDashboard
// (accessMode="family"), вместо собственной отдельной разметки. Bonus-
// техники (техника progress-блок) сюда намеренно НЕ подключаются на этом
// шаге — techniqueProgress не передаётся вовсе, секция просто не
// рендерится (та же семантика, что и везде в StudentPageContent). Ряд
// навигационных карточек ("Моя семья"/"Договор и оплата"/...) тоже
// намеренно не показывается тренеру (showNavigationCards не передаётся) —
// эти карточки принадлежат family-стороне (аккаунт/договор семьи), и для
// тренера сегодня нет ни одного реального backend-источника под ними;
// честный "подключим позже" в каждой из них был бы просто лишним шумом на
// странице, а не полезной функциональностью.
//
// Каталог техник дзюдо + реальное сохранение выполненных техник ученика —
// самостоятельная, УЖЕ полностью рабочая часть этой страницы, переехавшая
// БЕЗ ИЗМЕНЕНИЙ ЛОГИКИ в children-слот StudentPageContent:
//   1) useStudentTechniqueRecords(studentId) — читает student_technique_records
//      JOIN judo_techniques для ЭТОГО ученика (RLS: can_trainer_access_student).
//   2) useTrainerWriteContext() — узнаёт {trainerRowId, clubId} текущего
//      тренера через RPC get_current_trainer_write_context.
//   3) useTrainerStudentProfile(studentId) — теперь ЕДИНСТВЕННЫЙ источник
//      {id, firstName, lastName} для StudentPageContent's student-пропа И
//      единственный page-level access-check (get_trainer_student_by_id сам
//      вызывает can_trainer_access_student, 0 строк без ошибки = доступа
//      нет — см. ветку ниже). Миграция 20260911090049 ещё НЕ применена к
//      production (см. итоговый отчёт задачи) — до её применения этот путь
//      в production покажет error-состояние ниже, не данные.
//   4) pendingTechnique — какая техника прямо сейчас ждёт подтверждения в
//      модалке; клик "Отметить как выполнено" в JudoTechniquePicker
//      больше НЕ делает INSERT сразу, только открывает модалку — сам
//      upload видео + INSERT происходят внутри MarkTechniqueCompletedModal
//      (useCompleteTechniqueWithVideo).
//   5) viewingStudentVideoRecord — какая ИЗ ВЫПОЛНЕННЫХ записей сейчас
//      открыта в StudentVideoPlayerModal (персональное видео ученика,
//      НЕ YouTube).
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

  const {
    student,
    isLoading: isProfileLoading,
    error: profileError,
    reload: reloadProfile
  } = useTrainerStudentProfile(studentId);

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

  // Page-level gate — тот же паттерн, что StudentPreviewPage.jsx (Super
  // Admin Preview): loading/error/denied обрабатываются ЗДЕСЬ, ДО рендера
  // StudentPageContent, а не пропами внутрь общего каркаса — он получает
  // student только когда данные реально есть. profileError (RPC-сбой,
  // включая "функция ещё не задеплоена") — ОТДЕЛЬНОЕ от "student === null
  // без ошибки" (= can_trainer_access_student вернула false/студента нет) —
  // первое retry-able, второе — окончательный отказ, не путаем их местами.
  if (isProfileLoading) {
    return <div className={styles.state}>{t('common.loading')}</div>;
  }

  if (profileError) {
    return (
      <div className={styles.state}>
        <div>{t('trainerTechniques.studentLoadError')}</div>
        <button type="button" className={styles.retryButton} onClick={reloadProfile}>
          {t('trainerTechniques.retry')}
        </button>
      </div>
    );
  }

  if (!student) {
    return <div className={styles.state}>{t('trainerTechniques.accessDenied')}</div>;
  }

  return (
    <StudentPageContent
      accessMode="trainer"
      header={<TrainerHeader title={`${student.firstName ?? ''} ${student.lastName ?? ''}`.trim()} showBack />}
      student={student}
    >
      <div className={styles.content}>
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
    </StudentPageContent>
  );
}
