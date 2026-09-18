import { useState } from 'react';
import Icon from '../common/Icon.jsx';
import styles from './TechniqueThumbnail.module.css';

// Общий для JudoTechniquePicker (каталог) и CompletedTechniquesList
// (выполненные техники) — одна и та же техника должна визуально показывать
// одну и ту же картинку в обоих местах, тем же размером/border-radius/
// object-fit/placeholder, не двумя параллельными реализациями.
//
// Отдельный маленький компонент (не инлайн-JSX в списке), чтобы ошибка
// загрузки конкретной картинки (onError) была per-item состоянием, а не
// полем в общем списке техник: одна сломанная картинка не должна вызывать
// ре-рендер/лишний state у остальных строк. Если image_url нет вообще
// (image_path пустой) или картинка не загрузилась — показывается тот же
// placeholder, карточка/кнопки продолжают работать как обычно.
// size="sm" — компактный вариант для SelectedTechniqueChip (лента
// выбранных техник) — тот же компонент, тот же placeholder/object-fit,
// только меньше. Без size — прежнее поведение/размер, ни один
// существующий вызов не меняется.
export default function TechniqueThumbnail({ imageUrl, size }) {
  const [hasError, setHasError] = useState(false);
  const showImage = Boolean(imageUrl) && !hasError;

  return (
    <div className={`${styles.thumbnail} ${size === 'sm' ? styles.thumbnailSm : ''}`}>
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          className={styles.thumbnailImg}
          onError={() => setHasError(true)}
        />
      ) : (
        <Icon name="belt" size={size === 'sm' ? 14 : 20} className={styles.thumbnailPlaceholderIcon} />
      )}
    </div>
  );
}
