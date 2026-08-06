import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import TrainerDashboardCard from '../../components/trainer/TrainerDashboardCard.jsx';
import { trainerDashboardSections } from '../../config/trainerDashboardSections.js';
import styles from './TrainerDashboard.module.css';

// Точка входа тренерской области после успешного логина (см. App.jsx).
// Ровно две карточки на этом этапе — «Найти страницу ученика» и
// «Настроить вид страницы ученика» — согласно заданию, третья карточка не
// добавляется.
export default function TrainerDashboard() {
  const { t } = useTranslation();

  return (
    <div className={styles.page}>
      <TrainerHeader title={t('trainerDashboard.title')} />

      <div className={styles.grid}>
        {trainerDashboardSections.map((section) => (
          <TrainerDashboardCard
            key={section.id}
            title={t(section.titleKey)}
            description={t(section.descriptionKey)}
            icon={section.icon}
            path={section.path}
          />
        ))}
      </div>
    </div>
  );
}
