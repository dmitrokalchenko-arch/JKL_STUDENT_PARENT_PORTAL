import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import PlaceholderSection from '../../components/family/PlaceholderSection.jsx';
import styles from './TrainerStudentPage.module.css';

// Маршрут /trainer/student/:studentId — существует на этом этапе только
// как приёмник маршрута (см. App.jsx), чтобы клик по подсказке поиска в
// будущем имел куда вести. Family Block в режиме Trainer View, RPC и поиск
// по базе учеников — предмет отдельного, ещё не начатого этапа.
export default function TrainerStudentPage({ studentId }) {
  const { t } = useTranslation();

  return (
    <div className={styles.page}>
      <TrainerHeader title={t('trainerDashboard.findStudentTitle')} showBack />

      <div className={styles.content}>
        <PlaceholderSection title={t('trainerDashboard.findStudentTitle')} />
        {studentId && <div className={`${styles.debugId} ltr-isolate`}>{studentId}</div>}
      </div>
    </div>
  );
}
