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
  }
];
