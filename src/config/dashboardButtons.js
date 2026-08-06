export const DASHBOARD_SECTIONS = {
  FAMILY: 'family',
  TRAININGS: 'trainings',
  ACHIEVEMENTS: 'achievements',
  CERTIFICATES: 'certificates',
  EVENTS: 'events',
  TECHNIQUES: 'techniques',
  CONTRACT: 'contract'
};

// При первом открытии Family Dashboard ни одна dashboard-кнопка не активна
// (см. memory/UI_RULES.md, «Утверждено — дефолтное состояние Family Dashboard»).
export const DEFAULT_SECTION = null;

export const dashboardButtons = [
  { id: DASHBOARD_SECTIONS.FAMILY, labelKey: 'dashboard.family', icon: 'family' },
  { id: DASHBOARD_SECTIONS.TRAININGS, labelKey: 'dashboard.trainings', icon: 'calendar' },
  { id: DASHBOARD_SECTIONS.ACHIEVEMENTS, labelKey: 'dashboard.achievements', icon: 'trophy' },
  // disabled: временно скрыто из UI, компонент/локализация/раздел сохранены для последующего включения
  { id: DASHBOARD_SECTIONS.CERTIFICATES, labelKey: 'dashboard.certificates', icon: 'certificate', disabled: true },
  { id: DASHBOARD_SECTIONS.EVENTS, labelKey: 'dashboard.events', icon: 'event' },
  { id: DASHBOARD_SECTIONS.TECHNIQUES, labelKey: 'dashboard.techniques', icon: 'belt' },
  { id: DASHBOARD_SECTIONS.CONTRACT, labelKey: 'dashboard.contract', icon: 'contract' }
];
