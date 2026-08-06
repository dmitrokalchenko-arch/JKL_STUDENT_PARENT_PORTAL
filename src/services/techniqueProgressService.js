import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { techniqueProgressMock } from '../mocks/techniqueProgressMock.js';

const SIGNED_URL_TTL_SECONDS = 3600;

// Явный dev-fallback: используется ТОЛЬКО когда Supabase не настроен
// (см. supabaseClient.js — предупреждение в консоль уже выведено там один
// раз при инициализации модуля). Не должно происходить в production.
function getMockProgress(studentId) {
  const mock = techniqueProgressMock[studentId];
  if (!mock) {
    return { featureEnabled: false, bonusRequirement: 0, bonusPoints: null, belt: null, techniques: [] };
  }
  return {
    featureEnabled: mock.featureEnabled,
    bonusRequirement: mock.bonusRequirement,
    bonusPoints: null,
    belt: null,
    techniques: mock.techniques.map((technique) => ({
      id: technique.id,
      name: technique.name,
      category: technique.category,
      status: technique.status,
      imageUrl: technique.imageUrl ?? null,
      hasVideo: Boolean(technique.videoUrl),
      videoPath: technique.videoUrl ?? null,
      completedAt: technique.completedAt ?? null,
      trainerComment: null
    }))
  };
}

async function resolveImageUrls(techniques) {
  const withPaths = techniques.filter((t) => t.imagePath);
  if (withPaths.length === 0) return techniques;

  const signedEntries = await Promise.all(
    withPaths.map(async (t) => {
      const { data, error } = await supabase.storage
        .from('technique-images')
        .createSignedUrl(t.imagePath, SIGNED_URL_TTL_SECONDS);
      return [t.id, error ? null : data.signedUrl];
    })
  );
  const urlById = new Map(signedEntries);

  return techniques.map((t) => ({ ...t, resolvedImageUrl: urlById.get(t.id) ?? null }));
}

// studentId — string (см. src/services/familyDataService.js — защита от
// потери точности bigint через JSON/JS Number). Здесь и ниже он не
// приводится к Number/parseInt/unary + ни при каких условиях.
export async function getTechniqueProgress(studentId) {
  if (!studentId) {
    return { featureEnabled: false, bonusRequirement: 0, bonusPoints: null, belt: null, techniques: [] };
  }

  if (!isSupabaseConfigured) {
    return getMockProgress(studentId);
  }

  const { data, error } = await supabase.rpc('get_student_technique_progress', {
    p_student_id: studentId
  });

  if (error) {
    throw new Error(`Не удалось загрузить прогресс техник: ${error.message}`);
  }

  const rawTechniques = data?.techniques ?? [];
  const withResolvedImages = await resolveImageUrls(rawTechniques);

  return {
    featureEnabled: Boolean(data?.featureEnabled),
    bonusRequirement: data?.bonusRequirement ?? 0,
    bonusPoints: data?.bonusPoints ?? null,
    belt: data?.belt ?? null,
    techniques: withResolvedImages.map((technique) => ({
      id: technique.id,
      name: technique.name,
      category: technique.category,
      status: technique.status,
      imageUrl: technique.resolvedImageUrl ?? null,
      hasVideo: Boolean(technique.videoPath),
      videoPath: technique.videoPath ?? null,
      completedAt: technique.completedAt ?? null,
      trainerComment: technique.trainerComment ?? null
    }))
  };
}

// Signed URL запрашивается только здесь — по клику на выполненную технику,
// не заранее для всех карточек (см. задание, раздел 10/15 п.9-10).
export async function getTechniqueVideoUrl(videoPath) {
  if (!videoPath) return null;
  if (!isSupabaseConfigured) {
    // Dev mock-режим: mock не хранит реальных Storage-путей, videoUrl там
    // всегда null — эта ветка практически не достигается, оставлена для
    // прямой совместимости с mock-данными, если в них появится тестовый путь.
    return videoPath;
  }

  const { data, error } = await supabase.storage
    .from('technique-videos')
    .createSignedUrl(videoPath, SIGNED_URL_TTL_SECONDS);

  if (error) {
    throw new Error(`Не удалось получить ссылку на видео: ${error.message}`);
  }
  return data.signedUrl;
}
