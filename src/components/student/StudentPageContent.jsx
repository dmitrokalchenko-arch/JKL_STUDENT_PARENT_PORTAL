import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../layouts/DashboardLayout.jsx';
import StudentProfileCard from '../family/StudentProfileCard.jsx';
import styles from './StudentPageContent.module.css';

export const STUDENT_PAGE_ACCESS_MODES = ['family', 'trainer', 'superadmin'];

// Общий presentation-каркас Student Page — единственный источник дизайна
// для всех трёх ролей (family/trainer/superadmin), а не три расходящиеся
// копии. НЕ делает запросов к Supabase сам: student приходит уже готовым
// пропом, у каждого accessMode свой data-loader снаружи (RPC/Edge Function
// решает вызывающая страница, не этот компонент).
//
// Этот этап — только каркас: DashboardLayout + StudentProfileCard + бейдж
// режима доступа. Секции техник/достижений/тренировок/договора и
// Super Admin-действия — предмет последующих отдельных этапов, здесь
// сознательно не добавлены (см. memory/CURRENT_STATUS.md).
//
// header/selector — pass-through в DashboardLayout: у каждой роли своя
// шапка (Family: приветствие+выход, Trainer: back-кнопка, Super Admin
// Preview: бренд+бейдж) — этот компонент не диктует, как она выглядит.
export default function StudentPageContent({ student, accessMode, header, selector, children }) {
  const { t } = useTranslation();
  const mode = STUDENT_PAGE_ACCESS_MODES.includes(accessMode) ? accessMode : 'family';

  return (
    <DashboardLayout header={header} selector={selector}>
      <span className={styles.modeBadge}>{t(`studentPage.accessMode.${mode}`)}</span>

      <div className={styles.overviewRow}>
        <StudentProfileCard child={student} />
      </div>

      {children}
    </DashboardLayout>
  );
}
