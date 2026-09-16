import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import styles from './StudentProfileCard.module.css';

function ChildAvatar({ child, showPhoto }) {
  const initials = `${child.firstName?.[0] ?? ''}${child.lastName?.[0] ?? ''}`;
  const usePhoto = showPhoto && !!child.photoUrl;
  return (
    <span className={`${styles.avatar} ltr-isolate`}>
      {usePhoto ? <img src={child.photoUrl} alt="" /> : initials}
    </span>
  );
}

// fieldVisibility отсутствует (undefined) у ВСЕХ сегодняшних реальных
// вызывающих сторон (Family/Trainer Student Page/Super Admin Preview) —
// поэтому isFieldVisible(...) для них всегда возвращает true, и normal
// mode ниже рендерит РОВНО то же самое, что и до этого PR. fieldVisibility
// начинает что-то скрывать только тогда, когда его явно передают — сейчас
// это делает единственный вызывающий код: TrainerSettingsPage (settings
// mode), временное frontend-only состояние, нигде не сохраняется.
function isFieldVisible(fieldVisibility, key) {
  return fieldVisibility ? fieldVisibility[key] !== false : true;
}

// Единственная кнопка-тумблер Settings Mode — переиспользуется для всех 17
// полей, а не копируется в каждую строку.
function FieldToggle({ active, onToggle, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={ariaLabel}
      className={`${styles.fieldToggle} ${active ? styles.fieldToggleActive : ''}`}
      onClick={onToggle}
    >
      {active && <Icon name="check" size={13} color="#17171b" />}
    </button>
  );
}

// Порядок = будущий порядок полей на реальной StudentProfileCard (WYSIWYG,
// см. задание). "photo" — единственный slot, который управляет НЕ строкой,
// а avatar-областью (см. normal mode ниже), но в Settings Mode он всё
// равно отображается как обычная строка в списке — Trainer переключает
// его тем же способом, что и остальные поля.
const SETTINGS_FIELD_KEYS = [
  'photo',
  'firstName',
  'lastName',
  'gender',
  'birthDate',
  'age',
  'weight',
  'sport',
  'group',
  'trainingSchedule',
  'trainer',
  'kyuGrade',
  'beltColor',
  'phone',
  'email',
  'contractStatus',
  'contractDate'
];

// ОДИН StudentProfileCard, ДВА режима — никакой второй копии карточки
// (см. итоговый отчёт задачи "student-profile-visual-configurator").
//
// mode="normal" (по умолчанию) — реальная карточка ученика, ведёт себя
// ТОЧНО как до этого PR, если fieldVisibility не передан.
//
// mode="settings" — используется ТОЛЬКО из /trainer/settings
// (TrainerSettingsPage, club-wide режим настройки). Показывает ВСЕ 17
// display slots в фиксированном порядке (тот же порядок, что займут
// реальные поля в normal mode), каждый — с ACTIVE/INACTIVE тумблером.
// Ничего не исчезает при выключении — только визуально приглушается
// (см. .settingsRowInactive). child в этом режиме не используется вовсе:
// показываются только нейтральные i18n-лейблы, без единого реального
// значения ученика.
export default function StudentProfileCard({ child, mode = 'normal', fieldVisibility, onFieldToggle }) {
  const { t } = useTranslation();

  if (mode === 'settings') {
    return (
      <div className={styles.card}>
        <ChildAvatar child={{ firstName: '', lastName: '' }} showPhoto={false} />

        <div className={styles.info}>
          {SETTINGS_FIELD_KEYS.map((key) => {
            const active = isFieldVisible(fieldVisibility, key);
            const label = t(`student.${key}`);
            const stateLabel = t(`studentPage.settingsMode.${active ? 'active' : 'inactive'}`);
            return (
              <div
                key={key}
                className={`${styles.settingsRow} ${active ? '' : styles.settingsRowInactive}`}
              >
                <span className={styles.settingsFieldLabel}>{label}</span>
                <FieldToggle
                  active={active}
                  onToggle={() => onFieldToggle?.(key)}
                  ariaLabel={`${label} — ${stateLabel}`}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (!child) return null;

  const visible = (key) => isFieldVisible(fieldVisibility, key);

  // age/birthYear/currentBelt/nextBelt (Mock-Form: {color,key}) пока
  // приходят только из mock-данных. sportName/groupName/trainingSchedule/
  // beltLabel/contractStatus (готовые строки, не i18n-key) приходят из
  // реального RPC (migration 20260901100040) — отдельный простой блок
  // строк, чтобы не трогать существующую mock-форму currentBelt/nextBelt.
  // Каждая строка рендерится только если есть — карточка не падает на
  // реальных данных, просто показывает меньше блоков.
  //
  // gender/birthDate/weight/trainerName/kyuGrade/beltColorName/phone/
  // email/contractDate — НОВЫЕ display slots (задание "Club-Wide
  // настройка полей StudentProfileCard"). Ни один текущий сервис
  // (familyDataService.js/trainerStudentsService.js/get-student-preview)
  // их не заполняет — эти блоки СЕГОДНЯ не рендерятся никогда ни для
  // одного accessMode, это подготовка на будущее, а не подключение
  // реальных данных (RPC/RLS/Block 1 в этом PR не менялись).
  return (
    <div className={styles.card}>
      <ChildAvatar child={child} showPhoto={visible('photo')} />

      <div className={styles.info}>
        <div className={styles.name}>
          {visible('firstName') && child.firstName}
          {visible('firstName') && visible('lastName') && child.firstName && child.lastName ? ' ' : ''}
          {visible('lastName') && child.lastName}
        </div>

        {visible('gender') && child.gender && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.gender')}</span>
            <span className={styles.beltValue}>{child.gender}</span>
          </div>
        )}

        {visible('birthDate') && child.birthDate && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.birthDate')}</span>
            <span className={styles.beltValue}>{child.birthDate}</span>
          </div>
        )}

        {visible('age') && child.age != null && (
          <div className={styles.age}>
            {t('common.years', { count: child.age })}{child.birthYear ? ` (${child.birthYear})` : ''}
          </div>
        )}

        {visible('weight') && child.weight != null && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.weight')}</span>
            <span className={styles.beltValue}>{child.weight}</span>
          </div>
        )}

        {visible('sport') && child.sportName && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.sport')}</span>
            <span className={styles.beltValue}>{child.sportName}</span>
          </div>
        )}

        {visible('group') && child.groupName && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.group')}</span>
            <span className={styles.beltValue}>
              {child.groupName}
              {visible('trainingSchedule') && child.trainingSchedule ? ` (${child.trainingSchedule})` : ''}
            </span>
          </div>
        )}

        {visible('trainer') && child.trainerName && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.trainer')}</span>
            <span className={styles.beltValue}>{child.trainerName}</span>
          </div>
        )}

        {visible('kyuGrade') && child.kyuGrade && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.kyuGrade')}</span>
            <span className={styles.beltValue}>{child.kyuGrade}</span>
          </div>
        )}

        {visible('beltColor') && child.beltColorName && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.beltColor')}</span>
            <span className={styles.beltValue}>{child.beltColorName}</span>
          </div>
        )}

        {(visible('kyuGrade') || visible('beltColor')) && child.currentBelt && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.currentBelt')}</span>
            <span className={styles.beltValue}>
              <span className={styles.beltDot} style={{ background: child.currentBelt.color }} />
              {t(child.currentBelt.key)}
            </span>
          </div>
        )}

        {(visible('kyuGrade') || visible('beltColor')) && child.nextBelt && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.nextBelt')}</span>
            <span className={styles.beltValue}>
              <span className={styles.beltDot} style={{ background: child.nextBelt.color }} />
              {t(child.nextBelt.key)}
            </span>
          </div>
        )}

        {(visible('kyuGrade') || visible('beltColor')) && child.beltLabel && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.currentBelt')}</span>
            <span className={styles.beltValue}>{child.beltLabel}</span>
          </div>
        )}

        {visible('phone') && child.phone && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.phone')}</span>
            <span className={styles.beltValue}>{child.phone}</span>
          </div>
        )}

        {visible('email') && child.email && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.email')}</span>
            <span className={styles.beltValue}>{child.email}</span>
          </div>
        )}

        {visible('contractStatus') && child.contractStatus && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.contractStatus')}</span>
            <span className={styles.beltValue}>{child.contractStatus}</span>
          </div>
        )}

        {visible('contractDate') && child.contractDate && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.contractDate')}</span>
            <span className={styles.beltValue}>{child.contractDate}</span>
          </div>
        )}
      </div>
    </div>
  );
}
