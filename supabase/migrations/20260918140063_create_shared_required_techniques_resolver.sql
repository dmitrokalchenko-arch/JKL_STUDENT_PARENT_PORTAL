-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- НАЗНАЧЕНИЕ: этап 1 задачи "Super Admin Preview → Required Techniques" —
-- вынести ОДНУ общую server-side точку вычисления Required Techniques
-- (student -> current Kyu -> next Kyu -> club program -> techniques) в
-- отдельную функцию, чтобы get_family_required_techniques и
-- get_trainer_required_techniques (обе — миграция 20260918100061)
-- перестали дублировать одну и ту же SQL-логику, и чтобы будущий
-- get-student-preview (Super Admin Preview, ОТДЕЛЬНЫЙ следующий этап, НЕ
-- реализуется в этой миграции) мог использовать ТУ ЖЕ логику через
-- service_role, без копирования в третий раз.
--
-- ПОДГОТОВКА К БУДУЩИМ INDIVIDUAL OVERRIDES (тоже НЕ реализуется здесь):
-- когда появится student-level include/exclude поверх club-программы,
-- единственное место, которое потребуется изменить — тело ЭТОЙ функции
-- (добавить -EXCLUDE +INCLUDE к уже вычисленному club-пулу). Family RPC/
-- Trainer RPC/будущий Super Admin Preview НЕ изменятся вообще — они уже
-- просто делегируют вычисление сюда. Сейчас effective program = ТОЛЬКО
-- существующая club_kyu_program_items, никакой overrides-таблицы эта
-- миграция не создаёт.
--
-- ЭТА ФУНКЦИЯ — НЕ ACCESS-CHECK RPC И НЕ ПУБЛИЧНЫЙ API. Она принимает
-- p_student_id и ДОВЕРЯЕТ вызывающему, что доступ к этому ученику уже
-- проверен (can_family_access_student/can_trainer_access_student — во
-- внешних wrapper RPC ниже, — или уже провалидированный one-time preview
-- token в будущем Super Admin Edge Function). Сама она НИКОГДА не
-- проверяет auth.uid() и не решает, кому можно видеть ученика — именно
-- поэтому EXECUTE закрыт для anon/authenticated/public (см. grants ниже):
-- единственный способ получить из неё данные — уже пройти access check в
-- одной из внешних RPC (или быть service_role внутри Edge Function).
--
-- ПОЧЕМУ ВЫЗОВ ИЗ SECURITY DEFINER WRAPPER БЕЗОПАСЕН, А НАПРЯМУЮ —
-- НЕТ: когда get_family_required_techniques (SECURITY DEFINER, владелец —
-- роль миграций/postgres) вызывает get_required_techniques_for_student
-- внутри своего PL/pgSQL-тела, проверка EXECUTE-привилегии на ВНУТРЕННИЙ
-- вызов проходит от имени ТЕКУЩЕГО РОЛЕВОГО КОНТЕКСТА выполнения (то есть
-- владельца SECURITY DEFINER функции — postgres), а не от имени внешнего
-- клиента (authenticated Family/Trainer) — то же самое стандартное
-- поведение PostgreSQL для цепочек SECURITY DEFINER, на котором уже
-- держится вся security-модель проекта (private.* helpers вызываются
-- точно так же). Реальный authenticated Family/Trainer, пытающийся
-- вызвать public.get_required_techniques_for_student(<любой student_id>)
-- НАПРЯМУЮ через PostgREST (используя СВОЮ собственную роль
-- authenticated, а не унаследованную роль владельца), получит
-- "permission denied" — EXECUTE ему не выдан ни explicit grant'ом, ни
-- через public.
--
-- RESPONSE CONTRACT (без изменений, идентичен уже существующему в
-- get_family_required_techniques/get_trainer_required_techniques):
--   { currentKyu: text|null, nextKyu: text|null,
--     status: 'ok'|'no_current_kyu'|'unmapped_kyu'|'max_level',
--     techniques: [{ technique_id, name, category, main_group,
--                     image_path, youtube_url, youtube_video_id,
--                     sort_order }] }
-- STATUS SEMANTICS — без изменений (побайтовая копия логики из
-- 20260918100061): NULL/пустой current Kyu -> no_current_kyu; текст,
-- не совпадающий ни с одной Kyu-строкой kyu_lookup (включая Dan,
-- "99. Kyu", произвольный текст) -> unmapped_kyu; "1. Kyu" (Dan не
-- строится) -> max_level; валидный Kyu с next Kyu -> ok (techniques
-- может быть пустым массивом, если клуб ничего не настроил — это НЕ
-- ошибка). NEXT KYU по-прежнему НЕ через kyu_lookup.id+1 — переиспользует
-- уже существующий public.resolve_next_kyu_lookup_id(text) (миграция
-- 20260918100061), логика разбора номера Kyu из текста здесь НЕ
-- копируется повторно.
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

  -- Club program для next Kyu — СЕЙЧАС ровно club_kyu_program_items, без
  -- overrides (будущий этап добавит сюда -EXCLUDE +INCLUDE поверх этого
  -- же pool, не меняя ничего снаружи этой функции).
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
               'sort_order', ckpi.sort_order
             )
             order by ckpi.sort_order, jt.name
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
  'ЕДИНСТВЕННАЯ точка вычисления Required Techniques (club program для следующего Kyu) — НЕ access-check RPC, доверяет вызывающему в part p_student_id. Вызывается ТОЛЬКО из get_family_required_techniques/get_trainer_required_techniques (после их собственных access checks) и в будущем — из get-student-preview через service_role (после валидации one-time preview token). Прямой внешний вызов запрещён (EXECUTE закрыт для anon/authenticated/public). Будущие individual overrides (student include/exclude) добавятся ВНУТРИ этой функции, не меняя контракт вызывающих.';

-- Явный revoke сразу в этой же миграции — та же дважды/трижды уже
-- подтверждённая в проекте необходимость (миграции 20260916150058,
-- 20260916160059, 20260918100061): default privileges на новые функции в
-- этом Supabase-проекте оказываются шире ожидаемого, полагаться на них
-- нельзя. НИКАКОГО explicit grant для authenticated здесь НЕТ и не будет —
-- это внутренний helper, а не публичная RPC.
revoke all on function public.get_required_techniques_for_student(bigint) from public;
revoke all on function public.get_required_techniques_for_student(bigint) from anon;
revoke all on function public.get_required_techniques_for_student(bigint) from authenticated;

-- service_role — единственная внешняя роль, которой EXECUTE реально
-- нужен: будущий get-student-preview (Super Admin Preview, ОТДЕЛЬНЫЙ
-- следующий этап) будет вызывать эту функцию именно из service_role-
-- клиента Edge Function, уже ПОСЛЕ безопасного потребления one-time
-- preview token. Указан явно (не полагаемся на неявные default privileges
-- Supabase, даже если resolve_next_kyu_lookup_id их и получила без
-- явного grant — здесь делаем это документированно и предсказуемо).
grant execute on function public.get_required_techniques_for_student(bigint) to service_role;

-- ── REFACTOR: FAMILY RPC делегирует вычисление общему resolver'у ────────
-- Сигнатура/access check (can_family_access_student)/anti-enumeration
-- поведение/SECURITY DEFINER/search_path/grants — БЕЗ ИЗМЕНЕНИЙ
-- (CREATE OR REPLACE с той же формой RETURNS сохраняет существующие
-- grants автоматически). Изменилось ТОЛЬКО тело после успешного access
-- check: вместо повторного вычисления SQL — один вызов общего resolver'а.
create or replace function public.get_family_required_techniques(p_student_id bigint)
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
begin
  if (select auth.uid()) is null then
    return v_empty_result;
  end if;

  if not public.can_family_access_student(p_student_id) then
    return v_empty_result;
  end if;

  return public.get_required_techniques_for_student(p_student_id);
end;
$$;

-- ── REFACTOR: TRAINER RPC делегирует вычисление общему resolver'у ───────
-- Аналогично Family — только access check меняется на
-- can_trainer_access_student, остальное идентично.
create or replace function public.get_trainer_required_techniques(p_student_id bigint)
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
begin
  if (select auth.uid()) is null then
    return v_empty_result;
  end if;

  if not public.can_trainer_access_student(p_student_id) then
    return v_empty_result;
  end if;

  return public.get_required_techniques_for_student(p_student_id);
end;
$$;
