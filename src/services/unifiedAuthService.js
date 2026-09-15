import { signInFamily } from './familyAuthService.js';
import { signInTrainer } from './trainerAuthService.js';

// UNIFIED LOGIN — один экран входа (/) для Trainer и Family/Student, без
// предварительного выбора роли (см. итоговый отчёт аудита этой задачи).
//
// НЕ переизобретает auth: signInFamily/signInTrainer — БЕЗ ИЗМЕНЕНИЙ,
// каждая по-прежнему работает на своём собственном, уже существующем
// Supabase-клиенте (supabaseClient.js / trainerSupabaseClient.js, разные
// storageKey — см. их комментарии) и пишет результат ТОЛЬКО в свой
// клиент. Эта функция — чистая оркестрация: запускает обе попытки
// ОДНОВРЕМЕННО и сообщает, какая (или какие) реально прошли.
//
// Почему Promise.allSettled, а не Promise.all/race: обе попытки — это
// НЕЗАВИСИМЫЕ, ожидаемо иногда неуспешные операции (человек мог быть и
// тренером, и семьёй — или ни тем, ни другим, если ввёл неверный пароль);
// allSettled гарантирует, что мы дожидаемся ОБОИХ результатов и ни один
// reject не прерывает другую попытку (issue, которого явно избегало
// задание).
//
// Почему не нужен отдельный cleanup "проигравшего" клиента: неуспешный
// signInWithPassword НИКОГДА не создаёт и не трогает существующую сессию
// того клиента (задокументированное поведение Supabase Auth) — если до
// вызова клиент был без сессии, он и остаётся без сессии после
// неудачной попытки. Этот компонент показывается ТОЛЬКО когда ни одна из
// двух сессий ещё не активна (см. App.jsx — до этого вызова обе уже
// проверены и обе false), поэтому "старой мусорной сессии другого типа"
// в момент вызова этой функции структурно быть не может.
export const UnifiedLoginResult = Object.freeze({
  FAMILY_ONLY: 'family_only',
  TRAINER_ONLY: 'trainer_only',
  BOTH: 'both',
  NONE: 'none'
});

export async function signInUnified(login, password) {
  const [trainerOutcome, familyOutcome] = await Promise.allSettled([
    signInTrainer(login, password),
    signInFamily(login, password)
  ]);

  const trainerSucceeded = trainerOutcome.status === 'fulfilled';
  const familySucceeded = familyOutcome.status === 'fulfilled';

  if (trainerSucceeded && familySucceeded) return UnifiedLoginResult.BOTH;
  if (trainerSucceeded) return UnifiedLoginResult.TRAINER_ONLY;
  if (familySucceeded) return UnifiedLoginResult.FAMILY_ONLY;
  return UnifiedLoginResult.NONE;
}
