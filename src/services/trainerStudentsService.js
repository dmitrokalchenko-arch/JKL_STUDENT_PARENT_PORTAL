import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';
import { calculateAge, formatBirthDate } from '../utils/studentProfileFormatting.js';

// search_trainer_students(p_query) (migration 018) — identity исключительно
// из auth.uid() на backend (та же конвенция, что trainerGroupsService.js/
// trainerProfileService.js): без настоящего Supabase Trainer Area поиск не
// работает вовсе, mock-режим сознательно не реализован.
//
// id приходит уже как text (не bigint) — та же защита от потери точности
// bigint через JSON, что в familyDataService.js. Здесь и по всей цепочке
// (useTrainerStudentSearch, TrainerStudentSearch, навигация на
// /trainer/student/:id) ЗАПРЕЩЕНО приводить его к Number/parseInt/unary +.
export async function searchTrainerStudents(query) {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await trainerSupabase.rpc('search_trainer_students', {
    p_query: query
  });

  if (error) {
    throw new Error(`Suche fehlgeschlagen: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    firstName: row.vorname,
    lastName: row.nachname,
    birthDate: row.geburtsdatum
  }));
}

// get_trainer_student_by_id(p_student_id) — точечный lookup ОДНОГО ученика
// по id, для страниц вроде TrainerStudentPage, которые получают от
// роутинга только studentId и нигде рядом уже не загружали профиль (см.
// App.jsx — window.location.href без переданного state). НЕ переиспользует
// searchTrainerStudents — та ищет по подстроке имени, не по id. Тот же
// access-gate (can_trainer_access_student), что и у остального RLS этой
// цепочки — 0 строк, если доступа нет, не ошибка.
//
// TRAINER UNIVERSAL STUDENT PAGE (миграция 20260915130056, применена к
// production): RPC возвращает тот же набор Block-1 базовых профильных
// полей, что get_current_family_children() уже отдаёт Family — маппинг
// здесь НАМЕРЕННО зеркалит getCurrentFamilyChildren() (familyDataService.js),
// те же имена итоговых полей, чтобы StudentProfileCard рендерил их
// одинаково независимо от accessMode.
//
// STUDENT PROFILE DATA PIPELINE AUDIT (задача "student-profile-data-
// pipeline-audit"): age теперь ВСЕГДА вычисляется из geburtsdatum через
// calculateAge() — НЕ из row.alter (хранимая колонка ненадёжна, у
// реального ученика в production оказалась NULL при заполненном
// geburtsdatum). birthDate — отформатированная строка (DD.MM.YYYY) для
// прямого отображения, отдельно от уже существующего birthYear (год в
// скобках рядом с возрастом, не трогается). gender/weight/phone/email/
// photoUrl/trainerName — новые поля, требуют миграции 20260916160059
// (⚠️ ПРЕДЛОЖЕНИЕ, ещё НЕ применена к production на этом шаге) — до её
// применения соответствующие row.* будут undefined, поля просто не
// отрендерятся (тот же safe-fallback принцип, что и везде в этом пайплайне).
// kyuGrade/beltColorName — раздельные поля вместо единого beltLabel
// (задание, раздел 10: toggle'ы Kyu/Цвет пояса должны быть НЕЗАВИСИМЫ) —
// beltLabel здесь больше не устанавливается для реальных данных.
export async function getTrainerStudentById(studentId) {
  if (!isSupabaseConfigured || !studentId) return null;

  const { data, error } = await trainerSupabase.rpc('get_trainer_student_by_id', {
    p_student_id: studentId
  });

  if (error) {
    throw new Error(`Schülerdaten konnten nicht geladen werden: ${error.message}`);
  }

  const row = data?.[0];
  if (!row) return null;

  return {
    id: row.id,
    firstName: row.vorname,
    lastName: row.nachname,
    gender: row.geschlecht ?? null,
    birthDate: formatBirthDate(row.geburtsdatum),
    age: calculateAge(row.geburtsdatum),
    birthYear: row.geburtsdatum ? row.geburtsdatum.slice(0, 4) : null,
    weight: row.aktuelles_gewicht ?? null,
    sportName: row.sport_name ?? null,
    groupName: row.group_name ?? null,
    trainingSchedule: [row.training_day, row.training_time].filter(Boolean).join(' · ') || null,
    trainerName: row.trainer_names ?? null,
    kyuGrade: row.kyu_grade ?? null,
    beltColorName: row.belt_color ?? null,
    phone: row.telefon ?? null,
    email: row.email ?? null,
    photoUrl: row.foto_url || null,
    contractStatus: row.contract_status ?? null
  };
}
