import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../layouts/DashboardLayout.jsx';
import StudentProfileCard from '../family/StudentProfileCard.jsx';
import TechniqueProgressSection from '../family/TechniqueProgressSection.jsx';
import DashboardButtons from '../family/DashboardButtons.jsx';
import ContentArea from '../family/ContentArea.jsx';
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
// Обе технические/навигационные секции — ОПЦИОНАЛЬНЫЕ и не рендерятся,
// пока вызывающая страница явно не передаст соответствующие пропы:
//   - techniqueProgress === undefined -> секция прогресса вообще не
//     рендерится (а не "вечная загрузка" — TechniqueProgressSection сама по
//     себе не умеет отличить "данных ещё нет от этого потребителя" от
//     "идёт реальная загрузка", поэтому это разруливается здесь).
//   - showNavigationCards (по умолчанию false) — ряд карточек «Моя семья/
//     Мои тренировки/...» показывается только если вызывающая страница
//     явно попросила (сейчас — только /dev/student-page-preview с
//     mock-данными). Это НЕ включает новые данные для существующего
//     Super Admin Preview (StudentPreviewPage) — тот продолжает вызывать
//     этот компонент без этих пропов и визуально не меняется на этом шаге.
//
// header/selector — pass-through в DashboardLayout: у каждой роли своя
// шапка (Family: приветствие+выход, Trainer: back-кнопка, Super Admin
// Preview: бренд+бейдж) — этот компонент не диктует, как она выглядит.
export default function StudentPageContent({
  student,
  accessMode,
  header,
  selector,
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

  // Локальное состояние активной навигационной карточки — только когда
  // вызывающая страница не управляет им сама (activeSection не передан).
  // Ровно тот же паттерн, что useActiveSection.js у FamilyDashboard, но не
  // завязан на её конкретный хук — держим это внутри shell, раз никто
  // снаружи пока не обязан этим управлять.
  const [internalActiveSection, setInternalActiveSection] = useState(null);
  const activeSection = activeSectionProp !== undefined ? activeSectionProp : internalActiveSection;
  const handleSelectSection = onSelectSection ?? setInternalActiveSection;

  return (
    <DashboardLayout header={header} selector={selector}>
      <span className={styles.modeBadge}>{t(`studentPage.accessMode.${mode}`)}</span>

      <div className={styles.overviewRow}>
        <StudentProfileCard child={student} />
      </div>

      {techniqueProgress !== undefined && (
        <TechniqueProgressSection
          progressData={techniqueProgress}
          isLoading={isTechniqueProgressLoading}
          error={techniqueProgressError}
          onRetry={onRetryTechniqueProgress}
        />
      )}

      {showNavigationCards && (
        <>
          <DashboardButtons activeSection={activeSection} onSelectSection={handleSelectSection} />
          <ContentArea
            activeSection={activeSection}
            trainings={trainings}
            familyAccount={familyAccount}
            children={familyChildren}
            contract={contract}
          />
        </>
      )}

      {children}
    </DashboardLayout>
  );
}
