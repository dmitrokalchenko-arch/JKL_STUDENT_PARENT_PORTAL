import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { findTechniqueById } from '../../utils/judoTechniques.js';
import SelectedTechniqueChip from './SelectedTechniqueChip.jsx';
import styles from './SelectedTechniquesStrip.module.css';

// Горизонтальная лента выбранных техник для sticky-панели
// TrainerKyuProgramPage — ИСКЛЮЧИТЕЛЬНО визуальное представление
// draftSelectedIds: второго state здесь нет, отдельный запрос к БД не
// делается — для каждого id ищем уже существующую технику в уже
// загруженном каталоге (findTechniqueById, тот же переиспользуемый
// helper, что и utils/judoTechniques.js). Если каталог ещё не загружен
// (techniques === null) — лента просто ничего не показывает (родитель
// сам решает, когда её рендерить); id без соответствия в каталоге
// (не должно происходить, но findTechniqueById безопасно вернёт null)
// пропускаются, а не роняют список.
export default function SelectedTechniquesStrip({ techniques, selectedIds, onRemove }) {
  const { t } = useTranslation();

  const selectedTechniques = useMemo(() => {
    if (!techniques) return [];
    return [...selectedIds]
      .map((id) => findTechniqueById(techniques, id))
      .filter(Boolean);
  }, [techniques, selectedIds]);

  if (selectedTechniques.length === 0) {
    return <div className={styles.empty}>{t('trainerKyuProgram.stripEmpty')}</div>;
  }

  return (
    <div className={styles.strip}>
      {selectedTechniques.map((technique) => (
        <SelectedTechniqueChip key={technique.id} technique={technique} onRemove={onRemove} />
      ))}
    </div>
  );
}
