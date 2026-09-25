import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

// Write-path индивидуальной программы "Необходимых техник" ученика
// (миграция 20260930100076). Чтение effective program идёт через уже
// существующий getTrainerRequiredTechniques (requiredTechniquesService.js) —
// отдельного read-RPC нет.
//
// club_id/target Kyu НЕ доверяются клиенту: сервер сам проверяет доступ
// тренера по группам, активность Student Page для записи и пересчитывает
// target Kyu; kyuLookupId и expectedVersion — только то, что редактор
// реально открыл (для target_kyu_changed / version_conflict).
//
// Обе функции возвращают ответ RPC как есть: { ok: true, version } или
// { ok: false, reason } (not_allowed | page_inactive | target_kyu_changed |
// invalid_items | version_conflict). Бросают исключение только при
// транспортной/серверной ошибке.
export async function saveTrainerStudentKyuProgram(studentId, kyuLookupId, items, expectedVersion) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured');
  }

  const { data, error } = await trainerSupabase.rpc('save_trainer_student_kyu_program', {
    p_student_id: studentId,
    p_kyu_lookup_id: kyuLookupId,
    p_items: items,
    p_expected_version: expectedVersion ?? null
  });

  if (error) {
    throw new Error(`Не удалось сохранить индивидуальную программу: ${error.message}`);
  }

  return data ?? { ok: false, reason: 'unknown' };
}

export async function resetTrainerStudentKyuProgram(studentId, kyuLookupId, expectedVersion) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured');
  }

  const { data, error } = await trainerSupabase.rpc('reset_trainer_student_kyu_program', {
    p_student_id: studentId,
    p_kyu_lookup_id: kyuLookupId,
    p_expected_version: expectedVersion ?? null
  });

  if (error) {
    throw new Error(`Не удалось вернуть программу клуба: ${error.message}`);
  }

  return data ?? { ok: false, reason: 'unknown' };
}
