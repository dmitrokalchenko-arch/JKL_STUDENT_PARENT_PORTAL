import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

/**
 * @typedef {Object} KyuTemplateTechnique
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

// 'djb'/'goKyu' — те же значения, что уже использует sourceMode
// (KyuSourceCards.jsx/TrainerKyuProgramPage.jsx) и templateType-проп
// TrainerKyuTemplatePage.jsx. 'djb'/'go_kyu' — значения колонки
// club_kyu_template_items.template_type (snake_case, тот же стиль, что
// block_type). Единственное место преобразования между этими двумя
// словарями — чтобы конвенция БД (snake_case) не просачивалась во весь
// frontend, а frontend-конвенция (camelCase sourceMode) не просачивалась
// в SQL-параметр.
export const TEMPLATE_TYPE_DB_VALUE = { djb: 'djb', goKyu: 'go_kyu' };

// Тонкие обёртки над get_trainer_kyu_template/save_trainer_kyu_template
// (миграция 20260928100073 — единая таблица club_kyu_template_items для
// ВСЕХ template source'ов, DJB и Go Kyu; ЕЩЁ НЕ применена к production,
// см. memory/CURRENT_STATUS.md) — club_id нигде не передаётся с клиента,
// RPC резолвит его сама из сессии текущего тренера, тот же паттерн, что
// trainerKyuProgramService.js. Один сервис на оба template source
// (вместо отдельного trainerDjbTemplateService.js, который этот файл
// заменяет) — сама RPC теперь тоже одна пара на оба источника, дублировать
// JS-обёртку поверх нет смысла.
export async function getTrainerKyuTemplate(kyuLookupId, templateType) {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await trainerSupabase.rpc('get_trainer_kyu_template', {
    p_kyu_lookup_id: kyuLookupId,
    p_template_type: TEMPLATE_TYPE_DB_VALUE[templateType]
  });

  if (error) {
    throw new Error(`Не удалось загрузить шаблон: ${error.message}`);
  }

  return data ?? [];
}

export async function saveTrainerKyuTemplate(kyuLookupId, templateType, items) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase не настроен.');
  }

  const { data, error } = await trainerSupabase.rpc('save_trainer_kyu_template', {
    p_kyu_lookup_id: kyuLookupId,
    p_template_type: TEMPLATE_TYPE_DB_VALUE[templateType],
    p_items: items
  });

  if (error) {
    throw new Error(`Не удалось сохранить шаблон: ${error.message}`);
  }
  if (data !== true) {
    throw new Error('Сохранение отклонено: нет активной сессии тренера.');
  }
  return true;
}
