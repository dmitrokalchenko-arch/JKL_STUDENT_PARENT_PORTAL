import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Явный, а не тихий fallback — но ТОЛЬКО в development. Если .env не
// настроен во время разработки, приложение переключается на mock-данные с
// предупреждением в консоль. В production-сборке (import.meta.env.PROD)
// отсутствие переменных — это ошибка конфигурации, а не повод показать
// тестовые данные реальным пользователям: приложение должно упасть громко,
// а не молча отрисовать mock (аудит этапа 2.1, пункт 12).
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  if (import.meta.env.PROD) {
    throw new Error(
      '[supabaseClient] Критическая ошибка конфигурации: VITE_SUPABASE_URL / ' +
        'VITE_SUPABASE_ANON_KEY не заданы в production-сборке. Mock-fallback ' +
        'запрещён в production — см. .env.example.'
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[supabaseClient] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY не заданы — ' +
      'используется dev mock-fallback (см. src/services/techniqueProgressService.js). ' +
      'Не должно происходить в production, см. .env.example.'
  );
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    })
  : null;
