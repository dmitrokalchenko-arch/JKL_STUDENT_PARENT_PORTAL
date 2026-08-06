import Icon from './Icon.jsx';
import styles from './CircularIndicator.module.css';

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function CircularIndicator({
  title,
  percent,
  color = 'gold',
  cornerIcon,
  centerContent,
  footer
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const dashOffset = CIRCUMFERENCE - (clamped / 100) * CIRCUMFERENCE;

  return (
    <div className={styles.card}>
      <div className={styles.title}>{title}</div>

      <div className={styles.ringWrap}>
        <svg viewBox="0 0 120 120" className={styles.ring}>
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke="var(--color-border-strong)"
            strokeWidth="8"
          />
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke={`var(--color-${color})`}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 60 60)"
            className={styles.progress}
          />
        </svg>

        {cornerIcon && (
          <span className={`${styles.cornerIcon} ${styles[`corner-${color}`]}`}>
            <Icon name={cornerIcon} size={16} />
          </span>
        )}

        <div className={styles.center}>{centerContent}</div>
      </div>

      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
