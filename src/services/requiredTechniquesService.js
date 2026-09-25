import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { trainerSupabase } from './trainerSupabaseClient.js';
import { getTechniqueImageUrl } from './techniqueImageUrl.js';

/**
 * @typedef {'ok'|'no_current_kyu'|'unmapped_kyu'|'max_level'} RequiredTechniquesStatus
 * @typedef {Object} RequiredTechniquesResult
 * @property {string|null} currentKyu
 * @property {string|null} nextKyu
 * @property {RequiredTechniquesStatus} status
 * @property {Array<{id:string,name:string,category:string,main_group:string,image_url:string|null,youtube_url:string,youtube_video_id:string|null,block_type:'required_nage'|'required_katame'|'additional'|null}>} techniques
 */

// Read-path для "Необходимые техники" (миграция 20260918100061, уже
// применена к production) — программа СЛЕДУЮЩЕГО Kyu ученика, club-wide.
// НАМЕРЕННО отдельный сервис от techniqueProgressService.js
// (get_student_technique_progress) — та функция обслуживает Bonus
// Techniques (уже полученный Kyu + completion) и исторически связана с
// известной ошибкой "Не удалось загрузить прогресс техник"; Required
// Techniques её не использует и не наследует её поведение.
//
// club_id/currentKyu/nextKyu/kyu_lookup_id нигде не передаются с клиента —
// обе RPC резолвят их сами, сервис только пробрасывает p_student_id.
const EMPTY_RESULT = Object.freeze({ currentKyu: null, nextKyu: null, status: 'no_current_kyu', techniques: [] });

function mapResponse(data) {
  const techniques = (data?.techniques ?? []).map((t) => ({
    id: t.technique_id,
    name: t.name,
    category: t.category,
    main_group: t.main_group,
    image_url: getTechniqueImageUrl(t.image_path),
    youtube_url: t.youtube_url,
    youtube_video_id: t.youtube_video_id ?? null,
    // Фактический club_kyu_program_items.block_type (миграция
    // 20260929100074) — required_nage/required_katame/additional. null,
    // если backend ещё отдаёт старый контракт без этого поля
    // (RequiredTechniquesSection тогда откатывается на прежнюю группировку).
    block_type: t.block_type ?? null
  }));

  return {
    currentKyu: data?.currentKyu ?? null,
    nextKyu: data?.nextKyu ?? null,
    status: data?.status ?? 'no_current_kyu',
    techniques,
    // Effective program metadata (миграция 20260930100076): source —
    // 'club' | 'individual' (null для старого контракта/статусов не 'ok'),
    // version — версия индивидуальной программы, nextKyuLookupId — target
    // Kyu, подтверждённый сервером. canEdit приходит ТОЛЬКО от Trainer RPC
    // (EDIT-право, без trainer_access_after_expiry); у Family всегда false.
    source: data?.source ?? null,
    version: data?.version ?? null,
    nextKyuLookupId: data?.nextKyuLookupId ?? null,
    canEdit: data?.canEdit === true
  };
}

export async function getFamilyRequiredTechniques(studentId) {
  if (!studentId || !isSupabaseConfigured) return EMPTY_RESULT;

  const { data, error } = await supabase.rpc('get_family_required_techniques', {
    p_student_id: studentId
  });

  if (error) {
    throw new Error(`Не удалось загрузить необходимые техники: ${error.message}`);
  }

  return mapResponse(data);
}

export async function getTrainerRequiredTechniques(studentId) {
  if (!studentId || !isSupabaseConfigured) return EMPTY_RESULT;

  const { data, error } = await trainerSupabase.rpc('get_trainer_required_techniques', {
    p_student_id: studentId
  });

  if (error) {
    throw new Error(`Не удалось загрузить необходимые техники: ${error.message}`);
  }

  return mapResponse(data);
}
