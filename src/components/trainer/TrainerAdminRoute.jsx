import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentTrainerProfile } from './TrainerProfileContext.js';
import { isPortalAdmin } from '../../utils/trainerPortalRole.js';
import styles from './TrainerAuthGuard.module.css';

// Admin-only маршрут Trainer Portal (club-wide настройки). Используется
// ВНУТРИ TrainerAuthGuard — к этому моменту профиль уже загружен и активен.
// Не-admin (trainer, неизвестная роль, нет профиля) — страница НЕ
// рендерится вовсе, сразу replace на дашборд /trainer. Это UX-слой: сервер
// (migration 078) отказывает не-admin в club-wide RPC независимо от UI.
export default function TrainerAdminRoute({ children }) {
  const { t } = useTranslation();
  const profile = useCurrentTrainerProfile();
  const allowed = isPortalAdmin(profile);

  useEffect(() => {
    if (!allowed) {
      window.location.replace('/trainer');
    }
  }, [allowed]);

  if (!allowed) {
    return <div className={styles.state}>{t('common.loading')}</div>;
  }

  return children;
}
