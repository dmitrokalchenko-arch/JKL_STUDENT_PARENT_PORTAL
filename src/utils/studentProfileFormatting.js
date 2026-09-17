// ЕДИНАЯ функция расчёта возраста — используется и Family, и Trainer data
// pipeline (familyDataService.js/trainerStudentsService.js), чтобы возраст
// никогда не расходился между ролями и не зависел от возможно устаревшей
// хранимой колонки students.alter (аудит задачи
// "student-profile-data-pipeline-audit" подтвердил: у реального ученика в
// production эта колонка = NULL, несмотря на заполненный geburtsdatum —
// хранимое значение ненадёжно). Исходная дата рождения НИГДЕ не
// изменяется, только читается. Зеркалит ту же логику, что уже использует
// Block 1 (app.js, getStudentFullData/getAgeFromStudent) — тот же принцип
// расчёта "полных лет на сегодня".
export function calculateAge(birthDateString) {
  if (!birthDateString) return null;
  const birthDate = new Date(birthDateString);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
}

// students.geburtsdatum приходит как 'YYYY-MM-DD' (ISO date) — приводим к
// тому же DD.MM.YYYY, что уже видит Trainer в Block 1 (Geburtsdatum =
// 21.11.2012), а не сырой ISO-формат на Student Page.
export function formatBirthDate(birthDateString) {
  if (!birthDateString) return null;
  const [year, month, day] = birthDateString.split('-');
  if (!year || !month || !day) return birthDateString;
  return `${day}.${month}.${year}`;
}
