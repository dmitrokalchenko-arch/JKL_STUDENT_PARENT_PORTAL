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
// REAL SUPER ADMIN STUDENT PAGE — STEP 1/2: студент ниже — РЕАЛЬНЫЕ данные
// из get-student-preview (studentId/firstName/lastName/sportName/
// groupName/beltLabel). showNavigationCards показывает тот же ряд карточек
// «Моя семья/Мои тренировки/...», что и демо-стенд, но БЕЗ mock-данных под
// ними (trainings/familyAccount/contract сюда намеренно не передаются) —
// StudentPageContent сам покажет нейтральное "подключим позже" вместо
// ContentArea, см. её комментарий.
//
// STEP 2 (club-scoped technique program foundation): techniqueProgress
// теперь передаётся, ЕСЛИ get-student-preview его вернул — это РЕАЛЬНЫЕ
// club-scoped данные (club_technique_program_settings/
// club_required_techniques/student_technique_records, все — строго club_id
// ЭТОГО студента, определённого сервером). Если у клуба вообще нет ни
// bonus_requirement, ни required-техник, ни completed-записей —
// techniqueProgress ВСЁ РАВНО присутствует (featureEnabled:true,
// bonusRequirement:null, techniques:[]) — TechniqueProgressSection сам
// корректно покажет "программа ещё не настроена" (её собственная
// hasNoProgram-ветка), а не спрячет секцию. Проп остаётся undefined ТОЛЬКО
// если сама миграция ещё не применена/запрос упал (см. buildTechniqueProgress
// в get-student-preview) — тогда секция не рендерится вовсе, как и раньше.
// Никаких mock-чисел здесь нет и не может быть.
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
      studentPageConfig={student.studentPageConfig}
      techniqueProgress={student.techniqueProgress}
      isTechniqueProgressLoading={false}
      techniqueProgressError={null}
    />
  );
}
