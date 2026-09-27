export const trainerDashboardSections = [
  {
    id: 'find-student',
    titleKey: 'trainerDashboard.findStudentTitle',
    descriptionKey: 'trainerDashboard.findStudentDescription',
    icon: 'search',
    path: '/trainer/students'
  },
  {
    id: 'settings',
    titleKey: 'trainerDashboard.settingsTitle',
    descriptionKey: 'trainerDashboard.settingsDescription',
    icon: 'gear',
    path: '/trainer/settings',
    requiresPortalAdmin: true
  },
  {
    id: 'kyu-program',
    titleKey: 'trainerDashboard.kyuProgramTitle',
    descriptionKey: 'trainerDashboard.kyuProgramDescription',
    icon: 'belt',
    path: '/trainer/kyu-program',
    requiresPortalAdmin: true
  },
  {
    // Точка входа будущих настроек рейтинга ученика (сейчас — только
    // UI-прототип, см. docs/architecture/STUDENT_RATING.md). Admin-only.
    id: 'rating-settings',
    titleKey: 'trainerDashboard.ratingSettingsTitle',
    descriptionKey: 'trainerDashboard.ratingSettingsDescription',
    icon: 'trophy',
    path: '/trainer/rating-settings',
    requiresPortalAdmin: true
  }
];
