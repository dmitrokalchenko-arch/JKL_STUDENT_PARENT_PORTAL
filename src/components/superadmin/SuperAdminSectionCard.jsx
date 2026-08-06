import Icon from '../common/Icon.jsx';
import styles from './SuperAdminSectionCard.module.css';

// Карточка раздела SuperAdmin-дашборда — открывает целиком новую страницу
// (обычная навигация по URL, без клиентского роутера, тот же принцип, что
// и во всём остальном проекте). Не путать с DashboardButton (common) — та
// переключает активную вкладку внутри одной страницы и не имеет описания,
// это другой UX-паттерн, поэтому не переиспользуется здесь напрямую.
export default function SuperAdminSectionCard({ title, description, icon, path }) {
  return (
    <button type="button" className={styles.card} onClick={() => { window.location.href = path; }}>
      <div className={styles.iconBox}>
        <Icon name={icon} size={22} />
      </div>
      <div className={styles.title}>{title}</div>
      <div className={styles.description}>{description}</div>
    </button>
  );
}
