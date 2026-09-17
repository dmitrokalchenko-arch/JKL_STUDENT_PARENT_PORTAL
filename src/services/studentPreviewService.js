// get-student-preview (Edge Function, production) — потребляет одноразовый
// Super Admin Preview токен (выдан Block 1, JCL_Gruppen,
// create-student-preview-token) и возвращает read-only набор данных
// ученика — тот же полный profile/config contract, что уже отдают
// get_current_family_children/get_trainer_student_by_id (см. миграцию
// 20260916160059) плюс studentPageConfig/techniqueProgress.
//
// НАМЕРЕННО не supabase.rpc() и не trainerSupabase/supabase клиент — эта
// страница (/admin-preview/:token) открывается АНОНИМНО, без family/
// trainer-сессии вовсе (см. комментарий в самой Edge Function). Прямой
// fetch с anon-ключом только как apikey — тот же паттерн, что уже
// используется в JCL_Gruppen для admin-pin-login/super-admin-pin-login
// (вызовы ДО появления какой-либо сессии), впервые применённый здесь, в
// Block 3.
//
// token нигде не логируется и не сохраняется на этой странице дольше, чем
// нужно для одного вызова — сервер помечает его использованным сразу же,
// повторный вызов с тем же token всегда вернёт invalid_or_expired_token.
export async function getStudentPreview(token) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('server_misconfigured');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/get-student-preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey
    },
    body: JSON.stringify({ token })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data?.error || 'preview_failed');
    error.code = data?.error || 'preview_failed';
    throw error;
  }

  return {
    studentId: data.studentId,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    gender: data.gender ?? null,
    birthDate: data.birthDate ?? null,
    age: data.age ?? null,
    weight: data.weight ?? null,
    sportName: data.sportName ?? null,
    groupName: data.groupName ?? null,
    trainerName: data.trainerName ?? null,
    kyuGrade: data.kyuGrade ?? null,
    beltColorName: data.beltColorName ?? null,
    phone: data.phone ?? null,
    email: data.email ?? null,
    photoUrl: data.photoUrl ?? null,
    // Отсутствует в ответе, пока club-scoped миграция/данные не готовы —
    // см. get-student-preview: undefined, а не null, чтобы
    // StudentPageContent корректно не рендерил секцию вовсе (та же
    // семантика "не подключено", что уже используется для остальных
    // секций, см. StudentPreviewPage.jsx).
    techniqueProgress: data.techniqueProgress ?? undefined,
    // studentPageConfig — та же семантика: undefined, если Edge Function
    // его не вернул (миграция/RPC ещё не готовы), чтобы
    // mergeStudentPageConfig откатился на DEFAULT_STUDENT_PAGE_CONFIG, а не
    // получил пустой объект, который выглядел бы как "всё выключено".
    studentPageConfig: data.studentPageConfig ?? undefined
  };
}
