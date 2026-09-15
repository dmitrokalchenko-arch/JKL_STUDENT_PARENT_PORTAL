import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

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
// TRAINER UNIVERSAL STUDENT PAGE (миграция 20260915130056, ещё НЕ применена
// к production): RPC теперь возвращает тот же набор Block-1 базовых
// профильных полей, что get_current_family_children() уже отдаёт Family —
// маппинг здесь НАМЕРЕННО зеркалит getCurrentFamilyChildren()
// (familyDataService.js), те же имена итоговых полей (sportName/groupName/
// trainingSchedule/beltLabel/contractStatus/age/birthYear), чтобы
// StudentProfileCard рендерил их одинаково независимо от accessMode.
// birthYear берётся из geburtsdatum (YYYY-MM-DD) так же, как там —
// student_birthdate.slice(0, 4).
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
    age: row.alter ?? null,
    birthYear: row.geburtsdatum ? row.geburtsdatum.slice(0, 4) : null,
    sportName: row.sport_name ?? null,
    groupName: row.group_name ?? null,
    trainingSchedule: [row.training_day, row.training_time].filter(Boolean).join(' · ') || null,
    beltLabel: [row.belt_color, row.kyu_grade].filter(Boolean).join(' · ') || null,
    contractStatus: row.contract_status ?? null
  };
}
