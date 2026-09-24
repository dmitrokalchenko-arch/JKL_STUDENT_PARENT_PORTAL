import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

/**
 * @typedef {Object} KyuProgramTechnique
 * @property {string} technique_id
 * @property {string} name
 * @property {string} category
 * @property {string} main_group
 * @property {string|null} image_path
 * @property {string} youtube_url
 * @property {string|null} youtube_video_id
 * @property {number} sort_order
 * @property {'required_nage'|'required_katame'|'additional'} block_type
 */

/**
 * @typedef {Object} KyuProgramItemInput
 * @property {string} technique_id
 * @property {'required_nage'|'required_katame'|'additional'} block_type
 */

// Тонкие обёртки над get_trainer_kyu_program/save_trainer_kyu_program
// (миграции 20260917120060 и 20260927100072, обе уже применены к
// production — вторая добавила block_type и сменила сигнатуру save на
// jsonb) — club_id нигде не передаётся с клиента, RPC резолвит его сама
// из сессии текущего тренера (см. комментарии самих миграций).
// trainerSupabase — тот же клиент, что уже используют все остальные
// тренерские RPC (studentPageConfigService.js) — не service_role,
// обычная authenticated сессия тренера.
//
// saveTrainerKyuProgram теперь принимает items (technique_id + block_type)
// вместо плоского массива id — соответствует новой сигнатуре
// save_trainer_kyu_program(bigint, jsonb) из 20260927100072.
export async function getTrainerKyuProgram(kyuLookupId) {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await trainerSupabase.rpc('get_trainer_kyu_program', {
    p_kyu_lookup_id: kyuLookupId
  });

  if (error) {
    throw new Error(`Не удалось загрузить программу Kyu: ${error.message}`);
  }

  return data ?? [];
}

// Возвращает true/false ровно так же, как save_trainer_student_page_config
// (см. studentPageConfigService.js) — false означает "нет активной сессии
// тренера", отдельное от сетевой/валидационной ошибки (та приходит через
// error и превращается в throw).
export async function saveTrainerKyuProgram(kyuLookupId, items) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase не настроен.');
  }

  const { data, error } = await trainerSupabase.rpc('save_trainer_kyu_program', {
    p_kyu_lookup_id: kyuLookupId,
    p_items: items
  });

  if (error) {
    throw new Error(`Не удалось сохранить программу: ${error.message}`);
  }
  if (data !== true) {
    throw new Error('Сохранение отклонено: нет активной сессии тренера.');
  }
  return true;
}
