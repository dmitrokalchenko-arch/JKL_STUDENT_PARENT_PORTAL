import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import styles from './ChildSelector.module.css';

function ChildAvatar({ child }) {
  const initials = `${child.firstName?.[0] ?? ''}${child.lastName?.[0] ?? ''}`;
  return (
    <span className={`${styles.avatar} ltr-isolate`}>
      {child.photoUrl ? <img src={child.photoUrl} alt="" /> : initials}
    </span>
  );
}

export default function ChildSelector({ children, selectedId, onSelect }) {
  const { t } = useTranslation();

  if (!children || children.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{t('childSelector.label')}</span>
      <div className={styles.chips}>
        {children.map((child) => {
          const active = child.id === selectedId;
          return (
            <button
              key={child.id}
              type="button"
              className={`${styles.chip} ${active ? styles.chipActive : ''}`}
              onClick={() => onSelect(child.id)}
              aria-pressed={active}
            >
              <ChildAvatar child={child} />
              <span>
                {child.firstName} {child.lastName}
                {child.age != null ? ` (${t('common.years', { count: child.age })})` : ''}
              </span>
              <Icon name="chevronDown" size={14} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
