import { useTranslation } from 'react-i18next';
import Icon from '../common/Icon.jsx';
import { formatDate, formatDateRange, formatCurrency } from '../../utils/formatters.js';
import styles from './ContractSection.module.css';

export default function ContractSection({ contract }) {
  const { t, i18n } = useTranslation();

  if (!contract) return null;

  const amountLabel = t('contract.amountPerMonth', {
    amount: formatCurrency(contract.amount, i18n.language)
  });

  return (
    <div className={styles.grid}>
      <div className={styles.block}>
        <h3>{t('contract.infoTitle')}</h3>
        <div className={styles.row}>
          <span>{t('contract.status')}</span>
          <span className={styles.badgeSuccess}>{t(contract.statusKey)}</span>
        </div>
        <div className={styles.row}><span>{t('contract.startDate')}</span><span>{formatDate(contract.startDate, i18n.language)}</span></div>
        <div className={styles.row}><span>{t('contract.endDate')}</span><span>{formatDate(contract.endDate, i18n.language)}</span></div>
        <div className={styles.row}><span>{t('contract.renewalType')}</span><span>{t(contract.renewalTypeKey)}</span></div>
        <div className={styles.row}><span>{t('contract.tariff')}</span><span>{t(contract.tariffKey)}</span></div>
        <div className={styles.row}><span>{t('contract.amount')}</span><span className="ltr-isolate">{amountLabel}</span></div>
        <div className={styles.row}><span>{t('contract.paidUntil')}</span><span>{formatDate(contract.paidUntil, i18n.language)}</span></div>
        <div className={styles.row}><span>{t('contract.nextPayment')}</span><span>{formatDate(contract.nextPaymentDate, i18n.language)}</span></div>
        <div className={styles.row}>
          <span>{t('contract.debt')}</span>
          <span className={contract.hasDebt ? styles.badgeWarning : styles.badgeSuccess}>
            {contract.hasDebt ? t('contract.debtPresent') : t('contract.debtAbsent')}
          </span>
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.headerRow}>
          <h3>{t('payments.recentTitle')}</h3>
          <button type="button" className={styles.showAll}>
            {t('common.showAll')} <Icon name="arrowRight" size={14} />
          </button>
        </div>
        <div className={styles.paymentsList}>
          {contract.payments.map((payment) => (
            <div key={payment.id} className={styles.paymentRow}>
              <div className={styles.paymentDate}>{formatDate(payment.date, i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              <div className={styles.paymentPeriod}>{formatDateRange(payment.periodStart, payment.periodEnd, i18n.language)}</div>
              <div className={`${styles.paymentAmount} ltr-isolate`}>{formatCurrency(payment.amount, i18n.language)}</div>
              <div className={`${styles.paymentMethod} ltr-isolate`}>{t('payments.cardMasked', { last4: payment.cardLast4 })}</div>
              <span className={styles.badgeSuccess}>{t(payment.statusKey)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.block}>
        <h3>{t('payments.methodTitle')}</h3>
        <div className={styles.fieldLabel}>{t('payments.mainMethod')}</div>
        <div className={`${styles.fieldValue} ltr-isolate`}>{t('payments.cardMasked', { last4: contract.cardLast4 })}</div>
        <button type="button" className={styles.secondaryAction}>{t('payments.changeMethod')}</button>

        <div className={styles.helpBox}>
          <div>{t('payments.needHelp')}</div>
          <div className={styles.helpText}>{t('payments.helpText')}</div>
          <button type="button" className={styles.secondaryAction}>{t('payments.contactSupport')}</button>
        </div>
      </div>
    </div>
  );
}
