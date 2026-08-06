import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import TrainerStudentSearch from '../../components/trainer/TrainerStudentSearch.jsx';
import TrainerGroupsSection from '../../components/trainer/TrainerGroupsSection.jsx';
import { useTrainerGroups } from '../../hooks/useTrainerGroups.js';
import styles from './TrainerStudentsScreen.module.css';

// Открывается карточкой «Schüler suchen» с Dashboard (/trainer/students).
// Список групп тренера перенесён сюда без изменений из прежнего TrainerPage
// (useTrainerGroups/TrainerGroupsSection) — существующий функционал не
// теряется. Поиск ученика (TrainerStudentSearch, search_trainer_students,
// migration 018) размещён в верхней части экрана, над списком групп —
// после выбора подсказки переходит на /trainer/student/:studentId.
export default function TrainerStudentsScreen() {
  const { t } = useTranslation();
  const { groups, isLoading, error, refetch } = useTrainerGroups();

  return (
    <div className={styles.page}>
      <TrainerHeader title={t('trainerDashboard.findStudentTitle')} showBack />

      <div className={styles.content}>
        <TrainerStudentSearch />

        <h2 className={styles.groupsTitle}>{t('trainerGroups.title')}</h2>
        <TrainerGroupsSection groups={groups} isLoading={isLoading} error={error} onRetry={refetch} />
      </div>
    </div>
  );
}
