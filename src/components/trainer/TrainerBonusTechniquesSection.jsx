import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import CompletedTechniquesList from './CompletedTechniquesList.jsx';
import JudoTechniquePicker from './JudoTechniquePicker.jsx';
import MarkTechniqueCompletedModal from './MarkTechniqueCompletedModal.jsx';
import StudentVideoPlayerModal from './StudentVideoPlayerModal.jsx';
import JudoTechniqueVideoModal from './JudoTechniqueVideoModal.jsx';
import { useTrainerWriteContext } from '../../hooks/useTrainerWriteContext.js';
import { useStudentTechniqueRecords } from '../../hooks/useStudentTechniqueRecords.js';
import { useTrainerStudentBonusPool } from '../../hooks/useTrainerStudentBonusPool.js';
import { useUnmarkTechniqueCompleted } from '../../hooks/useUnmarkTechniqueCompleted.js';
import styles from './TrainerBonusTechniquesSection.module.css';

// "Trainer Bonus Techniques" (задача этого же имени) — восстанавливает на
// Trainer Student Page функциональность "отметить технику выполненной",
// ранее убранную отсюда целиком (см. комментарий "REMOVED FROM THIS PAGE"
// в TrainerStudentPage.jsx) вместе с legacy-picker'ом ВСЕГО каталога.
// Ключевое отличие от старой реализации: JudoTechniquePicker здесь
// получает НЕ useJudoTechniques() (весь каталог, 100 техник), а
// useTrainerStudentBonusPool(studentId) — пул, ограниченный бонусной
// программой ДОСТИГНУТОГО Kyu этого конкретного ученика
// (get_trainer_student_bonus_pool, миграция 20260922100066).
//
// CompletedTechniquesList/MarkTechniqueCompletedModal/
// StudentVideoPlayerModal/JudoTechniqueVideoModal/useStudentTechniqueRecords/
// useTrainerWriteContext/useUnmarkTechniqueCompleted — ПЕРЕИСПОЛЬЗУЮТСЯ
// БЕЗ ИЗМЕНЕНИЙ (та же student_technique_records/Storage video flow, что
// уже была полностью реализована и проверена ранее — задание прямо
// запрещает вторую реализацию видео-flow).
export default function TrainerBonusTechniquesSection({ student }) {
  const { t } = useTranslation();

  const { context: writeContext } = useTrainerWriteContext();

  const {
    records,
    isLoading: isRecordsLoading,
    error: recordsError,
    refetch: refetchRecords,
    addRecordLocally,
    removeRecordLocally
  } = useStudentTechniqueRecords(student?.id);

  const {
    techniques: bonusPool,
    isLoading: isPoolLoading,
    error: poolError,
    refetch: refetchPool
  } = useTrainerStudentBonusPool(student?.id);

  const [techniqueToMark, setTechniqueToMark] = useState(null);
  const [catalogVideoTechnique, setCatalogVideoTechnique] = useState(null);
  const [performanceVideoRecord, setPerformanceVideoRecord] = useState(null);

  const { unmarkCompleted, unmarkingId, error: unmarkError } = useUnmarkTechniqueCompleted({
    onUnmarked: removeRecordLocally
  });

  const completedTechniqueIds = new Set((records ?? []).map((record) => record.techniqueId));

  return (
    <div className={styles.wrap}>
      <h2 className={styles.title}>{t('trainerTechniques.bonusSectionTitle')}</h2>

      <div className={styles.completedBlock}>
        <h3 className={styles.blockTitle}>{t('trainerTechniques.completedListTitle')}</h3>
        <CompletedTechniquesList
          records={records}
          isLoading={isRecordsLoading}
          error={recordsError}
          onRetry={refetchRecords}
          onPlay={setPerformanceVideoRecord}
          onUnmark={unmarkCompleted}
          unmarkingId={unmarkingId}
          unmarkError={unmarkError}
        />
      </div>

      <div className={styles.pickerBlock}>
        <h3 className={styles.blockTitle}>{t('trainerTechniques.bonusPoolTitle')}</h3>
        {!isPoolLoading && !poolError && (bonusPool?.length ?? 0) === 0 && (
          <div className={styles.stateText}>{t('trainerTechniques.bonusPoolEmpty')}</div>
        )}
        <JudoTechniquePicker
          techniques={bonusPool}
          isLoading={isPoolLoading}
          error={poolError}
          onRetry={refetchPool}
          completedTechniqueIds={completedTechniqueIds}
          onMarkCompleted={setTechniqueToMark}
          onPlay={setCatalogVideoTechnique}
        />
      </div>

      <MarkTechniqueCompletedModal
        technique={techniqueToMark}
        student={student}
        writeContext={writeContext}
        onCompleted={(record) => {
          addRecordLocally(record);
          setTechniqueToMark(null);
        }}
        onClose={() => setTechniqueToMark(null)}
      />

      <JudoTechniqueVideoModal technique={catalogVideoTechnique} onClose={() => setCatalogVideoTechnique(null)} />

      <StudentVideoPlayerModal
        record={performanceVideoRecord}
        student={student}
        onClose={() => setPerformanceVideoRecord(null)}
      />
    </div>
  );
}
