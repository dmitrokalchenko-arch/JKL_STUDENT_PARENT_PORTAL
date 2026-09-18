import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RequiredTechniqueCard from './RequiredTechniqueCard.jsx';
import JudoTechniqueVideoModal from '../trainer/JudoTechniqueVideoModal.jsx';
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
export default function RequiredTechniquesSection({ nextKyu, status, techniques, isLoading, error, onRetry }) {
  const { t } = useTranslation();

  // Локальное состояние "какая техника сейчас открыта в видео-модалке" —
  // НЕ связано с useRequiredTechniques/RPC вообще: открытие/закрытие
  // модалки никогда не вызывает повторную загрузку списка техник (тот же
  // кэш по studentId продолжает работать как есть).
  const [videoTechnique, setVideoTechnique] = useState(null);

  const groups = useMemo(() => groupTechniquesByCategory(techniques ?? []), [techniques]);

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
  // этого статуса (см. get_family_required_techniques/
  // get_trainer_required_techniques).
  return (
    <div className={styles.wrap}>
      <h3 className={styles.title}>{t('requiredTechniques.titleForKyu', { kyu: nextKyu })}</h3>

      {(!techniques || techniques.length === 0) && (
        <div className={styles.stateBox}>{t('requiredTechniques.emptyProgram', { kyu: nextKyu })}</div>
      )}

      {techniques && techniques.length > 0 && (
        <div className={styles.groups}>
          {groups.map(({ mainGroup, categories }) => (
            <div key={mainGroup} className={styles.mainGroup}>
              <h4 className={styles.mainGroupTitle}>{mainGroup}</h4>

              {categories.map(({ category, techniques: categoryTechniques }) => (
                <div key={category} className={styles.category}>
                  <div className={styles.categoryTitle}>{category}</div>
                  <div className={styles.grid}>
                    {categoryTechniques.map((technique) => (
                      <RequiredTechniqueCard key={technique.id} technique={technique} onPlay={setVideoTechnique} />
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
