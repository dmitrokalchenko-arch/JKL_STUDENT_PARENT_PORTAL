import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import TrainerDashboardCard from '../../components/trainer/TrainerDashboardCard.jsx';
import { trainerDashboardSections } from '../../config/trainerDashboardSections.js';
import { signOutTrainer } from '../../services/trainerAuthService.js';
import styles from './TrainerDashboard.module.css';

// Точка входа тренерской области после успешного логина (см. App.jsx).
// Ровно две карточки на этом этапе — «Найти страницу ученика» и
// «Настроить вид страницы ученика» — согласно заданию, третья карточка не
// добавляется.
//
// UNIFIED ROLE LOGOUT: handleLogout — единственное новое место, вызывающее
// signOutTrainer() (БЕЗ ИЗМЕНЕНИЙ в самой функции) с этой страницы; после
// успешного завершения — явный переход на `/` (тот же паттерн
// window.location.href, что уже используют TrainerDashboardCard/
// TrainerHeader-back-кнопка). В отличие от Family (FamilyDashboard уже
// рендерится НА `/`, поэтому signOutFamily "бесплатно" приводит обратно к
// Unified Login тем же рендером App.jsx) — здесь URL другой (/trainer),
// без явного redirect logout оставил бы пользователя на /trainer, где
// TrainerAuthGuard просто снова показал бы старый TrainerLogin, а не
// Unified Login, что прямо противоречит заданию.
export default function TrainerDashboard() {
  const { t } = useTranslation();

  const handleLogout = async () => {
    await signOutTrainer();
    window.location.href = '/';
  };

  return (
    <div className={styles.page}>
      <TrainerHeader title={t('trainerDashboard.title')} onLogout={handleLogout} />

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
