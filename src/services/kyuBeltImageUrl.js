import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

// Публичные PNG реальных Obi (Trainer → Kyu-Programm, замена искусственного
// SVG KyuBeltIcon). Bucket публичный (создан отдельно, вне этого репозитория
// — см. memory/CURRENT_STATUS.md, этап "Supabase Storage для Obi"),
// поэтому getPublicUrl() не делает сетевой запрос — только строит URL по
// filename на клиенте, тем же паттерном, что и getTechniqueImageUrl()
// (techniqueImageUrl.js) для judo-techniques.
const OBI_BELTS_BUCKET = 'obi-belts';

// Имя файла определяется НОМЕРОМ Kyu, а не позицией в массиве kyuLevels —
// смена порядка/состава данных с бэкенда не должна подменить пояс.
const BELT_FILENAME_BY_KYU = {
  9: 'weiss.png',
  8: 'weiss-gelb.png',
  7: 'gelb.png',
  6: 'gelb-orange.png',
  5: 'orange.png',
  4: 'orange-gruen.png',
  3: 'gruen.png',
  2: 'blau.png',
  1: 'braun.png',
};

export function parseKyuNumber(kyuGrad) {
  const match = /^(\d+)/.exec(String(kyuGrad ?? '').trim());
  return match ? Number(match[1]) : null;
}

export function getKyuBeltImageUrl(kyuGrad) {
  if (!isSupabaseConfigured) return null;
  const kyuNumber = parseKyuNumber(kyuGrad);
  const filename = BELT_FILENAME_BY_KYU[kyuNumber];
  if (!filename) return null;
  const { data } = trainerSupabase.storage.from(OBI_BELTS_BUCKET).getPublicUrl(filename);
  return data?.publicUrl ?? null;
}
