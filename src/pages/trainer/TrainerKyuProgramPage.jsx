import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import TrainerKyuTechniqueGrid from '../../components/trainer/TrainerKyuTechniqueGrid.jsx';
import Icon from '../../components/common/Icon.jsx';
import KyuBeltImage from '../../components/trainer/KyuBeltImage.jsx';
import KyuSourceCards from '../../components/trainer/KyuSourceCards.jsx';
import KyuProgramBlocks, { KYU_PROGRAM_BLOCK_TYPES } from '../../components/trainer/KyuProgramBlocks.jsx';
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
// Kyu). Переключение Kyu при dirty=true требует подтверждения
// (window.confirm) — простой guard, без autosave, без сложной модалки
// (см. задание).
//
// STICKY CONTROL PANEL (этап "UX-доработка"): Kyu-селектор/счётчик/
// Save-Cancel/источник/блоки/поиск теперь в одной position:sticky-панели
// над каталогом — TrainerHeader НЕ менялся (он не sticky сам по себе,
// поэтому просто скроллится вместе со страницей до того, как включится
// sticky-панель — перекрытия нет без единой правки в самом хедере).
//
// ТРИ БЛОКА (этап "Trainer Kyu-Programm — три блока", только режим "Все
// техники"): программа Kyu теперь не плоский Set technique_id, а объект
// {required_nage, required_katame, additional} — по одному Set на блок
// (createEmptyProgram/cloneProgram/programsEqual/programTotalCount ниже).
// savedProgram — последнее подтверждённое состояние всех трёх блоков
// текущего Kyu, draftProgram — редактируемый черновик; isDirty сравнивает
// ВСЕ три блока (programsEqual). activeBlock — чистый UI-state (какой
// блок сейчас цель добавления из каталога), сам по себе НИЧЕГО не
// сохраняет и не помечает программу dirty. Клик по карточке техники в
// каталоге ниже (handleToggleTechnique) переключает её принадлежность
// ИМЕННО в draftProgram[activeBlock] — никакой проверки
// category/main_group техники относительно блока нет и не должно быть
// (см. задание, раздел 6: названия блоков — организационная структура,
// а не validation rules). Одна и та же technique_id может быть
// одновременно в нескольких блоках одного Kyu — это две разные записи
// программы, а не дубликат (см. миграцию 20260927100072).
function createEmptyProgram() {
  return { required_nage: new Set(), required_katame: new Set(), additional: new Set() };
}

function cloneProgram(program) {
  return {
    required_nage: new Set(program.required_nage),
    required_katame: new Set(program.required_katame),
    additional: new Set(program.additional)
  };
}

function programsEqual(a, b) {
  return KYU_PROGRAM_BLOCK_TYPES.every((blockType) => {
    if (a[blockType].size !== b[blockType].size) return false;
    for (const techniqueId of a[blockType]) {
      if (!b[blockType].has(techniqueId)) return false;
    }
    return true;
  });
}

function programTotalCount(program) {
  return KYU_PROGRAM_BLOCK_TYPES.reduce((sum, blockType) => sum + program[blockType].size, 0);
}

export default function TrainerKyuProgramPage() {
  const { t } = useTranslation();

  const { techniques, isLoading: isCatalogLoading, error: catalogError, refetch: refetchCatalog } = useJudoTechniques();

  const [kyuLevels, setKyuLevels] = useState(null);
  const [kyuLevelsError, setKyuLevelsError] = useState(null);
  const [selectedKyuId, setSelectedKyuId] = useState(null);

  const [savedProgram, setSavedProgram] = useState(createEmptyProgram());
  const [draftProgram, setDraftProgram] = useState(createEmptyProgram());
  const [activeBlock, setActiveBlock] = useState('required_nage');
  const [isProgramLoading, setIsProgramLoading] = useState(false);
  const [programError, setProgramError] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [query, setQuery] = useState('');
  // Источник программы (DJB/Все техники/Go Kyu) — ТОЛЬКО frontend
  // view-переключатель, нигде не сохраняется (см. KyuSourceCards.jsx).
  // Не влияет и не сбрасывает draftProgram/savedProgram.
  const [sourceMode, setSourceMode] = useState('all');

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
    setSavedProgram(createEmptyProgram());
    setDraftProgram(createEmptyProgram());
    setActiveBlock('required_nage');
    getTrainerKyuProgram(kyuId)
      .then((items) => {
        const program = createEmptyProgram();
        items.forEach((item) => {
          if (program[item.block_type]) {
            program[item.block_type].add(item.technique_id);
          }
        });
        setSavedProgram(program);
        setDraftProgram(cloneProgram(program));
      })
      .catch((err) => setProgramError(err))
      .finally(() => setIsProgramLoading(false));
  }, []);

  useEffect(() => {
    if (selectedKyuId !== null) loadProgram(selectedKyuId);
  }, [selectedKyuId, loadProgram]);

  const isDirty = !programsEqual(draftProgram, savedProgram);

  const handleSelectKyu = (kyuId) => {
    if (kyuId === selectedKyuId) return;
    if (isDirty) {
      const confirmed = window.confirm(t('trainerKyuProgram.switchConfirm'));
      if (!confirmed) return;
    }
    setQuery('');
    setSelectedKyuId(kyuId);
  };

  // Клик по карточке техники в каталоге — всегда относится к ТЕКУЩЕМУ
  // activeBlock (см. задание, раздел 12): toggle технику именно в нём,
  // остальные два блока не трогаются.
  const handleToggleTechnique = (techniqueId) => {
    setSaveState('idle');
    setDraftProgram((prev) => {
      const next = cloneProgram(prev);
      const blockSet = next[activeBlock];
      if (blockSet.has(techniqueId)) {
        blockSet.delete(techniqueId);
      } else {
        blockSet.add(techniqueId);
      }
      return next;
    });
  };

  // Кнопка × внутри блока — удаляет из ЭТОГО конкретного блока
  // (переданного явно), независимо от того, какой блок сейчас active.
  const handleRemoveFromBlock = (blockType, techniqueId) => {
    setSaveState('idle');
    setDraftProgram((prev) => {
      const next = cloneProgram(prev);
      next[blockType].delete(techniqueId);
      return next;
    });
  };

  const handleDiscard = () => {
    setDraftProgram(cloneProgram(savedProgram));
    setSaveState('idle');
  };

  const handleSave = async () => {
    setSaveState('saving');
    try {
      const items = KYU_PROGRAM_BLOCK_TYPES.flatMap((blockType) =>
        [...draftProgram[blockType]].map((techniqueId) => ({ technique_id: techniqueId, block_type: blockType }))
      );
      await saveTrainerKyuProgram(selectedKyuId, items);
      setSavedProgram(cloneProgram(draftProgram));
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
                    {t('trainerKyuProgram.selectedCount', { count: programTotalCount(draftProgram) })}
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

              <KyuSourceCards mode={sourceMode} onSelect={setSourceMode} />

              <div className={styles.sourceInfoBar}>
                <Icon name="info" size={16} className={styles.sourceInfoIcon} />
                <span>{t('trainerKyuProgram.source.infoBar', { kyu: selectedKyuLabel })}</span>
              </div>

              {sourceMode === 'all' && (
                <KyuProgramBlocks
                  techniques={techniques}
                  program={draftProgram}
                  activeBlock={activeBlock}
                  onActivate={setActiveBlock}
                  onRemove={handleRemoveFromBlock}
                />
              )}

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

            {canEditSelection && sourceMode === 'all' && (
              <TrainerKyuTechniqueGrid
                techniques={techniques}
                isLoading={isCatalogLoading}
                error={catalogError}
                onRetry={refetchCatalog}
                query={query}
                selectedIds={draftProgram[activeBlock]}
                onToggle={handleToggleTechnique}
              />
            )}

            {canEditSelection && sourceMode !== 'all' && (
              <div className={styles.plainStateBox}>
                {t(`trainerKyuProgram.source.${sourceMode}.emptyTemplate`, { kyu: selectedKyuLabel })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
