import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RequiredTechniqueCard from './RequiredTechniqueCard.jsx';
import JudoTechniqueVideoModal from '../trainer/JudoTechniqueVideoModal.jsx';
import { KYU_PROGRAM_BLOCK_TYPES } from '../trainer/KyuProgramBlocks.jsx';
import { groupTechniquesByCategory } from '../../utils/judoTechniques.js';
import styles from './RequiredTechniquesSection.module.css';

// Общий блок "Необходимые техники" — ОДИН компонент для family И trainer
// (не FamilyRequiredTechniques/TrainerRequiredTechniques), используется
// внутри StudentPageContent. Получает уже готовые данные пропами (та же
// конвенция, что TechniqueProgressSection/SectionToggleCard) — сам ничего
// не запрашивает, RPC-вызов и выбор family/trainer RPC остаются на
// уровне страницы (FamilyDashboard/TrainerStudentPage), не здесь.
//
// status различает "программа пуста, клуб не настроил" (ok + []) от
// "Kyu не определён/не распознан/уже максимальный" — эти пять состояний
// НЕ путаются между собой и отдельно от реальной ошибки загрузки
// (error проп, отдельная ветка с Retry). Completion/progress/чекбоксы
// здесь намеренно отсутствуют — read-only список программы, не прогресс
// выполнения (см. итоговый отчёт задачи).
//
// ТРИ БЛОКА (этап 1 задачи "Student → Необходимые техники по блокам"):
// верхний уровень группировки — ФАКТИЧЕСКИЙ block_type сохранённой
// программы Kyu (required_nage/required_katame/additional, тот же порядок
// KYU_PROGRAM_BLOCK_TYPES, что в Trainer → Kyu-Программа), а НЕ
// main_group/category глобального каталога: kata-guruma (required_nage) и
// kibisu-gaeshi (additional) не должны слипаться в "Nage-waza → TE-WAZA"
// только потому, что обе — Nage-waza. category остаётся подписью на самой
// карточке. Все три блока показываются всегда (пустой — спокойный empty
// state). Одна technique_id может стоять в двух блоках — это две разные
// записи программы, поэтому key = block_type + id, дедупликации нет.
//
// Fallback: если backend ещё отдаёт старый контракт без block_type
// (миграция 20260929100074 не применена) — показывается прежняя
// группировка по main_group/category, block_type НЕ угадывается.
export default function RequiredTechniquesSection({ nextKyu, status, techniques, isLoading, error, onRetry }) {
  const { t } = useTranslation();

  // Локальное состояние "какая техника сейчас открыта в видео-модалке" —
  // НЕ связано с useRequiredTechniques/RPC вообще: открытие/закрытие
  // модалки никогда не вызывает повторную загрузку списка техник (тот же
  // кэш по studentId продолжает работать как есть).
  const [videoTechnique, setVideoTechnique] = useState(null);

  const { list, hasBlockTypes, blocks, legacyGroups } = useMemo(() => {
    const items = techniques ?? [];
    const withBlockTypes = items.every((technique) => KYU_PROGRAM_BLOCK_TYPES.includes(technique.block_type));
    return {
      list: items,
      hasBlockTypes: withBlockTypes,
      blocks: KYU_PROGRAM_BLOCK_TYPES.map((blockType) => ({
        blockType,
        techniques: items.filter((technique) => technique.block_type === blockType)
      })),
      legacyGroups: withBlockTypes ? [] : groupTechniquesByCategory(items)
    };
  }, [techniques]);

  if (isLoading) {
    return <div className={styles.stateBox}>{t('requiredTechniques.loading')}</div>;
  }

  if (error) {
    return (
      <div className={styles.stateBox}>
        {t('requiredTechniques.loadError')}
        <button type="button" className={styles.retryButton} onClick={onRetry}>
          {t('requiredTechniques.retry')}
        </button>
      </div>
    );
  }

  if (status === 'no_current_kyu') {
    return <div className={styles.stateBox}>{t('requiredTechniques.noCurrentKyu')}</div>;
  }

  if (status === 'unmapped_kyu') {
    return <div className={styles.stateBox}>{t('requiredTechniques.unmappedKyu')}</div>;
  }

  if (status === 'max_level') {
    return <div className={styles.stateBox}>{t('requiredTechniques.maxLevel')}</div>;
  }

  // status === 'ok' далее — nextKyu гарантированно задан на бэкенде для
  // этого статуса (см. get_required_techniques_for_student).
  return (
    <div className={styles.wrap}>
      <h3 className={styles.title}>{t('requiredTechniques.titleForKyu', { kyu: nextKyu })}</h3>

      {list.length === 0 && (
        <div className={styles.stateBox}>{t('requiredTechniques.emptyProgram', { kyu: nextKyu })}</div>
      )}

      {hasBlockTypes ? (
        <div className={styles.blocks}>
          {blocks.map(({ blockType, techniques: blockTechniques }) => (
            <section key={blockType} className={styles.block}>
              <h4 className={styles.blockTitle}>
                {t(`requiredTechniques.block.${blockType}`)}
                <span className={styles.blockCount}>{blockTechniques.length}</span>
              </h4>
              {blockTechniques.length === 0 ? (
                <div className={styles.blockEmpty}>{t('requiredTechniques.blockEmpty')}</div>
              ) : (
                <div className={styles.grid}>
                  {blockTechniques.map((technique) => (
                    <RequiredTechniqueCard
                      key={`${blockType}:${technique.id}`}
                      technique={technique}
                      onPlay={setVideoTechnique}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.groups}>
          {legacyGroups.map(({ mainGroup, categories }) => (
            <div key={mainGroup} className={styles.mainGroup}>
              <h4 className={styles.mainGroupTitle}>{mainGroup}</h4>

              {categories.map(({ category, techniques: categoryTechniques }) => (
                <div key={category} className={styles.category}>
                  <div className={styles.categoryTitle}>{category}</div>
                  <div className={styles.grid}>
                    {categoryTechniques.map((technique, index) => (
                      <RequiredTechniqueCard key={`${technique.id}:${index}`} technique={technique} onPlay={setVideoTechnique} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <JudoTechniqueVideoModal technique={videoTechnique} onClose={() => setVideoTechnique(null)} />
    </div>
  );
}
