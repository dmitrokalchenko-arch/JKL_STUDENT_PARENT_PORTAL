import SuperAdminSectionCard from '../../components/superadmin/SuperAdminSectionCard.jsx';
import { superAdminSections } from '../../config/superAdminSections.js';
import styles from './SuperAdminDashboard.module.css';

// Минимальный каркас SuperAdmin-дашборда — сетка карточек разделов, без
// авторизации/ролей на этом этапе (согласовано отдельно, см. чат).
export default function SuperAdminDashboard() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>SuperAdmin</h1>
      <div className={styles.grid}>
        {superAdminSections.map((section) => (
          <SuperAdminSectionCard
            key={section.id}
            title={section.title}
            description={section.description}
            icon={section.icon}
            path={section.path}
          />
        ))}
      </div>
    </div>
  );
}
