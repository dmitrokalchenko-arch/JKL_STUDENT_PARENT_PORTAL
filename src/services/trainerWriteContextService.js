import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';

/**
 * @typedef {Object} TrainerWriteContext
 * @property {string} trainerRowId - trainers.id (bigint) текущего тренера, как text —
 *   та же защита от потери точности через JSON, что и у student_id по всей
 *   цепочке проекта; НЕ приводить к Number/parseInt/unary +.
 * @property {string} clubId
 */

// get_current_trainer_write_context() — RPC, подготовленный в этой сессии
// (см. supabase/migrations/20260908140044_get_current_trainer_write_context.sql,
// НЕ применён к production, ждёт вашего запуска через Dashboard). До
// применения эта функция вернёт "Could not find the function" — обработано
// в markStudentTechniqueCompleted как writeContextError, не как крэш.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ getCurrentTrainerProfile(): та НАМЕРЕННО не
// возвращает trainer_row_id (см. migration 013 — "внутренний bigint чужой
// системы, раскрывать незачем"), но RLS-policy INSERT на
// student_technique_records требует completed_by = private.current_trainer_row_id()
// — а private-схема не экспонирована как RPC-путь, вызвать её напрямую с
// фронтенда нельзя. Единственный источник этого bigint для клиента — новая
// узкая public-функция, см. миграцию выше.
//
// ИСПРАВЛЕНО (self-review перед применением миграции): раньше здесь стояло
// `const row = data?.[0]` — то есть если бы RPC когда-либо вернула больше
// одной строки (несколько активных trainer_accounts на один auth.uid()),
// фронтенд молча взял бы первую произвольную и отправил бы её
// trainer_row_id как completed_by. Сама функция теперь (см. миграцию)
// гарантирует на сервере максимум одну строку — при неоднозначности она
// бросает исключение, а не возвращает несколько строк. Проверка длины
// массива ниже — defense in depth, а не единственная защита: даже если бы
// контракт функции на сервере когда-нибудь нарушился, фронтенд всё равно
// не станет угадывать, какая строка правильная, а явно откажет.
export async function getCurrentTrainerWriteContext() {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await trainerSupabase.rpc('get_current_trainer_write_context');

  if (error) {
    // Сюда же попадёт RAISE EXCEPTION 'Ambiguous active trainer account' —
    // тот же generic writeContextError на фронтенде, что и любая другая
    // ошибка RPC (намеренно неотличимо для пользователя от "функция ещё не
    // применена"/сетевой ошибки — детали см. в консоли разработчика через
    // error, не в UI).
    throw new Error(`Не удалось определить данные тренера: ${error.message}`);
  }

  const rows = data ?? [];

  if (rows.length > 1) {
    // Контракт функции это исключает (см. миграцию) — если сюда всё же
    // дошло, это несоответствие сервера и клиента, а не повод угадывать.
    throw new Error('Не удалось определить данные тренера: получено более одной записи.');
  }

  const row = rows[0];
  if (!row || row.trainer_row_id == null) return null;

  return { trainerRowId: row.trainer_row_id, clubId: row.club_id };
}
