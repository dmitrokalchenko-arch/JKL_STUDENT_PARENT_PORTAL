import Icon from '../common/Icon.jsx';
import styles from './TrainerDashboardCard.module.css';

// Карточка Trainer Dashboard — тот же UX-паттерн, что SuperAdminSectionCard
// (переход по обычному URL, без клиентского роутера), но отдельный,
// независимый компонент: тексты приходят уже переведёнными через props,
// а не зашиты внутри, как в SuperAdmin-карточках.
export default function TrainerDashboardCard({ title, description, icon, path }) {
  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => {
        window.location.href = path;
      }}
    >
      <div className={styles.iconBox}>
        <Icon name={icon} size={22} />
      </div>
      <div className={styles.title}>{title}</div>
      <div className={styles.description}>{description}</div>
    </button>
  );
}
