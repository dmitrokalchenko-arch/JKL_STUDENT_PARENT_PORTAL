import Icon from './Icon.jsx';
import styles from './ToggleSwitch.module.css';

// Единственная реализация ACTIVE/INACTIVE-переключателя во всём Settings
// Mode — переиспользуется StudentProfileCard (14 полей карточки),
// StudentPageSettingsPanels (Rating/Bonus Techniques/6 nav-карточек), а не
// копируется в каждое место отдельно.
export default function ToggleSwitch({ active, onToggle, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={ariaLabel}
      className={`${styles.toggle} ${active ? styles.toggleActive : ''}`}
      onClick={onToggle}
    >
      {active && <Icon name="check" size={13} color="#17171b" />}
    </button>
  );
}
