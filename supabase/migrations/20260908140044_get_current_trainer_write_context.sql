-- ⚠️ ПРЕДЛОЖЕНИЕ, НЕ ПРИМЕНЕНО К PRODUCTION. Подготовлено в рамках интеграции
-- реального сохранения (INSERT) в public.student_technique_records — не
-- выполнялось ни против production, ни локально. Никакая существующая
-- production-функция/таблица/policy/grant этим файлом НЕ изменяется —
-- только ОДНА новая, чисто аддитивная функция.
--
-- ЗАЧЕМ: production RLS-policy student_technique_records_insert_own_students
-- (уже применена вручную, см. отчёт предыдущей сессии) требует
-- with check (completed_by = private.current_trainer_row_id()). Это
-- ПРОВЕРКА на сервере — но клиент всё равно обязан явно передать значение
-- completed_by в самой INSERT-строке (колонка bigint not null, без default).
-- Сегодня во ВСЕЙ Trainer Area нет ни одного публичного способа узнать
-- собственный trainers.id (bigint):
--   - public.get_current_trainer_profile() (migration 013) НАМЕРЕННО не
--     возвращает trainer_row_id ("внутренний bigint чужой системы,
--     раскрывать незачем" — верно для профиля/UI, но не покрывает write-flow);
--   - private.current_trainer_row_id() (migration 043) в схеме private —
--     PostgREST в этом проекте не экспонирует эту схему как RPC-путь (в
--     этом и весь смысл схемы private, см. остальные private.*-функции
--     проекта) — вызвать её напрямую с фронтенда НЕВОЗМОЖНО, только изнутри
--     другой SECURITY DEFINER функции/RLS-выражения на сервере.
-- Поэтому нужна ОТДЕЛЬНАЯ, новая, тоже read-only public-функция — прямая
-- аналогия get_current_trainer_profile() (тот же auth.uid()-only контракт,
-- тот же "0 строк = не тренер", то же SECURITY DEFINER-обоснование), но со
-- своим отдельным, узким контрактом (bigint id + club_id для write-flow),
-- НЕ меняющая существующий get_current_trainer_profile() ни на одну
-- строчку — ноль риска для уже работающих потребителей той функции
-- (useTrainerProfile.js, TrainerAuthGuard.jsx).
--
-- club_id возвращается тем же способом, что и в get_current_trainer_profile
-- (ta.club_id из trainer_accounts) — ученик и тренер гарантированно в одном
-- клубе (структурно обеспечено can_trainer_access_student, см. migration
-- 017), поэтому club_id тренера безопасно использовать как club_id новой
-- строки student_technique_records; триггер
-- enforce_student_technique_records_club_match (migration 043) НЕЗАВИСИМО
-- перепроверит это на сервере при INSERT — если когда-либо не совпадёт,
-- INSERT провалится с понятной ошибкой, а не тихо запишет неверные данные.
--
-- trainer_row_id возвращается как text, не bigint — та же защита от потери
-- точности bigint через JSON/JS Number, что уже применена в проекте для
-- students.id (см. src/services/trainerStudentsService.js,
-- searchTrainerStudents: "id приходит уже как text... ЗАПРЕЩЕНО приводить
-- его к Number/parseInt/unary +"). Postgres/PostgREST принимает текстовое
-- числовое значение как bigint при последующем INSERT без потерь — та же
-- схема, что уже работает для student_id по всей цепочке проекта.
--
-- ИСПРАВЛЕНО (self-review перед применением, см. отчёт сессии "SECURITY",
-- пункт 4): trainer_accounts НЕ имеет UNIQUE(auth_user_id) на уровне схемы
-- (не добавляется и здесь — отдельное архитектурное решение вне объёма
-- этой миграции). Первая версия этой функции была `language sql` с
-- обычным SELECT без LIMIT — при гипотетическом нарушении инварианта
-- "не больше одной активной строки на auth_user_id" она молча вернула бы
-- НЕСКОЛЬКО строк, а фронтенд (data?.[0]) молча взял бы первую произвольную
-- — то есть completed_by мог бы быть отправлен с bigint ДРУГОГО, не
-- обязательно текущего, trainer_row_id того же auth.uid(). RLS
-- (private.current_trainer_row_id(), migration 043) всё равно не пропустил
-- бы совсем чужого тренера (там та же двусмысленность разрешалась бы через
-- LIMIT 1 — за это отвечает уже существующий, не редактируемый здесь код),
-- но сам факт "какая из двух строк правильная" не должен решаться угадыванием
-- ни на фронтенде, ни через произвольный LIMIT 1 на сервере.
--
-- Теперь функция явно считает совпадения и требует FAIL-CLOSED:
--   0 активных строк  -> 0 строк результата (не тренер / деактивирован);
--   1 активная строка -> ровно эта строка;
--   >1 активных строк -> RAISE EXCEPTION (неоднозначное состояние,
--                        сообщение нейтральное, БЕЗ auth_user_id/UUID).
-- Read-only production-аудит перед применением этой версии —
-- supabase/diagnostics/check_trainer_accounts_duplicate_active.sql
-- (результат см. отчёт сессии) — сегодня 0 нарушений, но функция не
-- полагается на то, что так будет всегда.
create or replace function public.get_current_trainer_write_context()
returns table (
  trainer_row_id text,
  club_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_match_count integer;
begin
  select count(*)
  into v_match_count
  from public.trainer_accounts ta
  where ta.auth_user_id = v_auth_uid
    and ta.is_active = true;

  if v_match_count = 0 then
    -- Не тренер вообще, либо деактивирован — 0 строк, НЕ exception (Family
    -- authenticated и любой другой не-тренер получают ровно это).
    return;
  end if;

  if v_match_count > 1 then
    -- Неоднозначное состояние: несколько активных trainer_accounts на один
    -- auth.uid(). Намеренно НЕ выбираем "первую" — ни LIMIT 1, ни ORDER BY
    -- + LIMIT 1 не делают выбор корректным, только скрывают проблему.
    -- Сообщение нейтральное: без auth_user_id, без trainer_row_id, без
    -- club_id — ничего чувствительного не попадает в текст исключения
    -- (он долетает до фронтенда как error.message через PostgREST).
    raise exception 'Ambiguous active trainer account';
  end if;

  return query
    select t.id::text, ta.club_id
    from public.trainer_accounts ta
    join public.trainers t on t.id = ta.trainer_row_id
    where ta.auth_user_id = v_auth_uid
      and ta.is_active = true;
end;
$$;

comment on function public.get_current_trainer_write_context() is
  'SECURITY DEFINER, PL/pgSQL (не простой SQL — намеренно, чтобы явно посчитать совпадения перед выбором строки): {trainer_row_id, club_id} ТЕКУЩЕГО auth.uid(), без параметров (подмена чужого контекста невозможна). 0 активных trainer_accounts -> 0 строк (не тренер/деактивирован, не ошибка). Ровно 1 -> эта строка. Больше 1 -> RAISE EXCEPTION ''Ambiguous active trainer account'' (нейтральное сообщение, без auth_user_id/UUID) — неоднозначность НЕ разрешается произвольным выбором (ни LIMIT 1 в SQL, ни data?.[0] на фронтенде). Единственное назначение — дать фронтенду значение для completed_by при прямом INSERT в student_technique_records; сама вставка по-прежнему идёт через обычный table INSERT клиента (не через эту функцию) и по-прежнему проходит RLS-policy student_technique_records_insert_own_students, которая независимо пересчитывает private.current_trainer_row_id() на сервере — эта функция ничего не обходит и не подменяет проверку, только сообщает клиенту, что подставить в запрос.';

revoke all on function public.get_current_trainer_write_context() from public;
revoke all on function public.get_current_trainer_write_context() from anon;
grant execute on function public.get_current_trainer_write_context() to authenticated;
