-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- НАЗНАЧЕНИЕ: этап 1 задачи "Student → Необходимые техники по трём
-- блокам Kyu-программы". Минимальное расширение read-контракта общего
-- resolver'а public.get_required_techniques_for_student(bigint)
-- (миграция 20260918140063): каждый элемент techniques[] дополнительно
-- получает block_type — ФАКТИЧЕСКОЕ значение club_kyu_program_items.
-- block_type (миграция 20260927100072), НЕ вычисленное из category/
-- main_group/названия техники.
--
-- ЧТО МЕНЯЕТСЯ (только тело resolver'а):
--   1. techniques[].block_type — новое additive-поле. Существующие поля
--      (technique_id, name, category, main_group, image_path, youtube_url,
--      youtube_video_id, sort_order) и верхний уровень ответа (currentKyu,
--      nextKyu, status) — БЕЗ ИЗМЕНЕНИЙ.
--   2. Сортировка: раньше "ORDER BY ckpi.sort_order, jt.name" — но
--      sort_order нумеруется ВНУТРИ каждого блока (save_trainer_kyu_program,
--      row_number() over (partition by block_type)), поэтому элементы
--      разных блоков перемешивались. Теперь — сначала явный логический
--      порядок блоков (required_nage -> required_katame -> additional, НЕ
--      алфавитный), затем sort_order, затем jt.name.
--
-- ЧТО НЕ МЕНЯЕТСЯ:
--   - Источник: только club_kyu_program_items (club_id ученика + next Kyu +
--     item_type='technique'). DJB/Go Kyu шаблоны (club_kyu_template_items)
--     по-прежнему НЕ читаются.
--   - Next Kyu: public.resolve_next_kyu_lookup_id(text) — не трогается.
--   - Статусы no_current_kyu/unmapped_kyu/max_level/ok — побайтово те же.
--   - get_family_required_techniques/get_trainer_required_techniques
--     (обёртки с access-check, миграция 20260920100065) — НЕ пересоздаются,
--     их access semantics (включая trainer_access_after_expiry) не меняются.
--   - Одна technique_id в двух block_type -> две записи в techniques[]
--     (как и раньше, дедупликации нет — это разрешено моделью программы).
--   - Никаких individual-program таблиц/RPC.
--
-- GRANTS: CREATE OR REPLACE с той же сигнатурой/RETURNS сохраняет
-- существующие привилегии. Revoke/grant ниже повторены ДОСЛОВНО из
-- 20260918140063 только как защита от расширения прав — EXECUTE остаётся
-- ТОЛЬКО у service_role (плюс владелец), anon/authenticated/public — нет.
create or replace function public.get_required_techniques_for_student(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_empty_result jsonb := jsonb_build_object(
    'currentKyu', null, 'nextKyu', null, 'status', 'no_current_kyu', 'techniques', '[]'::jsonb
  );
  v_student record;
  v_current_kyu text;
  v_is_current_valid boolean;
  v_next_id bigint;
  v_next_kyu text;
  v_techniques jsonb;
begin
  select s.id, s.club_id, s.kyu_grad
    into v_student
  from public.students s
  where s.id = p_student_id;

  if v_student.id is null then
    return v_empty_result;
  end if;

  v_current_kyu := nullif(trim(v_student.kyu_grad), '');
  if v_current_kyu is null then
    return v_empty_result;
  end if;

  select true
    into v_is_current_valid
  from public.kyu_lookup kl
  where lower(trim(kl.kyu_grad)) = lower(v_current_kyu)
    and kl.kyu_grad ilike '%Kyu%'
  limit 1;

  if v_is_current_valid is not true then
    return jsonb_build_object('currentKyu', v_current_kyu, 'nextKyu', null, 'status', 'unmapped_kyu', 'techniques', '[]'::jsonb);
  end if;

  v_next_id := public.resolve_next_kyu_lookup_id(v_current_kyu);

  if v_next_id is null then
    return jsonb_build_object('currentKyu', v_current_kyu, 'nextKyu', null, 'status', 'max_level', 'techniques', '[]'::jsonb);
  end if;

  select kl.kyu_grad into v_next_kyu from public.kyu_lookup kl where kl.id = v_next_id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'technique_id', jt.id,
               'name', jt.name,
               'category', jt.category,
               'main_group', jt.main_group,
               'image_path', jt.image_path,
               'youtube_url', jt.youtube_url,
               'youtube_video_id', jt.youtube_video_id,
               'sort_order', ckpi.sort_order,
               'block_type', ckpi.block_type
             )
             order by
               case ckpi.block_type
                 when 'required_nage' then 1
                 when 'required_katame' then 2
                 when 'additional' then 3
                 else 4
               end,
               ckpi.sort_order,
               jt.name
           ),
           '[]'::jsonb
         )
    into v_techniques
  from public.club_kyu_program_items ckpi
  join public.judo_techniques jt on jt.id = ckpi.technique_id
  where ckpi.club_id = v_student.club_id
    and ckpi.kyu_lookup_id = v_next_id
    and ckpi.item_type = 'technique';

  return jsonb_build_object(
    'currentKyu', v_current_kyu,
    'nextKyu', v_next_kyu,
    'status', 'ok',
    'techniques', v_techniques
  );
end;
$$;

comment on function public.get_required_techniques_for_student(bigint) is
  'ЕДИНСТВЕННАЯ точка вычисления Required Techniques (club program для следующего Kyu) — НЕ access-check RPC, доверяет вызывающему в части p_student_id. Вызывается ТОЛЬКО из get_family_required_techniques/get_trainer_required_techniques (после их собственных access checks) и из get-student-preview через service_role. techniques[].block_type — фактический club_kyu_program_items.block_type (миграция 20260929100074), сортировка: required_nage -> required_katame -> additional, затем sort_order, name. Прямой внешний вызов запрещён (EXECUTE закрыт для anon/authenticated/public).';

revoke all on function public.get_required_techniques_for_student(bigint) from public;
revoke all on function public.get_required_techniques_for_student(bigint) from anon;
revoke all on function public.get_required_techniques_for_student(bigint) from authenticated;
grant execute on function public.get_required_techniques_for_student(bigint) to service_role;
