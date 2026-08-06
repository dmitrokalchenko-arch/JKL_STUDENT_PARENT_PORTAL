// Реестр разделов SuperAdmin-дашборда — по аналогии с
// src/config/dashboardButtons.js (данные отдельно от компонента карточки,
// чтобы добавление нового раздела не требовало правки JSX). Пока без ролей
// и авторизации — минимальный каркас, см. .claude/CLAUDE.md.
export const superAdminSections = [
  {
    id: 'familienzugaenge',
    title: 'Familienzugänge',
    description: 'Verwaltung des Familienzugangs',
    icon: 'family',
    path: '/superadmin/familienzugaenge'
  }
];
