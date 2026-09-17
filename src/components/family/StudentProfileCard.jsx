import { useTranslation } from 'react-i18next';
import ToggleSwitch from '../common/ToggleSwitch.jsx';
import { PROFILE_FIELD_COLUMNS } from '../../config/studentPageConfig.js';
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
// вызывающих сторон normal mode (Family/Trainer Student Page/Super Admin
// Preview на этом шаге получают его из StudentPageContent, см. её
// комментарий) — isFieldVisible(...) тогда всегда true.
function isFieldVisible(fieldVisibility, key) {
  return fieldVisibility ? fieldVisibility[key] !== false : true;
}

// Простая строка "лейбл + значение" — общий примитив для большинства полей
// normal mode (используется внутри renderColumnBody ниже). null, если
// значения реально нет — ACTIVE, но пустое поле не показывает бессмысленную
// строку (задание, раздел про empty value behavior).
function ValueRow({ label, value }) {
  // !value (не === null/''): value сюда часто приходит как
  // `visible('x') && child.x` — если поле выключено, это выражение
  // коротко замыкается на `false`, не на null/'' — falsy-проверка целиком
  // ловит все "нет смысла показывать строку" случаи одним условием.
  if (!value) return null;
  return (
    <div className={styles.beltRow}>
      <span className={styles.beltLabel}>{label}</span>
      <span className={styles.beltValue}>{value}</span>
    </div>
  );
}

// ЕДИНАЯ структура колонок для ОБОИХ режимов (задача "student-profile-
// shared-layout"): normal mode и settings mode читают один и тот же
// PROFILE_FIELD_COLUMNS (src/config/studentPageConfig.js) и рендерят поля
// В ТОМ ЖЕ порядке, сгруппированные в те же 5 колонок — устраняет ранее
// найденное расхождение (Settings Mode показывал 5 колонок через
// .columnsGrid/CSS Grid, а normal mode — одну вертикальную .info-колонку
// через flex). Каждая колонка рендерится ОДНИМ и тем же .columnsGrid/
// .column контейнером в обоих режимах — при добавлении/перестановке поля
// в PROFILE_FIELD_COLUMNS обе карточки меняются синхронно, без риска
// разъехаться снова.
//
// normal mode НЕ показывает заголовки колонок ("ОСНОВНАЯ ИНФОРМАЦИЯ" и
// т.д.) — это UI-подсказка, нужная только в конструкторе Settings Mode,
// реальная карточка ученика их никогда не показывала.
function renderColumnBody(columnId, child, visible, t) {
  if (columnId === 'basic') {
    // photo/firstName/lastName — не типовые label+value строки: avatar
    // всегда структурен (см. ChildAvatar выше, toggle 'photo' управляет
    // только photo-vs-инициалы), firstName/lastName — отдельные строки
    // текста, каждая по своей visibility, в том же порядке, что в
    // PROFILE_FIELD_COLUMNS.basic.fields (photo, firstName, lastName).
    return (
      <>
        <ChildAvatar child={child} showPhoto={visible('photo')} />
        {visible('firstName') && child.firstName && <div className={styles.name}>{child.firstName}</div>}
        {visible('lastName') && child.lastName && <div className={styles.name}>{child.lastName}</div>}
      </>
    );
  }

  if (columnId === 'personal') {
    return (
      <>
        <ValueRow label={t('student.gender')} value={visible('gender') && child.gender} />
        <ValueRow label={t('student.birthDate')} value={visible('birthDate') && child.birthDate} />
        {visible('age') && child.age != null && (
          <div className={styles.age}>
            {t('common.years', { count: child.age })}{child.birthYear ? ` (${child.birthYear})` : ''}
          </div>
        )}
        <ValueRow label={t('student.weight')} value={visible('weight') && child.weight} />
      </>
    );
  }

  if (columnId === 'sport') {
    return (
      <>
        <ValueRow label={t('student.sport')} value={visible('sport') && child.sportName} />
        <ValueRow label={t('student.group')} value={visible('group') && child.groupName} />
        <ValueRow label={t('student.trainer')} value={visible('trainer') && child.trainerName} />
      </>
    );
  }

  if (columnId === 'qualification') {
    // Kyu/Цвет пояса — ОДНА объединённая строка, а не два независимых
    // ValueRow, потому что toggle'ы управляют ЧАСТЯМИ одного и того же
    // смыслового значения "пояс" (задание "student-profile-data-pipeline-
    // audit", раздел 10): kyuGrade+beltColor оба ACTIVE -> "gelb · 7. Kyu";
    // только один ACTIVE -> показывается только он; оба INACTIVE -> строка
    // отсутствует целиком. Порядок — цвет, затем Kyu.
    const combined = [visible('beltColor') && child.beltColorName, visible('kyuGrade') && child.kyuGrade]
      .filter(Boolean)
      .join(' · ');
    return (
      <>
        <ValueRow label={t('student.currentBelt')} value={combined} />
        {/* currentBelt/nextBelt — ТОЛЬКО mock-данные (childrenMock.js,
            {color,key}-форма), реальные RPC этот shape никогда не задают —
            не конфликтует с блоком выше. */}
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
      </>
    );
  }

  if (columnId === 'contact') {
    return (
      <>
        <ValueRow label={t('student.phone')} value={visible('phone') && child.phone} />
        <ValueRow label={t('student.email')} value={visible('email') && child.email} />
      </>
    );
  }

  return null;
}

// ОДИН StudentProfileCard, ДВА режима — никакой второй копии карточки.
//
// mode="normal" (по умолчанию) — реальная карточка ученика.
//
// mode="settings" — используется ТОЛЬКО из /trainer/settings. Оба режима
// используют ОДНУ и ту же 5-колоночную структуру (PROFILE_FIELD_COLUMNS,
// см. renderColumnBody выше и итоговый отчёт задачи "student-profile-
// shared-layout") — WYSIWYG: расположение полей в конструкторе точно
// совпадает с расположением на реальной Student Page.
// trainingSchedule/contractStatus/contractDate сюда НЕ входят и НЕ
// показываются здесь вообще НИ В КАКОМ виде — они больше не являются
// полями профиля (задание "student-profile-club-wide-config", раздел 4):
// расписание принадлежит разделу "Мои тренировки", статус/дата договора —
// разделу "Договор и оплата", у обоих есть собственные nav-toggles
// (StudentPageSettingsPanels).
export default function StudentProfileCard({ child, mode = 'normal', fieldVisibility, onFieldToggle }) {
  const { t } = useTranslation();
  const visible = (key) => isFieldVisible(fieldVisibility, key);

  if (mode === 'settings') {
    return (
      <div className={styles.settingsCard}>
        <div className={styles.settingsHeaderRow}>
          <ChildAvatar child={{ firstName: '', lastName: '' }} showPhoto={false} />
          <div>
            <div className={styles.settingsHeaderTitle}>{t('studentPageConfig.cardTitle')}</div>
            <div className={styles.settingsHeaderSubtitle}>{t('studentPageConfig.cardSubtitle')}</div>
          </div>
        </div>

        <div className={styles.columnsGrid}>
          {PROFILE_FIELD_COLUMNS.map((column) => (
            <div key={column.id} className={styles.column}>
              <div className={styles.columnTitle}>{t(column.titleKey)}</div>

              {column.fields.map((key) => {
                const active = isFieldVisible(fieldVisibility, key);
                const label = t(`student.${key}`);
                const stateLabel = t(`studentPage.settingsMode.${active ? 'active' : 'inactive'}`);
                return (
                  <div
                    key={key}
                    className={`${styles.settingsRow} ${active ? '' : styles.settingsRowInactive}`}
                  >
                    <span className={styles.settingsFieldLabel}>{label}</span>
                    <ToggleSwitch
                      active={active}
                      onToggle={() => onFieldToggle?.(key)}
                      ariaLabel={`${label} — ${stateLabel}`}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!child) return null;

  return (
    <div className={styles.card}>
      <div className={styles.columnsGrid}>
        {PROFILE_FIELD_COLUMNS.map((column) => (
          <div key={column.id} className={styles.column}>
            {renderColumnBody(column.id, child, visible, t)}
          </div>
        ))}
      </div>
    </div>
  );
}
