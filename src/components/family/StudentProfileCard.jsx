import { useTranslation } from 'react-i18next';
import styles from './StudentProfileCard.module.css';

function ChildAvatar({ child }) {
  const initials = `${child.firstName?.[0] ?? ''}${child.lastName?.[0] ?? ''}`;
  return (
    <span className={`${styles.avatar} ltr-isolate`}>
      {child.photoUrl ? <img src={child.photoUrl} alt="" /> : initials}
    </span>
  );
}

export default function StudentProfileCard({ child }) {
  const { t } = useTranslation();

  if (!child) return null;

  // age/birthYear/currentBelt/nextBelt (Mock-Form: {color,key}) пока
  // приходят только из mock-данных. sportName/groupName/trainingSchedule/
  // beltLabel/contractStatus (готовые строки, не i18n-key) приходят из
  // реального RPC (migration 20260901100040) — отдельный простой блок
  // строк, чтобы не трогать существующую mock-форму currentBelt/nextBelt.
  // Каждая строка рендерится только если есть — карточка не падает на
  // реальных данных, просто показывает меньше блоков.
  return (
    <div className={styles.card}>
      <ChildAvatar child={child} />

      <div className={styles.info}>
        <div className={styles.name}>{child.firstName} {child.lastName}</div>
        {child.age != null && (
          <div className={styles.age}>
            {t('common.years', { count: child.age })}{child.birthYear ? ` (${child.birthYear})` : ''}
          </div>
        )}

        {child.sportName && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.sport')}</span>
            <span className={styles.beltValue}>{child.sportName}</span>
          </div>
        )}

        {child.groupName && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.group')}</span>
            <span className={styles.beltValue}>
              {child.groupName}{child.trainingSchedule ? ` (${child.trainingSchedule})` : ''}
            </span>
          </div>
        )}

        {child.currentBelt && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.currentBelt')}</span>
            <span className={styles.beltValue}>
              <span className={styles.beltDot} style={{ background: child.currentBelt.color }} />
              {t(child.currentBelt.key)}
            </span>
          </div>
        )}

        {child.nextBelt && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.nextBelt')}</span>
            <span className={styles.beltValue}>
              <span className={styles.beltDot} style={{ background: child.nextBelt.color }} />
              {t(child.nextBelt.key)}
            </span>
          </div>
        )}

        {child.beltLabel && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.currentBelt')}</span>
            <span className={styles.beltValue}>{child.beltLabel}</span>
          </div>
        )}

        {child.contractStatus && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.contractStatus')}</span>
            <span className={styles.beltValue}>{child.contractStatus}</span>
          </div>
        )}
      </div>
    </div>
  );
}
