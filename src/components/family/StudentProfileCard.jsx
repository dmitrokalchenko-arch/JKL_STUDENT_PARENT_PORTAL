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

// ОДИН StudentProfileCard, ДВА режима — никакой второй копии карточки.
//
// mode="normal" (по умолчанию) — реальная карточка ученика.
//
// mode="settings" — используется ТОЛЬКО из /trainer/settings. 14 полей
// сгруппированы в 5 колонок (PROFILE_FIELD_COLUMNS,
// src/config/studentPageConfig.js) — согласованный вид задания
// "student-profile-club-wide-config" (раздел 3), НЕ позиционное
// повторение normal-mode layout (это сознательный отход от строгого
// WYSIWYG PR #10 в пользу читаемости — категории вместо одной длинной
// колонки). trainingSchedule/contractStatus/contractDate сюда НЕ входят и
// НЕ показываются здесь вообще НИ В КАКОМ виде (ни как toggleable поле,
// ни как informational/disabled строка) — они больше не являются полями
// профиля (раздел 4 задания): расписание принадлежит разделу "Мои
// тренировки", статус/дата договора — разделу "Договор и оплата", у обоих
// есть собственные nav-toggles (StudentPageSettingsPanels), колонка
// "Спортивная информация" заканчивается на "Тренер" и ничего после него
// не показывает.
export default function StudentProfileCard({ child, mode = 'normal', fieldVisibility, onFieldToggle }) {
  const { t } = useTranslation();

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

  const visible = (key) => isFieldVisible(fieldVisibility, key);

  // age/birthYear/currentBelt/nextBelt (Mock-Form: {color,key}) пока
  // приходят только из mock-данных. Реальные данные (Family/Trainer/Super
  // Admin Preview) заполняют firstName/lastName/gender/birthDate/age/
  // weight/sportName/groupName/trainerName/kyuGrade/beltColorName/phone/
  // email/photoUrl — см. familyDataService.js/trainerStudentsService.js/
  // get-student-preview (задача "student-profile-data-pipeline-audit").
  // age ВСЕГДА вычисляется из даты рождения через calculateAge() на
  // уровне сервиса, не хранится статично. weight/phone/email/photoUrl/
  // trainerName у Family/Trainer пайплайнов требуют миграции
  // 20260916160059 (⚠️ ПРЕДЛОЖЕНИЕ, ещё НЕ применена к production на этом
  // шаге) — до её применения соответствующие значения будут undefined,
  // строка просто не рендерится (тот же safe-fallback, что и всегда).
  // Каждая строка рендерится только если поле ACTIVE И значение реально
  // есть у ученика — ACTIVE-но-пустое значение НЕ показывает бессмысленную
  // строку (задание, раздел 8).
  //
  // trainingSchedule/contractStatus/contractDate ПОЛНОСТЬЮ убраны из этого
  // компонента (задание "student-profile-club-wide-config", раздел 4) —
  // это больше не поля профиля, а поля разделов "Мои тренировки"/"Договор
  // и оплата" под навигационными карточками (не подключены к этим
  // разделам на этом шаге — только визуально убраны отсюда).
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
            <span className={styles.beltValue}>{child.groupName}</span>
          </div>
        )}

        {visible('trainer') && child.trainerName && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.trainer')}</span>
            <span className={styles.beltValue}>{child.trainerName}</span>
          </div>
        )}

        {/* Kyu/Цвет пояса — ОДНА объединённая строка, а не два независимых
            .beltRow, потому что toggle'ы управляют ЧАСТЯМИ одного и того же
            смыслового значения "пояс" (задание "student-profile-data-
            pipeline-audit", раздел 10): kyuGrade+beltColor оба ACTIVE ->
            "gelb · 7. Kyu"; только один ACTIVE -> показывается только он;
            оба INACTIVE -> строка отсутствует целиком. Порядок — цвет,
            затем Kyu (тот же порядок, что уже был у комбинированного
            beltLabel: "gelb · 7. Kyu"). */}
        {((visible('beltColor') && child.beltColorName) || (visible('kyuGrade') && child.kyuGrade)) && (
          <div className={styles.beltRow}>
            <span className={styles.beltLabel}>{t('student.currentBelt')}</span>
            <span className={styles.beltValue}>
              {[visible('beltColor') && child.beltColorName, visible('kyuGrade') && child.kyuGrade]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        )}

        {/* currentBelt/nextBelt — ТОЛЬКО mock-данные (childrenMock.js,
            {color,key}-форма), реальные RPC этот shape никогда не задают —
            не конфликтует с блоком выше (реальные данные используют
            kyuGrade/beltColorName, mock их не устанавливает). */}
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
      </div>
    </div>
  );
}
