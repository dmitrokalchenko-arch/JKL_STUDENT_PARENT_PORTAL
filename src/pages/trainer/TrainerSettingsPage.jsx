import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import PlaceholderSection from '../../components/family/PlaceholderSection.jsx';
import styles from './TrainerSettingsPage.module.css';

// Открывается карточкой «Ansicht der Schülerseite anpassen» с Dashboard
// (/trainer/settings). На этом этапе — временная заглушка с локализованным
// заголовком: включение/отключение карточек Family Block и их порядок —
// предмет отдельного этапа (хранение конфигурации, RPC).
export default function TrainerSettingsPage() {
  const { t } = useTranslation();

  return (
    <div className={styles.page}>
      <TrainerHeader title={t('trainerDashboard.settingsTitle')} showBack />

      <div className={styles.content}>
        <PlaceholderSection title={t('trainerDashboard.settingsTitle')} />
      </div>
    </div>
  );
}
