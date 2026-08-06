import { useTranslation } from 'react-i18next';
import styles from './PlaceholderSection.module.css';

export default function PlaceholderSection({ title }) {
  const { t } = useTranslation();

  return (
    <div className={styles.card}>
      <div className={styles.title}>{title}</div>
      <div className={styles.text}>{t('placeholders.notDesignedYet')}</div>
    </div>
  );
}
