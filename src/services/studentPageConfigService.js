import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { trainerSupabase } from './trainerSupabaseClient.js';

// Три тонкие обёртки над club_student_page_settings RPC (миграция
// 20260916140057, ⚠️ ПРЕДЛОЖЕНИЕ, ЕЩЁ НЕ ПРИМЕНЕНА К PRODUCTION на этом
// шаге — см. итоговый отчёт задачи). Все три ВСЕГДА возвращаются
// успешно с безопасным fallback (null/false), НИКОГДА не бросают
// исключение наружу — до применения миграции сам RPC физически не
// существует (PGRST202/42883), это ОЖИДАЕМОЕ состояние на Deploy Preview
// этого PR, а не баг: вызывающий код (useEffect в FamilyDashboard/
// TrainerStudentPage/TrainerSettingsPage) обязан продолжить работу с
// DEFAULT_STUDENT_PAGE_CONFIG (mergeStudentPageConfig(null)), а не упасть.
export async function getFamilyStudentPageConfig() {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.rpc('get_family_student_page_config');
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

export async function getTrainerStudentPageConfig() {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await trainerSupabase.rpc('get_trainer_student_page_config');
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

// В отличие от двух read-обёрток выше, save НЕ проглатывает ошибку молча —
// вызывающая сторона (TrainerSettingsPage) обязана честно показать
// "Ошибка сохранения" (задание, раздел 16-17), а не тихо считать
// несохранённый черновик сохранённым.
export async function saveTrainerStudentPageConfig(config) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase не настроен.');
  }
  const { data, error } = await trainerSupabase.rpc('save_trainer_student_page_config', {
    p_config: config
  });
  if (error) {
    throw new Error(`Не удалось сохранить настройки: ${error.message}`);
  }
  if (data !== true) {
    throw new Error('Сохранение отклонено: нет активной сессии тренера.');
  }
  return true;
}
