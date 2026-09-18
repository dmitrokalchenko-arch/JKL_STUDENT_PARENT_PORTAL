import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import StudentPageContent from '../../components/student/StudentPageContent.jsx';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import { useTrainerStudentProfile } from '../../hooks/useTrainerStudentProfile.js';
import { useActiveSection } from '../../hooks/useActiveSection.js';
import { useRequiredTechniques } from '../../hooks/useRequiredTechniques.js';
import { signOutTrainer } from '../../services/trainerAuthService.js';
import { getTrainerStudentPageConfig } from '../../services/studentPageConfigService.js';
import { getTrainerRequiredTechniques } from '../../services/requiredTechniquesService.js';
import styles from './TrainerStudentPage.module.css';

// Маршрут /trainer/student/:studentId — рендерится ВНУТРИ TrainerAuthGuard
// (см. App.jsx), значит authenticated trainer с активным profile.is_active
// уже гарантирован выше по дереву — здесь остаётся только per-student
// access check (см. useTrainerStudentProfile ниже).
//
// TRAINER UNIVERSAL STUDENT PAGE: страница использует общий presentation-
// каркас StudentPageContent (accessMode="trainer") — тот же, что уже
// использует Super Admin Preview (accessMode="superadmin") и FamilyDashboard
// (accessMode="family"). get_trainer_student_by_id возвращает тот же набор
// Block-1-профильных полей, что get_current_family_children() уже отдаёт
// Family — StudentProfileCard рендерит их одинаково независимо от
// accessMode, БЕЗ mock-данных.
//
// useTrainerStudentProfile(studentId) — ЕДИНСТВЕННЫЙ источник профиля для
// StudentPageContent's student-пропа И единственный page-level access-check
// (get_trainer_student_by_id сам вызывает can_trainer_access_student, 0
// строк без ошибки = доступа нет — см. ветку ниже). Familienzugang/
// families.status/family_students.status здесь НИГДЕ не участвуют —
// Trainer-доступ к Student Page не зависит от семейного доступа.
//
// ⚠️ REMOVED FROM THIS PAGE (задача "student-profile-shared-layout",
// раздел "Задача 2"): inline-рендер "Выполненные техники"
// (CompletedTechniquesList) + полный "Каталог техник" (JudoTechniquePicker,
// все 100 judo_techniques) больше НЕ показываются под StudentProfileCard —
// эта legacy-модель (тренер отмечает ЛЮБУЮ технику каталога, без привязки
// к bonus-пулу ученика) не соответствует финальной архитектуре Universal
// Student Page. Ни функциональность, ни компоненты (CompletedTechniquesList,
// JudoTechniquePicker, JudoTechniqueVideoModal, MarkTechniqueCompletedModal,
// StudentVideoPlayerModal), ни хуки (useStudentTechniqueRecords,
// useTrainerWriteContext, useUnmarkTechniqueCompleted), ни services/RPC/DB
// НЕ удалены — только их использование ИМЕННО на этой странице. Они
// подключатся позже к отдельному разделу Student Page ("Необходимые
// техники" или будущий Bonus Techniques UI) — отдельной следующей задачей,
// не здесь.
//
// showNavigationCards (задача "student-profile-universal-page-sections"):
// раньше здесь сознательно не передавался ("для тренера сегодня нет ни
// одного реального backend-источника под nav-карточками") — но сами
// карточки уже умеют показываться БЕЗ реального содержимого (клик ->
// нейтральное "данные этого раздела будут подключены на следующем этапе",
// тот же существующий паттерн StudentPageContent) и уже фильтруются
// club-wide config.navigation. Club-wide видимость (Rating/Bonus/Navigation)
// должна работать одинаково для Family и Trainer — исключать Trainer из
// showNavigationCards больше не обосновано, раз navigation card ≠
// content implementation.
export default function TrainerStudentPage({ studentId }) {
  const { t } = useTranslation();

  // Club-wide конфигурация видимости (см. FamilyDashboard.jsx — тот же
  // паттерн: один запрос при монтировании, честный null-fallback ->
  // StudentPageContent откатывается на DEFAULT_STUDENT_PAGE_CONFIG, если
  // RPC/миграция ещё не задеплоены.
  const [studentPageConfig, setStudentPageConfig] = useState(null);
  useEffect(() => {
    let isCancelled = false;
    getTrainerStudentPageConfig().then((config) => {
      if (!isCancelled) setStudentPageConfig(config);
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  const {
    student,
    isLoading: isProfileLoading,
    error: profileError,
    reload: reloadProfile
  } = useTrainerStudentProfile(studentId);

  // activeSection теперь поднят сюда (раньше StudentPageContent управлял
  // им целиком внутри себя, activeSection/onSelectSection не
  // передавались) — нужен здесь, чтобы Required Techniques грузился LAZY
  // именно по клику на карточку «Необходимые техники», тем же
  // useActiveSection(), что уже использует FamilyDashboard.jsx.
  const { activeSection, selectSection } = useActiveSection();

  const {
    data: requiredTechniques,
    isLoading: isRequiredTechniquesLoading,
    error: requiredTechniquesError,
    refetch: refetchRequiredTechniques
  } = useRequiredTechniques(getTrainerRequiredTechniques, student?.id, activeSection === 'techniques');

  const handleLogout = async () => {
    await signOutTrainer();
    window.location.href = '/';
  };

  // Page-level gate — тот же паттерн, что StudentPreviewPage.jsx (Super
  // Admin Preview): loading/error/denied обрабатываются ЗДЕСЬ, ДО рендера
  // StudentPageContent, а не пропами внутрь общего каркаса — он получает
  // student только когда данные реально есть. profileError (RPC-сбой,
  // включая "функция ещё не задеплоена") — ОТДЕЛЬНОЕ от "student === null
  // без ошибки" (= can_trainer_access_student вернула false/студента нет) —
  // первое retry-able, второе — окончательный отказ, не путаем их местами.
  if (isProfileLoading) {
    return <div className={styles.state}>{t('common.loading')}</div>;
  }

  if (profileError) {
    return (
      <div className={styles.state}>
        <div>{t('trainerTechniques.studentLoadError')}</div>
        <button type="button" className={styles.retryButton} onClick={reloadProfile}>
          {t('trainerTechniques.retry')}
        </button>
      </div>
    );
  }

  if (!student) {
    return <div className={styles.state}>{t('trainerTechniques.accessDenied')}</div>;
  }

  return (
    <StudentPageContent
      accessMode="trainer"
      header={
        <TrainerHeader
          title={`${student.firstName ?? ''} ${student.lastName ?? ''}`.trim()}
          showBack
          onLogout={handleLogout}
        />
      }
      student={student}
      studentPageConfig={studentPageConfig}
      showNavigationCards
      activeSection={activeSection}
      onSelectSection={selectSection}
      requiredTechniques={requiredTechniques}
      isRequiredTechniquesLoading={isRequiredTechniquesLoading}
      requiredTechniquesError={requiredTechniquesError}
      onRetryRequiredTechniques={refetchRequiredTechniques}
    />
  );
}
