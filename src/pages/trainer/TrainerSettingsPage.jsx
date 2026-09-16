import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import StudentPageContent from '../../components/student/StudentPageContent.jsx';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import { SectionToggleCard, NavigationTogglesCard } from '../../components/trainer/StudentPageSettingsPanels.jsx';
import { signOutTrainer } from '../../services/trainerAuthService.js';
import {
  getTrainerStudentPageConfig,
  saveTrainerStudentPageConfig
} from '../../services/studentPageConfigService.js';
import { DEFAULT_STUDENT_PAGE_CONFIG, mergeStudentPageConfig } from '../../config/studentPageConfig.js';
import styles from './TrainerSettingsPage.module.css';

// CLUB-WIDE STUDENT PAGE SETTINGS MODE — открывается карточкой «Настроить
// вид страницы ученика» с Trainer Dashboard (/trainer/settings, маршрут не
// менялся). StudentProfileCard здесь работает в mode="settings"
// (5-колоночный конструктор 14 полей), плюс две SectionToggleCard
// (Rating/Bonus Techniques) и одна NavigationTogglesCard (6 nav-карточек)
// — все три из StudentPageSettingsPanels.jsx, переданы через
// StudentPageContent.settingsPanels. Всё вместе образует ОДИН
// studentPageConfig объект (см. src/config/studentPageConfig.js) —
// единственный источник видимости для этой страницы и для реальных
// Family/Trainer Student Page/Super Admin Preview (см. итоговый отчёт
// задачи "student-profile-club-wide-config").
//
// САМА КОНФИГУРАЦИЯ ТЕПЕРЬ CLUB-WIDE И СОХРАНЯЕТСЯ (в отличие от PR #10,
// где fieldVisibility был чисто frontend-only state, который сбрасывался
// при reload): draftConfig — текущий редактируемый черновик, savedConfig —
// последнее подтверждённое сохранённое состояние (или
// DEFAULT_STUDENT_PAGE_CONFIG, пока клуб ни разу не сохранял). Кнопка
// "Сохранить" появляется активной только когда draftConfig отличается от
// savedConfig; "Отменить изменения" откатывает draftConfig обратно на
// savedConfig без сетевого запроса.
//
// ⚠️ persistence требует миграции 20260916140057
// (club_student_page_settings + 3 RPC), которая НЕ применена к production
// на этом шаге (см. итоговый отчёт) — до её применения
// getTrainerStudentPageConfig()/saveTrainerStudentPageConfig() будут
// получать "функция не существует" от Supabase; get честно откатывается
// на DEFAULT_STUDENT_PAGE_CONFIG (см. её комментарий), save показывает
// t('studentPageConfig.saveError') — это ОЖИДАЕМОЕ, не баг, поведение на
// Deploy Preview этого PR.
export default function TrainerSettingsPage() {
  const { t } = useTranslation();
  const [savedConfig, setSavedConfig] = useState(DEFAULT_STUDENT_PAGE_CONFIG);
  const [draftConfig, setDraftConfig] = useState(DEFAULT_STUDENT_PAGE_CONFIG);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error

  useEffect(() => {
    let isCancelled = false;
    getTrainerStudentPageConfig().then((raw) => {
      if (isCancelled) return;
      const merged = mergeStudentPageConfig(raw);
      setSavedConfig(merged);
      setDraftConfig(merged);
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  const hasUnsavedChanges = JSON.stringify(draftConfig) !== JSON.stringify(savedConfig);

  // Любое новое изменение черновика сбрасывает предыдущий save-статус
  // ("Настройки сохранены"/"Ошибка сохранения" не должны висеть на экране
  // после того, как trainer уже успел изменить что-то ещё).
  const editDraft = (updater) => {
    setSaveState('idle');
    setDraftConfig(updater);
  };

  const handleFieldToggle = (key) => {
    editDraft((prev) => ({ ...prev, profileFields: { ...prev.profileFields, [key]: !prev.profileFields[key] } }));
  };

  const handleSectionToggle = (key) => {
    editDraft((prev) => ({ ...prev, sections: { ...prev.sections, [key]: !prev.sections[key] } }));
  };

  const handleNavigationToggle = (key) => {
    editDraft((prev) => ({ ...prev, navigation: { ...prev.navigation, [key]: !prev.navigation[key] } }));
  };

  const handleDiscard = () => {
    setDraftConfig(savedConfig);
    setSaveState('idle');
  };

  const handleSave = async () => {
    setSaveState('saving');
    try {
      await saveTrainerStudentPageConfig(draftConfig);
      setSavedConfig(draftConfig);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const handleLogout = async () => {
    await signOutTrainer();
    window.location.href = '/';
  };

  return (
    <StudentPageContent
      accessMode="trainer"
      header={
        <div className={styles.header}>
          <TrainerHeader title={t('trainerDashboard.settingsTitle')} showBack onLogout={handleLogout} />
          <div className={styles.scopeNote}>{t('trainerDashboard.settingsPageScopeNote')}</div>
        </div>
      }
      profileMode="settings"
      fieldVisibility={draftConfig.profileFields}
      onFieldToggle={handleFieldToggle}
      settingsPanels={
        <div className={styles.panelsStack}>
          <SectionToggleCard
            icon="trophy"
            title={t('studentPage.futureRatingBlock.title')}
            badge={t('studentPageConfig.futureBadge')}
            description={t('studentPage.futureRatingBlock.description')}
            active={draftConfig.sections.ratingEligibility}
            onToggle={() => handleSectionToggle('ratingEligibility')}
          />

          <SectionToggleCard
            icon="belt"
            title={t('techniqueProgress.title')}
            description={t('studentPageConfig.bonusDescription')}
            active={draftConfig.sections.bonusTechniques}
            onToggle={() => handleSectionToggle('bonusTechniques')}
          />

          <NavigationTogglesCard navigation={draftConfig.navigation} onToggle={handleNavigationToggle} />

          <div className={styles.saveBar}>
            <div className={styles.saveBarStatus}>
              {saveState === 'saved' && <span className={styles.saveBarSaved}>{t('studentPageConfig.savedMessage')}</span>}
              {saveState === 'error' && <span className={styles.saveBarError}>{t('studentPageConfig.saveError')}</span>}
              {saveState === 'idle' && hasUnsavedChanges && (
                <span className={styles.saveBarUnsaved}>{t('studentPageConfig.unsavedChanges')}</span>
              )}
            </div>
            <div className={styles.saveBarActions}>
              <button
                type="button"
                className={styles.discardButton}
                onClick={handleDiscard}
                disabled={!hasUnsavedChanges || saveState === 'saving'}
              >
                {t('studentPageConfig.discardButton')}
              </button>
              <button
                type="button"
                className={styles.saveButton}
                onClick={handleSave}
                disabled={!hasUnsavedChanges || saveState === 'saving'}
              >
                {saveState === 'saving' ? t('studentPageConfig.saving') : t('studentPageConfig.saveButton')}
              </button>
            </div>
          </div>
        </div>
      }
      showNavigationCards={false}
    />
  );
}
