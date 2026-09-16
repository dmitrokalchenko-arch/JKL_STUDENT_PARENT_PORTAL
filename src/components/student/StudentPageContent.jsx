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
//     Мои тренировки/...» показывается, если вызывающая страница попросила
//     (реальный Super Admin Preview — StudentPreviewPage — и Deploy-Preview
//     demo route оба это делают, см. REAL SUPER ADMIN STUDENT PAGE — STEP 1).
//   - Содержимое под карточками: если ни trainings, ни familyAccount, ни
//     contract не переданы (все undefined) — вместо ContentArea (которая
//     сама разворачивает TrainingsSection/FamilySection/ContractSection и
//     упала бы на FamilySection без familyAccount) показывается нейтральная
//     заглушка "данные подключим позже" — НЕ mock-данные вместо реальных.
//     Как только вызывающая страница передаст хотя бы одно из этих трёх —
//     используется настоящий ContentArea с этими данными (ровно так уже
//     делает demo route).
//
// header/selector — pass-through в DashboardLayout: у каждой роли своя
// шапка (Family: приветствие+выход, Trainer: back-кнопка, Super Admin
// Preview: бренд+бейдж) — этот компонент не диктует, как она выглядит.
//
// profileMode/fieldVisibility/onFieldToggle — чистый pass-through в
// StudentProfileCard (см. её собственный комментарий про normal/settings
// режимы). Все три не заданы почти везде (Family/Trainer Student Page/
// Super Admin Preview) — StudentProfileCard в этом случае ведёт себя
// ТОЧНО как до PR "student-profile-visual-configurator". Единственный
// вызывающий код, который их передаёт — TrainerSettingsPage
// (mode="settings", club-wide конструктор /trainer/settings).
//
// futureRatingPlaceholder — необязательный узел между профилем и
// TechniqueProgressSection. undefined везде, кроме /trainer/settings —
// зарезервированное место будущего блока "Рейтинг и допуск к следующему
// Kyu" (см. TrainerSettingsPage), никакой реальной rating-логики здесь и
// там нет.
export default function StudentPageContent({
  student,
  accessMode,
  header,
  selector,
  profileMode,
  fieldVisibility,
  onFieldToggle,
  futureRatingPlaceholder,
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
          fieldVisibility={fieldVisibility}
          onFieldToggle={onFieldToggle}
        />
      </div>

      {futureRatingPlaceholder}

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
