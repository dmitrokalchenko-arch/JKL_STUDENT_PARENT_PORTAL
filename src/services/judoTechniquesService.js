import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

/**
 * @typedef {'Te-waza'|'Koshi-waza'|'Ashi-waza'|'Ma-sutemi-waza'|'Yoko-sutemi-waza'|'Osaekomi-waza'|'Shime-waza'|'Kansetsu-waza'} JudoTechniqueCategory
 * @typedef {'Nage-waza'|'Katame-waza'} JudoTechniqueMainGroup
 * @typedef {Object} JudoTechnique
 * @property {string} id - uuid, public.judo_techniques.id
 * @property {string} name
 * @property {JudoTechniqueCategory} category
 * @property {JudoTechniqueMainGroup} main_group
 * @property {string} youtube_url
 * @property {string|null} youtube_video_id
 */
// Проект не использует TypeScript (см. memory/CURRENT_STATUS.md — "React +
// Vite + JavaScript без TypeScript") и не генерирует Supabase database
// types — конкурирующий .ts-файл потребовал бы добавления TS-тулчейна ради
// одного типа, что выходит за рамки этой задачи. JSDoc-typedef — прямой
// эквивалент в рамках уже принятого стека: даёт автодополнение/проверку в
// IDE без изменения сборки.

// Единственный источник истины — public.judo_techniques (глобальный,
// club-independent справочник; см.
// supabase/migrations/20260908120041_create_judo_techniques.sql,
// supabase/migrations/20260908120042_seed_judo_techniques_100.sql — оба уже
// применены к production). SELECT выполняется тем же тренерским клиентом
// (trainerSupabase, своя auth-сессия/storageKey), что и остальные
// тренерские запросы — как authenticated, согласно RLS-policy
// judo_techniques_select_authenticated. Никакого anon/service_role обхода.
//
// Без mock-fallback — та же конвенция, что у trainerGroupsService.js/
// trainerProfileService.js: без настоящего Supabase Trainer Area не
// работает вовсе, не показывает фиктивные данные.
//
// ORDER BY — буквально запрос из задания (main_group, category, name).
// Это НЕ порядок отображения (алфавитный порядок category/main_group не
// совпадает с официальным IJF-порядком) — фактическую группировку/порядок
// для UI строит groupTechniquesByCategory() (src/utils/judoTechniques.js)
// через CATEGORY_ORDER/MAIN_GROUP_ORDER констант, не через SQL.
export async function getJudoTechniques() {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await trainerSupabase
    .from('judo_techniques')
    .select('id, name, category, main_group, youtube_url, youtube_video_id')
    .eq('active', true)
    .order('main_group', { ascending: true })
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Не удалось загрузить каталог техник: ${error.message}`);
  }

  return data ?? [];
}
