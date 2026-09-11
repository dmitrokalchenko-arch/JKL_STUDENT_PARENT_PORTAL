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

// get_trainer_student_by_id(p_student_id) (migration 049, ещё НЕ применена
// к production) — точечный lookup ОДНОГО ученика по id, для страниц вроде
// TrainerStudentPage, которые получают от роутинга только studentId и
// нигде рядом уже не загружали Vorname/Nachname (см. App.jsx —
// window.location.href без переданного state). НЕ переиспользует
// searchTrainerStudents — та ищет по подстроке имени, не по id. Тот же
// access-gate (can_trainer_access_student), что и у остального RLS этой
// цепочки — 0 строк, если доступа нет, не ошибка.
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
    lastName: row.nachname
  };
}
