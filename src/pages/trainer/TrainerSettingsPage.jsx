import { useTranslation } from 'react-i18next';
import StudentPageContent from '../../components/student/StudentPageContent.jsx';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import styles from './TrainerSettingsPage.module.css';

// CLUB-WIDE STUDENT PAGE SETTINGS MODE — открывается карточкой «Настроить
// вид страницы ученика» с Trainer Dashboard (/trainer/settings, маршрут не
// менялся). ПЕРЕСМОТРЕНО (см. отчёт задачи): это НЕ отдельный Settings
// Hub со своим дизайном (предыдущая версия — grid из TrainerDashboardCard —
// заменена, TrainerDashboardCard/конфиг-массив здесь больше не
// используются) — это тот же самый StudentPageContent (accessMode=
// "trainer"), что и на /trainer/student/:id, но БЕЗ данных конкретного
// ученика. Trainer должен видеть ЗДЕСЬ ту же страницу, что он видит для
// Matviei Sukonko — потому что здесь позже, отдельной задачей, появятся
// органы управления, влияющие на ОБЩИЙ шаблон Student Page ВСЕХ учеников
// клуба (club-wide scope), а не только на этого одного ученика
// (student-specific scope у /trainer/student/:id остаётся отдельным и не
// затронут). Разделение ролей и scope НЕ через новый accessMode
// ("trainer" — это по-прежнему просто роль, кто смотрит) — сама разница
// "student vs club-settings" выражается ЗДЕСЬ, в том, что этой странице
// сознательно НЕ передаётся ничей реальный student.
//
// TEMPLATE_STUDENT ниже — НЕ mock ученика (никаких Vorname/Nachname,
// похожих на настоящее имя, никакого вида спорта/группы/пояса/статуса
// договора — только один нейтральный ярлык в поле "имени" карточки).
// Сознательно НЕ переиспользует MOCK_STUDENT из StudentPageDemoRoute.jsx —
// тот выглядит как настоящий ученик (Max Mustermann + реалистичные
// вид спорта/группа/пояс) и рассчитан на dev/Deploy-Preview демонстрацию,
// а не на реальный production-экран, который видит каждый тренер.
const TEMPLATE_STUDENT_KEY = 'trainerDashboard.settingsPageTemplateName';

// TEMPLATE-состояние блока "Бонусные техники" — ЧИСТО статический объект,
// без единого RPC/fetch. TechniqueProgressSection.jsx (импортируется
// изнутри StudentPageContent, здесь напрямую не используется) — уже
// полностью presentational-компонент: получает progressData/isLoading/
// error/onRetry пропами и сам ничего не загружает. Family Student Page
// использует этот же компонент через тот же прямой проп техника
// StudentPageContent — та же самая связка, никакой отдельной копии.
// featureEnabled:true + techniques:[] + bonusRequirement:null ->
// selectTechniqueGroups даёт completed=[]/requiredNageWaza=[]/
// requiredKatameWaza=[] -> компонент сам заходит в свою штатную
// hasNoProgram-ветку (см. TechniqueProgressSection.jsx) и показывает тот
// же честный "для этого пояса ещё не создана программа техник", что и для
// реального ученика без настроенной программы — ни фейковых техник, ни
// ошибки загрузки, ни малейшего намёка на student_id=78/Matviei.
const TEMPLATE_TECHNIQUE_PROGRESS = {
  featureEnabled: true,
  bonusRequirement: null,
  bonusPoints: null,
  belt: null,
  techniques: []
};

export default function TrainerSettingsPage() {
  const { t } = useTranslation();

  return (
    <StudentPageContent
      accessMode="trainer"
      header={
        <div className={styles.header}>
          <TrainerHeader title={t('trainerDashboard.settingsTitle')} showBack />
          <div className={styles.scopeNote}>{t('trainerDashboard.settingsPageScopeNote')}</div>
        </div>
      }
      student={{ id: 'template', firstName: t(TEMPLATE_STUDENT_KEY), lastName: '' }}
      techniqueProgress={TEMPLATE_TECHNIQUE_PROGRESS}
      isTechniqueProgressLoading={false}
      techniqueProgressError={null}
      showNavigationCards
    />
  );
}
