import { useTranslation } from 'react-i18next';
import DashboardButton from '../common/DashboardButton.jsx';
import { dashboardButtons } from '../../config/dashboardButtons.js';
import styles from './DashboardButtons.module.css';

export default function DashboardButtons({ activeSection, onSelectSection }) {
  const { t } = useTranslation();

  return (
    <div className={styles.row}>
      {dashboardButtons
        .filter((btn) => !btn.disabled)
        .map((btn) => (
          <DashboardButton
            key={btn.id}
            label={t(btn.labelKey)}
            icon={btn.icon}
            active={btn.id === activeSection}
            onClick={() => onSelectSection(btn.id)}
          />
        ))}
    </div>
  );
}
