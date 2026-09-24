import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import LanguageSwitcher from '../common/LanguageSwitcher/LanguageSwitcher.jsx';
import styles from './TrainerHeader.module.css';

// Общий хедер тренерской области (Dashboard/Students/Settings/Student) —
// тот же визуальный паттерн, что FamilyHeader (бренд + заголовок +
// LanguageSwitcher), теперь СИММЕТРИЧНО и с кнопкой выхода — тот же
// header.logout ключ, что уже использует FamilyHeader (единое "Выход"
// для обеих ролей, задание, раздел 4: "кнопка «Выйти» = завершить
// текущую role session").
//
// onLogout — единственный новый проп, ЕДИНСТВЕННАЯ реализация на все 4
// экрана, использующих этот компонент (TrainerDashboard/
// TrainerStudentsScreen/TrainerSettingsPage/TrainerStudentPage — см.
// итоговый отчёт задачи) — сама async-защита от double-click (disabled
// на время выполнения) тоже живёт здесь ОДИН раз, а не в каждой из
// четырёх страниц. Сам signOutTrainer() эта кнопка не вызывает —
// вызывающая страница передаёт уже готовую функцию (симметрично тому,
// как FamilyHeader принимает onLogout от FamilyDashboard, не вызывая
// signOutFamily сам).
//
// backTo (этап "DJB template", раздел 2): опциональный проп, по
// умолчанию '/trainer' — ВСЕ 4 существующих вызова не передают его и
// продолжают вести себя ровно как раньше. TrainerKyuTemplatePage.jsx —
// единственная страница, передающая backTo="/trainer/kyu-program"
// (кнопка «Назад» должна вернуть на Kyu-Programm, а не на dashboard —
// см. задание).
export default function TrainerHeader({ title, showBack, onLogout, backTo = '/trainer' }) {
  const { t } = useTranslation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogoutClick = async () => {
    if (isLoggingOut || !onLogout) return;
    setIsLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <header className={styles.header}>
      <div className={`${styles.brand} ltr-isolate`}>
        <span className={styles.logo}>JKL</span>
        <span className={styles.logoSub}>CLUB</span>
      </div>

      <div className={styles.titleRow}>
        {showBack && (
          <button
            type="button"
            className={styles.backButton}
            onClick={() => {
              window.location.href = backTo;
            }}
          >
            <Icon name="arrowRight" size={14} className={styles.backIcon} />
            {t('common.back')}
          </button>
        )}
        {title && <h1 className={styles.title}>{title}</h1>}
      </div>

      <div className={styles.actions}>
        <LanguageSwitcher />

        {onLogout && (
          <button
            type="button"
            className={styles.logoutButton}
            aria-label={t('header.logout')}
            onClick={handleLogoutClick}
            disabled={isLoggingOut}
          >
            <Icon name="logout" size={18} />
            <span className={styles.logoutLabel}>{t('header.logout')}</span>
          </button>
        )}
      </div>
    </header>
  );
}
