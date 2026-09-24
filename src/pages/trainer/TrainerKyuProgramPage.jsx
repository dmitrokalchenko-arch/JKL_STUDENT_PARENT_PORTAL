import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import TrainerKyuTechniqueGrid from '../../components/trainer/TrainerKyuTechniqueGrid.jsx';
import Icon from '../../components/common/Icon.jsx';
import KyuBeltImage from '../../components/trainer/KyuBeltImage.jsx';
import KyuSourceCards from '../../components/trainer/KyuSourceCards.jsx';
import KyuProgramBlocks from '../../components/trainer/KyuProgramBlocks.jsx';
import { useJudoTechniques } from '../../hooks/useJudoTechniques.js';
import { getKyuLevels } from '../../services/kyuLookupService.js';
import { getTrainerKyuProgram, saveTrainerKyuProgram } from '../../services/trainerKyuProgramService.js';
import { getTrainerKyuTemplate } from '../../services/trainerKyuTemplateService.js';
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
// ТРИ БЛОКА (этап "Trainer Kyu-Programm — три блока"): программа Kyu —
// не плоский Set technique_id, а объект {required_nage, required_katame,
// additional} — по одному Set на блок. Чистые helpers над этой формой
// (createEmptyKyuProgram/cloneKyuProgram/kyuProgramsEqual/
// kyuProgramTotalCount/kyuProgramFromItems/kyuProgramToItems) вынесены в
// src/utils/kyuProgram.js — TrainerKyuTemplatePage.jsx (общий редактор
// DJB/Go Kyu шаблонов) использует ТЕ ЖЕ функции без копирования этой логики.
// savedProgram — последнее подтверждённое состояние всех трёх блоков
// текущего Kyu, draftProgram — редактируемый черновик; isDirty сравнивает
// ВСЕ три блока. activeBlock — чистый UI-state (какой блок сейчас цель
// добавления из каталога), сам по себе НИЧЕГО не сохраняет и не помечает
// программу dirty. Клик по карточке техники в каталоге ниже
// (handleToggleTechnique) переключает её принадлежность ИМЕННО в
// draftProgram[activeBlock] — никакой проверки category/main_group
// техники относительно блока нет и не должно быть (см. задание, раздел
// 6: названия блоков — организационная структура, а не validation
// rules). Одна и та же technique_id может быть одновременно в нескольких
// блоках одного Kyu — это две разные записи программы, а не дубликат
// (см. миграцию 20260927100072).
//
// TEMPLATE APPLY (этап "DJB template" раздел 6, "Go Kyu template" раздел
// 9-11): клик по самой карточке DJB/Go Kyu (НЕ по ⚙️) загружает
// сохранённый шаблон текущего Kyu и подставляет его как НОВЫЙ
// draftProgram — savedProgram при этом НЕ трогается, поэтому после
// применения isDirty становится true (если шаблон отличается от уже
// сохранённой программы) и требует обычного нажатия «Сохранить», чтобы
// стать фактической программой Kyu (COPY, не live binding — см. задание
// "Go Kyu template", раздел 9/10: изменение шаблона в будущем никогда не
// меняет уже сохранённую программу задним числом). DJB и Go Kyu —
// независимые шаблоны одного Kyu (разные template_type одной и той же
// club_kyu_template_items, см. миграцию 20260928100073, ЕЩЁ НЕ применена
// к production): применение одного не трогает сохранённые данные
// другого. Обе карточки используют ОДИН обработчик handleApplyTemplate
// (templateType-параметр), а не два почти одинаковых — единственное,
// что отличается между DJB/Go Kyu на этой странице, это какой
// template_type передать.
// Возврат из редактора шаблона (TrainerKyuTemplatePage, кнопка «Назад» —
// TrainerHeader делает window.location.href = backTo, т.е. ПОЛНЫЙ reload
// приложения, весь React-state этой страницы теряется). Чтобы после
// Save/Back пользователь вернулся туда же, откуда зашёл в редактор
// (выбранный Kyu + активная source-карточка DJB/Go Kyu), а не на дефолт
// (первый Kyu в списке + «Все техники»), редактор кодирует контекст
// возврата прямо в query-строку backTo (?kyu=<id>&source=djb|goKyu) — ЭТО
// ЕДИНСТВЕННЫЙ канал передачи: страница не хранится смонтированной, значит
// ни module-level переменная, ни sessionStorage не нужны — URL уже
// одноразово переживает reload сам по себе, ничего дополнительного заводить
// не требуется (см. задание — «минимальное решение без глобального state,
// если глобальный state не нужен»).
//
// ВАЖНО: это ТОЛЬКО восстановление UI-контекста (какой Kyu выбран, какая
// карточка подсвечена) — НЕ повторное применение шаблона. draftProgram
// как и раньше всегда загружается через обычный loadProgram(selectedKyuId)
// (реальная сохранённая программа клуба), а не через handleApplyTemplate —
// иначе возврат из редактора незаметно перезаписывал бы черновик текущим
// содержимым шаблона, чего никто не просил и не ожидает просто от нажатия
// «Назад».
function readReturnContext() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const kyuParam = params.get('kyu');
  const sourceParam = params.get('source');
  const kyuId = kyuParam !== null ? Number(kyuParam) : NaN;
  const source = sourceParam === 'djb' || sourceParam === 'goKyu' ? sourceParam : null;
  if (!Number.isFinite(kyuId) && !source) return null;
  return { kyuId: Number.isFinite(kyuId) ? kyuId : null, source };
}

export default function TrainerKyuProgramPage() {
  const { t } = useTranslation();

  const { techniques, isLoading: isCatalogLoading, error: catalogError, refetch: refetchCatalog } = useJudoTechniques();

  const [kyuLevels, setKyuLevels] = useState(null);
  const [kyuLevelsError, setKyuLevelsError] = useState(null);
  const [selectedKyuId, setSelectedKyuId] = useState(null);

  const [savedProgram, setSavedProgram] = useState(createEmptyKyuProgram());
  const [draftProgram, setDraftProgram] = useState(createEmptyKyuProgram());
  // Баг ("DJB -> Go Kyu -> DJB снова не применяется"): подтверждение
  // переключения template-источника (ниже, handleApplyTemplate) раньше
  // сравнивало draftProgram с savedProgram (реальная сохранённая программа
  // клуба). Но сразу после ЛЮБОГО успешного применения шаблона draft
  // почти ВСЕГДА отличается от savedProgram (это ожидаемо — трогать
  // savedProgram при apply нельзя, см. snapshot rule) — значит isDirty
  // оставался true после каждого apply, и КАЖДОЕ следующее переключение
  // DJB<->Go Kyu заново открывало window.confirm(). При свободном
  // переключении "сколько угодно раз" это быстро приводило к нескольким
  // confirm() подряд — начиная с определённого момента браузер (Chrome)
  // молча подавляет повторные confirm()-диалоги той же страницы
  // ("Prevent this page from creating additional dialogs"), из-за чего
  // повторный клик по DJB выглядел как "вообще не срабатывает".
  //
  // lastSyncedProgram — отдельная baseline ИМЕННО для guard'а переключения
  // источника: программа как она была сразу после последней "чистой" точки
  // (загрузка Kyu / успешный apply шаблона / Save / Discard). Обновляется
  // ВЕЗДЕ, где обновляется savedProgram, И ДОПОЛНИТЕЛЬНО после успешного
  // apply шаблона (в отличие от savedProgram, которую apply намеренно не
  // трогает). handleToggleTechnique/handleRemoveFromBlock её НЕ трогают —
  // значит она отличается от draftProgram ТОЛЬКО когда тренер реально
  // вручную отредактировал текущий draft после последней чистой точки, и
  // confirm при переключении шаблона показывается ровно тогда, когда есть
  // что реально потерять (test 8/9), а не при каждом чистом
  // template-to-template переключении (test 1-3).
  const [lastSyncedProgram, setLastSyncedProgram] = useState(createEmptyKyuProgram());
  const [activeBlock, setActiveBlock] = useState('required_nage');
  const [isProgramLoading, setIsProgramLoading] = useState(false);
  const [programError, setProgramError] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [query, setQuery] = useState('');
  // Источник программы (DJB/Все техники/Go Kyu) — ТОЛЬКО frontend
  // view-переключатель для 'all', нигде не сохраняется (см.
  // KyuSourceCards.jsx). Не влияет и не сбрасывает draftProgram/
  // savedProgram сам по себе. Исключение — клик по самой карточке
  // DJB/Go Kyu (handleApplyTemplate ниже): единственное действие среди
  // трёх карточек, которое реально подставляет данные в draftProgram
  // (загруженный шаблон), а не просто переключает видимую область.
  const [sourceMode, setSourceMode] = useState('all');
  const [isTemplateLoading, setIsTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState(null);
  // Баг ("Go Kyu ACTIVE, но блоки показывают не Go Kyu template"): восстановление
  // Kyu/sourceMode (mount-эффект ниже) и loadProgram (отдельный эффект,
  // реагирующий на selectedKyuId) были полностью независимы — loadProgram
  // ВСЕГДА тянул реальную сохранённую программу клуба в draftProgram/
  // lastSyncedProgram, независимо от того, что sourceMode тем временем уже
  // показывал 'goKyu'/'djb'. pendingTemplateRestoreRef — единственный мост
  // между ними: mount-эффект заполняет его ОДИН раз ({kyuId, source}),
  // ТОЛЬКО когда return-context валиден, loadProgram читает и сразу же
  // очищает его (одноразовое потребление — последующие переключения Kyu тем
  // же id НЕ должны снова триггерить auto-apply). useRef, а не state — само
  // чтение/запись не должно вызывать лишний render, значение нужно только
  // ВНУТРИ loadProgram синхронно в момент вызова.
  const pendingTemplateRestoreRef = useRef(null);

  useEffect(() => {
    let isCancelled = false;
    getKyuLevels()
      .then((levels) => {
        if (isCancelled) return;
        setKyuLevels(levels);
        if (levels.length === 0) return;

        // Прямой вход БЕЗ query-контекста (обычная навигация на
        // /trainer/kyu-program, TEST 6 задания) — прежнее поведение без
        // изменений: первый Kyu из списка, sourceMode остаётся 'all'
        // (дефолт из useState выше, здесь ничего не трогаем).
        const returnContext = readReturnContext();
        const restoredKyu =
          returnContext?.kyuId !== null && returnContext?.kyuId !== undefined
            ? levels.find((level) => level.id === returnContext.kyuId)
            : null;
        setSelectedKyuId(restoredKyu ? restoredKyu.id : levels[0].id);
        // sourceMode выставляется сразу для мгновенной визуальной обратной
        // связи (подсветка карточки не должна ждать сетевого fetch). Если
        // restoredKyu не найден (невалидный/устаревший ?kyu=), source из
        // того же битого контекста тоже не применяем — откатываемся к
        // чистому дефолту целиком.
        //
        // ВАЖНО (см. комментарий у pendingTemplateRestoreRef выше): раньше
        // здесь заканчивалось восстановление UI-контекста, а draftProgram
        // всегда приходил из loadProgram = реальная club-программа, НЕ
        // template — отсюда рассинхронизация "Go Kyu active, но блоки не
        // Go Kyu". Теперь дополнительно кладём {kyuId, source} в ref —
        // loadProgram (эффект ниже, сработает на следующий рендер из-за
        // setSelectedKyuId) сам решит, откуда взять draftProgram/
        // lastSyncedProgram для ИМЕННО этого первого запроса.
        if (restoredKyu && returnContext.source) {
          setSourceMode(returnContext.source);
          pendingTemplateRestoreRef.current = { kyuId: restoredKyu.id, source: returnContext.source };
        }
        // URL подчищается сразу после однократного использования — иначе
        // обычный F5 на этой странице снова и снова навязывал бы контекст
        // редактора, из которого пользователь давно ушёл.
        if (returnContext && typeof window !== 'undefined') {
          window.history.replaceState(null, '', '/trainer/kyu-program');
        }
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
  //
  // pendingRestore (см. pendingTemplateRestoreRef выше): если это ИМЕННО
  // тот вызов loadProgram, что соответствует one-shot return-context из
  // template editor — savedProgram всё равно грузится из реальной
  // club-программы (она нужна truthfully для isDirty/Save/Discard, snapshot
  // rule не меняется), НО draftProgram/lastSyncedProgram в этом случае
  // берутся из ЗАГРУЖЕННОГО ШАБЛОНА, а не из club-программы. Два fetch'а
  // (getTrainerKyuProgram/getTrainerKyuTemplate) идут параллельно и КАЖДЫЙ
  // пишет в СВОЙ, непересекающийся набор state — savedProgram трогает
  // только программный .then, draftProgram/lastSyncedProgram только
  // шаблонный .then — порядок разрешения промисов не важен, гонки между
  // ними структурно невозможны (не потому что "обычно успевает", а потому
  // что они физически не пишут в одни и те же переменные).
  const loadProgram = useCallback((kyuId) => {
    const pendingRestore =
      pendingTemplateRestoreRef.current && pendingTemplateRestoreRef.current.kyuId === kyuId
        ? pendingTemplateRestoreRef.current
        : null;
    // Потребляется ОДИН раз здесь независимо от исхода (использован он
    // сейчас или нет) — повторный вызов loadProgram для того же kyuId
    // (например, повторный клик по тому же Kyu в селекторе) больше не
    // должен снова навязывать auto-apply шаблона.
    pendingTemplateRestoreRef.current = null;

    setIsProgramLoading(true);
    setProgramError(null);
    setSaveState('idle');
    setSavedProgram(createEmptyKyuProgram());
    setDraftProgram(createEmptyKyuProgram());
    setLastSyncedProgram(createEmptyKyuProgram());
    setActiveBlock('required_nage');

    if (pendingRestore) {
      setIsTemplateLoading(true);
      setTemplateError(null);
    }

    getTrainerKyuProgram(kyuId)
      .then((items) => {
        const program = kyuProgramFromItems(items);
        setSavedProgram(program);
        if (!pendingRestore) {
          setDraftProgram(cloneKyuProgram(program));
          setLastSyncedProgram(cloneKyuProgram(program));
        }
      })
      .catch((err) => setProgramError(err))
      .finally(() => setIsProgramLoading(false));

    if (pendingRestore) {
      getTrainerKyuTemplate(kyuId, pendingRestore.source)
        .then((items) => {
          const program = kyuProgramFromItems(items);
          setDraftProgram(program);
          setLastSyncedProgram(cloneKyuProgram(program));
        })
        .catch((err) => setTemplateError(err))
        .finally(() => setIsTemplateLoading(false));
    }
  }, []);

  useEffect(() => {
    if (selectedKyuId !== null) loadProgram(selectedKyuId);
  }, [selectedKyuId, loadProgram]);

  const isDirty = !kyuProgramsEqual(draftProgram, savedProgram);
  // Loading/error относятся к попытке применить шаблон — актуальны, только
  // пока sourceMode реально указывает на тот шаблон (djb/goKyu), который
  // сейчас грузится/только что упал; при sourceMode='all' блоки/каталог
  // показываются как обычно независимо от того, что templateError мог
  // остаться от предыдущей неудачной попытки (handleApplyTemplate сам
  // сбрасывает его в начале следующей попытки).
  const isApplyingTemplate = (sourceMode === 'djb' || sourceMode === 'goKyu') && (isTemplateLoading || templateError);

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

  // Кнопка × внутри блока — удаляет из ЭТОГО конкретного блока
  // (переданного явно), независимо от того, какой блок сейчас active.
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
    setLastSyncedProgram(cloneKyuProgram(savedProgram));
    setSaveState('idle');
  };

  const handleSave = async () => {
    setSaveState('saving');
    try {
      const items = kyuProgramToItems(draftProgram);
      await saveTrainerKyuProgram(selectedKyuId, items);
      setSavedProgram(cloneKyuProgram(draftProgram));
      setLastSyncedProgram(cloneKyuProgram(draftProgram));
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  // Клик по САМОЙ карточке DJB/Go Kyu (не по ⚙️) — применяет сохранённый
  // шаблон текущего Kyu как НОВЫЙ draftProgram (копия, не live binding).
  // savedProgram не трогается: если шаблон отличается от уже сохранённой
  // программы, isDirty станет true, и потребуется обычное «Сохранить»,
  // чтобы сделать его фактической программой (см. задание "Go Kyu
  // template", раздел 9/10). Один обработчик на оба источника —
  // templateType определяет, какой шаблон запросить.
  const handleApplyTemplate = async (templateType) => {
    if (selectedKyuId === null) return;
    // Сравнение именно с lastSyncedProgram, НЕ с savedProgram — см.
    // комментарий у lastSyncedProgram выше. confirm должен защищать от
    // потери РЕАЛЬНЫХ ручных правок, а не срабатывать просто потому что
    // применённый шаблон (ожидаемо) отличается от ещё не сохранённой
    // программы клуба.
    if (!kyuProgramsEqual(draftProgram, lastSyncedProgram)) {
      const confirmed = window.confirm(t(`trainerKyuProgram.${templateType}.applyConfirm`));
      if (!confirmed) return;
    }
    setSourceMode(templateType);
    setIsTemplateLoading(true);
    setTemplateError(null);
    try {
      const items = await getTrainerKyuTemplate(selectedKyuId, templateType);
      const program = kyuProgramFromItems(items);
      setDraftProgram(program);
      setLastSyncedProgram(cloneKyuProgram(program));
      setActiveBlock('required_nage');
      setSaveState('idle');
    } catch (err) {
      setTemplateError(err);
    } finally {
      setIsTemplateLoading(false);
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

              <KyuSourceCards
                mode={sourceMode}
                onSelect={setSourceMode}
                onApplyDjb={() => handleApplyTemplate('djb')}
                djbEditorHref={selectedKyuId !== null ? `/trainer/kyu-program/djb/${selectedKyuId}` : null}
                onApplyGoKyu={() => handleApplyTemplate('goKyu')}
                goKyuEditorHref={selectedKyuId !== null ? `/trainer/kyu-program/go-kyu/${selectedKyuId}` : null}
              />

              <div className={styles.sourceInfoBar}>
                <Icon name="info" size={16} className={styles.sourceInfoIcon} />
                <span>{t('trainerKyuProgram.source.infoBar', { kyu: selectedKyuLabel })}</span>
              </div>

              {!isApplyingTemplate && (
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

            {canEditSelection && (sourceMode === 'djb' || sourceMode === 'goKyu') && isTemplateLoading && (
              <div className={styles.plainStateBox}>{t(`trainerKyuProgram.${sourceMode}.loadingTemplate`)}</div>
            )}

            {canEditSelection && (sourceMode === 'djb' || sourceMode === 'goKyu') && !isTemplateLoading && templateError && (
              <div className={styles.plainStateBox}>
                {t(`trainerKyuProgram.${sourceMode}.loadTemplateError`)}
                <button type="button" className={styles.retryButton} onClick={() => handleApplyTemplate(sourceMode)}>
                  {t('trainerKyuProgram.retry')}
                </button>
              </div>
            )}

            {canEditSelection && !isApplyingTemplate && (
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
