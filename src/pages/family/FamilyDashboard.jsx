import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../layouts/DashboardLayout.jsx';
import FamilyHeader from '../../components/family/FamilyHeader.jsx';
import ChildSelector from '../../components/family/ChildSelector.jsx';
import StudentProfileCard from '../../components/family/StudentProfileCard.jsx';
import AgeIndicator from '../../components/family/AgeIndicator.jsx';
import RatingIndicator from '../../components/family/RatingIndicator.jsx';
import DashboardButtons from '../../components/family/DashboardButtons.jsx';
import ContentArea from '../../components/family/ContentArea.jsx';
import TechniqueProgressSection from '../../components/family/TechniqueProgressSection.jsx';

import { useFamilyData } from '../../hooks/useFamilyData.js';
import { useSelectedChild } from '../../hooks/useSelectedChild.js';
import { useActiveSection } from '../../hooks/useActiveSection.js';
import { useTechniqueProgress } from '../../hooks/useTechniqueProgress.js';

import { signOutFamily } from '../../services/familyAuthService.js';
import { familyMock } from '../../mocks/familyMock.js';
import { trainingsMock } from '../../mocks/trainingsMock.js';
import { contractMock } from '../../mocks/contractMock.js';
import { familyAccountMock } from '../../mocks/familyAccountMock.js';

import styles from './FamilyDashboard.module.css';

export default function FamilyDashboard() {
  const { t } = useTranslation();
  const {
    family,
    children,
    loading: isFamilyLoading,
    error: familyError,
    reload: reloadFamily
  } = useFamilyData();
  const { selectedChild, selectedId, selectChild } = useSelectedChild(children);
  const { activeSection, selectSection } = useActiveSection();
  const {
    data: techniqueProgress,
    isLoading: isTechniqueProgressLoading,
    error: techniqueProgressError,
    refetch: refetchTechniqueProgress
  } = useTechniqueProgress(selectedChild?.id);

  // Ошибка выхода намеренно проглатывается здесь: сама сессия проверяется
  // заново при следующей загрузке (useFamilySession), пользователю нечего
  // сделать с деталями сбоя signOut на этом этапе задачи.
  const handleLogout = () => {
    signOutFamily().catch(() => {});
  };

  if (isFamilyLoading) {
    return <div className={styles.emptyState}>{t('common.loading')}</div>;
  }

  if (familyError) {
    return (
      <div className={styles.emptyState}>
        <div>{t('errors.familyLoadError')}</div>
        <button type="button" className={styles.retryButton} onClick={reloadFamily}>
          {t('techniqueProgress.retry')}
        </button>
      </div>
    );
  }

  if (!selectedChild) {
    return <div className={styles.emptyState}>{t('errors.noChildrenLinked')}</div>;
  }

  return (
    <DashboardLayout
      header={
        <FamilyHeader
          familyName={family.displayName || familyMock.familyName}
          notificationsCount={familyMock.notificationsCount}
          onLogout={handleLogout}
        />
      }
      selector={
        <ChildSelector
          children={children}
          selectedId={selectedId}
          onSelect={selectChild}
        />
      }
    >
      <div className={styles.overviewRow}>
        <StudentProfileCard child={selectedChild} />
        {selectedChild.ageEligibility && <AgeIndicator eligibility={selectedChild.ageEligibility} />}
        {selectedChild.rating && <RatingIndicator rating={selectedChild.rating} />}
      </div>

      <TechniqueProgressSection
        progressData={techniqueProgress}
        isLoading={isTechniqueProgressLoading}
        error={techniqueProgressError}
        onRetry={refetchTechniqueProgress}
      />

      <DashboardButtons activeSection={activeSection} onSelectSection={selectSection} />

      <ContentArea
        activeSection={activeSection}
        trainings={trainingsMock[selectedChild.id]}
        familyAccount={familyAccountMock}
        children={children}
        contract={contractMock[selectedChild.id]}
      />
    </DashboardLayout>
  );
}
