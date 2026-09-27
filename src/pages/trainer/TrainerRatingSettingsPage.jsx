import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TrainerHeader from '../../components/trainer/TrainerHeader.jsx';
import KyuBeltImage from '../../components/trainer/KyuBeltImage.jsx';
import Icon from '../../components/common/Icon.jsx';
import { signOutTrainer } from '../../services/trainerAuthService.js';
import { RATING_SETTINGS_KYU_MOCK, RATING_SETTINGS_FIELDS } from '../../config/ratingSettingsMock.js';
import styles from './TrainerRatingSettingsPage.module.css';

// /trainer/rating-settings — UI-МАКЕТ настроек рейтинга (карточка «Настройка
// рейтинга» на Trainer Dashboard). Рендерится внутри существующего
// TrainerAuthGuard (App.jsx), отдельной авторизации нет.
//
// ВАЖНО — ТОЛЬКО UI, НИЧЕГО НЕ СОХРАНЯЕТСЯ:
//   - значения карточек — локальный state поверх RATING_SETTINGS_KYU_MOCK
//     (src/config/ratingSettingsMock.js), не официальные требования DJB;
//   - «Сохранить настройки» / «Сбросить к настройкам DJB» — disabled, в
//     Supabase ничего не пишется, RPC/таблиц нет;
//   - кнопка DJB в карточке: DJB preset backend/business logic NOT IMPLEMENTED —
//     она только показывает пояснение и значения НЕ меняет. В будущем DJB
//     управляет лишь официальными параметрами (возраст, минимальное время
//     подготовки) и НИКОГДА не меняет «Необходимый рейтинг» — это клубная
//     настройка;
//   - ↺ в карточке — локальный возврат значений карточки к mock, без backend;
//   - правило «3 Kyu за 365 дней» и допустимая дата градуировки — только
//     информационные блоки, без расчётов;
//   - 9. Kyu — обычная UI-карточка, Kihon Judo здесь НЕ реализуется.
// Архитектура будущего рейтинга: docs/architecture/STUDENT_RATING.md.
function initialValues() {
  return Object.fromEntries(
    RATING_SETTINGS_KYU_MOCK.map((level) => [
      level.kyu,
      {
        minAgeYears: String(level.minAgeYears),
        monthsInPreviousKyu: String(level.monthsInPreviousKyu),
        requiredRating: String(level.requiredRating)
      }
    ])
  );
}

function DjbFlag() {
  return (
    <span className={styles.flag} aria-hidden="true">
      <span className={styles.flagBlack} />
      <span className={styles.flagRed} />
      <span className={styles.flagGold} />
    </span>
  );
}

export default function TrainerRatingSettingsPage() {
  const { t } = useTranslation();
  const [values, setValues] = useState(initialValues);
  const [djbNoticeKyu, setDjbNoticeKyu] = useState(null);

  const handleLogout = async () => {
    await signOutTrainer();
    window.location.href = '/';
  };

  const handleChange = (kyu, key, value) => {
    setValues((prev) => ({ ...prev, [kyu]: { ...prev[kyu], [key]: value } }));
  };

  const handleResetCard = (level) => {
    setValues((prev) => ({ ...prev, [level.kyu]: initialValues()[level.kyu] }));
    setDjbNoticeKyu(null);
  };

  const rules = [
    { titleKey: 'trainerRatingSettings.rules.minAge.title', textKey: 'trainerRatingSettings.rules.minAge.text' },
    { titleKey: 'trainerRatingSettings.rules.prepTime.title', textKey: 'trainerRatingSettings.rules.prepTime.text' },
    { titleKey: 'trainerRatingSettings.rules.djbLimit.title', textKey: 'trainerRatingSettings.rules.djbLimit.text' },
    { titleKey: 'trainerRatingSettings.rules.rating.title', textKey: 'trainerRatingSettings.rules.rating.text' }
  ];

  return (
    <div className={styles.page}>
      <TrainerHeader title={t('trainerDashboard.ratingSettingsTitle')} showBack backTo="/trainer" onLogout={handleLogout} />

      <div className={styles.content}>
        <div className={styles.intro}>
          <div className={styles.introText}>
            <Icon name="trophy" size={22} className={styles.introIcon} />
            <p className={styles.subtitle}>{t('trainerRatingSettings.subtitle')}</p>
          </div>
          <div className={styles.djbInfo}>
            <DjbFlag />
            <div>
              <div className={styles.djbInfoTitle}>{t('trainerRatingSettings.djbInfo.title')}</div>
              <div className={styles.djbInfoText}>{t('trainerRatingSettings.djbInfo.text')}</div>
            </div>
          </div>
        </div>

        <div className={styles.mockNote}>
          <Icon name="info" size={14} />
          {t('trainerRatingSettings.mockNote')}
        </div>

        <div className={styles.kyuScroller}>
          <div className={styles.kyuRow}>
            {RATING_SETTINGS_KYU_MOCK.map((level) => {
              const kyuGrad = `${level.kyu}. Kyu`;
              const cardValues = values[level.kyu];
              return (
                <section key={level.kyu} className={styles.kyuCard} aria-label={kyuGrad}>
                  <div className={styles.kyuTitle}>{kyuGrad}</div>
                  <div className={styles.beltName}>{t(`trainerRatingSettings.belts.${level.beltKey}`)}</div>
                  <div className={styles.beltImageWrap}>
                    <KyuBeltImage kyuGrad={kyuGrad} className={styles.beltImage} />
                  </div>

                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.djbButton}
                      title={t('trainerRatingSettings.djbButtonTitle')}
                      onClick={() => setDjbNoticeKyu(level.kyu)}
                    >
                      <DjbFlag />
                      DJB
                    </button>
                    <button
                      type="button"
                      className={styles.resetCardButton}
                      title={t('trainerRatingSettings.resetCard')}
                      aria-label={t('trainerRatingSettings.resetCard')}
                      onClick={() => handleResetCard(level)}
                    >
                      ↺
                    </button>
                  </div>

                  {djbNoticeKyu === level.kyu && (
                    <div className={styles.djbNotice} role="status">
                      {t('trainerRatingSettings.djbNotImplemented')}
                    </div>
                  )}

                  {RATING_SETTINGS_FIELDS.map((field) => {
                    const inputId = `rating-${level.kyu}-${field.key}`;
                    return (
                      <div key={field.key} className={styles.field}>
                        <label htmlFor={inputId} className={styles.fieldLabel}>
                          {t(field.labelKey)}
                        </label>
                        <div className={styles.inputWrap}>
                          <input
                            id={inputId}
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            className={styles.input}
                            value={cardValues[field.key]}
                            onChange={(event) => handleChange(level.kyu, field.key, event.target.value)}
                          />
                          <span className={styles.unit}>{t(field.unitKey)}</span>
                        </div>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </div>

        <div className={styles.infoGrid}>
          <section className={styles.infoBlock}>
            <h2 className={styles.infoTitle}>
              <Icon name="info" size={18} className={styles.infoTitleIcon} />
              {t('trainerRatingSettings.rules.title')}
            </h2>
            <ol className={styles.rulesList}>
              {rules.map((rule, index) => (
                <li key={rule.titleKey} className={styles.ruleItem}>
                  <span className={styles.ruleNumber}>{index + 1}</span>
                  <span>
                    <strong>{t(rule.titleKey)}</strong> — {t(rule.textKey)}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className={`${styles.infoBlock} ${styles.infoBlockGold}`}>
            <h2 className={styles.infoTitle}>
              <Icon name="calendar" size={18} className={styles.infoTitleIcon} />
              {t('trainerRatingSettings.nextDate.title')}
            </h2>
            <p className={styles.infoText}>{t('trainerRatingSettings.nextDate.intro')}</p>
            <ul className={styles.bulletList}>
              <li>{t('trainerRatingSettings.nextDate.age')}</li>
              <li>{t('trainerRatingSettings.nextDate.prepTime')}</li>
              <li>{t('trainerRatingSettings.nextDate.djbLimit')}</li>
            </ul>
            <p className={styles.infoText}>{t('trainerRatingSettings.nextDate.note')}</p>
          </section>
        </div>

        <div className={styles.actionsBar}>
          <button type="button" className={styles.saveButton} disabled>
            {t('trainerRatingSettings.actions.save')}
          </button>
          <button type="button" className={styles.resetAllButton} disabled>
            {t('trainerRatingSettings.actions.resetDjb')}
          </button>
          <span className={styles.actionsNote}>{t('trainerRatingSettings.actions.notConnected')}</span>
        </div>
      </div>
    </div>
  );
}
