import { useTranslation } from 'react-i18next';
import StudentPageContent from '../../components/student/StudentPageContent.jsx';
import { useStudentPreview } from '../../hooks/useStudentPreview.js';
import styles from './StudentPreviewPage.module.css';

// /admin-preview/:token — открывается ТОЛЬКО из Block 1 (JCL_Gruppen, Super
// Admin, кнопка «👁 Family-Seite ansehen» → большое модальное окно с этим
// iframe), БЕЗ family/trainer-сессии (см. App.jsx — этот маршрут
// проверяется ДО FamilyLogin/TrainerAuthGuard, ничего из них здесь не
// задействовано).
//
// Единственный источник данных — одноразовый Super Admin Preview токен из
// URL (get-student-preview) — token flow НЕ менялся на этом этапе, см.
// useStudentPreview.js.
//
// С этого этапа успешно загруженные данные рендерятся через общий
// StudentPageContent (accessMode="superadmin") — тот же presentation-
// каркас, что в будущем будет использовать Family Dashboard и Trainer
// Student Page, вместо собственной отдельной разметки этой страницы.
// Loading/error-состояния остаются локальными для этой страницы (общий
// shell их не знает — он получает student только когда данные уже есть).
//
// REAL SUPER ADMIN STUDENT PAGE — STEP 1: студент ниже — РЕАЛЬНЫЕ данные
// из get-student-preview (studentId/firstName/lastName/sportName/
// groupName/beltLabel), backend не расширялся. showNavigationCards
// показывает тот же ряд карточек «Моя семья/Мои тренировки/...», что и
// демо-стенд, но БЕЗ mock-данных под ними (trainings/familyAccount/
// contract сюда намеренно не передаются) — StudentPageContent сам покажет
// нейтральное "подключим позже" вместо ContentArea, см. её комментарий.
// Прогресс техник (techniqueProgress) пока не передаётся вообще — для
// Super Admin ещё нет backend-источника, секция просто отсутствует на
// странице, это ожидаемо на этом шаге.
export default function StudentPreviewPage({ token }) {
  const { t } = useTranslation();
  const { student, isLoading, error } = useStudentPreview(token);

  const headerNode = (
    <header className={styles.header}>
      <div className={`${styles.brand} ltr-isolate`}>
        <span className={styles.logo}>JKL</span>
        <span className={styles.logoSub}>CLUB</span>
      </div>
      <span className={styles.badge}>{t('studentPreview.badge')}</span>
    </header>
  );

  if (isLoading || error || !student) {
    return (
      <div className={styles.page}>
        {headerNode}
        <div className={styles.content}>
          {isLoading && <div className={styles.stateText}>{t('common.loading')}</div>}
          {!isLoading && error && (
            <div className={styles.errorBox}>{t('studentPreview.invalidOrExpired')}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <StudentPageContent
      accessMode="superadmin"
      header={headerNode}
      showNavigationCards
      student={{
        id: student.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        sportName: student.sportName,
        groupName: student.groupName,
        beltLabel: student.beltLabel
      }}
    />
  );
}
