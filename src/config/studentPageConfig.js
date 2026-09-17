import { dashboardButtons } from './dashboardButtons.js';

// ЕДИНАЯ club-wide конфигурация Universal Student Page — источник истины
// для StudentPageContent/StudentProfileCard и обеих новых settings-панелей
// (Rating/Bonus Techniques/Navigation), а не десяток разрозненных boolean
// пропов (задание "student-profile-club-wide-config", раздел 14).
//
// ТРИ независимые группы, ключи внутри каждой — plain booleans:
//   profileFields — верхняя StudentProfileCard (14 полей, 5 колонок в
//     Settings Mode, см. PROFILE_FIELD_COLUMNS ниже). trainingSchedule/
//     contractStatus/contractDate сюда сознательно НЕ входят — это больше
//     не поля профиля (см. раздел 4 задания): расписание принадлежит
//     разделу "Мои тренировки", статус/дата договора — разделу "Договор и
//     оплата", у обоих уже есть collственные nav-toggles ниже.
//   sections — блоки под TechniqueProgressSection: ratingEligibility
//     (будущий, ещё не реализованный блок — ТОЛЬКО visibility-флаг, без
//     единой формулы/цифры) и bonusTechniques (существующий
//     TechniqueProgressSection — этот флаг ТОЛЬКО скрывает/показывает
//     весь блок целиком, business-логика самого блока не меняется).
//   navigation — 6 нижних Dashboard-карточек (family/trainings/
//     achievements/events/techniques/contract) — "certificates" сюда не
//     входит, она остаётся disabled на уровне dashboardButtons.js, как и
//     была, вне club-wide конфигурации.
//
// DEFAULT_STUDENT_PAGE_CONFIG воспроизводит РЕАЛЬНОЕ сегодняшнее
// production-поведение (см. итоговый отчёт задачи) — это critical
// backward-compatibility default (раздел 15): пока клуб ни разу не
// сохранил конфигурацию (club_student_page_settings ещё нет строки, RPC
// недоступен, миграция не применена, поле отсутствует в старой
// сохранённой записи) — mergeStudentPageConfig(...) всегда откатывается
// именно к этим значениям, а не к пустому/всё-выключено состоянию.
export const DEFAULT_STUDENT_PAGE_CONFIG = Object.freeze({
  profileFields: Object.freeze({
    photo: true,
    firstName: true,
    lastName: true,
    gender: false,
    birthDate: false,
    age: true,
    weight: false,
    sport: true,
    group: true,
    trainer: false,
    kyuGrade: true,
    beltColor: true,
    phone: false,
    email: false
  }),
  sections: Object.freeze({
    ratingEligibility: false,
    bonusTechniques: true
  }),
  navigation: Object.freeze({
    family: true,
    trainings: true,
    achievements: true,
    events: true,
    techniques: true,
    contract: true
  })
});

// 5 колонок Settings Mode (см. скриншот согласованного вида задания) —
// ЕДИНСТВЕННОЕ место, где зафиксирована группировка полей на категории;
// и StudentProfileCard (рендер колонок), и любой будущий код, которому
// понадобится этот же список, читают отсюда, а не дублируют его.
export const PROFILE_FIELD_COLUMNS = [
  { id: 'basic', titleKey: 'studentPageConfig.columns.basic', fields: ['photo', 'firstName', 'lastName'] },
  { id: 'personal', titleKey: 'studentPageConfig.columns.personal', fields: ['gender', 'birthDate', 'age', 'weight'] },
  { id: 'sport', titleKey: 'studentPageConfig.columns.sport', fields: ['sport', 'group', 'trainer'] },
  { id: 'qualification', titleKey: 'studentPageConfig.columns.qualification', fields: ['kyuGrade', 'beltColor'] },
  { id: 'contact', titleKey: 'studentPageConfig.columns.contact', fields: ['phone', 'email'] }
];

// Подмножество dashboardButtons.js, которое участвует в club-wide
// конфигурации (см. раздел 9 задания) — "certificates" НЕ входит, она уже
// disabled в самом dashboardButtons.js и остаётся вне этой конфигурации.
// Иконки/labelKey берутся ИЗ dashboardButtons.js напрямую — не
// дублируются здесь второй раз.
const NAVIGATION_KEYS = ['family', 'trainings', 'achievements', 'events', 'techniques', 'contract'];
export const NAVIGATION_TOGGLE_ITEMS = dashboardButtons.filter((btn) => NAVIGATION_KEYS.includes(btn.id));

function mergeGroup(defaults, partial) {
  if (!partial || typeof partial !== 'object') return { ...defaults };
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (partial[key] === true || partial[key] === false) {
      result[key] = partial[key];
    }
  }
  return result;
}

// Единственная точка входа для превращения "того, что реально вернул RPC/
// Edge Function (может быть null, may быть частичным, может быть вообще
// не тем полностью доверенным объектом)" в полный, безопасный
// studentPageConfig. Неизвестные ключи в partial игнорируются, отсутствие
// ключа = дефолт — именно это гарантирует раздел 15 задания (новые поля,
// ещё не сохранённые старой записью, не выключают уже существующие
// разделы производства).
export function mergeStudentPageConfig(partial) {
  return {
    profileFields: mergeGroup(DEFAULT_STUDENT_PAGE_CONFIG.profileFields, partial?.profileFields),
    sections: mergeGroup(DEFAULT_STUDENT_PAGE_CONFIG.sections, partial?.sections),
    navigation: mergeGroup(DEFAULT_STUDENT_PAGE_CONFIG.navigation, partial?.navigation)
  };
}
