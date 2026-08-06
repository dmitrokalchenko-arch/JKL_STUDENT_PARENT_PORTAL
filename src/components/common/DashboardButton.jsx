import Icon from './Icon.jsx';
import styles from './DashboardButton.module.css';

export default function DashboardButton({ label, icon, active, onClick }) {
  return (
    <button
      type="button"
      className={`${styles.button} ${active ? styles.active : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <Icon name={icon} size={20} />
      <span>{label}</span>
    </button>
  );
}
