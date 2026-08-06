import { getLanguageByCode, normalizeLanguageCode } from '../i18n/languages.js';

const CURRENCY = 'EUR';

function resolveLocale(languageCode) {
  return getLanguageByCode(normalizeLanguageCode(languageCode)).locale;
}

export function formatDate(dateInput, languageCode, options = { day: 'numeric', month: 'long', year: 'numeric' }) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return new Intl.DateTimeFormat(resolveLocale(languageCode), options).format(date);
}

export function formatDateRange(startInput, endInput, languageCode, options = { day: 'numeric', month: 'short' }) {
  const start = startInput instanceof Date ? startInput : new Date(startInput);
  const end = endInput instanceof Date ? endInput : new Date(endInput);
  const formatter = new Intl.DateTimeFormat(resolveLocale(languageCode), options);

  if (formatter.formatRange) {
    return formatter.formatRange(start, end);
  }

  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

export function formatCurrency(amount, languageCode, currency = CURRENCY) {
  return new Intl.NumberFormat(resolveLocale(languageCode), {
    style: 'currency',
    currency
  }).format(amount);
}

export function formatNumber(value, languageCode, options) {
  return new Intl.NumberFormat(resolveLocale(languageCode), options).format(value);
}

export function formatPercent(value01to100, languageCode, options = { maximumFractionDigits: 0 }) {
  return new Intl.NumberFormat(resolveLocale(languageCode), {
    style: 'percent',
    ...options
  }).format(value01to100 / 100);
}
