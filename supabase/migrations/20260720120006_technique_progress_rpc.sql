-- RPC для семейной страницы: один безопасный вызов вместо набора разрозненных
-- select'ов из фронтенда.
--
-- ТИПЫ (аудит этапа 2.2): p_student_id — bigint (students.id, реальный PK),
-- НЕ uuid. Более ранняя версия этой миграции ошибочно предполагала uuid.

-- Best-effort сопоставление "текущий пояс ученика (текст) -> club_belts.id".
-- См. предупреждение в шапке 20260720120004_create_technique_progress_schema.sql —
-- сравнение по имени регистронезависимое, но зависит от того, что club_belts.name
-- совпадает по написанию с students.guertelfarbe. Несовпадение -> null.
create or replace function public.resolve_student_current_belt(p_student_id bigint)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_club_id text;
  v_guertelfarbe text;
  v_belt_id uuid;
begin
  select club_id, guertelfarbe into v_club_id, v_guertelfarbe
  from public.students
  where id = p_student_id;

  if v_club_id is null then
    return null;
  end if;

  select id into v_belt_id
  from public.club_belts
  where club_id = v_club_id
    and is_active = true
    and lower(trim(name)) = lower(trim(coalesce(v_guertelfarbe, '')))
  limit 1;

  return v_belt_id;
end;
$$;

comment on function public.resolve_student_current_belt(bigint) is
  'Best-effort: сопоставляет students.guertelfarbe (text) с club_belts.name (case-insensitive). Известное ограничение, не полноценная нормализация — см. комментарий в create_technique_progress_schema.sql.';

create or replace function public.get_student_technique_progress(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_club_id text;
  v_belt_id uuid;
  v_settings record;
  v_belt_override record;
  v_feature_enabled boolean;
  v_bonus_requirement integer;
  v_bonus_points integer;
  v_belt jsonb;
  v_techniques jsonb;
begin
  -- Пункт 9 задания: функция сама проверяет доступ, подстановка чужого
  -- student_id ничего не возвращает — доступ отклоняется явной ошибкой,
  -- а не тихим пустым ответом (чтобы не путать "нет доступа" с "нет данных").
  if not public.can_family_access_student(p_student_id) then
    raise exception 'access_denied: current user cannot access student %', p_student_id
      using errcode = '42501';
  end if;

  select club_id into v_club_id from public.students where id = p_student_id;

  select * into v_settings
  from public.club_technique_progress_settings
  where club_id = v_club_id;

  v_belt_id := public.resolve_student_current_belt(p_student_id);

  select * into v_belt_override
  from public.club_belt_technique_settings
  where club_id = v_club_id and belt_id = v_belt_id;

  v_feature_enabled := coalesce(v_belt_override.feature_enabled, v_settings.feature_enabled, false);
  v_bonus_requirement := coalesce(v_belt_override.bonus_requirement, v_settings.default_bonus_requirement, 5);
  v_bonus_points := coalesce(v_belt_override.bonus_points, v_settings.bonus_points);

  if v_belt_id is not null then
    select jsonb_build_object('id', cb.id, 'name', cb.name, 'color', cb.color_hex)
    into v_belt
    from public.club_belts cb
    where cb.id = v_belt_id;
  end if;

  -- featureEnabled=false или отсутствие набора техник пояса -> пустой массив,
  -- не ошибка (пункт 9 задания).
  if not v_feature_enabled or v_club_id is null or v_belt_id is null then
    v_techniques := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ct.id,
        'name', ct.name,
        'category', ct.category,
        'status', case when stp.id is null then 'required' else 'completed' end,
        'imagePath', ct.image_path,
        'videoPath', stp.video_path,
        'completedAt', stp.completed_at,
        'trainerComment', stp.trainer_comment
      )
      order by cbt.sort_order
    ), '[]'::jsonb)
    into v_techniques
    from public.club_belt_techniques cbt
    join public.club_techniques ct on ct.id = cbt.technique_id
    left join public.student_technique_progress stp
      on stp.student_id = p_student_id
     and stp.technique_id = cbt.technique_id
     and stp.belt_id = cbt.belt_id
    where cbt.belt_id = v_belt_id
      and cbt.club_id = v_club_id
      and ct.is_active = true;
  end if;

  return jsonb_build_object(
    'featureEnabled', v_feature_enabled,
    'bonusRequirement', v_bonus_requirement,
    'bonusPoints', v_bonus_points,
    'belt', v_belt,
    'techniques', v_techniques
  );
end;
$$;

comment on function public.get_student_technique_progress(bigint) is
  'Единая точка чтения для семейной страницы. Сама проверяет can_family_access_student. status вычисляется из ЕДИНОГО источника (наличие/отсутствие student_technique_progress), сортировка по club_belt_techniques.sort_order. videoPath — только Storage path, не подписанная ссылка; signed URL запрашивается отдельно при открытии модалки (см. src/services/techniqueProgressService.js). p_student_id — bigint (students.id).';

-- ИСПРАВЛЕНО (аудит этапа 2.1): resolve_student_current_belt НЕ проверяет
-- can_family_access_student — она читает students.guertelfarbe/club_id для
-- ЛЮБОГО переданного p_student_id. Изначальный grant to authenticated делал
-- её вызываемой напрямую с фронтенда для произвольного чужого student_id
-- (утечка: какой пояс у чужого ученика). У функции нет легитимного прямого
-- вызова — она используется только изнутри get_student_technique_progress,
-- которая уже проверяет доступ ДО её вызова. Убираем прямой грант
-- authenticated; вызов изнутри другой SECURITY DEFINER функции работает
-- независимо от этого grant'а (выполняется в контексте владельца функции).
revoke all on function public.resolve_student_current_belt(bigint) from public;

revoke all on function public.get_student_technique_progress(bigint) from public;
grant execute on function public.get_student_technique_progress(bigint) to authenticated;
