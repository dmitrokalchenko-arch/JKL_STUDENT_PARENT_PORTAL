import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

/**
 * @typedef {Object} KyuLevel
 * @property {number} id - public.kyu_lookup.id, реальный kyu_lookup_id для RPC
 * @property {string} kyuGrad - например "7. Kyu"
 */

// Единственный источник истины — public.kyu_lookup (уже существующая
// production-таблица, RLS-policy "Allow read access kyu_lookup" уже
// разрешает SELECT для public/authenticated — никакой новой миграции/RPC
// для этого чтения не требуется).
//
// Возвращает ТОЛЬКО Kyu-строки (9. Kyu .. 1. Kyu), Dan-строки (1-3 Dan)
// отфильтрованы прямо в запросе — константа Kyu-редактора этого этапа
// (см. save_trainer_kyu_program, который сам отклоняет Dan на бэкенде —
// здесь дублируем фильтр только для UI-списка, не полагаясь на порядок
// id). ORDER BY id — тот же порядок, что "9. Kyu" -> "1. Kyu" (id=1..9
// расположены именно в этом порядке в production).
export async function getKyuLevels() {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await trainerSupabase
    .from('kyu_lookup')
    .select('id, kyu_grad')
    .ilike('kyu_grad', '%Kyu%')
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Не удалось загрузить список Kyu: ${error.message}`);
  }

  return (data ?? []).map((row) => ({ id: row.id, kyuGrad: row.kyu_grad }));
}
