import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { establishRecoverySession, updateFamilyPassword } from '../../services/familyAuthService.js';
import { PORTAL_CLUB_NAME } from '../../config/portalClub.js';
import styles from './FamilyLogin.module.css';

const MIN_PASSWORD_LENGTH = 8;

// Landing-Seite für den Link aus manage-family-account (JCL_Gruppen,
// Aktion send_recovery → supabaseAdmin.auth.admin.generateLink({type:'recovery'})).
// Der Link liefert access_token/refresh_token im URL-Hash (klassischer
// Supabase-Implicit-Flow) — hier manuell ausgelesen und per
// establishRecoverySession() übernommen, weil der geteilte Client bewusst
// detectSessionInUrl:false hat (siehe Kommentar dort).
function parseRecoveryHashParams() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);
  return {
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    type: params.get('type')
  };
}

export default function FamilyResetPassword() {
  const { t } = useTranslation();
  const [sessionState, setSessionState] = useState('checking'); // checking | ready | invalid
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const { accessToken, refreshToken, type } = parseRecoveryHashParams();
    if (!accessToken || !refreshToken || type !== 'recovery') {
      setSessionState('invalid');
      return;
    }
    establishRecoverySession(accessToken, refreshToken)
      .then(() => {
        // Token nicht im sichtbaren URL-Hash belassen, nachdem die Sitzung
        // etabliert wurde (History-API, kein Reload).
        window.history.replaceState(null, '', window.location.pathname);
        setSessionState('ready');
      })
      .catch(() => setSessionState('invalid'));
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    if (password !== passwordRepeat) {
      setError(t('passwordReset.mismatch'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('passwordReset.tooShort'));
      return;
    }

    setIsSubmitting(true);
    try {
      await updateFamilyPassword(password);
      setSuccess(true);
    } catch (err) {
      setError(err.message || t('auth.genericError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (sessionState === 'checking') {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>{t('common.loading')}</div>
      </div>
    );
  }

  if (sessionState === 'invalid') {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t('passwordReset.title')}</h1>
          <div className={styles.error}>{t('passwordReset.invalidLink')}</div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.title}>{t('passwordReset.title')}</h1>
          <p>{t('passwordReset.success')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.title}>{t('passwordReset.title')}</h1>
        <p className={styles.subtitle}>{PORTAL_CLUB_NAME}</p>

        <label className={styles.field}>
          <span className={styles.label}>{t('passwordReset.newPasswordLabel')}</span>
          <input
            className={styles.input}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{t('passwordReset.repeatPasswordLabel')}</span>
          <input
            className={styles.input}
            type="password"
            value={passwordRepeat}
            onChange={(event) => setPasswordRepeat(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>

        {error && <div className={styles.error}>{error}</div>}

        <button type="submit" className={styles.submit} disabled={isSubmitting}>
          {isSubmitting ? t('passwordReset.submitting') : t('passwordReset.submit')}
        </button>
      </form>
    </div>
  );
}
