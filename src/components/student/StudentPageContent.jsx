import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../layouts/DashboardLayout.jsx';
import StudentProfileCard from '../family/StudentProfileCard.jsx';
import TechniqueProgressSection from '../family/TechniqueProgressSection.jsx';
import DashboardButtons from '../family/DashboardButtons.jsx';
import ContentArea from '../family/ContentArea.jsx';
import { SectionToggleCard } from '../trainer/StudentPageSettingsPanels.jsx';
import { mergeStudentPageConfig } from '../../config/studentPageConfig.js';
import styles from './StudentPageContent.module.css';

export const STUDENT_PAGE_ACCESS_MODES = ['family', 'trainer', 'superadmin'];

// Общий presentation-каркас Student Page — единственный источник дизайна
// для всех трёх ролей (family/trainer/superadmin), а не три расходящиеся
// копии. НЕ делает запросов к Supabase сам: все данные приходят готовыми
// пропами, у каждого accessMode свой data-loader снаружи (RPC/Edge Function
// решает вызывающая страница, не этот компонент).
//
// Секции ниже — те же презентационные компоненты, что уже использует
// FamilyDashboard (TechniqueProgressSection/DashboardButtons/ContentArea,
// которые сами разворачивают TrainingsSection/FamilySection/ContractSection/
// PlaceholderSection) — не второй похожий UI, тот же самый.
//
// studentPageConfig — ЕДИНАЯ club-wide конфигурация (см.
// src/config/studentPageConfig.js) — источник истины для видимости полей
// StudentProfileCard, блока Bonus Techniques и nav-карточек. Не задан ->
// mergeStudentPageConfig(undefined) откатывается на DEFAULT_STUDENT_PAGE_CONFIG,
// который воспроизводит ТЕКУЩЕЕ production-поведение (backward-compat
// default, см. итоговый отчёт задачи "student-profile-club-wide-config").
//
// Rating/Bonus Techniques/Navigation — три club-wide секции ПОД профилем,
// одинаковые для всех трёх ролей (задача "student-profile-universal-page-
// sections" — до неё Rating вообще нигде не рендерился на реальных
// страницах, а Bonus/Navigation у Trainer были случайно потеряны вместе с
// удалением legacy technique-каталога, см. итоговый отчёт задачи):
//   - config.sections.ratingEligibility !== false -> ВСЕГДА read-only
//     SectionToggleCard-placeholder (нет и не может быть реальной rating
//     business-логики ни у одной роли на этом шаге) — те же i18n-тексты,
//     что уже показывает settingsPanels в Settings Mode.
//   - config.sections.bonusTechniques !== false -> ЕСЛИ techniqueProgress
//     передан (Family — useTechniqueProgress, data никогда не undefined,
//     см. сам хук) — реальный TechniqueProgressSection с её собственным
//     loading/error/данными, НЕ изменялся. ИНАЧЕ (Trainer/Super Admin без
//     per-student progress loader) — тот же read-only placeholder, что
//     Rating, а НЕ legacy-каталог 100 техник.
//   - showNavigationCards (по умолчанию false) — ряд карточек «Моя семья/
//     Мои тренировки/...» показывается, если вызывающая страница попросила.
//     Каждая отдельная карточка внутри дополнительно фильтруется
//     config.navigation — DashboardButtons сам решает, какие id показать.
//     Содержимое под карточками: если ни trainings, ни familyAccount, ни
//     contract не переданы (все undefined) — вместо ContentArea показывается
//     нейтральная заглушка "данные подключим позже" (navigation card ≠
//     content implementation).
//
// header/selector — pass-through в DashboardLayout.
//
// profileMode/fieldVisibility/onFieldToggle — используются ТОЛЬКО в
// settings mode (TrainerSettingsPage передаёt profileMode="settings" +
// локальный черновик конфигурации + onFieldToggle). Во всех остальных
// случаях profileMode не задан -> StudentProfileCard рендерится в normal
// mode с config.profileFields из studentPageConfig (реальная, уже
// сохранённая club-wide конфигурация, а не черновик).
//
// settingsPanels — необязательный узел, рендерится один раз сразу под
// профилем. undefined везде, кроме /trainer/settings — там TrainerSettingsPage
// composes туда карточки Rating/Bonus Techniques/Navigation-toggles (см.
// StudentPageSettingsPanels.jsx). Реальные Student Pages его не получают.
export default function StudentPageContent({
  student,
  accessMode,
  header,
  selector,
  studentPageConfig,
  profileMode,
  fieldVisibility,
  onFieldToggle,
  settingsPanels,
  techniqueProgress,
  isTechniqueProgressLoading,
  techniqueProgressError,
  onRetryTechniqueProgress,
  showNavigationCards = false,
  activeSection: activeSectionProp,
  onSelectSection,
  trainings,
  familyAccount,
  familyChildren = [],
  contract,
  children
}) {
  const { t } = useTranslation();
  const mode = STUDENT_PAGE_ACCESS_MODES.includes(accessMode) ? accessMode : 'family';
  const config = mergeStudentPageConfig(studentPageConfig);

  const isSettingsMode = profileMode === 'settings';
  const resolvedFieldVisibility = isSettingsMode ? fieldVisibility : config.profileFields;
  const resolvedOnFieldToggle = isSettingsMode ? onFieldToggle : undefined;

  // Локальное состояние активной навигационной карточки — только когда
  // вызывающая страница не управляет им сама (activeSection не передан).
  const [internalActiveSection, setInternalActiveSection] = useState(null);
  const activeSection = activeSectionProp !== undefined ? activeSectionProp : internalActiveSection;
  const handleSelectSection = onSelectSection ?? setInternalActiveSection;

  // Реальные данные для секций под карточками ещё не подключены ни для
  // одного accessMode на этом шаге — если вызывающая страница не передала
  // НИ ОДНОГО из трёх, показываем нейтральное "подключим позже" вместо
  // падения на отсутствующих данных внутри FamilySection/TrainingsSection/
  // ContractSection.
  const hasRealSectionData = trainings !== undefined || familyAccount !== undefined || contract !== undefined;

  return (
    <DashboardLayout header={header} selector={selector}>
      <span className={styles.modeBadge}>{t(`studentPage.accessMode.${mode}`)}</span>

      <div className={styles.overviewRow}>
        <StudentProfileCard
          child={student}
          mode={profileMode}
          fieldVisibility={resolvedFieldVisibility}
          onFieldToggle={resolvedOnFieldToggle}
        />
      </div>

      {settingsPanels}

      {/* Rating/Bonus auto-render — ТОЛЬКО НЕ в settings mode: в Settings
          Mode видимость+управление этими двумя секциями уже полностью
          показывает settingsPanels (SectionToggleCard С onToggle, полный
          вид с тумблером) — без этого условия ниже они бы дублировались
          ЕЩЁ РАЗ под settingsPanels в read-only виде, как только
          config.sections.* оказывается true (в т.ч. просто по умолчанию,
          см. DEFAULT_STUDENT_PAGE_CONFIG.sections.bonusTechniques=true) —
          найдено и исправлено при QA этой задачи. */}
      {!isSettingsMode && (
        <>
          {/* Rating/Kyu eligibility — реальной rating-логики нигде ещё нет
              (ни у одной роли), поэтому это ВСЕГДА read-only placeholder
              (SectionToggleCard без onToggle), одинаковый для
              family/trainer/superadmin — единственное, что решает
              видимость, это club-wide config.sections.ratingEligibility.
              Те же i18n-ключи, что уже показывает settingsPanels в Settings
              Mode — текст не расходится между конструктором и реальной
              страницей. */}
          {config.sections.ratingEligibility !== false && (
            <SectionToggleCard
              icon="trophy"
              title={t('studentPage.futureRatingBlock.title')}
              badge={t('studentPageConfig.futureBadge')}
              description={t('studentPage.futureRatingBlock.description')}
            />
          )}

          {/* Bonus Techniques — ДВЕ разные ветки внутри одного
              config.sections.bonusTechniques !== false гейта:
                - techniqueProgress передан (Family — useTechniqueProgress
                  возвращает {data: null|object, isLoading, error}, data
                  НИКОГДА не undefined, см. хук) -> показываем РЕАЛЬНЫЙ
                  TechniqueProgressSection с loading/error/данными — то
                  самое уже существующее поведение Family, здесь НЕ
                  меняется (включая её собственный известный отдельный баг
                  "Не удалось загрузить прогресс техник" — не трогаем).
                - techniqueProgress не передан (Trainer/Super Admin без
                  реального per-student progress loader) -> read-only
                  placeholder, тот же паттерн, что Rating — ЧЕСТНО говорит
                  "пока нет данных", а не молчит и не показывает
                  legacy-каталог. */}
          {config.sections.bonusTechniques !== false &&
            (techniqueProgress !== undefined ? (
              <TechniqueProgressSection
                progressData={techniqueProgress}
                isLoading={isTechniqueProgressLoading}
                error={techniqueProgressError}
                onRetry={onRetryTechniqueProgress}
              />
            ) : (
              <SectionToggleCard
                icon="belt"
                title={t('techniqueProgress.title')}
                description={t('studentPage.bonusPlaceholder.description')}
              />
            ))}
        </>
      )}

      {showNavigationCards && (
        <>
          <DashboardButtons
            activeSection={activeSection}
            onSelectSection={handleSelectSection}
            navigation={config.navigation}
          />
          {activeSection && !hasRealSectionData && (
            <div className={styles.sectionNotConnected}>{t('studentPage.sectionNotConnectedYet')}</div>
          )}
          {activeSection && hasRealSectionData && (
            <ContentArea
              activeSection={activeSection}
              trainings={trainings}
              familyAccount={familyAccount}
              children={familyChildren}
              contract={contract}
            />
          )}
        </>
      )}

      {children}
    </DashboardLayout>
  );
}
