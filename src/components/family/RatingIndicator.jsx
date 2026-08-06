import { useTranslation } from 'react-i18next';
import CircularIndicator from '../common/CircularIndicator.jsx';
import { formatNumber, formatPercent } from '../../utils/formatters.js';
import styles from './RatingIndicator.module.css';

export default function RatingIndicator({ rating }) {
  const { t, i18n } = useTranslation();
  const { current, total } = rating;
  const percent = Math.round((current / total) * 100);
  const remaining = total - current;

  return (
    <CircularIndicator
      title={t('rating.title')}
      percent={percent}
      color="gold"
      centerContent={
        <div className={`${styles.value} ltr-isolate`}>
          <span className={styles.current}>{formatNumber(current, i18n.language)}</span>
          <span className={styles.total}> / {formatNumber(total, i18n.language)}</span>
          <div className={styles.label}>{t('rating.pointsLabel', { count: current })}</div>
        </div>
      }
      footer={
        <div className={styles.footer}>
          <span>{t('rating.remainingPoints', { count: remaining })}</span>
          <span className={`${styles.percent} ltr-isolate`}>{formatPercent(percent, i18n.language)}</span>
        </div>
      }
    />
  );
}
