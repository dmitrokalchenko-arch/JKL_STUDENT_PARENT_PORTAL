import { useTranslation } from 'react-i18next';
import TrainerLogin from '../../pages/trainer/TrainerLogin.jsx';
import { useTrainerSession } from '../../hooks/useTrainerSession.js';
import { useTrainerProfile } from '../../hooks/useTrainerProfile.js';
import { isSupabaseConfigured } from '../../services/supabaseClient.js';
import styles from './TrainerAuthGuard.module.css';

// Защита тренерской зоны портала. Спроектировано так, чтобы в будущем
// оборачивать несколько тренерских маршрутов (/trainer/*), не только
// текущий единственный /trainer — см. архитектурный анализ Trainer Auth.
//
// НЕ завершает Supabase-сессию тренерского клиента автоматически при
// is_active=false (согласованное решение) — только блокирует рендер
// защищённого содержимого и показывает нейтральное сообщение с
// возможностью повторной проверки без повторного входа. Это безопасно
// ТОЛЬКО при условии, что каждый будущий тренерский RPC самостоятельно
// проверяет is_active — этот Guard не заменяет такую проверку на backend,
// он только управляет тем, что видит пользователь.
export default function TrainerAuthGuard({ children }) {
  const { t } = useTranslation();
  const { isLoading: isSessionLoading, isAuthenticated } = useTrainerSession();
  const shouldLoadProfile = isSupabaseConfigured && isAuthenticated;
  const { profile, loading: isProfileLoading, reload } = useTrainerProfile(shouldLoadProfile);

  if (!isSupabaseConfigured) {
    return <div className={styles.state}>{t('trainerAuth.notConfigured')}</div>;
  }

  if (isSessionLoading) {
    return <div className={styles.state}>{t('common.loading')}</div>;
  }

  if (!isAuthenticated) {
    return <TrainerLogin />;
  }

  if (isProfileLoading) {
    return <div className={styles.state}>{t('common.loading')}</div>;
  }

  if (!profile || !profile.is_active) {
    return (
      <div className={styles.state}>
        <div>{t('trainerAuth.notAvailable')}</div>
        <button type="button" className={styles.retryButton} onClick={reload}>
          {t('techniqueProgress.retry')}
        </button>
      </div>
    );
  }

  return children;
}
