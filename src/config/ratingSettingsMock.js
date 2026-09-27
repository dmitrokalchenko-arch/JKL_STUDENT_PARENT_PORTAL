// UI-MOCK настроек рейтинга (/trainer/rating-settings) — ТОЛЬКО для макета
// страницы. Значения НЕ сохраняются в Supabase, НЕ являются официальными
// требованиями DJB и будут заменены backend-данными клуба на следующем этапе
// (см. docs/architecture/STUDENT_RATING.md).
//
// beltKey — ключ перевода trainerRatingSettings.belts.<beltKey>; сам цвет и
// изображение Obi берутся из существующего mapping'а
// (src/services/kyuBeltImageUrl.js / KyuBeltImage) по номеру Kyu.
export const RATING_SETTINGS_KYU_MOCK = Object.freeze([
  { kyu: 9, beltKey: 'white', minAgeYears: 6, monthsInPreviousKyu: 0, requiredRating: 0 },
  { kyu: 8, beltKey: 'whiteYellow', minAgeYears: 6, monthsInPreviousKyu: 3, requiredRating: 50 },
  { kyu: 7, beltKey: 'yellow', minAgeYears: 6, monthsInPreviousKyu: 3, requiredRating: 75 },
  { kyu: 6, beltKey: 'yellowOrange', minAgeYears: 7, monthsInPreviousKyu: 3, requiredRating: 100 },
  { kyu: 5, beltKey: 'orange', minAgeYears: 8, monthsInPreviousKyu: 3, requiredRating: 150 },
  { kyu: 4, beltKey: 'orangeGreen', minAgeYears: 9, monthsInPreviousKyu: 3, requiredRating: 200 },
  { kyu: 3, beltKey: 'green', minAgeYears: 11, monthsInPreviousKyu: 3, requiredRating: 250 },
  { kyu: 2, beltKey: 'blue', minAgeYears: 12, monthsInPreviousKyu: 3, requiredRating: 300 },
  { kyu: 1, beltKey: 'brown', minAgeYears: 13, monthsInPreviousKyu: 6, requiredRating: 400 }
]);

// Поля карточки Kyu: ключ значения в mock-объекте -> ключи перевода.
export const RATING_SETTINGS_FIELDS = Object.freeze([
  { key: 'minAgeYears', labelKey: 'trainerRatingSettings.fields.minAge', unitKey: 'trainerRatingSettings.units.years' },
  {
    key: 'monthsInPreviousKyu',
    labelKey: 'trainerRatingSettings.fields.monthsInPreviousKyu',
    unitKey: 'trainerRatingSettings.units.months'
  },
  {
    key: 'requiredRating',
    labelKey: 'trainerRatingSettings.fields.requiredRating',
    unitKey: 'trainerRatingSettings.units.points'
  }
]);
