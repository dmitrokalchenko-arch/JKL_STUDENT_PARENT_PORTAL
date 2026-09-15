import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { signInUnified, UnifiedLoginResult } from '../../services/unifiedAuthService.js';
import { PORTAL_CLUB_NAME } from '../../config/portalClub.js';
import styles from './UnifiedLogin.module.css';

// UNIFIED LOGIN — единственная точка входа в Block 3 (корневой `/`, см.
// App.jsx) для Trainer И Family/Student, без предварительного выбора
// роли. Визуально — та же карточка/поля/кнопка, что уже использовали
// FamilyLogin.jsx/TrainerLogin.jsx (тот же набор CSS-классов, тот же
// паттерн, что и у них двоих — в этом проекте уже принято, что
// FamilyLogin.module.css и TrainerLogin.module.css практически идентичны
// друг другу, а не переиспользуются через общий импорт; этот файл
// продолжает тот же устоявшийся паттерн).
//
// Сама auth-логика НЕ здесь — signInUnified() (services/unifiedAuthService.js)
// параллельно вызывает уже существующие signInFamily/signInTrainer,
// ничего не меняя в них. Этот компонент только:
//   1) собирает login/password;
//   2) вызывает signInUnified и ждёт ОДИН комбинированный результат;
//   3) при результате BOTH — показывает локальный, изолированный экран
//      выбора роли (ниже), НЕ раскрывая наружу никакой навигации, пока
//      человек явно не выберет; обе сессии уже реально сохранены на своих
//      клиентах к этому моменту, повторный ввод пароля не нужен;
//   4) при FAMILY_ONLY/TRAINER_ONLY — ничего сам не делает: App.jsx
//      реактивно переключит корневой рендер, как только его собственные
//      useFamilySession()/useTrainerSession() подхватят новую сессию
//      (тот же принцип, что уже был у отдельных FamilyLogin/TrainerLogin —
//      никакого ручного redirect после успешного family-входа не было и
//      здесь не нужно; для чистого trainer-входа автоматический переход
//      на /trainer делает App.jsx, см. его комментарий);
//   5) при NONE — один общий текст ошибки, тип аккаунта не раскрывается.
//
// onBothSucceeded — проп из App.jsx: именно ОН, а не этот компонент,
// решает, что показывать после выбора (см. App.jsx — pendingRoleChoice
// специально поднят на уровень выше UnifiedLogin, иначе сам этот
// компонент размонтировался бы раньше, чем успел бы показать выбор, как
// только обе сессии становятся активными — App.jsx перестал бы его
// рендерить по условию "ни одна сессия не активна").
export default function UnifiedLogin({ onBothSucceeded }) {
  const { t } = useTranslation();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return; // double-submit guard
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await signInUnified(login.trim(), password);
      if (result === UnifiedLoginResult.NONE) {
        setError(t('auth.invalidLoginOrPassword'));
      } else if (result === UnifiedLoginResult.BOTH) {
        onBothSucceeded();
      }
      // FAMILY_ONLY / TRAINER_ONLY: намеренно ничего не делаем — App.jsx
      // сам переключится реактивно (см. комментарий выше файла).
    } catch (err) {
      // signInUnified() не бросает исключений сама по себе (обе попытки
      // идут через allSettled) — эта ветка защищает только от
      // непредвиденной ошибки окружения (например, сеть недоступна
      // настолько, что упал сам Promise.allSettled вызов).
      setError(err.message || t('auth.genericError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.title}>{t('auth.title')}</h1>
        <p className={styles.subtitle}>{PORTAL_CLUB_NAME}</p>

        <label className={styles.field}>
          <span className={styles.label}>{t('auth.loginLabel')}</span>
          <input
            className={styles.input}
            type="text"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{t('auth.passwordLabel')}</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <div className={styles.error}>{error}</div>}

        <button type="submit" className={styles.submit} disabled={isSubmitting}>
          {isSubmitting ? t('auth.loggingIn') : t('auth.submit')}
        </button>
      </form>
    </div>
  );
}
