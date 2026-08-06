import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import LanguageSwitcher from '../common/LanguageSwitcher/LanguageSwitcher.jsx';
import { formatNumber } from '../../utils/formatters.js';
import styles from './FamilyHeader.module.css';

export default function FamilyHeader({ familyName, notificationsCount, onLogout }) {
  const { t, i18n } = useTranslation();

  return (
    <header className={styles.header}>
      <div className={`${styles.brand} ltr-isolate`}>
        <span className={styles.logo}>JKL</span>
        <span className={styles.logoSub}>CLUB</span>
      </div>

      <div className={styles.greeting}>{t('header.greeting', { name: familyName })}</div>

      <div className={styles.actions}>
        <LanguageSwitcher />

        <button type="button" className={styles.actionButton} aria-label={t('header.notifications')}>
          <Icon name="bell" size={18} />
          <span className={styles.actionLabel}>{t('header.notifications')}</span>
          {notificationsCount > 0 && (
            <span className={styles.badge}>{formatNumber(notificationsCount, i18n.language)}</span>
          )}
        </button>

        <button type="button" className={styles.actionButton} aria-label={t('header.settings')}>
          <Icon name="gear" size={18} />
          <span className={styles.actionLabel}>{t('header.settings')}</span>
        </button>

        <button type="button" className={styles.actionButton} aria-label={t('header.logout')} onClick={onLogout}>
          <Icon name="logout" size={18} />
          <span className={styles.actionLabel}>{t('header.logout')}</span>
        </button>
      </div>
    </header>
  );
}
