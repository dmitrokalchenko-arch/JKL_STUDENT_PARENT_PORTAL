import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import StudentPageContent from '../../components/student/StudentPageContent.jsx';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import { signOutTrainer } from '../../services/trainerAuthService.js';
import styles from './TrainerSettingsPage.module.css';

// CLUB-WIDE STUDENT PAGE SETTINGS MODE — открывается карточкой «Настроить
// вид страницы ученика» с Trainer Dashboard (/trainer/settings, маршрут не
// менялся). Это тот же самый StudentPageContent (accessMode="trainer"),
// что и на /trainer/student/:id, но верхняя карточка (StudentProfileCard)
// здесь работает в mode="settings" — WYSIWYG-конструктор видимости полей
// (см. итоговый отчёт задачи "student-profile-visual-configurator").
//
// fieldVisibility — ЧИСТО frontend-only React state этой страницы. Нигде
// не сохраняется (ни localStorage, ни БД) — намеренно, согласно заданию:
// "НЕ сохранять настройки в БД... сейчас делаем только визуальную
// архитектуру и интерактивный prototype/state внутри frontend". После
// reload страницы состояние сбрасывается к DEFAULT_PROFILE_FIELD_VISIBILITY
// — это ожидаемо для этого этапа, а не баг.
//
// DEFAULT_PROFILE_FIELD_VISIBILITY подобран по РЕАЛЬНОМУ сегодняшнему
// production-виду StudentProfileCard (см. аудит задачи "Club-Wide
// настройка полей StudentProfileCard"): true — для полей, которые
// Family/Trainer уже видят сегодня (firstName/lastName/age/sport/group/
// trainingSchedule/kyuGrade+beltColor/contractStatus); false — для полей,
// которых сегодня на карточке нет вообще (gender/birthDate/weight/
// trainer/phone/email/contractDate) — ни один из них НЕ подключён к
// реальным данным в этом PR (RPC/RLS/Block 1 не менялись), toggle здесь
// влияет ТОЛЬКО на вид этого конструктора, не на реальные Student Pages.
const DEFAULT_PROFILE_FIELD_VISIBILITY = {
  photo: true,
  firstName: true,
  lastName: true,
  gender: false,
  birthDate: false,
  age: true,
  weight: false,
  sport: true,
  group: true,
  trainingSchedule: true,
  trainer: false,
  kyuGrade: true,
  beltColor: true,
  phone: false,
  email: false,
  contractStatus: true,
  contractDate: false
};

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
  const [fieldVisibility, setFieldVisibility] = useState(DEFAULT_PROFILE_FIELD_VISIBILITY);

  const handleLogout = async () => {
    await signOutTrainer();
    window.location.href = '/';
  };

  const handleFieldToggle = (key) => {
    setFieldVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <StudentPageContent
      accessMode="trainer"
      header={
        <div className={styles.header}>
          <TrainerHeader title={t('trainerDashboard.settingsTitle')} showBack onLogout={handleLogout} />
          <div className={styles.scopeNote}>{t('trainerDashboard.settingsPageScopeNote')}</div>
        </div>
      }
      profileMode="settings"
      fieldVisibility={fieldVisibility}
      onFieldToggle={handleFieldToggle}
      futureRatingPlaceholder={
        // Зарезервированное место будущего блока "Рейтинг и допуск к
        // следующему Kyu" (задание, раздел 12-13) — ТОЛЬКО нейтральный
        // текстовый placeholder, без единой цифры/прогресс-бара/формулы.
        // Показывается ИСКЛЮЧИТЕЛЬНО здесь (Settings Mode) — реальные
        // Family/Trainer Student Page его не получают вовсе (проп не
        // передаётся), см. StudentPageContent.
        <div className={styles.ratingPlaceholder}>
          <div className={styles.ratingPlaceholderTitle}>{t('studentPage.futureRatingBlock.title')}</div>
          <div className={styles.ratingPlaceholderDescription}>
            {t('studentPage.futureRatingBlock.description')}
          </div>
        </div>
      }
      techniqueProgress={TEMPLATE_TECHNIQUE_PROGRESS}
      isTechniqueProgressLoading={false}
      techniqueProgressError={null}
      showNavigationCards
    />
  );
}
