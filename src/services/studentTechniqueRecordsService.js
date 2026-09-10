import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';
import { getTechniqueImageUrl } from './techniqueImageUrl.js';

// Общая форма JOIN — technique_id остаётся FK, name/category/main_group/
// image_path/youtube_url/youtube_video_id читаются ИСКЛЮЧИТЕЛЬНО через
// embedded-select на judo_techniques (PostgREST резолвит его по уже
// существующему FK public.student_technique_records.technique_id ->
// public.judo_techniques.id, схема кэширована автоматически, ничего
// дополнительно настраивать не нужно). Ни здесь, ни в
// student_technique_records НИГДЕ не хранится копия этих полей —
// критическое правило задания (этап 5). image_path добавлен тем же
// принципом — это ссылка на изображение ЭТОЙ техники в каталоге, не копия:
// одна и та же getTechniqueImageUrl(image_path), что и в
// judoTechniquesService.js, гарантирует ту же самую картинку.
const RECORD_SELECT =
  'id, technique_id, completed_at, judo_techniques(name, category, main_group, image_path, youtube_url, youtube_video_id)';

function mapRecord(row) {
  const technique = row.judo_techniques
    ? { ...row.judo_techniques, image_url: getTechniqueImageUrl(row.judo_techniques.image_path) }
    : null;

  return {
    id: row.id,
    techniqueId: row.technique_id,
    completedAt: row.completed_at,
    // judo_techniques может быть null, если сама запись существует, но
    // JOIN ничего не вернул (RLS/edge case) — не должно случиться на
    // практике (technique_id -> judo_techniques(id) on delete restrict
    // гарантирует, что строка каталога физически не может быть удалена,
    // пока есть ссылающийся student_technique_records), но UI обязан
    // пережить и такой случай без падения (задание, этап 8: "technique_id,
    // который больше не найден").
    technique
  };
}

// studentId — string (см. src/services/trainerStudentsService.js —
// защита от потери точности bigint через JSON). НЕ приводить к
// Number/parseInt/unary + нигде в этой цепочке.
export async function getStudentTechniqueRecords(studentId) {
  if (!isSupabaseConfigured || !studentId) return [];

  const { data, error } = await trainerSupabase
    .from('student_technique_records')
    .select(RECORD_SELECT)
    .eq('student_id', studentId)
    .order('completed_at', { ascending: false });

  if (error) {
    throw new Error(`Не удалось загрузить выполненные техники: ${error.message}`);
  }

  return (data ?? []).map(mapRecord);
}

// Типизированная ошибка вместо "сырого" Postgres/PostgREST сообщения —
// вызывающий код (хук/компонент) решает, какой i18n-текст показать, сам
// текст ошибки БД никогда не долетает до UI (задание, этап 8: "не
// показывать raw Supabase/Postgres error пользователю").
export class MarkTechniqueError extends Error {
  constructor(reason, cause) {
    super(`markStudentTechniqueCompleted failed: ${reason}`);
    this.reason = reason; // 'duplicate' | 'access_denied' | 'unknown'
    this.cause = cause;
  }
}

// completed_by НИКОГДА не выбирается пользователем и не вычисляется на
// клиенте — trainerRowId приходит из useTrainerWriteContext() (RPC
// get_current_trainer_write_context, см. отчёт сессии), тот же bigint,
// который RLS-policy student_technique_records_insert_own_students
// независимо пересчитывает на сервере через private.current_trainer_row_id()
// и сверяет с этим значением. Если они разойдутся (практически невозможно —
// это тот же тренер, та же сессия), INSERT просто провалится RLS-проверкой
// (42501), а не молча запишет неверные данные.
export async function markStudentTechniqueCompleted({ studentId, techniqueId, clubId, trainerRowId, trainerComment }) {
  const { data, error } = await trainerSupabase
    .from('student_technique_records')
    .insert({
      club_id: clubId,
      student_id: studentId,
      technique_id: techniqueId,
      completed_by: trainerRowId,
      trainer_comment: trainerComment || null
    })
    .select(RECORD_SELECT)
    .single();

  if (error) {
    if (error.code === '23505') {
      // unique_violation — student_id+technique_id уже существует (ЭТАП 4).
      throw new MarkTechniqueError('duplicate', error);
    }
    if (error.code === '42501') {
      // insufficient_privilege — RLS WITH CHECK отклонил (чужой ученик/
      // деактивированный тренер/несовпадение completed_by).
      throw new MarkTechniqueError('access_denied', error);
    }
    throw new MarkTechniqueError('unknown', error);
  }

  return mapRecord(data);
}

// Отдельный класс (не переиспользует MarkTechniqueError) — разные операции,
// разный набор возможных reason (unmark не может получить 'duplicate'),
// разный catch-сайт (useUnmarkTechniqueCompleted, не useMarkTechniqueCompleted).
export class UnmarkTechniqueError extends Error {
  constructor(reason, cause) {
    super(`deleteStudentTechniqueRecord failed: ${reason}`);
    this.reason = reason; // 'access_denied' | 'unknown'
    this.cause = cause;
  }
}

// Удаляет ОДНУ конкретную запись по её первичному ключу (id) — не по
// student_id+technique_id отдельно, чтобы структурно исключить случайное
// совпадение больше чем одной строки (id уникален по определению, тогда
// как WHERE по двум колонкам был бы лишним способом выразить то же самое).
// RLS (student_technique_records_delete_own_students, migration 047)
// независимо проверяет can_trainer_access_student на сервере — эта функция
// ничего не обходит, только формирует запрос.
//
// .select('id') после .delete() — иначе Supabase не возвращает удалённые
// строки, и 0-affected-rows (тренер потерял доступ к ученику между
// загрузкой списка и кликом — RLS тихо отфильтровала, НЕ Postgres-ошибка)
// была бы неотличима от "успешно удалили ровно 0 строк, потому что их и
// не было" — без этого проверка ниже не сработала бы.
export async function deleteStudentTechniqueRecord(recordId) {
  const { data, error } = await trainerSupabase
    .from('student_technique_records')
    .delete()
    .eq('id', recordId)
    .select('id');

  if (error) {
    throw new UnmarkTechniqueError('unknown', error);
  }
  if (!data || data.length === 0) {
    throw new UnmarkTechniqueError('access_denied', null);
  }
}
