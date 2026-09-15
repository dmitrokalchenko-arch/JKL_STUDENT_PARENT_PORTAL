import { useTranslation } from 'react-i18next';
import styles from './UnifiedLogin.module.css';
import choiceStyles from './AccountRoleChoice.module.css';

// Показывается ТОЛЬКО когда signInUnified() реально вернул BOTH — то есть
// auth.uid() ОДНОВРЕМЕННО валиден и как Trainer, и как Family guardian
// (два независимых, уже успешно аутентифицированных Supabase-сеанса на
// двух разных клиентах — см. unifiedAuthService.js). Это НЕ обычный
// предварительный role selector "кем вы хотите войти" — до успешного
// ввода пароля этот экран вообще не может появиться.
//
// Обе сессии уже реально сохранены — здесь только выбор, КУДА перейти,
// повторный ввод пароля не требуется ни в одном варианте.
export default function AccountRoleChoice({ onChooseFamily }) {
  const { t } = useTranslation();

  const handleChooseTrainer = () => {
    window.location.href = '/trainer';
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('auth.chooseAccountTitle')}</h1>

        <button type="button" className={choiceStyles.choiceButton} onClick={handleChooseTrainer}>
          {t('auth.chooseAccountTrainer')}
        </button>

        <button type="button" className={choiceStyles.choiceButton} onClick={onChooseFamily}>
          {t('auth.chooseAccountFamily')}
        </button>
      </div>
    </div>
  );
}
