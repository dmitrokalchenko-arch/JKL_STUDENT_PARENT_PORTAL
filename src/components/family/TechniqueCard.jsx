import Icon from '../common/Icon.jsx';
import styles from './TechniqueCard.module.css';

export default function TechniqueCard({ technique, variant, onClick }) {
  const isCompleted = variant === 'completed';
  const Wrapper = isCompleted ? 'button' : 'div';

  return (
    <Wrapper
      type={isCompleted ? 'button' : undefined}
      className={`${styles.card} ${isCompleted ? styles.completed : styles.required}`}
      onClick={isCompleted ? () => onClick(technique) : undefined}
    >
      <div className={styles.imageBox}>
        {technique.imageUrl ? (
          <img src={technique.imageUrl} alt="" className={styles.image} />
        ) : (
          <Icon name="belt" size={isCompleted ? 26 : 16} className={styles.placeholderIcon} />
        )}
        {isCompleted && (
          <span className={styles.checkBadge}>
            <Icon name="check" size={12} color="#0b0b0d" />
          </span>
        )}
      </div>
      <div className={styles.name}>{technique.name}</div>
    </Wrapper>
  );
}
