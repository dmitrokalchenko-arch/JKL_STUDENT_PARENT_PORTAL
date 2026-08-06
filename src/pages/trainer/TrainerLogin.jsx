import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { signInTrainer } from '../../services/trainerAuthService.js';
import { PORTAL_CLUB_NAME } from '../../config/portalClub.js';
import styles from './TrainerLogin.module.css';

export default function TrainerLogin() {
  const { t } = useTranslation();
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await signInTrainer(loginName.trim(), password);
    } catch (err) {
      setError(err.message || t('auth.genericError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.title}>{t('auth.trainerTitle')}</h1>
        <p className={styles.subtitle}>{PORTAL_CLUB_NAME}</p>

        <label className={styles.field}>
          <span className={styles.label}>{t('auth.trainerLoginLabel')}</span>
          <input
            className={styles.input}
            type="text"
            value={loginName}
            onChange={(event) => setLoginName(event.target.value)}
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
