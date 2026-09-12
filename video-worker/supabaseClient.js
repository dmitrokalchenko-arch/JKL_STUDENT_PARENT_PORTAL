import { createClient } from '@supabase/supabase-js';
import { WorkerError } from './errors.js';

// Задание, раздел 4: "worker получает Authorization: Bearer <trainer JWT>,
// НЕ service_role". SUPABASE_ANON_KEY здесь — это ключ, с которым клиент
// подключается к PostgREST/Storage API (как и на frontend), а РЕАЛЬНАЯ
// личность/права запроса определяются JWT, переданным в
// `global.headers.Authorization` — Supabase проверяет этот JWT и
// auth.uid() внутри RLS/RPC становится тем же тренером, что и на клиенте.
// Ни здесь, ни где-либо ещё в этом worker'е НЕТ service_role key — весь
// доступ к Storage/DB идёт через штатный RLS, ту же защиту, что уже
// работает для browser-side upload'а (studentVideoService.js).
export function createTrainerScopedClient(authorizationHeader) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new WorkerError('INTERNAL_ERROR', 'Worker is missing SUPABASE_URL/SUPABASE_ANON_KEY configuration.');
  }
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    throw new WorkerError('UNAUTHORIZED', 'Missing or malformed Authorization header.');
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// Задание, раздел 8: "не дублировать auth-логику вручную, если можно
// использовать существующий DB helper" — public.can_trainer_access_student
// (supabase/migrations/20260720120017_trainer_student_access_helper.sql)
// уже ЕСТЬ, уже SECURITY DEFINER, уже grant execute to authenticated,
// уже используется как единая точка проверки "тренер -> ученик" везде в
// проекте. Вызывается как обычный RPC ЧЕРЕЗ trainer-scoped client — auth.uid()
// внутри функции резолвится из того же JWT, что в Authorization header.
export async function assertTrainerCanAccessStudent(trainerClient, studentId) {
  const { data, error } = await trainerClient.rpc('can_trainer_access_student', {
    p_student_id: studentId
  });

  if (error) {
    throw new WorkerError('UNAUTHORIZED', 'Failed to verify trainer session.');
  }
  if (data !== true) {
    throw new WorkerError('STUDENT_ACCESS_DENIED', 'Trainer does not have access to this student.');
  }
}
