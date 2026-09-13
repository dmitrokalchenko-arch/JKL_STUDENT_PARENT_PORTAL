import { useTranslation } from 'react-i18next';
import StudentProfileCard from '../../components/family/StudentProfileCard.jsx';
import { useStudentPreview } from '../../hooks/useStudentPreview.js';
import styles from './StudentPreviewPage.module.css';

// /admin-preview/:token — открывается ТОЛЬКО из Block 1 (JCL_Gruppen, Super
// Admin, кнопка «👁 Family-Seite ansehen»), новой вкладкой, БЕЗ family/
// trainer-сессии (см. App.jsx — этот маршрут проверяется ДО FamilyLogin/
// TrainerAuthGuard, ничего из них здесь не задействовано).
//
// Единственный источник данных — одноразовый Super Admin Preview токен из
// URL (get-student-preview, Edge Function, ещё НЕ задеплоена). Токен
// потребляется РОВНО ОДИН РАЗ — обновление страницы/повторный визит по той
// же ссылке всегда покажет invalidOrExpired.
//
// Первый этап (согласовано в задаче): доказать безопасную связь Block 1 →
// Block 3, НЕ переносить сюда весь FamilyDashboard — только карточка
// ученика (StudentProfileCard, тот же компонент, что на Family Dashboard и
// в будущем Trainer View — accessMode = 'superadmin' появится позже вместе
// с общим StudentPageContent, не на этом этапе).
export default function StudentPreviewPage({ token }) {
  const { t } = useTranslation();
  const { student, isLoading, error } = useStudentPreview(token);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={`${styles.brand} ltr-isolate`}>
          <span className={styles.logo}>JKL</span>
          <span className={styles.logoSub}>CLUB</span>
        </div>
        <span className={styles.badge}>{t('studentPreview.badge')}</span>
      </header>

      <div className={styles.content}>
        {isLoading && <div className={styles.stateText}>{t('common.loading')}</div>}

        {!isLoading && error && (
          <div className={styles.errorBox}>{t('studentPreview.invalidOrExpired')}</div>
        )}

        {!isLoading && !error && student && (
          <>
            <div className={`${styles.debugId} ltr-isolate`}>{student.studentId}</div>
            <StudentProfileCard
              child={{
                id: student.studentId,
                firstName: student.firstName,
                lastName: student.lastName,
                sportName: student.sportName,
                groupName: student.groupName,
                beltLabel: student.beltLabel
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
