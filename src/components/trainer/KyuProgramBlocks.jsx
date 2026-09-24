import { useTranslation } from 'react-i18next';
import SelectedTechniquesStrip from './SelectedTechniquesStrip.jsx';
import styles from './KyuProgramBlocks.module.css';

export const KYU_PROGRAM_BLOCK_TYPES = ['required_nage', 'required_katame', 'additional'];

// Три полноширинных блока формирования программы Kyu, один под другим
// (режим "Все техники", см. TrainerKyuProgramPage) — техники внутри
// блока переносятся на новую строку (flex-wrap), сам блок растёт вниз.
// Клик по блоку целиком делает его
// ACTIVE target — именно в него попадёт следующая техника, нажатая в
// каталоге ниже (см. handleToggleTechnique родителя). Названия блоков —
// ТОЛЬКО организационная структура программы, никакой проверки
// category/main_group техники относительно блока здесь и в родителе нет
// (см. задание, раздел 6) — тренер может положить любую технику в любой
// блок. Каждый блок переиспользует существующий SelectedTechniquesStrip
// (thumbnail+название+кнопка ×, тот же компонент, что раньше показывал
// единый плоский список) — просто по одному экземпляру на блок, со
// своим Set выбранных id и обработчиком удаления, привязанным именно к
// этому блоку (удаление из одного блока не трогает остальные).
export default function KyuProgramBlocks({ techniques, program, activeBlock, onActivate, onRemove }) {
  const { t } = useTranslation();

  return (
    <div className={styles.blocksRow}>
      {KYU_PROGRAM_BLOCK_TYPES.map((blockType) => {
        const selectedIds = program[blockType];
        const active = blockType === activeBlock;
        return (
          <div
            key={blockType}
            className={`${styles.block} ${active ? styles.blockActive : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            onClick={() => onActivate(blockType)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onActivate(blockType);
              }
            }}
          >
            <div className={styles.blockHeader}>
              <span className={styles.blockTitle}>{t(`trainerKyuProgram.block.${blockType}`)}</span>
              <span className={styles.blockCount}>{selectedIds.size}</span>
            </div>
            <SelectedTechniquesStrip
              techniques={techniques}
              selectedIds={selectedIds}
              onRemove={(techniqueId) => onRemove(blockType, techniqueId)}
            />
          </div>
        );
      })}
    </div>
  );
}
