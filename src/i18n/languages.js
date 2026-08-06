export const SUPPORTED_LANGUAGES = [
  { code: 'de', locale: 'de-DE', shortLabel: 'DE', nativeName: 'Deutsch', direction: 'ltr', enabled: true },
  { code: 'en', locale: 'en-GB', shortLabel: 'EN', nativeName: 'English', direction: 'ltr', enabled: true },
  { code: 'ru', locale: 'ru-RU', shortLabel: 'RU', nativeName: 'Русский', direction: 'ltr', enabled: true },
  { code: 'uk', locale: 'uk-UA', shortLabel: 'UK', nativeName: 'Українська', direction: 'ltr', enabled: true },
  { code: 'pl', locale: 'pl-PL', shortLabel: 'PL', nativeName: 'Polski', direction: 'ltr', enabled: true },
  { code: 'fr', locale: 'fr-FR', shortLabel: 'FR', nativeName: 'Français', direction: 'ltr', enabled: true },
  { code: 'tr', locale: 'tr-TR', shortLabel: 'TR', nativeName: 'Türkçe', direction: 'ltr', enabled: true },
  { code: 'it', locale: 'it-IT', shortLabel: 'IT', nativeName: 'Italiano', direction: 'ltr', enabled: true },
  { code: 'es', locale: 'es-ES', shortLabel: 'ES', nativeName: 'Español', direction: 'ltr', enabled: true },
  { code: 'ro', locale: 'ro-RO', shortLabel: 'RO', nativeName: 'Română', direction: 'ltr', enabled: true },
  { code: 'nl', locale: 'nl-NL', shortLabel: 'NL', nativeName: 'Nederlands', direction: 'ltr', enabled: true },
  { code: 'ar', locale: 'ar', shortLabel: 'AR', nativeName: 'العربية', direction: 'rtl', enabled: true }
];

export const DEFAULT_LANGUAGE = 'de';
export const FALLBACK_LANGUAGE = 'de';
export const LANGUAGE_STORAGE_KEY = 'jkl_family_language';

export const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map((language) => language.code);

/**
 * Явные будущие региональные варианты (пока не реализованы).
 * Когда потребуется различать de-DE / de-AT / de-CH как отдельные локали,
 * достаточно добавить сюда запись вида 'de-AT': 'de-AT' и создать
 * src/i18n/locales/de-AT/translation.json — normalizeLanguageCode подхватит
 * это автоматически, без изменения остальной логики.
 */
const REGION_OVERRIDES = {};

export function normalizeLanguageCode(rawCode) {
  if (!rawCode) return DEFAULT_LANGUAGE;
  const lower = rawCode.toLowerCase();

  if (REGION_OVERRIDES[lower]) return REGION_OVERRIDES[lower];

  const primary = lower.split('-')[0];
  return SUPPORTED_CODES.includes(primary) ? primary : DEFAULT_LANGUAGE;
}

export function getLanguageByCode(code) {
  return (
    SUPPORTED_LANGUAGES.find((language) => language.code === code) ??
    SUPPORTED_LANGUAGES.find((language) => language.code === DEFAULT_LANGUAGE)
  );
}
