import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import ToggleSwitch from '../common/ToggleSwitch.jsx';
import { NAVIGATION_TOGGLE_ITEMS } from '../../config/studentPageConfig.js';
import styles from './StudentPageSettingsPanels.module.css';

// Три презентационных блока Settings Mode, которых нет ни на одной
// реальной Student Page (только /trainer/settings, см.
// TrainerSettingsPage.jsx) — не часть StudentProfileCard (это отдельная
// геометрия, не 5-колоночный grid полей карточки), поэтому вынесены сюда,
// а не встроены туда.
//
// SectionToggleCard — ОДНА реализация на Rating и Bonus Techniques
// (раздел 7-8 задания) — те же icon/title/description/toggle, разные
// пропы, а не два похожих компонента.
export function SectionToggleCard({ icon, title, badge, description, active, onToggle }) {
  const { t } = useTranslation();
  const stateLabel = t(`studentPage.settingsMode.${active ? 'active' : 'inactive'}`);

  return (
    <div className={`${styles.sectionCard} ${active ? '' : styles.sectionCardInactive}`}>
      <div className={styles.sectionCardIcon}>
        <Icon name={icon} size={20} />
      </div>

      <div className={styles.sectionCardBody}>
        <div className={styles.sectionCardTitleRow}>
          <span className={styles.sectionCardTitle}>{title}</span>
          {badge && <span className={styles.sectionCardBadge}>{badge}</span>}
        </div>
        <div className={styles.sectionCardDescription}>{description}</div>
      </div>

      <div className={styles.sectionCardToggleWrap}>
        <ToggleSwitch active={active} onToggle={onToggle} ariaLabel={`${title} — ${stateLabel}`} />
        <span className={styles.sectionCardToggleLabel}>{t('studentPageConfig.showOnStudentPage')}</span>
      </div>
    </div>
  );
}

// Раздел 9-10 задания: все 6 nav-карточек ВСЕГДА видны здесь (даже
// INACTIVE — приглушены, не исчезают), каждая с собственным toggle.
// "certificates" сюда не входит — NAVIGATION_TOGGLE_ITEMS уже отфильтрован
// в studentPageConfig.js.
export function NavigationTogglesCard({ navigation, onToggle }) {
  const { t } = useTranslation();

  return (
    <div className={styles.navCard}>
      <div className={styles.navCardTitle}>{t('studentPageConfig.navigationTitle')}</div>
      <div className={styles.navCardSubtitle}>{t('studentPageConfig.navigationSubtitle')}</div>

      <div className={styles.navGrid}>
        {NAVIGATION_TOGGLE_ITEMS.map((item) => {
          const active = navigation[item.id] !== false;
          const label = t(item.labelKey);
          const stateLabel = t(`studentPage.settingsMode.${active ? 'active' : 'inactive'}`);
          return (
            <div key={item.id} className={`${styles.navItem} ${active ? '' : styles.navItemInactive}`}>
              <div className={styles.navItemToggle}>
                <ToggleSwitch
                  active={active}
                  onToggle={() => onToggle(item.id)}
                  ariaLabel={`${label} — ${stateLabel}`}
                />
              </div>
              <Icon name={item.icon} size={20} />
              <span>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
