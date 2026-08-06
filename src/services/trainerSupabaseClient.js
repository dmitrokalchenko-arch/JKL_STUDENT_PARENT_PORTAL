import { createClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from './supabaseClient.js';

// Отдельный, независимый от семейного (supabaseClient.js) Supabase-клиент
// для тренерской области. Один и тот же Supabase-проект (тот же URL/anon
// key — они не секрет и общие для всего портала), но СВОЙ storageKey —
// это единственное, что позволяет семейной и тренерской сессии
// существовать одновременно в одном браузере/origin без конфликта
// (auth.storageKey — штатный, документированный механизм supabase-js
// именно для этого сценария; подтверждено архитектурным анализом "модель
// сессий" перед реализацией).
//
// isSupabaseConfigured НЕ дублируется — оба клиента используют одни и те
// же VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY, значит признак "настроен
// ли Supabase" общий для обеих областей (уже решено на этапе
// проектирования, см. пункт 5 backend/frontend-контракта).
//
// Семейный supabaseClient.js НЕ меняется этим файлом ни в одной строке.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const trainerSupabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'jkl-trainer-auth-token'
      }
    })
  : null;
