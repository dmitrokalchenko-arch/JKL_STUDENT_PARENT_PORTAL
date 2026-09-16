import { useTranslation } from 'react-i18next';
import DashboardButton from '../common/DashboardButton.jsx';
import { dashboardButtons } from '../../config/dashboardButtons.js';
import styles from './DashboardButtons.module.css';

// navigation — club-wide config.navigation (см. studentPageConfig.js) —
// не задан -> ничего дополнительно не фильтрует (все не-disabled кнопки
// видимы, как раньше); задан -> id с navigation[id]===false исчезает
// полностью (задание "student-profile-club-wide-config", раздел 9-10).
export default function DashboardButtons({ activeSection, onSelectSection, navigation }) {
  const { t } = useTranslation();

  return (
    <div className={styles.row}>
      {dashboardButtons
        .filter((btn) => !btn.disabled && (!navigation || navigation[btn.id] !== false))
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
