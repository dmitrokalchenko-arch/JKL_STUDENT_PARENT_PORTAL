-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- НАЗНАЧЕНИЕ: read-path для "Необходимые техники" на Universal Student
-- Page (этап 4A задачи "Club Kyu Technique Program") — Family/Trainer.
-- Super Admin Preview (get-student-preview) НЕ трогается в этой миграции —
-- отдельный следующий шаг, после проверки Family/Trainer.
--
-- БИЗНЕС-ЛОГИКА: "Необходимые техники" = программа СЛЕДУЮЩЕГО Kyu (НЕ
-- текущего). Пример: у ученика current Kyu = "7. Kyu" → next = "6. Kyu" →
-- показываем club_kyu_program_items клуба ученика для "6. Kyu". Это
-- сознательно ОТДЕЛЬНОЕ понятие от Bonus Techniques (программа УЖЕ
-- полученного Kyu, не реализуется здесь) — обе секции в будущем читают
-- одну и ту же club_kyu_program_items, но для разных kyu_lookup_id.
--
-- НЕ ИСПОЛЬЗУЕТСЯ И НЕ ТРОГАЕТСЯ: get_student_technique_progress,
-- student_technique_progress, techniqueProgressService.js,
-- useTechniqueProgress — тот отдельный, уже существующий read-path
-- исторически связан с известной ошибкой "Не удалось загрузить прогресс
-- техник" и не имеет отношения к Required Techniques. completion
-- (student_technique_records) тоже не подключается на этом этапе — только
-- сам список необходимых техник, без прогресса выполнения.
--
-- NEXT KYU RESOLUTION: сознательно НЕ через kyu_lookup.id + 1 (в таблице
-- нет отдельной колонки ранга — совпадение возрастания id с убыванием
-- номера Kyu сегодня эмпирический факт данных, а не гарантия схемы).
-- Вместо этого — resolve_next_kyu_lookup_id() ниже разбирает текстовый
-- номер из kyu_grad ("7. Kyu" -> 7) и ищет СЛЕДУЮЩИЙ номер (6) как точное
-- значение в kyu_lookup.kyu_grad ("6. Kyu") — не зависит от id/порядка
-- строк вообще. Dan НЕ поддерживается этой функцией: "1. Kyu" -> NULL
-- (переход в Dan сознательно не строится на этом этапе), Dan как ВХОДНОЕ
-- значение current Kyu тоже отклоняется (см. подробности в самой функции).
--
-- CURRENT KYU VALIDATION: current Kyu ученика (students.kyu_grad,
-- свободный текст) подтверждается РЕАЛЬНОЙ строкой kyu_lookup, а не
-- только форматом текста — "99. Kyu" синтаксически похоже на валидный
-- Kyu, но такой строки в kyu_lookup нет -> unmapped_kyu, не 500/exception.
--
-- CLUB_ID: НИКОГДА не передаётся клиентом. Обе RPC резолвят club_id из
-- students.club_id ТОГО ученика, к которому уже подтверждён доступ
-- (can_family_access_student/can_trainer_access_student — обе уже
-- существуют в production, сигнатуры проверены перед написанием этой
-- миграции: public.can_family_access_student(p_student_id bigint),
-- public.can_trainer_access_student(p_student_id bigint)).
--
-- ANTI-ENUMERATION: при отказе в доступе (или отсутствии auth.uid())
-- обе RPC возвращают ТОТ ЖЕ по форме ответ, что и "у ученика просто нет
-- текущего Kyu" (status: no_current_kyu, currentKyu/nextKyu: null,
-- techniques: []) — не раскрывают, существует ли student_id вообще и
-- был бы доступ разрешён при других обстоятельствах. Тот же принцип, что
-- уже применён в get-student-preview (invalid_or_expired_token — один
-- ответ на все причины отказа).
--
-- RESPONSE MODEL (единый контракт Family/Trainer):
--   { currentKyu: text|null, nextKyu: text|null,
--     status: 'ok'|'no_current_kyu'|'unmapped_kyu'|'max_level',
--     techniques: [{ technique_id, name, category, main_group,
--                     image_path, youtube_url, youtube_video_id,
--                     sort_order }] }
-- status различает "программа пуста, потому что клуб не настроил"
-- (ok, techniques: []) от "current Kyu не определён/не распознан/уже
-- максимальный" — эти случаи НЕ путаются.
--
-- ТЕСТОВЫЕ ДАННЫЕ: в production для club_id='jcl'/6. Kyu уже существует
-- несколько техник, сохранённых пользователем вручную через
-- /trainer/kyu-program для проверки интерфейса. Эта миграция их не
-- создаёт, не удаляет и не хардкодит — просто читает то, что реально
-- сохранено в club_kyu_program_items на момент вызова.

-- ── SHARED RESOLVER ──────────────────────────────────────────────────────
create or replace function public.resolve_next_kyu_lookup_id(p_current_kyu_grad text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_input text;
  v_is_current_valid boolean;
  v_number integer;
  v_next_number integer;
  v_next_id bigint;
begin
  v_input := nullif(trim(p_current_kyu_grad), '');
  if v_input is null then
    return null;
  end if;

  -- Подтверждаем, что вход реально существует в kyu_lookup И является
  -- именно Kyu-строкой (не Dan, не произвольный текст) — регистронезависимое
  -- сравнение с trim, тот же best-effort приём, что уже принят в проекте
  -- (см. get-student-preview buildTechniqueProgress: belt_key сопоставление).
  select true
    into v_is_current_valid
  from public.kyu_lookup kl
  where lower(trim(kl.kyu_grad)) = lower(v_input)
    and kl.kyu_grad ilike '%Kyu%'
  limit 1;

  if v_is_current_valid is not true then
    return null;
  end if;

  -- Номер разбирается из ТЕКСТА ("7. Kyu" -> 7), НЕ из kyu_lookup.id —
  -- id+1 сознательно не используется (см. комментарий в шапке файла).
  v_number := (regexp_match(v_input, '^(\d+)\s*\.\s*Kyu$', 'i'))[1]::integer;

  if v_number is null or v_number <= 1 then
    -- v_number is null практически недостижимо (v_is_current_valid уже
    -- подтвердил формат реальной строкой kyu_lookup) — оставлено как
    -- defensive-условие. v_number <= 1: "1. Kyu" -> следующего
    -- поддерживаемого Kyu нет, переход в "1. Dan" на этом этапе не строится.
    return null;
  end if;

  v_next_number := v_number - 1;

  select kl.id
    into v_next_id
  from public.kyu_lookup kl
  where lower(trim(kl.kyu_grad)) = lower(v_next_number || '. kyu')
    and kl.kyu_grad ilike '%Kyu%'
  limit 1;

  return v_next_id;
end;
$$;

comment on function public.resolve_next_kyu_lookup_id(text) is
  'current Kyu (students.kyu_grad, свободный текст) -> kyu_lookup.id следующего Kyu. НЕ использует id+1. Возвращает NULL для NULL/пустой строки/текста, не совпадающего ни с одной Kyu-строкой kyu_lookup (включая Dan)/"1. Kyu" (максимальный поддерживаемый уровень, Dan не строится). Вызывающие RPC сами определяют точную причину NULL (no_current_kyu/unmapped_kyu/max_level) — эта функция намеренно возвращает только bigint|NULL, без статуса.';

revoke all on function public.resolve_next_kyu_lookup_id(text) from public;
revoke all on function public.resolve_next_kyu_lookup_id(text) from anon;
revoke all on function public.resolve_next_kyu_lookup_id(text) from authenticated;

-- ── FAMILY READ PATH ─────────────────────────────────────────────────────
create or replace function public.get_family_required_techniques(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
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
  if (select auth.uid()) is null then
    return v_empty_result;
  end if;

  if not public.can_family_access_student(p_student_id) then
    return v_empty_result;
  end if;

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

comment on function public.get_family_required_techniques(bigint) is
  'Family read-path для "Необходимые техники" (программа СЛЕДУЮЩЕГО Kyu, club-wide). Доступ — can_family_access_student(p_student_id). club_id ТОЛЬКО из students.club_id уже проверенного ученика, никогда не от клиента. Отказ в доступе и "нет current Kyu" дают одинаковый по форме ответ (anti-enumeration).';

revoke all on function public.get_family_required_techniques(bigint) from public;
revoke all on function public.get_family_required_techniques(bigint) from anon;
grant execute on function public.get_family_required_techniques(bigint) to authenticated;

-- ── TRAINER READ PATH ────────────────────────────────────────────────────
create or replace function public.get_trainer_required_techniques(p_student_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
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
  if (select auth.uid()) is null then
    return v_empty_result;
  end if;

  if not public.can_trainer_access_student(p_student_id) then
    return v_empty_result;
  end if;

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

comment on function public.get_trainer_required_techniques(bigint) is
  'Trainer read-path для "Необходимые техники" (программа СЛЕДУЮЩЕГО Kyu, club-wide). Доступ — can_trainer_access_student(p_student_id). club_id ТОЛЬКО из students.club_id уже проверенного ученика, никогда не от клиента. Отказ в доступе и "нет current Kyu" дают одинаковый по форме ответ (anti-enumeration).';

revoke all on function public.get_trainer_required_techniques(bigint) from public;
revoke all on function public.get_trainer_required_techniques(bigint) from anon;
grant execute on function public.get_trainer_required_techniques(bigint) to authenticated;

-- Прямой доступ к club_kyu_program_items НЕ открывается ни для Family, ни
-- для Trainer — таблица уже RLS-enabled без policy (миграция 20260917120060),
-- эта миграция НЕ добавляет к ней ни одной policy и ни одного grant. Весь
-- доступ — только через две RPC выше.
