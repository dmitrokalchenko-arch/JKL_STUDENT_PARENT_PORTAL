import { useTranslation } from 'react-i18next';
import { DASHBOARD_SECTIONS, dashboardButtons } from '../../config/dashboardButtons.js';
import TrainingsSection from './TrainingsSection.jsx';
import FamilySection from './FamilySection.jsx';
import ContractSection from './ContractSection.jsx';
import PlaceholderSection from './PlaceholderSection.jsx';
import styles from './ContentArea.module.css';

export default function ContentArea({
  activeSection,
  trainings,
  familyAccount,
  children,
  contract
}) {
  const { t } = useTranslation();
  const activeLabelKey = dashboardButtons.find((b) => b.id === activeSection)?.labelKey;

  // При первом открытии страницы ни одна вкладка не активна — под кнопками
  // ничего не отображается, пока пользователь сам не выберет раздел.
  if (!activeSection) return null;

  let content;
  switch (activeSection) {
    case DASHBOARD_SECTIONS.TRAININGS:
      content = <TrainingsSection trainings={trainings} />;
      break;
    case DASHBOARD_SECTIONS.FAMILY:
      content = <FamilySection familyAccount={familyAccount} children={children} />;
      break;
    case DASHBOARD_SECTIONS.CONTRACT:
      content = <ContractSection contract={contract} />;
      break;
    default:
      content = <PlaceholderSection title={activeLabelKey ? t(activeLabelKey) : ''} />;
  }

  return <div className={styles.area}>{content}</div>;
}
