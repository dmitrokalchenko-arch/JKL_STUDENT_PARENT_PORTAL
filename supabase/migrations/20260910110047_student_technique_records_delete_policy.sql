-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION. Разрешает тренеру отменить
-- ошибочно отмеченную технику (DELETE public.student_technique_records) —
-- ранее DELETE не был предоставлен вообще ни в grant, ни в policy (см.
-- 20260908130043: "UPDATE/DELETE НЕ добавлены вообще... если понадобится,
-- обсуждается отдельно, не задним числом через расширение уже одобренной
-- policy" — эта миграция и есть то самое отдельное обсуждение/применение,
-- не расширение существующей SELECT/INSERT policy).
--
-- ГРАНИЦЫ ДОСТУПА — ТЕ ЖЕ, что у SELECT (не шире, не уже): тренер может
-- удалить запись только если у него ПРЯМО СЕЙЧАС есть доступ к этому
-- ученику — public.can_trainer_access_student(student_id), та же функция
-- (migration 20260720120017), что уже проверяет и SELECT
-- (student_technique_records_select_own_students), и INSERT
-- (..._insert_own_students): membership ученика в одной из групп тренера +
-- совпадение club_id, пересчитывается на каждый запрос (деактивация
-- тренера/группы немедленно закрывает доступ, без отдельного отзыва).
--
-- Сознательно НЕ добавлено доп. условие "completed_by = свой trainers.id"
-- (в отличие от INSERT, где completed_by = private.current_trainer_row_id()
-- обязателен): задание прямо требует только "доступ к student", не "только
-- автор записи" — несколько тренеров одной группы уже видят записи друг
-- друга через SELECT на тех же основаниях, и должны мочь исправить
-- ошибочную отметку коллеги по этому ученику, не только свою собственную.
-- Если это когда-либо будет пересмотрено, замена на
-- "and completed_by = private.current_trainer_row_id()" — однострочная
-- правка USING этой же policy, не новая архитектура.
--
-- НЕ using(true): без выданного ниже GRANT DELETE операция для
-- authenticated в принципе невозможна на уровне privilege (PostgREST
-- вернёт "permission denied for table" ДО того, как Postgres успеет
-- применить RLS policy) — то есть даже гипотетическая ошибка в USING не
-- открыла бы доступ без этого явного, отдельного GRANT.
grant delete on table public.student_technique_records to authenticated;

create policy student_technique_records_delete_own_students
  on public.student_technique_records
  for delete
  to authenticated
  using (public.can_trainer_access_student(student_id));

comment on policy student_technique_records_delete_own_students on public.student_technique_records is
  'Тренер может удалить (отменить) запись выполнения только для ученика, к которому у него есть доступ ПРЯМО СЕЙЧАС (public.can_trainer_access_student(student_id) — та же fresh-проверка группы+клуба, что и у SELECT/INSERT). Не ограничено автором записи (completed_by) — любой тренер с доступом к ученику может исправить ошибочную отметку коллеги, как и видит её через SELECT. Деактивация тренера/группы немедленно закрывает и это право, без отдельного отзыва. Клиент удаляет по первичному ключу (id) конкретной записи student_id+technique_id — эта policy не расширяет то, ЧТО можно удалить (одна строка по PK), только проверяет право на неё.';
