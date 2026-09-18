import Icon from '../common/Icon.jsx';
import TechniqueThumbnail from './TechniqueThumbnail.jsx';
import styles from './SelectedTechniqueChip.module.css';

// Компактная мини-карточка для горизонтальной ленты выбранных техник
// (SelectedTechniquesStrip, TrainerKyuProgramPage) — НЕ полноразмерная
// TechniqueSelectCard из основного каталога, отдельный маленький
// компонент специально под ленту. Переиспользует только
// TechniqueThumbnail (то же изображение/placeholder, что и везде в
// проекте) — никакого отдельного состояния выбора здесь нет, чип — чисто
// визуальное отражение уже выбранной техники + кнопка удаления.
export default function SelectedTechniqueChip({ technique, onRemove }) {
  return (
    <div className={styles.chip}>
      <TechniqueThumbnail imageUrl={technique.image_url} size="sm" />
      <span className={`${styles.name} ltr-isolate`}>{technique.name}</span>
      <button
        type="button"
        className={styles.removeButton}
        onClick={() => onRemove(technique.id)}
        aria-label={technique.name}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
