import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import TrainerKyuTechniqueGrid from '../../components/trainer/TrainerKyuTechniqueGrid.jsx';
import { useJudoTechniques } from '../../hooks/useJudoTechniques.js';
import { getKyuLevels } from '../../services/kyuLookupService.js';
import { getTrainerKyuProgram, saveTrainerKyuProgram } from '../../services/trainerKyuProgramService.js';
import { signOutTrainer } from '../../services/trainerAuthService.js';
import styles from './TrainerKyuProgramPage.module.css';

// /trainer/kyu-program — club-wide конструктор программы необходимых
// техник по Kyu (задача "Club Kyu Technique Program", этап 3). Backend уже
// существует и применён (миграция 20260917120060): public.judo_techniques
// (100 активных техник, НЕ дублируется — читается тем же
// useJudoTechniques/getJudoTechniques, что уже использует
// JudoTechniquePicker), public.kyu_lookup (getKyuLevels — только Kyu,
// Dan отфильтрован), club_kyu_program_items через
// get_trainer_kyu_program/save_trainer_kyu_program (club_id нигде не
// передаётся с клиента — резолвится RPC из сессии тренера).
//
// Программа каждого Kyu независима — переключение Kyu заново запрашивает
// get_trainer_kyu_program для нового kyu_lookup_id, ничего не кэшируется
// между уровнями кроме самого каталога техник (он один общий для всех
// Kyu). savedSelectedIds — последнее подтверждённое состояние текущего
// Kyu, draftSelectedIds — редактируемый черновик; dirty = они различаются.
// Переключение Kyu при dirty=true требует подтверждения (window.confirm) —
// простой guard, без autosave, без сложной модалки (см. задание).
export default function TrainerKyuProgramPage() {
  const { t } = useTranslation();

  const { techniques, isLoading: isCatalogLoading, error: catalogError, refetch: refetchCatalog } = useJudoTechniques();

  const [kyuLevels, setKyuLevels] = useState(null);
  const [kyuLevelsError, setKyuLevelsError] = useState(null);
  const [selectedKyuId, setSelectedKyuId] = useState(null);

  const [savedSelectedIds, setSavedSelectedIds] = useState(new Set());
  const [draftSelectedIds, setDraftSelectedIds] = useState(new Set());
  const [isProgramLoading, setIsProgramLoading] = useState(false);
  const [programError, setProgramError] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [query, setQuery] = useState('');

  useEffect(() => {
    let isCancelled = false;
    getKyuLevels()
      .then((levels) => {
        if (isCancelled) return;
        setKyuLevels(levels);
        if (levels.length > 0) setSelectedKyuId(levels[0].id);
      })
      .catch((err) => {
        if (!isCancelled) setKyuLevelsError(err);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  const loadProgram = useCallback((kyuId) => {
    setIsProgramLoading(true);
    setProgramError(null);
    setSaveState('idle');
    getTrainerKyuProgram(kyuId)
      .then((items) => {
        const ids = new Set(items.map((item) => item.technique_id));
        setSavedSelectedIds(ids);
        setDraftSelectedIds(ids);
      })
      .catch((err) => setProgramError(err))
      .finally(() => setIsProgramLoading(false));
  }, []);

  useEffect(() => {
    if (selectedKyuId !== null) loadProgram(selectedKyuId);
  }, [selectedKyuId, loadProgram]);

  const isDirty =
    draftSelectedIds.size !== savedSelectedIds.size ||
    [...draftSelectedIds].some((id) => !savedSelectedIds.has(id));

  const handleSelectKyu = (kyuId) => {
    if (kyuId === selectedKyuId) return;
    if (isDirty) {
      const confirmed = window.confirm(t('trainerKyuProgram.switchConfirm'));
      if (!confirmed) return;
    }
    setQuery('');
    setSelectedKyuId(kyuId);
  };

  const handleToggleTechnique = (techniqueId) => {
    setSaveState('idle');
    setDraftSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(techniqueId)) {
        next.delete(techniqueId);
      } else {
        next.add(techniqueId);
      }
      return next;
    });
  };

  const handleDiscard = () => {
    setDraftSelectedIds(savedSelectedIds);
    setSaveState('idle');
  };

  const handleSave = async () => {
    setSaveState('saving');
    try {
      await saveTrainerKyuProgram(selectedKyuId, [...draftSelectedIds]);
      setSavedSelectedIds(draftSelectedIds);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const handleLogout = async () => {
    await signOutTrainer();
    window.location.href = '/';
  };

  const selectedKyuLabel = kyuLevels?.find((level) => level.id === selectedKyuId)?.kyuGrad ?? '';

  return (
    <div className={styles.page}>
      <TrainerHeader title={t('trainerDashboard.kyuProgramTitle')} showBack onLogout={handleLogout} />

      <div className={styles.content}>
        {kyuLevelsError && (
          <div className={styles.stateBox}>{t('trainerKyuProgram.kyuLevelsLoadError')}</div>
        )}

        {!kyuLevelsError && !kyuLevels && (
          <div className={styles.stateBox}>{t('trainerKyuProgram.loadingKyuLevels')}</div>
        )}

        {kyuLevels && kyuLevels.length > 0 && (
          <>
            <div className={styles.kyuSelector}>
              {kyuLevels.map((level) => (
                <button
                  key={level.id}
                  type="button"
                  className={`${styles.kyuButton} ${level.id === selectedKyuId ? styles.kyuButtonActive : ''}`}
                  onClick={() => handleSelectKyu(level.id)}
                >
                  {level.kyuGrad}
                </button>
              ))}
            </div>

            <div className={styles.selectedKyuLabel}>
              {t('trainerKyuProgram.kyuSelectedLabel')} <strong>{selectedKyuLabel}</strong>
            </div>

            {programError && (
              <div className={styles.stateBox}>
                {t('trainerKyuProgram.programLoadError')}
                <button type="button" className={styles.retryButton} onClick={() => loadProgram(selectedKyuId)}>
                  {t('trainerKyuProgram.retry')}
                </button>
              </div>
            )}

            {!programError && isProgramLoading && (
              <div className={styles.stateBox}>{t('trainerKyuProgram.loadingProgram')}</div>
            )}

            {!programError && !isProgramLoading && (
              <>
                <div className={styles.counter}>
                  {t('trainerKyuProgram.selectedCount', { count: draftSelectedIds.size })}
                </div>

                <TrainerKyuTechniqueGrid
                  techniques={techniques}
                  isLoading={isCatalogLoading}
                  error={catalogError}
                  onRetry={refetchCatalog}
                  query={query}
                  onQueryChange={setQuery}
                  selectedIds={draftSelectedIds}
                  onToggle={handleToggleTechnique}
                />

                <div className={styles.saveBar}>
                  <div className={styles.saveBarStatus}>
                    {saveState === 'saved' && <span className={styles.saveBarSaved}>{t('studentPageConfig.savedMessage')}</span>}
                    {saveState === 'error' && <span className={styles.saveBarError}>{t('trainerKyuProgram.saveError')}</span>}
                    {saveState === 'idle' && isDirty && (
                      <span className={styles.saveBarUnsaved}>{t('studentPageConfig.unsavedChanges')}</span>
                    )}
                  </div>
                  <div className={styles.saveBarActions}>
                    <button
                      type="button"
                      className={styles.discardButton}
                      onClick={handleDiscard}
                      disabled={!isDirty || saveState === 'saving'}
                    >
                      {t('studentPageConfig.discardButton')}
                    </button>
                    <button
                      type="button"
                      className={styles.saveButton}
                      onClick={handleSave}
                      disabled={!isDirty || saveState === 'saving'}
                    >
                      {saveState === 'saving' ? t('studentPageConfig.saving') : t('trainerKyuProgram.saveButton')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
