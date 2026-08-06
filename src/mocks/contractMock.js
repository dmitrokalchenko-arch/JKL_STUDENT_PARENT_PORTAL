// Даты — ISO-строки, форматируются через utils/formatters.js (Intl.DateTimeFormat).
// Суммы — числа (EUR), форматируются через formatCurrency.
// *Key поля указывают на ключи переводов (statuses.*), последние 4 цифры карты — не переводимые данные.
export const contractMock = {
  leon: {
    statusKey: 'statuses.active',
    startDate: '2025-05-01',
    endDate: '2026-04-30',
    renewalTypeKey: 'statuses.renewalAutomatic',
    tariffKey: 'statuses.tariffFamily',
    amount: 120,
    paidUntil: '2026-04-30',
    nextPaymentDate: '2026-05-01',
    hasDebt: false,
    cardLast4: '1234',
    payments: [
      { id: 'p1', date: '2025-05-01', periodStart: '2025-05-01', periodEnd: '2026-04-30', amount: 120, statusKey: 'statuses.paid', cardLast4: '1234' },
      { id: 'p2', date: '2025-04-01', periodStart: '2025-04-01', periodEnd: '2025-04-30', amount: 120, statusKey: 'statuses.paid', cardLast4: '1234' },
      { id: 'p3', date: '2025-03-01', periodStart: '2025-03-01', periodEnd: '2025-03-31', amount: 120, statusKey: 'statuses.paid', cardLast4: '1234' },
      { id: 'p4', date: '2025-02-01', periodStart: '2025-02-01', periodEnd: '2025-02-28', amount: 120, statusKey: 'statuses.paid', cardLast4: '1234' }
    ]
  },
  anna: {
    statusKey: 'statuses.active',
    startDate: '2025-09-01',
    endDate: '2026-08-31',
    renewalTypeKey: 'statuses.renewalManual',
    tariffKey: 'statuses.tariffFamily',
    amount: 90,
    paidUntil: '2026-01-31',
    nextPaymentDate: '2026-02-01',
    hasDebt: false,
    cardLast4: '1234',
    payments: [
      { id: 'p5', date: '2026-01-01', periodStart: '2026-01-01', periodEnd: '2026-01-31', amount: 90, statusKey: 'statuses.paid', cardLast4: '1234' }
    ]
  }
};
