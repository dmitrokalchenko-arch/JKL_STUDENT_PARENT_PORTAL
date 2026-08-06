import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import deTranslation from './locales/de/translation.json';
import {
  SUPPORTED_CODES,
  DEFAULT_LANGUAGE,
  FALLBACK_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  normalizeLanguageCode,
  getLanguageByCode
} from './languages.js';

const loadedLanguages = new Set([DEFAULT_LANGUAGE]);

export function isLanguageLoaded(code) {
  return loadedLanguages.has(code);
}

/**
 * Динамическая загрузка перевода через import() — Vite делит каждый файл
 * translation.json на отдельный chunk автоматически, поэтому все 12 языков
 * никогда не попадают в основной бандл одновременно.
 */
export async function loadLanguage(code) {
  const normalized = normalizeLanguageCode(code);
  if (loadedLanguages.has(normalized)) return normalized;

  const module = await import(`./locales/${normalized}/translation.json`);
  i18n.addResourceBundle(normalized, 'translation', module.default, true, true);
  loadedLanguages.add(normalized);
  return normalized;
}

export async function changeLanguage(code) {
  const normalized = await loadLanguage(code);
  await i18n.changeLanguage(normalized);
  return normalized;
}

function applyDocumentDirection(code) {
  const language = getLanguageByCode(normalizeLanguageCode(code));
  document.documentElement.lang = language.code;
  document.documentElement.dir = language.direction;
}

// i18next.init() с LanguageDetector завершается асинхронно (detection
// происходит уже внутри init). Сохраняем этот промис и обязательно ждём
// его в ensureInitialLanguageLoaded — иначе i18n.language/resolvedLanguage
// в момент проверки ещё не определены, и определение языка браузера
// (шаг 2 из требуемого порядка localStorage -> браузер -> de) будет
// молча проигнорировано.
const initPromise = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      [DEFAULT_LANGUAGE]: { translation: deTranslation }
    },
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: SUPPORTED_CODES,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage']
    },
    interpolation: {
      escapeValue: false
    },
    react: {
      useSuspense: false
    }
  });

i18n.on('languageChanged', applyDocumentDirection);

/**
 * После завершения i18next.init() (включая определение языка через
 * localStorage -> браузер -> de) реально загружен только немецкий бандл.
 * Если определённый язык отличается от немецкого, догружаем его перевод
 * и подтверждаем смену языка перед первым рендером приложения.
 */
export async function ensureInitialLanguageLoaded() {
  await initPromise;

  // Важно: i18n.resolvedLanguage отражает язык, для которого РЕАЛЬНО есть
  // загруженные ресурсы (изначально — только 'de'), а не то, что определил
  // LanguageDetector. Сам обнаруженный язык (localStorage -> браузер) лежит
  // в i18n.language — именно его нужно проверять здесь, иначе определение
  // языка браузера будет молча проигнорировано в пользу немецкого fallback.
  const detected = normalizeLanguageCode(i18n.language);
  applyDocumentDirection(detected);

  if (detected !== DEFAULT_LANGUAGE) {
    await loadLanguage(detected);
    // Всегда вызываем changeLanguage, даже если i18n.language уже равен
    // detected: только так react-i18next гарантированно перерендерит
    // компоненты с только что подгруженным translation.json (иначе они
    // могут остаться на резервном de-переводе, пока bundle не был готов).
    await i18n.changeLanguage(detected);
  }
  return detected;
}

export default i18n;
