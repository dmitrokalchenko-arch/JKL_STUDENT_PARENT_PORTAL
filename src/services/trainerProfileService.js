import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

// get_current_trainer_profile() returns table(...) — через PostgREST это
// приходит как JSON-массив (0 или 1 элемент, т.к. auth.uid() соответствует
// не более чем одной строке trainer_accounts). 0 строк = не тренер (не
// ошибка); 1 строка с is_active=false = профиль есть, но доступ
// приостановлен — оба случая различаются в TrainerAuthGuard, не здесь.
export async function getCurrentTrainerProfile() {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await trainerSupabase.rpc('get_current_trainer_profile');

  if (error) {
    throw new Error(`Не удалось загрузить профиль тренера: ${error.message}`);
  }

  return data?.[0] ?? null;
}
