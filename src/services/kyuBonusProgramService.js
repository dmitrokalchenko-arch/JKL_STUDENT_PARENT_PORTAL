import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

/**
 * @typedef {Object} KyuBonusProgramTechnique
 * @property {string} technique_id
 * @property {string} name
 * @property {string} category
 * @property {string} main_group
 * @property {string|null} image_path
 * @property {string} youtube_url
 * @property {string|null} youtube_video_id
 * @property {number} sort_order
 */

// Тонкие обёртки над get_trainer_kyu_bonus_program/save_trainer_kyu_bonus_program
// (миграция 20260922100066) — прямая структурная копия
// trainerKyuProgramService.js (Required Techniques), только club-wide
// БОНУСНАЯ программа (что уже засчитано на достигнутом Kyu), не программа
// следующего Kyu — разные таблицы, разные RPC, здесь не смешиваются.
// club_id нигде не передаётся с клиента — RPC резолвит его сама из сессии
// текущего тренера.
export async function getTrainerKyuBonusProgram(kyuLookupId) {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await trainerSupabase.rpc('get_trainer_kyu_bonus_program', {
    p_kyu_lookup_id: kyuLookupId
  });

  if (error) {
    throw new Error(`Не удалось загрузить бонусную программу Kyu: ${error.message}`);
  }

  return data ?? [];
}

export async function saveTrainerKyuBonusProgram(kyuLookupId, techniqueIds) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase не настроен.');
  }

  const { data, error } = await trainerSupabase.rpc('save_trainer_kyu_bonus_program', {
    p_kyu_lookup_id: kyuLookupId,
    p_technique_ids: techniqueIds
  });

  if (error) {
    throw new Error(`Не удалось сохранить бонусную программу: ${error.message}`);
  }
  if (data !== true) {
    throw new Error('Сохранение отклонено: нет активной сессии тренера.');
  }
  return true;
}
