import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

// Общий helper для judoTechniquesService.js (каталог) и
// studentTechniqueRecordsService.js (выполненные техники) — оба должны
// получать image_url ОДНИМ и тем же способом из ОДНОГО и того же
// image_path, иначе картинка в "Выполненные техники" могла бы визуально
// отличаться от картинки в каталоге для той же самой техники (задание:
// "изображение должно быть тем же самым"). Bucket публичный (см.
// supabase/migrations/20260910100046_create_judo_techniques_storage_bucket.sql),
// поэтому getPublicUrl() не делает сетевой запрос — только строит URL по
// image_path на клиенте, тем же trainerSupabase-соединением.
const TECHNIQUE_IMAGES_BUCKET = 'judo-techniques';

export function getTechniqueImageUrl(imagePath) {
  if (!imagePath) return null;
  if (!isSupabaseConfigured) return null;
  const { data } = trainerSupabase.storage.from(TECHNIQUE_IMAGES_BUCKET).getPublicUrl(imagePath);
  return data?.publicUrl ?? null;
}
