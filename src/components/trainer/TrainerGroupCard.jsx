import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import styles from './TrainerGroupCard.module.css';

export default function TrainerGroupCard({ group }) {
  const { t } = useTranslation();

  return (
    <div className={styles.card}>
      <div className={styles.iconBox}>
        <Icon name="family" size={20} />
      </div>
      <div className={styles.info}>
        <div className={styles.name}>{group.name}</div>
        {group.category && <div className={styles.category}>{group.category}</div>}
      </div>
      {group.isActive !== null && (
        <span className={group.isActive ? styles.statusActive : styles.statusInactive}>
          {t(group.isActive ? 'trainerGroups.statusActive' : 'trainerGroups.statusInactive')}
        </span>
      )}
    </div>
  );
}
