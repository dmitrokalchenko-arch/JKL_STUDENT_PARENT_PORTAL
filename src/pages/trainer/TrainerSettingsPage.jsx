import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import TrainerDashboardCard from '../../components/trainer/TrainerDashboardCard.jsx';
import { trainerStudentPageSettingsSections } from '../../config/trainerStudentPageSettingsSections.js';
import styles from './TrainerSettingsPage.module.css';

// STUDENT PAGE SETTINGS HUB — открывается карточкой «Настроить вид
// страницы ученика» с Trainer Dashboard (/trainer/settings, маршрут не
// менялся). Это ЕДИНСТВЕННОЕ место, откуда тренер в будущем будет
// управлять структурой Universal Student Page (какие разделы показаны,
// какие блоки активны) — сама эта настраиваемость ещё не реализована,
// см. комментарий в trainerStudentPageSettingsSections.js.
//
// Тот же UX-паттерн, что главная Trainer Dashboard: сетка
// TrainerDashboardCard, переиспользуемый компонент, не копия. Карточки
// берутся из trainerStudentPageSettingsSections — сегодня массив пуст
// (аудит не нашёл ни одной существующей отдельной настройки Student Page
// для переноса сюда), поэтому вместо сетки — честное сообщение "пока нет
// ни одной настройки", а не выдуманные ссылки. Когда появится первая
// реальная настройка, она добавится в конфиг одной записью — эта
// страница уже готова её отрендерить без переделки.
export default function TrainerSettingsPage() {
  const { t } = useTranslation();
  const hasSections = trainerStudentPageSettingsSections.length > 0;

  return (
    <div className={styles.page}>
      <TrainerHeader title={t('trainerDashboard.settingsTitle')} showBack />

      {hasSections ? (
        <div className={styles.grid}>
          {trainerStudentPageSettingsSections.map((section) => (
            <TrainerDashboardCard
              key={section.id}
              title={t(section.titleKey)}
              description={t(section.descriptionKey)}
              icon={section.icon}
              path={section.path}
            />
          ))}
        </div>
      ) : (
        <div className={styles.content}>
          <div className={styles.emptyState}>{t('trainerDashboard.settingsHubEmpty')}</div>
        </div>
      )}
    </div>
  );
}
