import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import TrainerKyuTechniqueGrid from '../../components/trainer/TrainerKyuTechniqueGrid.jsx';
import KyuProgramBlocks from '../../components/trainer/KyuProgramBlocks.jsx';
import KyuBeltImage from '../../components/trainer/KyuBeltImage.jsx';
import Icon from '../../components/common/Icon.jsx';
import { useJudoTechniques } from '../../hooks/useJudoTechniques.js';
import { useTrainerStudentProfile } from '../../hooks/useTrainerStudentProfile.js';
import { getTrainerRequiredTechniques } from '../../services/requiredTechniquesService.js';
import {
  saveTrainerStudentKyuProgram,
  resetTrainerStudentKyuProgram
} from '../../services/trainerStudentKyuProgramService.js';
import { signOutTrainer } from '../../services/trainerAuthService.js';
import {
  createEmptyKyuProgram,
  cloneKyuProgram,
  kyuProgramsEqual,
  kyuProgramTotalCount,
  kyuProgramFromItems,
  kyuProgramToItems
} from '../../utils/kyuProgram.js';
import styles from './TrainerKyuProgramPage.module.css';
import ownStyles from './TrainerStudentKyuProgramPage.module.css';

const KNOWN_REASONS = ['not_allowed', 'page_inactive', 'target_kyu_changed', 'invalid_items', 'version_conflict'];

// /trainer/student/:studentId/required-techniques — редактор ИНДИВИДУАЛЬНОЙ
// программы "Необходимых техник" ученика для его следующего Kyu (этап 2,
// миграция 20260930100076).
//
// Источник данных — тот же get_trainer_required_techniques, что и раздел
// «Необходимые техники» на странице ученика: он уже отдаёт EFFECTIVE
// program (individual, если есть active-версия, иначе программа клуба),
// target Kyu (nextKyuLookupId), version и canEdit. Поэтому первое открытие
// без индивидуальной программы начинается с программы клуба, и до Save в БД
// ничего не создаётся. target Kyu НЕ берётся из URL — только из ответа
// сервера, а Save/Reset сервер ещё раз сверяет с актуальным Kyu ученика.
//
// ПЕРЕИСПОЛЬЗОВАНИЕ: KyuProgramBlocks / TrainerKyuTechniqueGrid /
// KyuBeltImage / TrainerHeader / useJudoTechniques / utils/kyuProgram.js и
// CSS-модуль TrainerKyuProgramPage — тот же приём, что TrainerKyuTemplatePage.
// Club Kyu editor (TrainerKyuProgramPage) не меняется.
export default function TrainerStudentKyuProgramPage({ studentId }) {
  const { t } = useTranslation();

  const { techniques, isLoading: isCatalogLoading, error: catalogError, refetch: refetchCatalog } = useJudoTechniques();
  const { student, isLoading: isProfileLoading, error: profileError, reload: reloadProfile } = useTrainerStudentProfile(studentId);

  const [program, setProgram] = useState(null);
  const [isProgramLoading, setIsProgramLoading] = useState(false);
  const [programError, setProgramError] = useState(null);
  const [savedProgram, setSavedProgram] = useState(createEmptyKyuProgram());
  const [draftProgram, setDraftProgram] = useState(createEmptyKyuProgram());
  const [activeBlock, setActiveBlock] = useState('required_nage');
  const [query, setQuery] = useState('');
  // idle | saving | resetting | saved | reset | error — reason только для error.
  const [action, setAction] = useState({ state: 'idle', reason: null });

  const studentRowId = student?.id ?? null;

  const loadProgram = useCallback(() => {
    if (studentRowId === null) return;
    setIsProgramLoading(true);
    setProgramError(null);
    getTrainerRequiredTechniques(studentRowId)
      .then((result) => {
        const blocks = kyuProgramFromItems(
          result.techniques.map((technique) => ({ technique_id: technique.id, block_type: technique.block_type }))
        );
        setProgram(result);
        setSavedProgram(blocks);
        setDraftProgram(cloneKyuProgram(blocks));
        setActiveBlock('required_nage');
      })
      .catch((err) => setProgramError(err))
      .finally(() => setIsProgramLoading(false));
  }, [studentRowId]);

  useEffect(() => {
    loadProgram();
  }, [loadProgram]);

  const isDirty = !kyuProgramsEqual(draftProgram, savedProgram);
  const isBusy = action.state === 'saving' || action.state === 'resetting' || isProgramLoading;
  const isIndividual = program?.source === 'individual';

  const clearActionState = () => {
    if (action.state !== 'idle') setAction({ state: 'idle', reason: null });
  };

  const handleToggleTechnique = (techniqueId) => {
    clearActionState();
    setDraftProgram((prev) => {
      const next = cloneKyuProgram(prev);
      const blockSet = next[activeBlock];
      if (blockSet.has(techniqueId)) {
        blockSet.delete(techniqueId);
      } else {
        blockSet.add(techniqueId);
      }
      return next;
    });
  };

  const handleRemoveFromBlock = (blockType, techniqueId) => {
    clearActionState();
    setDraftProgram((prev) => {
      const next = cloneKyuProgram(prev);
      next[blockType].delete(techniqueId);
      return next;
    });
  };

  const handleDiscard = () => {
    setDraftProgram(cloneKyuProgram(savedProgram));
    setAction({ state: 'idle', reason: null });
  };

  const handleSave = async () => {
    setAction({ state: 'saving', reason: null });
    try {
      const result = await saveTrainerStudentKyuProgram(
        studentRowId,
        program.nextKyuLookupId,
        kyuProgramToItems(draftProgram),
        program.version
      );
      if (result?.ok) {
        setAction({ state: 'saved', reason: null });
        loadProgram();
      } else {
        setAction({ state: 'error', reason: result?.reason ?? null });
      }
    } catch {
      setAction({ state: 'error', reason: null });
    }
  };

  const handleReset = async () => {
    if (!window.confirm(t('trainerStudentKyuProgram.resetConfirm'))) return;
    setAction({ state: 'resetting', reason: null });
    try {
      const result = await resetTrainerStudentKyuProgram(studentRowId, program.nextKyuLookupId, program.version);
      if (result?.ok) {
        setAction({ state: 'reset', reason: null });
        loadProgram();
      } else {
        setAction({ state: 'error', reason: result?.reason ?? null });
      }
    } catch {
      setAction({ state: 'error', reason: null });
    }
  };

  const handleLogout = async () => {
    await signOutTrainer();
    window.location.href = '/';
  };

  const studentName = student ? `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() : '';
  const backTo = `/trainer/student/${encodeURIComponent(studentId)}?section=techniques`;
  const title =
    student && program?.status === 'ok' && program?.nextKyu
      ? t('trainerStudentKyuProgram.title', { name: studentName, kyu: program.nextKyu })
      : t('trainerStudentKyuProgram.titleGeneric');

  const header = <TrainerHeader title={title} showBack backTo={backTo} onLogout={handleLogout} />;

  // ── page-level states ─────────────────────────────────────────────────
  let blockingState = null;
  if (isProfileLoading || (student && program === null && !programError)) {
    blockingState = <div className={styles.plainStateBox}>{t('common.loading')}</div>;
  } else if (profileError) {
    blockingState = (
      <div className={styles.plainStateBox}>
        {t('trainerTechniques.studentLoadError')}
        <button type="button" className={styles.retryButton} onClick={reloadProfile}>
          {t('trainerTechniques.retry')}
        </button>
      </div>
    );
  } else if (!student) {
    blockingState = <div className={styles.plainStateBox}>{t('trainerTechniques.accessDenied')}</div>;
  } else if (programError) {
    blockingState = (
      <div className={styles.plainStateBox}>
        {t('requiredTechniques.loadError')}
        <button type="button" className={styles.retryButton} onClick={loadProgram}>
          {t('requiredTechniques.retry')}
        </button>
      </div>
    );
  } else if (program.status === 'max_level') {
    blockingState = <div className={styles.plainStateBox}>{t('requiredTechniques.maxLevel')}</div>;
  } else if (program.status === 'unmapped_kyu') {
    blockingState = <div className={styles.plainStateBox}>{t('requiredTechniques.unmappedKyu')}</div>;
  } else if (program.status !== 'ok' || !program.canEdit || !program.nextKyuLookupId) {
    blockingState = <div className={styles.plainStateBox}>{t('trainerStudentKyuProgram.unavailable')}</div>;
  }

  if (blockingState) {
    return (
      <div className={styles.page}>
        {header}
        {blockingState}
      </div>
    );
  }

  const errorText =
    action.state === 'error'
      ? t(`trainerStudentKyuProgram.errors.${KNOWN_REASONS.includes(action.reason) ? action.reason : 'generic'}`)
      : null;

  return (
    <div className={styles.page}>
      {header}

      <div className={styles.stickyPanel}>
        <div className={styles.stickyInner}>
          <div className={ownStyles.targetRow}>
            <KyuBeltImage kyuGrad={program.nextKyu} className={styles.kyuBeltIcon} />
            <span className={styles.selectedKyuLabel}>
              {t('trainerStudentKyuProgram.targetKyu')} <strong>{program.nextKyu}</strong>
            </span>
            {isIndividual ? (
              <span className={ownStyles.individualBadge}>
                {t('trainerStudentKyuProgram.sourceIndividual', { version: program.version })}
              </span>
            ) : (
              <span className={ownStyles.clubBadge}>{t('trainerStudentKyuProgram.sourceClub')}</span>
            )}
          </div>

          <div className={styles.statusRow}>
            <div className={styles.statusInfo}>
              <span className={styles.counter}>
                {t('trainerKyuProgram.selectedCount', { count: kyuProgramTotalCount(draftProgram) })}
              </span>
              {action.state === 'saved' && <span className={styles.saveBarSaved}>{t('studentPageConfig.savedMessage')}</span>}
              {action.state === 'reset' && (
                <span className={styles.saveBarSaved}>{t('trainerStudentKyuProgram.resetDone')}</span>
              )}
              {errorText && <span className={styles.saveBarError}>{errorText}</span>}
              {action.state === 'idle' && isDirty && (
                <span className={styles.saveBarUnsaved}>{t('studentPageConfig.unsavedChanges')}</span>
              )}
            </div>
            <div className={`${styles.statusActions} ${ownStyles.actionsWrap}`}>
              {isIndividual && (
                <button type="button" className={ownStyles.resetButton} onClick={handleReset} disabled={isBusy}>
                  {action.state === 'resetting' ? t('studentPageConfig.saving') : t('trainerStudentKyuProgram.resetButton')}
                </button>
              )}
              <button
                type="button"
                className={styles.discardButton}
                onClick={handleDiscard}
                disabled={!isDirty || isBusy}
              >
                {t('studentPageConfig.discardButton')}
              </button>
              <button type="button" className={styles.saveButton} onClick={handleSave} disabled={!isDirty || isBusy}>
                {action.state === 'saving' ? t('studentPageConfig.saving') : t('trainerKyuProgram.saveButton')}
              </button>
            </div>
          </div>

          {!isIndividual && (
            <div className={styles.sourceInfoBar}>
              <Icon name="info" size={16} className={styles.sourceInfoIcon} />
              <span>{t('trainerStudentKyuProgram.clubStartHint', { kyu: program.nextKyu })}</span>
            </div>
          )}

          <KyuProgramBlocks
            techniques={techniques}
            program={draftProgram}
            activeBlock={activeBlock}
            onActivate={setActiveBlock}
            onRemove={handleRemoveFromBlock}
          />

          <label className={styles.searchField}>
            <Icon name="search" size={16} className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              type="search"
              value={query}
              placeholder={t('trainerKyuProgram.searchPlaceholder')}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck="false"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className={styles.catalogArea}>
        <TrainerKyuTechniqueGrid
          techniques={techniques}
          isLoading={isCatalogLoading}
          error={catalogError}
          onRetry={refetchCatalog}
          query={query}
          selectedIds={draftProgram[activeBlock]}
          onToggle={handleToggleTechnique}
        />
      </div>
    </div>
  );
}
