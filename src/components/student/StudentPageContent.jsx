import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../layouts/DashboardLayout.jsx';
import StudentProfileCard from '../family/StudentProfileCard.jsx';
import TechniqueProgressSection from '../family/TechniqueProgressSection.jsx';
import DashboardButtons from '../family/DashboardButtons.jsx';
import ContentArea from '../family/ContentArea.jsx';
import { mergeStudentPageConfig } from '../../config/studentPageConfig.js';
import styles from './StudentPageContent.module.css';

export const STUDENT_PAGE_ACCESS_MODES = ['family', 'trainer', 'superadmin'];

// Общий presentation-каркас Student Page — единственный источник дизайна
// для всех трёх ролей (family/trainer/superadmin), а не три расходящиеся
// копии. НЕ делает запросов к Supabase сам: все данные приходят готовыми
// пропами, у каждого accessMode свой data-loader снаружи (RPC/Edge Function
// решает вызывающая страница, не этот компонент).
//
// Секции ниже — те же презентационные компоненты, что уже использует
// FamilyDashboard (TechniqueProgressSection/DashboardButtons/ContentArea,
// которые сами разворачивают TrainingsSection/FamilySection/ContractSection/
// PlaceholderSection) — не второй похожий UI, тот же самый.
//
// studentPageConfig — ЕДИНАЯ club-wide конфигурация (см.
// src/config/studentPageConfig.js) — источник истины для видимости полей
// StudentProfileCard, блока Bonus Techniques и nav-карточек. Не задан ->
// mergeStudentPageConfig(undefined) откатывается на DEFAULT_STUDENT_PAGE_CONFIG,
// который воспроизводит ТЕКУЩЕЕ production-поведение (backward-compat
// default, см. итоговый отчёт задачи "student-profile-club-wide-config").
//
// Обе технические/навигационные секции — ОПЦИОНАЛЬНЫЕ и не рендерятся,
// пока вызывающая страница явно не передаст соответствующие пропы:
//   - techniqueProgress === undefined -> секция прогресса вообще не
//     рендерится (а не "вечная загрузка"). Если проп передан — секция ещё
//     дополнительно гейтится config.sections.bonusTechniques (club-wide
//     "показывать ли весь блок целиком" — задание, раздел 8).
//   - showNavigationCards (по умолчанию false) — ряд карточек «Моя семья/
//     Мои тренировки/...» показывается, если вызывающая страница попросила.
//     Каждая отдельная карточка внутри дополнительно фильтруется
//     config.navigation (задание, раздел 9-10) — DashboardButtons сам
//     решает, какие id показать.
//   - Содержимое под карточками: если ни trainings, ни familyAccount, ни
//     contract не переданы (все undefined) — вместо ContentArea показывается
//     нейтральная заглушка "данные подключим позже".
//
// header/selector — pass-through в DashboardLayout.
//
// profileMode/fieldVisibility/onFieldToggle — используются ТОЛЬКО в
// settings mode (TrainerSettingsPage передаёt profileMode="settings" +
// локальный черновик конфигурации + onFieldToggle). Во всех остальных
// случаях profileMode не задан -> StudentProfileCard рендерится в normal
// mode с config.profileFields из studentPageConfig (реальная, уже
// сохранённая club-wide конфигурация, а не черновик).
//
// settingsPanels — необязательный узел, рендерится один раз сразу под
// профилем. undefined везде, кроме /trainer/settings — там TrainerSettingsPage
// composes туда карточки Rating/Bonus Techniques/Navigation-toggles (см.
// StudentPageSettingsPanels.jsx). Реальные Student Pages его не получают.
export default function StudentPageContent({
  student,
  accessMode,
  header,
  selector,
  studentPageConfig,
  profileMode,
  fieldVisibility,
  onFieldToggle,
  settingsPanels,
  techniqueProgress,
  isTechniqueProgressLoading,
  techniqueProgressError,
  onRetryTechniqueProgress,
  showNavigationCards = false,
  activeSection: activeSectionProp,
  onSelectSection,
  trainings,
  familyAccount,
  familyChildren = [],
  contract,
  children
}) {
  const { t } = useTranslation();
  const mode = STUDENT_PAGE_ACCESS_MODES.includes(accessMode) ? accessMode : 'family';
  const config = mergeStudentPageConfig(studentPageConfig);

  const isSettingsMode = profileMode === 'settings';
  const resolvedFieldVisibility = isSettingsMode ? fieldVisibility : config.profileFields;
  const resolvedOnFieldToggle = isSettingsMode ? onFieldToggle : undefined;

  // Локальное состояние активной навигационной карточки — только когда
  // вызывающая страница не управляет им сама (activeSection не передан).
  const [internalActiveSection, setInternalActiveSection] = useState(null);
  const activeSection = activeSectionProp !== undefined ? activeSectionProp : internalActiveSection;
  const handleSelectSection = onSelectSection ?? setInternalActiveSection;

  // Реальные данные для секций под карточками ещё не подключены ни для
  // одного accessMode на этом шаге — если вызывающая страница не передала
  // НИ ОДНОГО из трёх, показываем нейтральное "подключим позже" вместо
  // падения на отсутствующих данных внутри FamilySection/TrainingsSection/
  // ContractSection.
  const hasRealSectionData = trainings !== undefined || familyAccount !== undefined || contract !== undefined;

  return (
    <DashboardLayout header={header} selector={selector}>
      <span className={styles.modeBadge}>{t(`studentPage.accessMode.${mode}`)}</span>

      <div className={styles.overviewRow}>
        <StudentProfileCard
          child={student}
          mode={profileMode}
          fieldVisibility={resolvedFieldVisibility}
          onFieldToggle={resolvedOnFieldToggle}
        />
      </div>

      {settingsPanels}

      {techniqueProgress !== undefined && config.sections.bonusTechniques !== false && (
        <TechniqueProgressSection
          progressData={techniqueProgress}
          isLoading={isTechniqueProgressLoading}
          error={techniqueProgressError}
          onRetry={onRetryTechniqueProgress}
        />
      )}

      {showNavigationCards && (
        <>
          <DashboardButtons
            activeSection={activeSection}
            onSelectSection={handleSelectSection}
            navigation={config.navigation}
          />
          {activeSection && !hasRealSectionData && (
            <div className={styles.sectionNotConnected}>{t('studentPage.sectionNotConnectedYet')}</div>
          )}
          {activeSection && hasRealSectionData && (
            <ContentArea
              activeSection={activeSection}
              trainings={trainings}
              familyAccount={familyAccount}
              children={familyChildren}
              contract={contract}
            />
          )}
        </>
      )}

      {children}
    </DashboardLayout>
  );
}
