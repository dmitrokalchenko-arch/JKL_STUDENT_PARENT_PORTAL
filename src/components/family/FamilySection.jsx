import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import styles from './FamilySection.module.css';

export default function FamilySection({ familyAccount, children }) {
  const { t } = useTranslation();

  return (
    <div className={styles.grid}>
      <div className={styles.block}>
        <div className={styles.blockHeader}>
          <Icon name="family" size={20} />
          <h3>{t('family.profileTitle')}</h3>
        </div>
        <div className={styles.fieldLabel}>{t('family.nickname')}</div>
        <div className={`${styles.fieldValue} ltr-isolate`}>{familyAccount.nickname}</div>
        <div className={styles.fieldLabel}>{t('family.recoveryEmail')}</div>
        <div className={`${styles.fieldValue} ltr-isolate`}>{familyAccount.recoveryEmail}</div>
        <button type="button" className={styles.primaryAction}>{t('family.changeEmail')}</button>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHeader}>
          <Icon name="gear" size={20} />
          <h3>{t('family.securityTitle')}</h3>
        </div>
        <button type="button" className={styles.linkRow}>
          {t('family.changePassword')} <Icon name="arrowRight" size={14} />
        </button>
        <div className={styles.linkRow}>
          {t('family.logoutAllDevices')} <span className={styles.tag}>{t('common.comingSoon')}</span>
        </div>
        <div className={styles.linkRow}>
          {t('family.loginHistory')} <span className={styles.tag}>{t('common.comingSoon')}</span>
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHeader}>
          <Icon name="family" size={20} />
          <h3>{t('family.childrenManagementTitle')}</h3>
        </div>
        {children.map((child) => (
          <button type="button" key={child.id} className={styles.childRow}>
            <span className={`${styles.childAvatar} ltr-isolate`}>
              {child.firstName[0]}{child.lastName[0]}
            </span>
            <span className={styles.childInfo}>
              <span>{child.firstName} {child.lastName}</span>
              {child.age != null && (
                <span className={styles.childAge}>{t('common.years', { count: child.age })}</span>
              )}
            </span>
            <Icon name="arrowRight" size={14} />
          </button>
        ))}
        <button type="button" className={styles.primaryAction}>{t('family.addChild')}</button>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHeader}>
          <Icon name="bell" size={20} />
          <h3>{t('family.notificationsTitle')}</h3>
        </div>
        <div className={styles.toggleRow}>
          <span>{t('family.emailNotifications')}</span>
          <span className={styles.toggleOn}>{t('common.on')}</span>
        </div>
        <div className={styles.toggleRow}>
          <span>{t('family.pushNotifications')}</span>
          <span className={styles.toggleOn}>{t('common.on')}</span>
        </div>
        <button type="button" className={styles.primaryAction}>{t('family.configureNotifications')}</button>
      </div>
    </div>
  );
}
