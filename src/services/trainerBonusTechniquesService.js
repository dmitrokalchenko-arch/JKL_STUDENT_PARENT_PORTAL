import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';
import { getTechniqueImageUrl } from './techniqueImageUrl.js';

// get_trainer_student_bonus_pool(p_student_id) (миграция 20260922100066) —
// per-student пул техник, доступных Trainer к отметке ВЫПОЛНЕНИЯ,
// ограниченный бонусной программой ДОСТИГНУТОГО Kyu этого ученика — НЕ
// весь каталог public.judo_techniques (см. judoTechniquesService.js,
// используется club-wide редактором программы, НЕ здесь). Доступ —
// can_trainer_access_student(p_student_id) внутри RPC, БЕЗ ИЗМЕНЕНИЙ —
// 0 строк, если доступа нет (anti-enumeration, тот же принцип, что
// get_trainer_kyu_program/get_trainer_student_by_id). studentId — string
// (защита от потери точности bigint через JSON), не приводится к Number.
//
// Форма результата ЗЕРКАЛИТ getJudoTechniques() (id/name/category/
// main_group/image_path/image_url/youtube_url/youtube_video_id) —
// JudoTechniquePicker остаётся источник-агностичным, ему не важно, весь
// каталог перед ним или ограниченный пул.
export async function getTrainerStudentBonusPool(studentId) {
  if (!isSupabaseConfigured || !studentId) return [];

  const { data, error } = await trainerSupabase.rpc('get_trainer_student_bonus_pool', {
    p_student_id: studentId
  });

  if (error) {
    throw new Error(`Не удалось загрузить бонусный пул техник: ${error.message}`);
  }

  return (data ?? []).map((technique) => ({
    ...technique,
    image_url: getTechniqueImageUrl(technique.image_path)
  }));
}
