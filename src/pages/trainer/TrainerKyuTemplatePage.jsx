import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import TrainerKyuTechniqueGrid from '../../components/trainer/TrainerKyuTechniqueGrid.jsx';
import KyuProgramBlocks from '../../components/trainer/KyuProgramBlocks.jsx';
import Icon from '../../components/common/Icon.jsx';
import { useJudoTechniques } from '../../hooks/useJudoTechniques.js';
import { getKyuLevels } from '../../services/kyuLookupService.js';
import { getTrainerKyuTemplate, saveTrainerKyuTemplate } from '../../services/trainerKyuTemplateService.js';
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

// /trainer/kyu-program/djb/:kyuId И /trainer/kyu-program/go-kyu/:kyuId —
// ОДИН общий редактор шаблона (DJB и Go Kyu структурно идентичны: те же
// три блока, тот же каталог, та же save/discard-логика — единственная
// разница была в паре RPC/i18n-текстах, а с миграцией 20260928100073
// («Go Kyu template», раздел 5/6 задания) и это стало просто параметром
// p_template_type). templateType проп ('djb' | 'goKyu') различает:
//   - какие i18n-ключи читать (trainerKyuProgram.djb.*/trainerKyuProgram.
//     goKyu.* — та же структура ключей, что уже была у DJB, отдельный
//     блок goKyu.* просто добавлен рядом, ни один ключ djb.* не менялся);
//   - какой template_type передавать в get/save_trainer_kyu_template
//     (см. TEMPLATE_TYPE_DB_VALUE в trainerKyuTemplateService.js).
// Этот файл заменяет прежний TrainerDjbTemplatePage.jsx (был DJB-only) —
// сам DJB editor при этом ведёт себя ИДЕНТИЧНО тому, что было (тот же
// UX/layout/поведение, проверено регрессионно в preview), просто теперь
// через общий компонент вместо копии для Go Kyu.
//
// kyuId приходит из URL (App.jsx, parseTrainerView) — сознательно НЕТ
// отдельного выбора 9.–1. Kyu на этой странице (см. задание, раздел 2):
// какой Kyu редактируется, целиком определяется тем, откуда пользователь
// пришёл. Kyu показан только в заголовке страницы (title).
//
// ПЕРЕИСПОЛЬЗОВАНИЕ: тот же KyuProgramBlocks, тот же
// TrainerKyuTechniqueGrid, тот же CSS-модуль (TrainerKyuProgramPage.
// module.css — отдельный CSS-файл для этой страницы не создавался), те
// же helpers из src/utils/kyuProgram.js, что и manual editor/DJB editor.
// Шаблон (DJB или Go Kyu) — это источник/пресет, а не сохранённая
// программа клуба: изменения здесь никак не влияют на
// club_kyu_program_items, пока тренер отдельно не нажмёт
// соответствующую карточку на основной странице и затем «Сохранить» там.
export default function TrainerKyuTemplatePage({ kyuId, templateType }) {
  const { t } = useTranslation();
  const kyuLookupId = Number(kyuId);

  const { techniques, isLoading: isCatalogLoading, error: catalogError, refetch: refetchCatalog } = useJudoTechniques();

  const [kyuLevels, setKyuLevels] = useState(null);
  const [kyuLevelsError, setKyuLevelsError] = useState(null);

  const [savedProgram, setSavedProgram] = useState(createEmptyKyuProgram());
  const [draftProgram, setDraftProgram] = useState(createEmptyKyuProgram());
  const [activeBlock, setActiveBlock] = useState('required_nage');
  const [isProgramLoading, setIsProgramLoading] = useState(true);
  const [programError, setProgramError] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [query, setQuery] = useState('');

  useEffect(() => {
    let isCancelled = false;
    getKyuLevels()
      .then((levels) => {
        if (!isCancelled) setKyuLevels(levels);
      })
      .catch((err) => {
        if (!isCancelled) setKyuLevelsError(err);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  const loadTemplate = useCallback(() => {
    if (!Number.isFinite(kyuLookupId)) {
      setIsProgramLoading(false);
      return;
    }
    setIsProgramLoading(true);
    setProgramError(null);
    setSaveState('idle');
    getTrainerKyuTemplate(kyuLookupId, templateType)
      .then((items) => {
        const program = kyuProgramFromItems(items);
        setSavedProgram(program);
        setDraftProgram(cloneKyuProgram(program));
      })
      .catch((err) => setProgramError(err))
      .finally(() => setIsProgramLoading(false));
  }, [kyuLookupId, templateType]);

  useEffect(() => {
    loadTemplate();
  }, [loadTemplate]);

  const isDirty = !kyuProgramsEqual(draftProgram, savedProgram);

  const handleToggleTechnique = (techniqueId) => {
    setSaveState('idle');
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
    setSaveState('idle');
    setDraftProgram((prev) => {
      const next = cloneKyuProgram(prev);
      next[blockType].delete(techniqueId);
      return next;
    });
  };

  const handleDiscard = () => {
    setDraftProgram(cloneKyuProgram(savedProgram));
    setSaveState('idle');
  };

  const handleSave = async () => {
    setSaveState('saving');
    try {
      const items = kyuProgramToItems(draftProgram);
      await saveTrainerKyuTemplate(kyuLookupId, templateType, items);
      setSavedProgram(cloneKyuProgram(draftProgram));
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const handleLogout = async () => {
    await signOutTrainer();
    window.location.href = '/';
  };

  const matchedKyu = kyuLevels?.find((level) => level.id === kyuLookupId) ?? null;
  const isKnownKyu = kyuLevels ? matchedKyu !== null : null;
  const canEdit = !programError && !isProgramLoading && isKnownKyu !== false;

  // «Назад» должен вернуть на тот же Kyu + ту же активную source-карточку
  // (DJB/Go Kyu), откуда пользователь зашёл в редактор — а не на дефолт
  // основной страницы (первый Kyu + «Все техники», см. баг «UX возврат из
  // template editor»). Кодируем это прямо в backTo query-строкой —
  // TrainerKyuProgramPage сама разбирает её один раз при монтировании (см.
  // readReturnContext там) и НЕ применяет шаблон повторно, только
  // подсвечивает Kyu/карточку. Независимо от Save — контекст в URL один и
  // тот же и при простом «Назад» без изменений, и после Save.
  const backTo = Number.isFinite(kyuLookupId)
    ? `/trainer/kyu-program?kyu=${kyuLookupId}&source=${templateType}`
    : '/trainer/kyu-program';

  return (
    <div className={styles.page}>
      <TrainerHeader
        title={
          matchedKyu
            ? t(`trainerKyuProgram.${templateType}.editorTitle`, { kyu: matchedKyu.kyuGrad })
            : t(`trainerKyuProgram.${templateType}.editorTitleGeneric`)
        }
        showBack
        backTo={backTo}
        onLogout={handleLogout}
      />

      {kyuLevelsError && <div className={styles.plainStateBox}>{t('trainerKyuProgram.kyuLevelsLoadError')}</div>}

      {!kyuLevelsError && kyuLevels && isKnownKyu === false && (
        <div className={styles.plainStateBox}>{t(`trainerKyuProgram.${templateType}.unknownKyu`)}</div>
      )}

      {!kyuLevelsError && (!kyuLevels || isKnownKyu !== false) && (
        <>
          <div className={styles.stickyPanel}>
            <div className={styles.stickyInner}>
              <div className={styles.statusRow}>
                <div className={styles.statusInfo}>
                  <span className={styles.counter}>
                    {t('trainerKyuProgram.selectedCount', { count: kyuProgramTotalCount(draftProgram) })}
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
            {programError && (
              <div className={styles.plainStateBox}>
                {t(`trainerKyuProgram.${templateType}.loadTemplateError`)}
                <button type="button" className={styles.retryButton} onClick={loadTemplate}>
                  {t('trainerKyuProgram.retry')}
                </button>
              </div>
            )}

            {!programError && isProgramLoading && (
              <div className={styles.plainStateBox}>{t(`trainerKyuProgram.${templateType}.loadingTemplate`)}</div>
            )}

            {canEdit && !isProgramLoading && !programError && (
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
          </div>
        </>
      )}
    </div>
  );
}
