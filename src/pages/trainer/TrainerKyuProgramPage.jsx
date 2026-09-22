import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import TrainerKyuTechniqueGrid from '../../components/trainer/TrainerKyuTechniqueGrid.jsx';
import SelectedTechniquesStrip from '../../components/trainer/SelectedTechniquesStrip.jsx';
import Icon from '../../components/common/Icon.jsx';
import KyuBeltImage from '../../components/trainer/KyuBeltImage.jsx';
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
//
// STICKY CONTROL PANEL (этап "UX-доработка"): Kyu-селектор/счётчик/
// Save-Cancel/лента выбранных техник/поиск теперь в одной
// position:sticky-панели над каталогом — TrainerHeader НЕ менялся
// (он не sticky сам по себе, поэтому просто скроллится вместе со
// страницей до того, как включится sticky-панель — перекрытия нет без
// единой правки в самом хедере). SelectedTechniquesStrip — ЧИСТО
// визуальное представление draftSelectedIds (второго state нет, запроса
// к БД нет, см. её собственный комментарий).
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

  // Черновик/сохранённое состояние сбрасываются в пустое множество СРАЗУ
  // при начале загрузки нового Kyu (а не только после ответа RPC) — иначе
  // счётчик/лента в sticky-панели на мгновение показали бы набор ПРЕДЫДУЩЕГО
  // Kyu поверх спиннера, пока идёт запрос нового.
  const loadProgram = useCallback((kyuId) => {
    setIsProgramLoading(true);
    setProgramError(null);
    setSaveState('idle');
    setSavedSelectedIds(new Set());
    setDraftSelectedIds(new Set());
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
  const canEditSelection = !programError && !isProgramLoading;

  return (
    <div className={styles.page}>
      <TrainerHeader title={t('trainerDashboard.kyuProgramTitle')} showBack onLogout={handleLogout} />

      {kyuLevelsError && <div className={styles.plainStateBox}>{t('trainerKyuProgram.kyuLevelsLoadError')}</div>}

      {!kyuLevelsError && !kyuLevels && (
        <div className={styles.plainStateBox}>{t('trainerKyuProgram.loadingKyuLevels')}</div>
      )}

      {kyuLevels && kyuLevels.length > 0 && (
        <>
          <div className={styles.stickyPanel}>
            <div className={styles.stickyInner}>
              <div className={styles.kyuSelector}>
                {kyuLevels.map((level) => (
                  <button
                    key={level.id}
                    type="button"
                    className={`${styles.kyuButton} ${level.id === selectedKyuId ? styles.kyuButtonActive : ''}`}
                    onClick={() => handleSelectKyu(level.id)}
                  >
                    <KyuBeltImage kyuGrad={level.kyuGrad} className={styles.kyuBeltIcon} />
                    <span>{level.kyuGrad}</span>
                  </button>
                ))}
              </div>

              <div className={styles.statusRow}>
                <div className={styles.statusInfo}>
                  <span className={styles.selectedKyuLabel}>
                    {t('trainerKyuProgram.kyuSelectedLabel')} <strong>{selectedKyuLabel}</strong>
                  </span>
                  <span className={styles.counter}>
                    {t('trainerKyuProgram.selectedCount', { count: draftSelectedIds.size })}
                  </span>
                  {saveState === 'saved' && <span className={styles.saveBarSaved}>{t('studentPageConfig.savedMessage')}</span>}
                  {saveState === 'error' && <span className={styles.saveBarError}>{t('trainerKyuProgram.saveError')}</span>}
                  {saveState === 'idle' && isDirty && (
                    <span className={styles.saveBarUnsaved}>{t('studentPageConfig.unsavedChanges')}</span>
                  )}
                </div>
                <div className={styles.statusActions}>
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

              <SelectedTechniquesStrip
                techniques={techniques}
                selectedIds={draftSelectedIds}
                onRemove={handleToggleTechnique}
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
            {programError && (
              <div className={styles.plainStateBox}>
                {t('trainerKyuProgram.programLoadError')}
                <button type="button" className={styles.retryButton} onClick={() => loadProgram(selectedKyuId)}>
                  {t('trainerKyuProgram.retry')}
                </button>
              </div>
            )}

            {!programError && isProgramLoading && (
              <div className={styles.plainStateBox}>{t('trainerKyuProgram.loadingProgram')}</div>
            )}

            {canEditSelection && (
              <TrainerKyuTechniqueGrid
                techniques={techniques}
                isLoading={isCatalogLoading}
                error={catalogError}
                onRetry={refetchCatalog}
                query={query}
                selectedIds={draftSelectedIds}
                onToggle={handleToggleTechnique}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
