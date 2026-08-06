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

  // age/birthYear/currentBelt/nextBelt пока приходят только из mock-данных
  // (реальный RPC get_current_family_children их не отдаёт — см. RISKS
  // отчёта этапа frontend integration) — рендерятся только если есть,
  // чтобы карточка не падала на реальных данных, а просто показывала
  // меньше блоков.
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
      </div>
    </div>
  );
}
