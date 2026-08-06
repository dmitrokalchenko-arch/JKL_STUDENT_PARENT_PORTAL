import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import LanguageSwitcher from '../common/LanguageSwitcher/LanguageSwitcher.jsx';
import styles from './TrainerHeader.module.css';

// Общий хедер тренерской области (Dashboard/Students/Settings/Student) —
// тот же визуальный паттерн, что FamilyHeader (бренд + заголовок +
// LanguageSwitcher), но без семейных действий (уведомления/выход), которых
// на этом этапе для тренера ещё нет.
export default function TrainerHeader({ title, showBack }) {
  const { t } = useTranslation();

  return (
    <header className={styles.header}>
      <div className={`${styles.brand} ltr-isolate`}>
        <span className={styles.logo}>JKL</span>
        <span className={styles.logoSub}>CLUB</span>
      </div>

      <div className={styles.titleRow}>
        {showBack && (
          <button
            type="button"
            className={styles.backButton}
            onClick={() => {
              window.location.href = '/trainer';
            }}
          >
            <Icon name="arrowRight" size={14} className={styles.backIcon} />
            {t('common.back')}
          </button>
        )}
        {title && <h1 className={styles.title}>{title}</h1>}
      </div>

      <div className={styles.actions}>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
