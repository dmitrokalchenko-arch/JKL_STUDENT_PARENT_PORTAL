import { useEffect, useMemo, useState } from 'react';

// children может приходить асинхронно (реальная загрузка через
// useFamilyData) — начальное значение useState вычисляется только один раз
// при монтировании и не подходит, если на момент монтирования массив ещё
// пуст. Поэтому актуальность selectedId (сброс на null для пустого списка,
// переизбрание первого доступного при исчезновении текущего) поддерживается
// эффектом, а не начальным значением. Сравнение id — как строк (id из
// реальных данных — string, см. familyDataService.js), без приведения к
// Number.
export function useSelectedChild(children) {
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (children.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const stillExists = children.some((child) => String(child.id) === String(selectedId));
    if (!stillExists) {
      setSelectedId(children[0].id);
    }
  }, [children, selectedId]);

  const selectedChild = useMemo(
    () => children.find((child) => String(child.id) === String(selectedId)) ?? null,
    [children, selectedId]
  );

  return { selectedChild, selectedId, selectChild: setSelectedId };
}
