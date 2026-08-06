import { useTranslation } from 'react-i18next';
import CircularIndicator from '../common/CircularIndicator.jsx';
import styles from './AgeIndicator.module.css';

export default function AgeIndicator({ eligibility }) {
  const { t } = useTranslation();
  const { achieved, currentAge, requiredAge, remainingYears } = eligibility;

  const percent = achieved ? 100 : Math.min(100, Math.round((currentAge / requiredAge) * 100));
  const color = achieved ? 'success' : 'warning';

  return (
    <CircularIndicator
      title={t('exam.title')}
      percent={percent}
      color={color}
      cornerIcon={achieved ? 'check' : 'clock'}
      centerContent={
        <div className={`${achieved ? styles.statusAchieved : styles.statusPending} ltr-isolate`}>
          {achieved ? t('exam.achieved') : t('exam.notAchieved')}
        </div>
      }
      footer={
        <div className={styles.footer}>
          <div>{t('exam.currentAge', { count: currentAge })}</div>
          <div>{t('exam.requiredAge', { count: requiredAge })}</div>
          {!achieved && remainingYears != null && (
            <div className={styles.remaining}>{t('exam.remainingYears', { count: remainingYears })}</div>
          )}
        </div>
      }
    />
  );
}
