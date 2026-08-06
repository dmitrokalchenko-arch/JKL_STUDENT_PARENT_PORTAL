import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

// get_current_trainer_groups() (migration 016) — identity исключительно из
// auth.uid() на backend, здесь никакой club_id/trainer_id клиенту передать
// невозможно (RPC без параметров). Mock-режим сознательно не реализован —
// та же конвенция, что trainerAuthService.js/trainerProfileService.js: без
// настоящего Supabase Trainer Area не работает вовсе, не показывает
// фиктивные данные.
export async function getCurrentTrainerGroups() {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await trainerSupabase.rpc('get_current_trainer_groups');

  if (error) {
    throw new Error(`Не удалось загрузить группы: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.group_id,
    name: row.group_name,
    category: row.category ?? null,
    isActive: row.is_active ?? null
  }));
}
