import Icon from '../common/Icon.jsx';
import TechniqueThumbnail from './TechniqueThumbnail.jsx';
import styles from './TechniqueSelectCard.module.css';

// Карточка техники для конструктора программы Kyu (TrainerKyuProgramPage) —
// НЕ переиспользует JudoTechniquePicker.jsx as-is: там строка каталога с
// кнопкой "Отметить выполненной" (другой бизнес-процесс — прогресс
// конкретного ученика), здесь простой checkbox/toggle "входит/не входит в
// программу этого Kyu". Переиспользует только TechniqueThumbnail (то же
// изображение/placeholder, что и везде в проекте) и сами данные техники
// (image_url/name/category уже вычислены сервисом — эта карточка ничего
// не запрашивает сама и не хранит собственного состояния).
export default function TechniqueSelectCard({ technique, isSelected, onToggle }) {
  return (
    <button
      type="button"
      className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
      onClick={() => onToggle(technique.id)}
      aria-pressed={isSelected}
    >
      <span className={styles.checkbox} aria-hidden="true">
        {isSelected && <Icon name="check" size={13} color="var(--color-bg)" />}
      </span>

      <TechniqueThumbnail imageUrl={technique.image_url} />

      <span className={`${styles.name} ltr-isolate`}>{technique.name}</span>
      <span className={styles.category}>{technique.category}</span>
    </button>
  );
}
