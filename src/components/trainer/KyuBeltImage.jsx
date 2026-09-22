import { useState } from 'react';
import { getKyuBeltImageUrl } from '../../services/kyuBeltImageUrl.js';

// Реальное фото завязанного Obi из Supabase Storage (bucket `obi-belts`,
// public), заменяет прежний искусственно нарисованный SVG KyuBeltIcon.
// Если изображение не загрузилось (сеть/CORS/объект удалён из Storage) —
// просто ничего не рендерим: кнопка Kyu остаётся полностью рабочей, под
// названием Kyu не должно быть сломанной иконки браузера или старого SVG
// в роли fallback (см. задание).
export default function KyuBeltImage({ kyuGrad, className }) {
  const [failed, setFailed] = useState(false);
  const url = getKyuBeltImageUrl(kyuGrad);
  if (!url || failed) return null;

  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
