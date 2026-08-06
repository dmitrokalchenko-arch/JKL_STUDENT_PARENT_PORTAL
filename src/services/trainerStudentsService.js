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
